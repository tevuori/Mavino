import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import prisma from "../db/client";
import { authMiddlewareWithQuery } from "../middleware/auth";
import { cleanupOrphanLinks } from "../db/links";
import path from "node:path";
import { mkdir, writeFile, unlink, stat, readFile, copyFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { load as cheerioLoad } from "cheerio";
import { decryptSecret } from "../services/crypto";
import { fetchWithVutSession } from "../services/vut";
import { fetchMoodlePage, fetchResourceContent } from "../services/moodle";
import { getStorageStatus } from "../services/storage-quota";

/** True if the file is an integration-managed virtual file (e.g. Moodle). */
function isManagedExternal(record: { externalUrl: string | null; source: string }): boolean {
  return !!record.externalUrl && record.source === "moodle";
}

/**
 * Build a valid Content-Disposition header for an arbitrary filename.
 * Non-ASCII / control chars are not allowed in a quoted-string, so we emit
 * both an ASCII fallback (`filename="safe"`) and a UTF-8 encoded
 * `filename*=UTF-8''...` per RFC 5987/6266. This avoids the
 * "Header 'Content-Disposition' has invalid value" error Bun throws on names
 * like "Zadání prvního termínu 2026 Složka".
 */
function contentDisposition(name: string): string {
  const safe = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'").slice(0, 200) || "file";
  const encoded = encodeURIComponent(name.slice(0, 200)).replace(/['()]/g, escape);
  return `inline; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

/**
 * Stream a Moodle virtual file's content through the user's VUT session.
 * Re-authenticates if Moodle returns a login page. Returns a Response suitable
 * for inline delivery to the client.
 */
async function proxyMoodleFile(userId: string, record: { externalUrl: string | null; name: string; mimeType: string }): Promise<Response> {
  if (!record.externalUrl) return new Response("Missing external URL", { status: 500 });
  const creds = await prisma.vutCredentials.findUnique({ where: { userId } });
  if (!creds) return new Response("VUT credentials not configured", { status: 400 });

  const fetchOnce = async (): Promise<Response> => {
    const r = await fetchWithVutSession(userId, record.externalUrl!);
    // fetchWithVutSession consumes HTML 200s to check for redirects and
    // re-wraps them; for non-HTML the body stream is intact. If this is an
    // HTML page, sniff for a Moodle login form to decide whether to re-auth.
    const ct = r.headers.get("content-type") ?? "";
    if (r.status === 200 && (ct.includes("text/html") || ct.includes("application/xhtml"))) {
      const text = await r.text();
      if (text.includes("loginform") || text.includes("Přihlásit se účtem VUT")) {
        // Signal a re-auth is needed.
        return new Response(text, { status: 401, headers: r.headers });
      }
      // A mod/resource "view" page embeds the actual file behind a download
      // link. Resolve it and fetch the real (binary) content instead of
      // returning the wrapper HTML.
      const downloadUrl = extractMoodleDownloadLink(text, record.externalUrl!);
      if (downloadUrl) {
        return fetchWithVutSession(userId, downloadUrl);
      }
      // Genuine content page — re-wrap the consumed body.
      return new Response(text, { status: 200, headers: r.headers });
    }
    return r;
  };

  try {
    let resp = await fetchOnce();
    if (resp.status === 401) {
      // Re-auth via the VUT/Moodle SSO flow, then retry once.
      const password = decryptSecret(creds.passwordEnc);
      await fetchMoodlePage(userId, record.externalUrl, { username: creds.username, password });
      resp = await fetchOnce();
    }
    if (resp.status === 401) {
      return new Response("Moodle login failed — re-enter VUT credentials in the VUT app", { status: 401 });
    }
    if (!resp.ok) {
      console.error(`[files] Moodle proxy failed for ${record.externalUrl}: status ${resp.status}`);
      return new Response(`Failed to fetch Moodle resource (status ${resp.status})`, { status: 502 });
    }
    const headers = new Headers(resp.headers);
    headers.set("Content-Type", record.mimeType || headers.get("content-type") || "application/octet-stream");
    headers.set("Content-Disposition", contentDisposition(record.name));
    return new Response(resp.body, { status: 200, headers });
  } catch (e) {
    console.error(`[files] Moodle proxy error for ${record.externalUrl}:`, e);
    return new Response(`Failed to fetch Moodle resource: ${(e as Error).message}`, { status: 502 });
  }
}

/**
 * From a Moodle mod/resource view page, extract the actual file download URL.
 * Moodle wraps downloads in links like /mod/resource/content/...?forcedownload=1
 * or pluginfile.php URLs. Returns an absolute URL or null.
 */
function extractMoodleDownloadLink(html: string, baseUrl: string): string | null {
  const $ = cheerioLoad(html);
  const href =
    $('a[href*="forcedownload"]').first().attr("href") ||
    $('a[href*="/mod/resource/content/"]').first().attr("href") ||
    $(".resourcework a, .resourcelink a").first().attr("href") ||
    $('a.aalink[href*="pluginfile"]').first().attr("href") ||
    $('a[href*="pluginfile.php"]').first().attr("href");
  if (!href) return null;
  return href.startsWith("http") ? href : new URL(href, baseUrl).href;
}

const files = new Hono();
// Files routes use the query-token-accepting middleware because file downloads
// are loaded via <img>/<iframe> src attributes that can't set Authorization headers.
files.use("*", authMiddlewareWithQuery);

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

async function ensureUploadDir(userId: string) {
  const dir = path.join(UPLOAD_DIR, userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Heuristic: is this a text-based mime type we can safely edit/preview as text? */
function isTextMime(mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json") return true;
  if (mime === "application/xml") return true;
  if (mime === "application/javascript") return true;
  if (mime === "application/x-sh") return true;
  if (mime === "application/x-yaml") return true;
  if (mime.includes("yaml")) return true;
  if (mime.includes("csv")) return true;
  // Many servers send octet-stream for code files; extension check happens upstream.
  return false;
}

/** Common code/text extensions (used when mime is octet-stream). */
const TEXT_EXT = new Set([
  "txt","md","markdown","js","jsx","ts","tsx","mjs","cjs","json","json5","html",
  "htm","css","scss","sass","less","xml","svg","py","rb","php","go","rs","java",
  "c","h","cpp","hpp","cc","cs","kt","swift","sh","bash","zsh","fish","ps1",
  "yml","yaml","toml","ini","cfg","conf","env","gitignore","sql","graphql",
  "gql","vue","svelte","astro","lua","pl","r","dart","scala","clj","ex","exs",
  "erl","hs","ml","nim","v","zig","makefile","dockerfile","tf","hcl","log",
  "csv","tsv","diff","patch","lock","editorconfig","prettierrc","eslintrc",
]);

export function isTextFile(name: string, mime: string): boolean {
  if (isTextMime(mime)) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXT.has(ext)) return true;
  const base = path.basename(name).toLowerCase();
  if (base === "makefile" || base === "dockerfile" || base.startsWith(".")) return true;
  return false;
}

// ---------- Folders ----------
const folderSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().nullable().optional(),
});

files.get("/folders", async (c) => {
  const { userId } = c.get("auth");
  const parentId = c.req.query("parentId");
  const where: Record<string, unknown> = { userId };
  if (parentId) where.parentId = parentId === "null" ? null : parentId;
  const folders = await prisma.vFolder.findMany({ where: where as never, orderBy: { name: "asc" } });
  return c.json({ folders });
});

files.post("/folders", zValidator("json", folderSchema), async (c) => {
  const { userId } = c.get("auth");
  const body = c.req.valid("json");
  const folder = await prisma.vFolder.create({
    data: { ...body, userId, parentId: body.parentId ?? null },
  });
  return c.json({ folder }, 201);
});

files.delete("/folders/:id", async (c) => {
  const { userId } = c.get("auth");
  // Cascade delete handled by Prisma relation; also wipe files on disk.
  const folder = await prisma.vFolder.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!folder) return c.json({ error: "Not found" }, 404);
  // Collect all descendant file storage keys to remove from disk.
  const allFolders = await prisma.vFolder.findMany({ where: { userId } });
  const byParent = new Map<string | null, typeof allFolders>();
  for (const f of allFolders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const toDelete: string[] = [folder.id];
  const stack = [folder.id];
  while (stack.length) {
    const cur = stack.pop()!;
    const kids = byParent.get(cur) ?? [];
    for (const k of kids) {
      toDelete.push(k.id);
      stack.push(k.id);
    }
  }
  const descendantFiles = await prisma.vFile.findMany({
    where: { userId, folderId: { in: toDelete } },
    select: { storageKey: true },
  });
  await prisma.vFolder.delete({ where: { id: folder.id, userId } });
  for (const f of descendantFiles) {
    await unlink(path.join(UPLOAD_DIR, f.storageKey)).catch(() => {});
  }
  return c.json({ ok: true });
});

// Rename folder
const renameFolderSchema = z.object({ name: z.string().min(1).max(64) });
files.patch("/folders/:id", zValidator("json", renameFolderSchema), async (c) => {
  const { userId } = c.get("auth");
  const { name } = c.req.valid("json");
  const folder = await prisma.vFolder.updateMany({
    where: { id: c.req.param("id"), userId },
    data: { name },
  });
  if (folder.count === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Move folder under a new parent (or root)
const moveFolderSchema = z.object({ parentId: z.string().nullable() });
files.patch("/folders/:id/move", zValidator("json", moveFolderSchema), async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  const { parentId } = c.req.valid("json");

  if (parentId === id) return c.json({ error: "Cannot move folder into itself" }, 400);

  // Cycle detection: parentId must not be a descendant of id.
  if (parentId !== null) {
    const allFolders = await prisma.vFolder.findMany({ where: { userId } });
    const byParent = new Map<string | null, typeof allFolders>();
    for (const f of allFolders) {
      const key = f.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    }
    const descendants = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of byParent.get(cur) ?? []) {
        if (!descendants.has(child.id)) {
          descendants.add(child.id);
          stack.push(child.id);
        }
      }
    }
    if (descendants.has(parentId)) {
      return c.json({ error: "Cannot move folder into its own descendant" }, 400);
    }
    // Verify target parent exists & belongs to user
    const target = allFolders.find((f) => f.id === parentId);
    if (!target) return c.json({ error: "Target folder not found" }, 404);
  }

  const res = await prisma.vFolder.updateMany({
    where: { id, userId },
    data: { parentId: parentId ?? null },
  });
  if (res.count === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---------- Files ----------
files.get("/", async (c) => {
  const { userId } = c.get("auth");
  const folderId = c.req.query("folderId");
  const where: Record<string, unknown> = { userId };
  if (folderId) where.folderId = folderId === "null" ? null : folderId;
  const list = await prisma.vFile.findMany({ where: where as never, orderBy: { name: "asc" } });
  return c.json({ files: list });
});

// Flat list with optional filters: ?q= (name search), ?starred=true, ?recent=true
files.get("/all", async (c) => {
  const { userId } = c.get("auth");
  const q = c.req.query("q")?.trim();
  const starred = c.req.query("starred") === "true";
  const recent = c.req.query("recent") === "true";
  const where: Record<string, unknown> = { userId };
  if (starred) where.starred = true;
  if (q) where.name = { contains: q };
  const orderBy = recent
    ? { lastOpenedAt: "desc" as const }
    : { name: "asc" as const };
  const list = await prisma.vFile.findMany({
    where: where as never,
    orderBy,
    ...(recent ? { take: 20 } : {}),
  });
  return c.json({ files: list });
});

// Recursive folder tree (for sidebar)
files.get("/tree", async (c) => {
  const { userId } = c.get("auth");
  const [folders, fileCounts] = await Promise.all([
    prisma.vFolder.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.vFile.groupBy({
      by: ["folderId"],
      where: { userId },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map<string, number>();
  for (const row of fileCounts) {
    const key = row.folderId ?? "__root__";
    countMap.set(key, (countMap.get(key) ?? 0) + row._count._all);
  }
  return c.json({ folders, fileCounts: countMap });
});

// Storage usage
files.get("/storage", async (c) => {
  const { userId } = c.get("auth");
  const [agg, status] = await Promise.all([
    prisma.vFile.aggregate({
      where: { userId, storageKey: { not: "" }, source: { not: "moodle" } },
      _sum: { size: true },
      _count: { _all: true },
    }),
    getStorageStatus(userId),
  ]);
  return c.json({
    total: status.used,
    count: agg._count._all ?? 0,
    limit: status.limit,
  });
});

/** Max per-upload size for the general /files/upload endpoint (100 MB).
 *  The global Bun limit (2 GB) exists for lecture video processing, but
 *  general file uploads should be capped to prevent abuse. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** File extensions blocked from upload for security. These are executable or
 *  system-level file types that have no legitimate place in a student file
 *  manager and could be used to stage malware (especially on Windows hosts
 *  that might later download these files). */
const BLOCKED_UPLOAD_EXT = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "sh", "ps1", "psm1",
  "jar", "war", "dll", "so", "dylib", "sys", "drv", "ocx",
  "vbs", "vba", "vb", "wsf", "wsh", "hta", "cpl",
  "apk", "deb", "rpm", "dmg", "pkg",
]);

/**
 * MIME types detected by `file-type` that are considered dangerous and should
 * be blocked even if the extension isn't in the blocklist. This catches files
 * that have been renamed to a safe extension but are actually executables.
 */
const BLOCKED_MIME_TYPES = new Set([
  "application/x-msdownload", // .exe
  "application/x-msdos-program", // .exe/.com
  "application/x-executable", // Linux ELF
  "application/x-sharedlib", // .so
  "application/x-mach-binary", // macOS Mach-O
  "application/java-archive", // .jar
  "application/vnd.android.package-archive", // .apk
  "application/x-debian-package", // .deb
  "application/x-rpm", // .rpm
  "application/x-java-applet", // .class
]);

/**
 * Sniff the actual file type from its magic bytes and compare against the
 * declared MIME type. Returns the detected MIME type (to override the
 * client-provided one) or null if the file type couldn't be determined.
 *
 * If the detected MIME is in the blocklist, the upload is rejected regardless
 * of the extension.
 */
async function detectAndValidateMime(buf: ArrayBuffer, declaredMime: string): Promise<{ mime: string; blocked: boolean }> {
  // file-type needs a Uint8Array — only sniff the first 4KB for efficiency.
  const header = new Uint8Array(buf.slice(0, 4096));
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(header);

  if (!detected) {
    // Can't detect — text files, empty files, etc. Trust the client type.
    return { mime: declaredMime || "application/octet-stream", blocked: false };
  }

  const detectedMime = detected.mime;
  const blocked = BLOCKED_MIME_TYPES.has(detectedMime);

  // Use the detected MIME type instead of the client-provided one — the
  // client can lie, but magic bytes can't (for files file-type recognizes).
  return { mime: detectedMime, blocked };
}

/** POST /files/upload  multipart: file + optional folderId */
files.post("/upload", async (c) => {
  const { userId } = c.get("auth");
  const formData = await c.req.formData();
  const file = formData.get("file");
  const folderId = (formData.get("folderId") as string | null) ?? null;
  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum upload size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
      413
    );
  }
  const ext = path.extname(file.name).slice(1).toLowerCase();
  if (ext && BLOCKED_UPLOAD_EXT.has(ext)) {
    return c.json(
      { error: `File type ".${ext}" is not allowed for upload.` },
      415
    );
  }
  const buf = await file.arrayBuffer();

  // Magic number validation — detect the real file type from its content
  // and reject executables regardless of the file extension.
  const { mime: detectedMime, blocked: mimeBlocked } = await detectAndValidateMime(buf, file.type);
  if (mimeBlocked) {
    return c.json(
      { error: `File content does not match a safe type (detected: ${detectedMime}). Upload rejected.` },
      415
    );
  }

  // Enforce role-based storage quota before writing to disk.
  const quota = await getStorageStatus(userId, file.size);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  const safeName = path.basename(file.name).replace(/[^\w.\- ]+/g, "_");
  const storageKey = `${userId}/${Date.now()}-${safeName}`;
  const absPath = path.join(UPLOAD_DIR, storageKey);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, Buffer.from(buf));

  const record = await prisma.vFile.create({
    data: {
      name: file.name,
      mimeType: detectedMime,
      size: file.size,
      storageKey,
      folderId: folderId || null,
      userId,
    },
  });
  return c.json({ file: record }, 201);
});

// Create a new text file with content
const createTextSchema = z.object({
  name: z.string().min(1).max(128),
  folderId: z.string().nullable().optional(),
  content: z.string().default(""),
});
files.post("/text", zValidator("json", createTextSchema), async (c) => {
  const { userId } = c.get("auth");
  const { name, folderId, content } = c.req.valid("json");
  const safeName = path.basename(name).replace(/[^\w.\- ]+/g, "_");
  const storageKey = `${userId}/${Date.now()}-${safeName}`;
  const absPath = path.join(UPLOAD_DIR, storageKey);
  const buf = Buffer.from(content, "utf-8");

  // Enforce role-based storage quota before writing to disk.
  const quota = await getStorageStatus(userId, buf.length);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buf);
  const ext = path.extname(name).slice(1).toLowerCase();
  const mime = ext === "md" || ext === "markdown"
    ? "text/markdown"
    : ext === "json"
    ? "application/json"
    : ext === "html" || ext === "htm"
    ? "text/html"
    : ext === "css"
    ? "text/css"
    : ext === "svg"
    ? "image/svg+xml"
    : ext === "xml"
    ? "application/xml"
    : "text/plain";
  const record = await prisma.vFile.create({
    data: { name, mimeType: mime, size: buf.length, storageKey, folderId: folderId ?? null, userId },
  });
  return c.json({ file: record }, 201);
});

/** GET /files/:id/download */
files.get("/:id/download", async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  // Virtual / external file (e.g. Moodle) — stream through the session.
  if (isManagedExternal(record)) {
    return proxyMoodleFile(userId, record);
  }
  const absPath = path.join(UPLOAD_DIR, record.storageKey);
  try {
    await stat(absPath);
  } catch {
    return c.json({ error: "File missing on disk" }, 410);
  }
  const f = Bun.file(absPath);
  return new Response(f, {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Disposition": contentDisposition(record.name),
      "Content-Length": String(record.size),
    },
  });
});

// Get text content (for editor)
files.get("/:id/content", async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (!isTextFile(record.name, record.mimeType)) {
    return c.json({ error: "Not a text file" }, 400);
  }
  // Virtual text file (e.g. Moodle page) — fetch extracted text through the
  // session. Use fetchResourceContent (not proxyMoodleFile) so we get clean
  // text without Moodle's navigation chrome.
  if (isManagedExternal(record)) {
    try {
      const result = await fetchResourceContent(userId, record.externalUrl!);
      return c.json({ content: result.text, name: result.name || record.name, mimeType: record.mimeType });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  }
  const absPath = path.join(UPLOAD_DIR, record.storageKey);
  try {
    const data = await readFile(absPath, "utf-8");
    return c.json({ content: data, name: record.name, mimeType: record.mimeType });
  } catch {
    return c.json({ error: "File missing on disk" }, 410);
  }
});

// Save text content
const saveContentSchema = z.object({ content: z.string() });
files.put("/:id/content", zValidator("json", saveContentSchema), async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (isManagedExternal(record)) return c.json({ error: "Moodle-managed files are read-only" }, 403);
  if (!isTextFile(record.name, record.mimeType)) {
    return c.json({ error: "Not a text file" }, 400);
  }
  const { content } = c.req.valid("json");
  const absPath = path.join(UPLOAD_DIR, record.storageKey);
  const buf = Buffer.from(content, "utf-8");

  // Enforce role-based storage quota. The existing file will be overwritten,
  // so the net change is new size minus old size.
  const quota = await getStorageStatus(userId, buf.length - record.size);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  await writeFile(absPath, buf);
  const updated = await prisma.vFile.update({
    where: { id: record.id },
    data: { size: buf.length },
  });
  return c.json({ file: updated });
});

// Mark file opened (bump lastOpenedAt)
files.post("/:id/opened", async (c) => {
  const { userId } = c.get("auth");
  const res = await prisma.vFile.updateMany({
    where: { id: c.req.param("id"), userId },
    data: { lastOpenedAt: new Date() },
  });
  if (res.count === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Rename file
const renameSchema = z.object({ name: z.string().min(1).max(128) });
files.patch("/:id", zValidator("json", renameSchema), async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (isManagedExternal(record)) return c.json({ error: "Moodle-managed files are read-only" }, 403);
  const { name } = c.req.valid("json");
  const res = await prisma.vFile.updateMany({
    where: { id: c.req.param("id"), userId },
    data: { name },
  });
  if (res.count === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Move file to a folder
const moveSchema = z.object({ folderId: z.string().nullable() });
files.patch("/:id/move", zValidator("json", moveSchema), async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (isManagedExternal(record)) return c.json({ error: "Moodle-managed files are read-only" }, 403);
  const { folderId } = c.req.valid("json");
  if (folderId !== null) {
    const target = await prisma.vFolder.findFirst({ where: { id: folderId, userId } });
    if (!target) return c.json({ error: "Target folder not found" }, 404);
  }
  const res = await prisma.vFile.updateMany({
    where: { id: c.req.param("id"), userId },
    data: { folderId: folderId ?? null },
  });
  if (res.count === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Duplicate a file
files.post("/duplicate/:id", async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (isManagedExternal(record)) return c.json({ error: "Moodle-managed files can't be duplicated" }, 403);
  const srcPath = path.join(UPLOAD_DIR, record.storageKey);

  // Enforce role-based storage quota before copying on disk.
  const quota = await getStorageStatus(userId, record.size);
  if (!quota.allowed) {
    return c.json({ error: quota.message }, 413);
  }

  const safeName = path.basename(record.name).replace(/[^\w.\- ]+/g, "_");
  const storageKey = `${userId}/${Date.now()}-copy-${safeName}`;
  const destPath = path.join(UPLOAD_DIR, storageKey);
  await mkdir(path.dirname(destPath), { recursive: true });
  try {
    await copyFile(srcPath, destPath);
  } catch {
    return c.json({ error: "Source file missing on disk" }, 410);
  }
  // Derive "copy" name
  const dot = record.name.lastIndexOf(".");
  const baseName = dot > 0 ? record.name.slice(0, dot) : record.name;
  const ext = dot > 0 ? record.name.slice(dot) : "";
  const copyName = `${baseName} (copy)${ext}`;
  const dup = await prisma.vFile.create({
    data: {
      name: copyName,
      mimeType: record.mimeType,
      size: record.size,
      storageKey,
      folderId: record.folderId,
      userId,
    },
  });
  return c.json({ file: dup }, 201);
});

// Toggle star
files.post("/:id/star", async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  const updated = await prisma.vFile.update({
    where: { id: record.id },
    data: { starred: !record.starred },
  });
  return c.json({ file: updated });
});

// Bulk download as zip
const zipSchema = z.object({ fileIds: z.array(z.string()).min(1).max(500) });
files.post("/zip", zValidator("json", zipSchema), async (c) => {
  const { userId } = c.get("auth");
  const { fileIds } = c.req.valid("json");
  const records = await prisma.vFile.findMany({ where: { id: { in: fileIds }, userId } });
  if (records.length === 0) return c.json({ error: "No files found" }, 404);
  const tree: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  for (const r of records) {
    let safe = r.name.replace(/[\\/]+/g, "_");
    let n = 1;
    while (usedNames.has(safe)) {
      const dot = r.name.lastIndexOf(".");
      const base = dot > 0 ? r.name.slice(0, dot) : r.name;
      const ext = dot > 0 ? r.name.slice(dot) : "";
      safe = `${base} (${n})${ext}`.replace(/[\\/]+/g, "_");
      n++;
    }
    usedNames.add(safe);
    try {
      const data = await readFile(path.join(UPLOAD_DIR, r.storageKey));
      tree[safe] = new Uint8Array(data);
    } catch {
      tree[safe] = strToU8(`[missing on disk: ${r.storageKey}]`);
    }
  }
  const zipped = zipSync(tree);
  return new Response(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="athena-download-${Date.now()}.zip"`,
      "Content-Length": String(zipped.length),
    },
  });
});

// Zip a whole folder (recursive)
files.post("/folders/:id/zip", async (c) => {
  const { userId } = c.get("auth");
  const folder = await prisma.vFolder.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!folder) return c.json({ error: "Not found" }, 404);
  const allFolders = await prisma.vFolder.findMany({ where: { userId } });
  const byParent = new Map<string | null, typeof allFolders>();
  for (const f of allFolders) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  // Walk descendants collecting (relativePath, folderId)
  const folderPaths: { id: string; rel: string }[] = [{ id: folder.id, rel: folder.name }];
  const stack = [{ id: folder.id, rel: folder.name }];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur.id) ?? []) {
      const rel = `${cur.rel}/${child.name}`;
      folderPaths.push({ id: child.id, rel });
      stack.push({ id: child.id, rel });
    }
  }
  const allFiles = await prisma.vFile.findMany({
    where: { userId, folderId: { in: folderPaths.map((f) => f.id) } },
  });
  const tree: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  for (const f of allFiles) {
    const parent = folderPaths.find((fp) => fp.id === f.folderId);
    const rel = parent ? `${parent.rel}/${f.name}` : f.name;
    let safe = rel.replace(/[\\/]+/g, "/");
    let n = 1;
    while (usedNames.has(safe)) {
      const slash = safe.lastIndexOf("/");
      const dir = slash > 0 ? safe.slice(0, slash + 1) : "";
      const file = slash > 0 ? safe.slice(slash + 1) : safe;
      const dot = file.lastIndexOf(".");
      const base = dot > 0 ? file.slice(0, dot) : file;
      const ext = dot > 0 ? file.slice(dot) : "";
      safe = `${dir}${base} (${n})${ext}`;
      n++;
    }
    usedNames.add(safe);
    try {
      const data = await readFile(path.join(UPLOAD_DIR, f.storageKey));
      tree[safe] = new Uint8Array(data);
    } catch {
      tree[safe] = strToU8(`[missing on disk: ${f.storageKey}]`);
    }
  }
  if (Object.keys(tree).length === 0) {
    // Empty folder: add a placeholder so zip isn't empty/invalid
    tree[`${folder.name}/.empty`] = strToU8("");
  }
  const zipped = zipSync(tree);
  return new Response(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${folder.name}.zip"`,
      "Content-Length": String(zipped.length),
    },
  });
});

files.delete("/:id", async (c) => {
  const { userId } = c.get("auth");
  const record = await prisma.vFile.findFirst({ where: { id: c.req.param("id"), userId } });
  if (!record) return c.json({ error: "Not found" }, 404);
  if (isManagedExternal(record)) return c.json({ error: "Moodle-managed files are removed via the Moodle app's desync" }, 403);
  const absPath = path.join(UPLOAD_DIR, record.storageKey);
  await unlink(absPath).catch(() => {});
  await prisma.vFile.delete({ where: { id: record.id } });
  await cleanupOrphanLinks(userId, "file", record.id);
  return c.json({ ok: true });
});

export default files;
