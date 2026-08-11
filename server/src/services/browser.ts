// ===== General-purpose web browser reverse proxy =====
// Fetches an arbitrary http/https page, rewrites all URLs so navigation stays
// inside the proxy (so it can be embedded in an iframe), strips frame-blocking
// headers/meta, and injects a postMessage script so the parent window (the
// Browser app) can keep its address bar in sync with the real URL.
//
// A per-user in-memory cookie jar persists login sessions across navigations
// (refreshed on each request, ~24h TTL). Cookies are scoped per host.

import { load } from "cheerio";
import { isBlockedHost, validateUrl } from "./fetcher";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 Mavino/1.0 (+https://github.com/mavino/student-os)";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 8;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB raw HTML cap
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Sites known to refuse iframe embedding even with anti-frame-bust JS.
 *  These auto-fallback to the external browser. The BrowserApp checks this
 *  list (via the /api/browser/embeddable endpoint) before attempting to load. */
const NON_EMBEDDABLE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "twitter.com",
  "x.com",
  "www.x.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "netflix.com",
  "www.netflix.com",
  "chatgpt.com",
  "chat.openai.com",
]);

/** Check if a URL's host is known to refuse iframe embedding. */
export function isEmbeddable(url: string): boolean {
  try {
    const u = new URL(url);
    return !NON_EMBEDDABLE_HOSTS.has(u.hostname);
  } catch {
    return true; // If we can't parse it, let the proxy try.
  }
}

// ===== Per-user cookie jar =====

interface CookieEntry {
  name: string;
  value: string;
  domain: string; // host (hostname) the cookie was set for
  path: string;
  expires?: number; // epoch ms; if absent, session cookie
}

interface BrowserSession {
  cookies: CookieEntry[];
  expiresAt: number;
}

const sessions = new Map<string, BrowserSession>();

function getSession(userId: string): BrowserSession {
  const now = Date.now();
  let s = sessions.get(userId);
  if (!s || s.expiresAt < now) {
    s = { cookies: [], expiresAt: now + SESSION_TTL_MS };
    sessions.set(userId, s);
  }
  // Refresh TTL on activity.
  s.expiresAt = now + SESSION_TTL_MS;
  return s;
}

/** Parse a single Set-Cookie header value into a CookieEntry. */
function parseSetCookie(header: string, requestHost: string, requestPath: string): CookieEntry | null {
  if (!header) return null;
  const parts = header.split(";");
  if (!parts.length) return null;
  const nv = parts[0].trim();
  const eq = nv.indexOf("=");
  if (eq < 0) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;
  let domain = requestHost;
  let path = "/";
  let expires: number | undefined;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i].trim();
    const peq = p.indexOf("=");
    const k = (peq >= 0 ? p.slice(0, peq) : p).trim().toLowerCase();
    const v = peq >= 0 ? p.slice(peq + 1).trim() : "";
    if (k === "domain" && v) {
      // Normalize: strip leading dot.
      domain = v.replace(/^\./, "").toLowerCase();
    } else if (k === "path" && v) {
      path = v;
    } else if (k === "max-age" && v) {
      const secs = parseInt(v, 10);
      if (!isNaN(secs)) expires = secs > 0 ? Date.now() + secs * 1000 : 0;
    } else if (k === "expires" && v) {
      const t = Date.parse(v);
      if (!isNaN(t)) expires = t;
    }
  }
  return { name, value, domain, path, expires };
}

/** True if a cookie applies to the given host (domain match). */
function cookieMatchesHost(c: CookieEntry, host: string): boolean {
  const h = host.toLowerCase();
  const d = c.domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** True if a cookie applies to the given path. */
function cookieMatchesPath(c: CookieEntry, path: string): boolean {
  if (!c.path || c.path === "/") return true;
  const p = path || "/";
  return p === c.path || p.startsWith(c.path.endsWith("/") ? c.path : c.path + "/");
}

/** Build a Cookie header string for the given URL from the user's jar. */
function cookieHeader(session: BrowserSession, url: URL): string {
  const now = Date.now();
  const valid = session.cookies.filter(
    (c) => (c.expires === undefined || c.expires > now) &&
      cookieMatchesHost(c, url.hostname) &&
      cookieMatchesPath(c, url.pathname || "/")
  );
  if (!valid.length) return "";
  return valid.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Merge Set-Cookie headers from a response into the user's jar. */
function absorbSetCookies(
  session: BrowserSession,
  setCookieHeaders: string[],
  requestUrl: URL
): void {
  const now = Date.now();
  for (const raw of setCookieHeaders) {
    const entry = parseSetCookie(raw, requestUrl.hostname, requestUrl.pathname || "/");
    if (!entry) continue;
    // Delete: expires in the past or max-age=0 → remove matching cookie.
    if (entry.expires !== undefined && entry.expires <= now) {
      session.cookies = session.cookies.filter(
        (c) => !(c.name === entry.name && c.domain === entry.domain && c.path === entry.path)
      );
      continue;
    }
    // Upsert.
    const idx = session.cookies.findIndex(
      (c) => c.name === entry.name && c.domain === entry.domain && c.path === entry.path
    );
    if (idx >= 0) session.cookies[idx] = entry;
    else session.cookies.push(entry);
  }
}

/** Clear a user's cookie jar (log out / clear session). */
export function clearBrowserSession(userId: string): void {
  sessions.delete(userId);
}

// ===== Fetching =====

interface FetchResult {
  buffer: Buffer;
  finalUrl: string;
  contentType: string;
  /** HTTP status code (for non-2xx pass-through of non-HTML responses). */
  status?: number;
}

/** Fetch a resource following redirects manually, validating each hop + collecting cookies. */
async function fetchResource(
  userId: string,
  url: URL
): Promise<FetchResult> {
  const session = getSession(userId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let current = url;
  let redirects = 0;
  try {
    for (;;) {
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      };
      const cookie = cookieHeader(session, current);
      if (cookie) headers["Cookie"] = cookie;

      const res = await fetch(current, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      // Absorb any Set-Cookie from this hop.
      const setCookies = res.headers.getSetCookie?.() ?? [];
      if (setCookies.length) absorbSetCookies(session, setCookies, current);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc || ++redirects > MAX_REDIRECTS) {
          throw new Error("Too many redirects");
        }
        current = new URL(loc, current);
        if (isBlockedHost(current.hostname)) {
          throw new Error(`Redirect to blocked host '${current.hostname}'`);
        }
        continue;
      }
      if (!res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        // For non-HTML responses (JS, CSS, JSON, images, API calls), pass
        // through error responses (4xx/5xx) so the browser/JS can handle
        // them gracefully. Only throw for HTML pages (which are navigated
        // to directly and need a meaningful error message).
        if (/text\/html|application\/xhtml/i.test(contentType)) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        // Non-HTML error response — read the body and return it with the
        // original status so the client sees the real error code.
        const reader = res.body?.getReader();
        if (!reader) {
          return { buffer: Buffer.alloc(0), finalUrl: current.toString(), contentType: contentType || "application/octet-stream", status: res.status };
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > MAX_BYTES) {
              await reader.cancel();
              break;
            }
            chunks.push(value);
          }
        }
        return { buffer: Buffer.concat(chunks), finalUrl: current.toString(), contentType: contentType || "application/octet-stream", status: res.status };
      }
      const contentType = res.headers.get("content-type") ?? "";
      // Read with a size cap.
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new Error("Response too large (max 8 MB)");
          }
          chunks.push(value);
        }
      }
      const buffer = Buffer.concat(chunks);
      return { buffer, finalUrl: current.toString(), contentType };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ===== URL rewriting + page injection =====

/**
 * Script injected into every proxied HTML page. Runs before the page's own
 * scripts (injected at the top of <head>) so it can patch the runtime APIs
 * that sites use for navigation + data loading:
 *  - fetch / XMLHttpRequest: rewrite same-origin + relative URLs to route
 *    through the proxy (so /youtubei/v1/... hits the proxy, which passes the
 *    JSON response through).
 *  - Link clicks: intercept ALL <a> clicks (including dynamically-created
 *    links), resolve the raw href against the real page URL, and navigate
 *    the iframe to the proxy URL for that page.
 *  - history.pushState / replaceState: postMessage the target URL to the
 *    parent so the Browser app navigates the iframe to the proxy URL.
 *  - location.href / .assign / .replace: intercept JS redirects.
 *  - Form submissions: intercept GET forms, serialize + navigate to proxy.
 *  - window.open: open real URLs directly in a new browser tab.
 *  - Reports the real final URL + title to the parent for address-bar sync.
 */
// ===== Anti-frame-bust script =====
// Injected at the VERY TOP of <head>, before any page scripts run. Makes
// JS frame-busting code (if (top !== self) top.location = ...) think the
// page is NOT in an iframe, so it doesn't try to break out. The sandbox
// attribute (no allow-top-navigation) is a second layer of defense — even
// if a script does try to navigate top, the browser blocks it.
//
// Also fakes document.URL / documentURI / referrer so scripts that check
// the current URL see the real site URL, not the proxy URL. This is critical
// for SPAs (Google, GitHub, Reddit) that redirect or hide content when they
// detect they're not on the expected origin.

const ANTI_FRAME_BUST_SCRIPT = `<script>(function(){
  "use strict";
  var INITIAL_URL = __ATHENA_FINAL_URL__;
  // Mutable real-URL state. The INTERCEPT_SCRIPT updates this when
  // pushState/replaceState is called so fake location getters return the
  // current (not initial) URL — critical for SPA client-side routing.
  window.__athenaRealUrl = window.__athenaRealUrl || INITIAL_URL;
  function realUrl() { return window.__athenaRealUrl || INITIAL_URL; }
  try {
    // Make window.top / parent / self all point to window itself.
    Object.defineProperty(window, "top", { get: function() { return window; }, configurable: true });
    Object.defineProperty(window, "parent", { get: function() { return window; }, configurable: true });
    Object.defineProperty(window, "self", { get: function() { return window; }, configurable: true });
    Object.defineProperty(window, "frameElement", { get: function() { return null; }, configurable: true });
  } catch(e) {}
  // Fake document URL properties so scripts see the real URL, not the proxy.
  // Use dynamic getters so they stay in sync after pushState/replaceState.
  try {
    Object.defineProperty(document, "URL", { get: realUrl, configurable: true });
    Object.defineProperty(document, "documentURI", { get: realUrl, configurable: true });
    Object.defineProperty(document, "baseURI", { get: realUrl, configurable: true });
    Object.defineProperty(document, "referrer", { get: function() { return ""; }, configurable: true });
    Object.defineProperty(document, "domain", { get: function() { try { return new URL(realUrl()).hostname; } catch(e) { return ""; } }, configurable: true });
  } catch(e) {}
  // Try to fake location properties (may fail — location is non-configurable
  // in some browsers). Use dynamic getters derived from realUrl() so they
  // stay in sync after pushState/replaceState.
  try {
    var loc = window.location;
    var props = ["href", "origin", "host", "hostname", "protocol", "pathname", "search", "hash"];
    for (var i = 0; i < props.length; i++) {
      var key = props[i];
      try {
        Object.defineProperty(loc, key, {
          get: (function(k) {
            return function() {
              try { var u = new URL(realUrl()); return u[k]; } catch(e) { return ""; }
            };
          })(key),
          configurable: true,
        });
      } catch(e) {}
    }
  } catch(e) {}
})();<\/script>`;

const INTERCEPT_SCRIPT = `<script>(function(){
  var ORIGIN = __ATHENA_ORIGIN__;
  var FINAL_URL = __ATHENA_FINAL_URL__;
  // Capture the real proxy origin NOW — this script runs before the
  // ANTI_FRAME_BUST script fakes location properties, so window.location
  // is still the real proxy location (e.g. http://localhost:3001).
  var PROXY_ORIGIN = window.location.origin;
  var PROXY = PROXY_ORIGIN + "/api/browser/proxy?url=";
  var TOKEN = __ATHENA_TOKEN__;
  function toProxy(u) {
    try {
      if (!u) return u;
      var s = String(u);
      if (!s || s.charAt(0) === "#" || /^(javascript|mailto|tel|data|blob):/i.test(s)) return s;
      // Skip URLs that already point to the proxy (absolute or relative).
      if (s.indexOf(PROXY) >= 0 || s.indexOf("/api/browser/proxy?url=") >= 0) return s;
      var abs = new URL(s, FINAL_URL);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return s;
      // If the request points to the proxy/iframe origin (same-origin),
      // it's a relative URL that the browser resolved against the iframe's
      // actual origin (e.g. http://localhost:5173/api/foo) instead of the
      // real site origin. Rewrite it to the real site's equivalent path.
      if (abs.origin === PROXY_ORIGIN) {
        abs = new URL(abs.pathname + abs.search, FINAL_URL);
      }
      return PROXY + encodeURIComponent(abs.href) + (TOKEN ? "&token=" + encodeURIComponent(TOKEN) : "");
    } catch(e) { return u; }
  }
  // --- fetch ---
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function(input, init) {
      try {
        if (typeof input === "string") input = toProxy(input);
        else if (input && input.url) input = new Request(toProxy(input.url), input);
      } catch(e) {}
      return origFetch.call(this, input, init);
    };
  }
  // --- XMLHttpRequest ---
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    arguments[1] = toProxy(url);
    return origOpen.apply(this, arguments);
  };
  // --- Dynamic <script> / <link> / <img> src/href interception ---
  // SPAs like DuckDuckGo dynamically create <script> tags to load data
  // (e.g. DDG.deep.initialize creates a <script src="/d.js?...&jsa=...">
  // to complete a bot-detection challenge). Without interception, the
  // relative URL resolves against the iframe's actual origin (localhost)
  // instead of the real site, so the request never reaches the real server.
  // We override the src/href property setters on the relevant element
  // prototypes so any dynamically-created resource URL is proxied.
  function patchElementSrc(proto, attr) {
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, attr);
      if (!desc) return;
      var origSet = desc.set;
      Object.defineProperty(proto, attr, {
        get: desc.get,
        set: function(v) {
          try { v = toProxy(v); } catch(e) {}
          if (origSet) return origSet.call(this, v);
          // Fallback: use setAttribute
          this.setAttribute(attr, v);
        },
        configurable: true,
      });
    } catch(e) {}
  }
  patchElementSrc(HTMLScriptElement.prototype, "src");
  patchElementSrc(HTMLImageElement.prototype, "src");
  patchElementSrc(HTMLLinkElement.prototype, "href");
  // Also intercept setAttribute('src'/'href', ...) calls on these elements.
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    try {
      if (this instanceof HTMLScriptElement && name === "src") value = toProxy(value);
      else if (this instanceof HTMLImageElement && name === "src") value = toProxy(value);
      else if (this instanceof HTMLLinkElement && name === "href") value = toProxy(value);
    } catch(e) {}
    return origSetAttribute.call(this, name, value);
  };
  // MutationObserver as a safety net: catch any <script>/<link>/<img> that
  // was inserted into the DOM without going through the property setter
  // (e.g. via innerHTML, document.write, or insertAdjacentHTML).
  try {
    var observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          // Check the node itself + its descendants (for innerHTML batches).
          var els = [node];
          if (node.querySelectorAll) {
            var children = node.querySelectorAll("script[src], img[src], link[href]");
            for (var k = 0; k < children.length; k++) els.push(children[k]);
          }
          for (var k = 0; k < els.length; k++) {
            var el = els[k];
            if (el.tagName === "SCRIPT") {
              var s = el.getAttribute("src");
              if (s && s.indexOf("/api/browser/proxy") < 0) {
                try { el.setAttribute("src", toProxy(s)); } catch(e) {}
              }
            } else if (el.tagName === "IMG") {
              var s = el.getAttribute("src");
              if (s && s.indexOf("/api/browser/proxy") < 0) {
                try { el.setAttribute("src", toProxy(s)); } catch(e) {}
              }
            } else if (el.tagName === "LINK") {
              var h = el.getAttribute("href");
              if (h && h.indexOf("/api/browser/proxy") < 0) {
                try { el.setAttribute("href", toProxy(h)); } catch(e) {}
              }
            }
          }
        }
      }
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch(e) {}
  // --- history.pushState / replaceState ---
  // SPAs (GitHub, DuckDuckGo, Google) use pushState for client-side routing.
  // We must NOT navigate the iframe on pushState — that would reload the page,
  // re-init the SPA, which calls pushState again → infinite loop.
  // Instead, let pushState/replaceState execute normally (SPA routing works
  // inside the iframe) and just report the new URL to the parent for address
  // bar sync using __athenaBrowser (which updates without navigating).
  function reportUrlToParent(url) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __athenaBrowser: true, url: new URL(url, FINAL_URL).href, title: document.title || "" }, "*");
      }
    } catch(e) {}
  }
  // navToParent asks the BrowserApp to navigate the iframe to a new proxy URL
  // (pushes onto history). Used for link clicks and form submits — genuine
  // user-initiated navigations that should load a new page.
  function navToParent(url) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __athenaBrowserNav: true, url: new URL(url, FINAL_URL).href }, "*");
      }
    } catch(e) {}
  }
  var origPush = history.pushState;
  history.pushState = function(state, title, url) {
    if (url) {
      try { window.__athenaRealUrl = new URL(url, FINAL_URL).href; } catch(e) {}
    }
    var result = origPush.apply(this, arguments);
    if (url) reportUrlToParent(url);
    return result;
  };
  var origReplace = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (url) {
      try { window.__athenaRealUrl = new URL(url, FINAL_URL).href; } catch(e) {}
    }
    var result = origReplace.apply(this, arguments);
    if (url) reportUrlToParent(url);
    return result;
  };
  // --- location.href / .assign / .replace ---
  // Intercept navigation to proxy the target URL. BUT: if the target real URL
  // is the same as the current real URL (window.__athenaRealUrl), skip the
  // navigation entirely — SPAs often read location.href (which we fake to the
  // real URL), "normalize" it, and call location.replace(normalizedUrl). Without
  // this guard, that would proxy the URL → iframe navigates → page reloads →
  // SPA normalizes again → infinite loop.
  function resolveReal(url) {
    try { return new URL(url, FINAL_URL).href; } catch(e) { return null; }
  }
  function isSamePage(url) {
    var target = resolveReal(url);
    return target && target === window.__athenaRealUrl;
  }
  try {
    var origAssign = Location.prototype.assign;
    Location.prototype.assign = function(url) {
      if (isSamePage(url)) return;
      return origAssign.call(this, toProxy(url));
    };
    var origReplaceLoc = Location.prototype.replace;
    Location.prototype.replace = function(url) {
      if (isSamePage(url)) return;
      return origReplaceLoc.call(this, toProxy(url));
    };
    var hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    if (hrefDesc && hrefDesc.set) {
      var origHrefSet = hrefDesc.set;
      Object.defineProperty(Location.prototype, "href", {
        get: hrefDesc.get,
        set: function(url) {
          if (isSamePage(url)) return;
          return origHrefSet.call(this, toProxy(url));
        },
        configurable: true,
      });
    }
  } catch(e) {}
  // --- window.open (open real URL in a real new tab, not proxied) ---
  var origWinOpen = window.open;
  window.open = function(url, target, features) {
    try {
      if (url) {
        var s = String(url);
        if (/^https?:/i.test(s) && s.indexOf("/api/browser/proxy") < 0) {
          return origWinOpen.call(this, s, target || "_blank", features);
        }
      }
    } catch(e) {}
    return origWinOpen.apply(this, arguments);
  };
  // --- link click interceptor (handles static + dynamically-created links) ---
  // Reads the RAW href (cheerio doesn't rewrite links), resolves it against
  // the real page URL, and postMessages the parent to navigate. This keeps
  // the BrowserApp's history stack consistent and ensures the proxy URL
  // includes the auth token.
  document.addEventListener("click", function(e) {
    try {
      var link = e.target;
      while (link && link.tagName !== "A") link = link.parentElement;
      if (!link || !link.getAttribute) return;
      var rawHref = link.getAttribute("href");
      if (!rawHref) return;
      // Skip non-navigational hrefs.
      if (rawHref.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(rawHref)) return;
      // Resolve the raw href against the real page URL.
      var abs = new URL(rawHref, FINAL_URL);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey || link.target === "_blank") {
        // Open real URL in a new browser tab (not proxied).
        window.open(abs.href, "_blank");
      } else {
        // Ask the parent (BrowserApp) to navigate — it pushes onto history
        // and sets the iframe src to a tokenized proxy URL.
        navToParent(abs.href);
      }
    } catch(err) {}
  }, true);
  // --- form submit interceptor (GET forms) ---
  document.addEventListener("submit", function(e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;
      var method = (form.getAttribute("method") || "get").toLowerCase();
      if (method !== "get") return; // POST forms: leave as-is for now
      var action = form.getAttribute("action") || FINAL_URL;
      e.preventDefault();
      var url = new URL(action, FINAL_URL);
      var params = new URLSearchParams(new FormData(form));
      url.search = params.toString();
      // Ask the parent to navigate to the form target.
      navToParent(url.toString());
    } catch(err) {}
  }, true);
  // --- report real URL + title to parent ---
  function report() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __athenaBrowser: true, url: FINAL_URL, title: document.title || "" }, "*");
      }
    } catch(e) {}
  }
  report();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function(){ setTimeout(report, 50); });
  } else { setTimeout(report, 50); }
})();<\/script>`;

// ===== Teacher show-control content script =====
// Injected into every proxied HTML page. Listens for postMessage commands from
// the BrowserApp (forwarded from the show-control store) and performs scroll /
// highlight / clear-highlight on the page DOM. This lets the Interactive
// Teacher point at passages in web pages just like it does in Notes/Editor.
const TEACHER_SHOW_SCRIPT = `<script>(function(){
  "use strict";
  var HL_CLASS = "athena-teacher-highlight";
  // Inject the highlight style (the proxied page can't access our app CSS).
  var style = document.createElement("style");
  style.textContent = "mark." + HL_CLASS + "{background:rgba(99,102,241,0.4);border-radius:3px;box-shadow:0 0 0 1.5px rgba(99,102,241,0.6);color:inherit;transition:background 0.2s ease;scroll-margin-block:40vh;}";
  (document.head || document.documentElement).appendChild(style);
  var currentMarks = [];

  function clearHighlights() {
    for (var i = 0; i < currentMarks.length; i++) {
      var m = currentMarks[i];
      var parent = m.parentNode;
      if (parent) {
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      }
    }
    currentMarks = [];
  }

  // Build a flat text representation of the page body: a concatenated string
  // plus a map from char offsets back to (textNode, localOffset). This lets us
  // find a passage that may span multiple inline text nodes (e.g. across <br>,
  // <strong>, links) and resolve it to a DOM Range.
  function buildTextMap() {
    var chunks = [];
    var nodes = [];
    var starts = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        var tag = parent.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n = walker.nextNode();
    var offset = 0;
    while (n) {
      var val = n.nodeValue;
      chunks.push(val);
      nodes.push(n);
      starts.push(offset);
      offset += val.length;
      n = walker.nextNode();
    }
    return { text: chunks.join(""), nodes: nodes, starts: starts };
  }

  // Resolve a char offset in the concatenated text to (node, localOffset).
  function offsetToNode(map, off) {
    var nodes = map.nodes, starts = map.starts;
    // binary search for the last start <= off
    var lo = 0, hi = nodes.length - 1, idx = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (starts[mid] <= off) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (idx < 0) return null;
    return { node: nodes[idx], local: off - starts[idx] };
  }

  // Strip surrounding punctuation + lowercase for fuzzy token matching.
  function tokenKey(w) {
    return w.replace(/^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$/gu, "").toLowerCase();
  }

  // Fuzzy: find the densest cluster of phrase tokens in the concatenated text.
  // Returns {from, to} char offsets or null when no cluster scores >= 0.5.
  function fuzzyFind(text, phrase) {
    var pWords = phrase.toLowerCase().split(/\\s+/).map(tokenKey).filter(Boolean);
    if (pWords.length === 0) return null;
    var pTokens = {};
    for (var pi = 0; pi < pWords.length; pi++) pTokens[pWords[pi]] = true;
    var lower = text.toLowerCase();
    var words = [];
    var i = 0;
    while (i < lower.length) {
      while (i < lower.length && /\\s/.test(lower.charAt(i))) i++;
      if (i >= lower.length) break;
      var start = i;
      while (i < lower.length && !/\\s/.test(lower.charAt(i))) i++;
      words.push({ start: start, end: i, key: tokenKey(lower.slice(start, i)) });
    }
    if (words.length === 0) return null;
    var hits = [];
    for (var k = 0; k < words.length; k++) if (pTokens[words[k].key]) hits.push(k);
    var maxGap = Math.max(2, Math.ceil(pWords.length * 0.6));
    var maxSpan = pWords.length * 2 + 4;
    var best = { score: 0, start: -1, end: -1 };
    for (var h = 0; h < hits.length; h++) {
      var seen = {};
      var count = 0;
      var first = hits[h], last = hits[h];
      seen[words[first].key] = true; count = 1;
      for (var k2 = h + 1; k2 < hits.length; k2++) {
        var cur = hits[k2];
        if (cur - last > maxGap) break;
        if (cur - first >= maxSpan) break;
        last = cur;
        if (!seen[words[cur].key]) { seen[words[cur].key] = true; count++; }
      }
      var score = count / pWords.length;
      if (score > best.score) best = { score: score, start: first, end: last };
    }
    if (best.score >= 0.5 && best.start >= 0) {
      return { from: words[best.start].start, to: words[best.end].end };
    }
    return null;
  }

  // Wrap a DOM Range in <mark>, handling ranges that span element boundaries
  // (surroundContents throws on partial selections) by wrapping each text
  // portion individually, last-to-first so earlier offsets aren't shifted.
  function wrapRange(range) {
    var marks = [];
    try {
      var mark = document.createElement("mark");
      mark.className = HL_CLASS;
      range.surroundContents(mark);
      marks.push(mark);
    } catch (e) {
      var root = range.commonAncestorContainer;
      var walkRoot = root.nodeType === 3 ? root.parentNode : root;
      var walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT, null);
      var parts = [];
      var n = walker.nextNode();
      while (n) {
        if (range.intersectsNode(n)) {
          var s = 0, e = n.nodeValue.length;
          if (n === range.startContainer) s = range.startOffset;
          if (n === range.endContainer) e = range.endOffset;
          if (e > s) parts.push({ node: n, s: s, e: e });
        }
        n = walker.nextNode();
      }
      for (var i = parts.length - 1; i >= 0; i--) {
        try {
          var mk = document.createElement("mark");
          mk.className = HL_CLASS;
          var r = document.createRange();
          r.setStart(parts[i].node, parts[i].s);
          r.setEnd(parts[i].node, parts[i].e);
          r.surroundContents(mk);
          marks.push(mk);
        } catch (e2) { /* skip unwrappable */ }
      }
    }
    for (var i2 = 0; i2 < marks.length; i2++) currentMarks.push(marks[i2]);
    return marks;
  }

  // Highlight a passage in the page body. Matches across text nodes, first
  // exactly (case-insensitive), then via fuzzy token overlap so a paraphrased
  // phrase still lands on the right passage instead of nothing.
  function highlightText(text) {
    clearHighlights();
    if (!text || !text.trim()) return false;
    var needle = text.trim();
    var map = buildTextMap();
    if (!map.text) return false;
    var lower = map.text.toLowerCase();
    var needleLower = needle.toLowerCase();
    var from = lower.indexOf(needleLower);
    if (from < 0) {
      var fuzzy = fuzzyFind(map.text, needle);
      if (!fuzzy) return false;
      from = fuzzy.from;
      var to = fuzzy.to;
      return wrapAndScroll(map, from, to);
    }
    return wrapAndScroll(map, from, from + needle.length);
  }

  function wrapAndScroll(map, from, to) {
    var start = offsetToNode(map, from);
    var end = offsetToNode(map, to - 1);
    if (!start || !end) return false;
    var range = document.createRange();
    range.setStart(start.node, start.local);
    range.setEnd(end.node, end.local + 1);
    var marks = wrapRange(range);
    if (marks.length === 0) return false;
    marks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  // Scroll to a passage without highlighting (same matching as highlightText).
  function scrollToText(text) {
    if (!text || !text.trim()) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return true;
    }
    var needle = text.trim();
    var map = buildTextMap();
    if (!map.text) { window.scrollTo({ top: 0, behavior: "smooth" }); return false; }
    var lower = map.text.toLowerCase();
    var from = lower.indexOf(needle.toLowerCase());
    if (from < 0) {
      var fuzzy = fuzzyFind(map.text, needle);
      if (!fuzzy) { window.scrollTo({ top: 0, behavior: "smooth" }); return false; }
      from = fuzzy.from;
    }
    var start = offsetToNode(map, from);
    if (start) {
      var el = start.node.parentElement;
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); return true; }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    return false;
  }

  // Highlight a CSS selector match.
  function highlightSelector(selector) {
    clearHighlights();
    if (!selector) return false;
    var el = document.querySelector(selector);
    if (!el) return false;
    var mark = document.createElement("mark");
    mark.className = HL_CLASS;
    // Wrap the element's contents.
    while (el.firstChild) mark.appendChild(el.firstChild);
    el.appendChild(mark);
    currentMarks.push(mark);
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  window.addEventListener("message", function(e) {
    if (!e.data || !e.data.__athenaTeacherShow) return;
    var d = e.data;
    var ok = false;
    try {
      if (d.kind === "clear_highlight") {
        clearHighlights();
        ok = true;
      } else if (d.kind === "highlight") {
        if (d.selector) ok = highlightSelector(d.selector);
        else if (d.text) ok = highlightText(d.text);
      } else if (d.kind === "scroll_to") {
        if (d.selector) {
          var el = document.querySelector(d.selector);
          if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); ok = true; }
        } else if (d.text) {
          ok = scrollToText(d.text);
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
          ok = true;
        }
      }
    } catch(err) {
      // Never let a highlight error break the page.
    }
    // Tell the Teacher whether the passage was actually found, so it can fall
    // back to quoting the text inline instead of trusting an invisible visual.
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          __athenaTeacherShowResult: true,
          id: d.id,
          kind: d.kind,
          ok: !!ok
        }, "*");
      }
    } catch(err2) { /* noop */ }
  });
})();<\/script>`;

export type ProxiedPage =
  | { kind: "html"; html: string; finalUrl: string; title: string }
  | { kind: "raw"; buffer: Buffer; contentType: string; finalUrl: string; status?: number };

/** Fetch + rewrite a page for iframe embedding (HTML) or pass through (non-HTML). */
export async function proxyPage(
  userId: string,
  rawUrl: string,
  token?: string
): Promise<ProxiedPage> {
  const u = validateUrl(rawUrl);
  const { buffer, finalUrl, contentType, status } = await fetchResource(userId, u);

  // Non-HTML responses (JSON API calls, images, etc.) pass through untouched
  // so runtime fetch/XHR calls from SPAs work through the proxy.
  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    return { kind: "raw", buffer, contentType: contentType || "application/octet-stream", finalUrl, status };
  }

  const html = buffer.toString("utf-8");
  const final = new URL(finalUrl);
  const $ = load(html);

  // NOTE: We deliberately do NOT rewrite <a> hrefs via cheerio. Rewritten
  // proxy links would (a) lack the auth token → 401, and (b) navigate the
  // iframe directly, bypassing the BrowserApp's history stack. Instead, the
  // injected click interceptor (document-level capture listener) reads each
  // link's RAW href, resolves it against the real page URL, and postMessages
  // the parent to navigate — which pushes onto history + builds a tokenized
  // proxy URL. This handles static AND dynamically-created links uniformly.
  //
  // We do NOT inject a <base> tag. It was previously added to help relative
  // resources resolve against the real origin, but it also makes root-relative
  // proxy URLs (like /api/browser/proxy?url=... used for <script src>) resolve
  // against the real origin (e.g. https://duckduckgo.com/api/browser/proxy)
  // instead of the proxy server — breaking script loading. Instead:
  // - Resource URLs (CSS, images) are made absolute against the real origin
  //   in cheerio below.
  // - Script URLs are proxied through /api/browser/proxy (root-relative,
  //   resolves against the iframe's actual origin = the proxy server).
  // - CSS url() inside stylesheets resolves against the stylesheet's URL
  //   (which we make absolute), not document.baseURI.
  // - document.baseURI is faked by the ANTI_FRAME_BUST script to return the
  //   real URL, so JS that reads it gets the correct value.
  // - Relative <a href> and <form action> are handled by the click/submit
  //   interceptors, which resolve against FINAL_URL in JS.
  $("base").remove();

  // Rewrite resource URLs:
  // - <script src>: proxy through /api/browser/proxy so they load same-origin
  //   as the iframe. This is critical for `type="module"` scripts, which
  //   require CORS when loaded cross-origin — without proxying, they fail
  //   silently and SPAs like DuckDuckGo render blank.
  // - Other resources (CSS, images, etc.): make absolute against the real
  //   origin so they load directly (cross-origin loading works for these).
  const proxyBase = `/api/browser/proxy?url=`;
  const tokenSuffix = token ? `&token=${encodeURIComponent(token)}` : "";

  $("script[src]").each((_, el) => {
    const val = $(el).attr("src");
    if (!val || val.startsWith("data:") || val.startsWith("#")) return;
    try {
      let abs: string;
      if (val.startsWith("//")) abs = new URL(val, `https:${val}`).href;
      else if (val.startsWith("http")) abs = val;
      else abs = new URL(val, final).href;
      $(el).attr("src", proxyBase + encodeURIComponent(abs) + tokenSuffix);
    } catch { /* leave */ }
  });

  $("link[href], img[src], source[src], video[src], audio[src], iframe[src]").each((_, el) => {
    const tag = el.tagName;
    const attr = tag === "link" ? "href" : "src";
    const val = $(el).attr(attr);
    if (val && !val.startsWith("http") && !val.startsWith("data:") && !val.startsWith("#") && !val.startsWith("//")) {
      try {
        const abs = new URL(val, final);
        $(el).attr(attr, abs.toString());
      } catch { /* leave */ }
    } else if (val && val.startsWith("//")) {
      try {
        const abs = new URL(val, `https:${val}`);
        $(el).attr(attr, abs.toString());
      } catch { /* leave */ }
    }
  });

  // Strip frame-blocking meta tags and meta refresh redirects (DDG uses one
  // to redirect to the non-JS site as a fallback; if scripts load slowly,
  // the meta refresh can fire before JS renders, showing a blank page).
  $('meta[http-equiv="X-Frame-Options"]').remove();
  $('meta[http-equiv="Content-Security-Policy"]').remove();
  $('meta[http-equiv="refresh"]').remove();

  // Inject the anti-frame-bust script at the VERY TOP of <head>, before any
  // page scripts run. This makes frame-busting JS think the page is not in an
  // iframe and fakes document URL properties so SPAs don't detect the proxy.
  const antiBustScript = ANTI_FRAME_BUST_SCRIPT
    .replace("__ATHENA_FINAL_URL__", JSON.stringify(finalUrl));
  $("head").prepend(antiBustScript);

  // Inject the runtime interception script (fetch/XHR/pushState + URL report)
  // at the TOP of <head> so it patches APIs before the page's scripts run.
  const interceptScript = INTERCEPT_SCRIPT
    .replace("__ATHENA_ORIGIN__", JSON.stringify(final.origin))
    .replace("__ATHENA_FINAL_URL__", JSON.stringify(finalUrl))
    .replace("__ATHENA_TOKEN__", JSON.stringify(token ?? ""));
  $("head").prepend(interceptScript);

  // Inject the Teacher show-control content script (listens for postMessage
  // commands from the BrowserApp and performs scroll/highlight on the page).
  $("head").prepend(TEACHER_SHOW_SCRIPT);

  const title = $("title").first().text().trim() || finalUrl;
  return { kind: "html", html: $.html(), finalUrl, title };
}

// ===== Page text extraction (for Athena's get_browser_content tool) =====

export interface BrowserPageText {
  url: string;
  finalUrl: string;
  title: string;
  content: string;
  contentLength: number;
  truncated: boolean;
}

/** Fetch a URL through the user's cookie jar and extract main article text.
 *  If `selector` is provided, extracts text only from elements matching that
 *  CSS selector (used by Athena's get_browser_content for targeted reading). */
export async function fetchPageText(
  userId: string,
  rawUrl: string,
  maxChars = 20_000,
  selector?: string
): Promise<BrowserPageText> {
  const u = validateUrl(rawUrl);
  const { buffer, finalUrl } = await fetchResource(userId, u);
  const html = buffer.toString("utf-8");
  const $ = load(html);
  $("script, style, noscript, iframe, svg").remove();
  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    finalUrl;

  let main: string;
  if (selector && selector.trim()) {
    // Selector mode: extract text from all elements matching the CSS selector.
    const elements = $(selector);
    main = elements.length > 0 ? elements.text() : "";
  } else {
    // Auto-extract mode: remove boilerplate + pick the main content container.
    $("nav, header, footer, aside, form, button").remove();
    main =
      $("article").first().text() ||
      $("main").first().text() ||
      $("[role=main]").first().text() ||
      $(".content, .article, .post, .entry-content, #content").first().text() ||
      $("body").text();
  }
  let content = (main || "").replace(/\s{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  let truncated = false;
  if (content.length > maxChars) {
    content = content.slice(0, maxChars);
    truncated = true;
  }
  return {
    url: u.toString(),
    finalUrl,
    title: title.slice(0, 500),
    content,
    contentLength: content.length,
    truncated,
  };
}
