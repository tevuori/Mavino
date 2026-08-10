# Mavino — Student OS

A desktop-environment-style productivity dashboard for students.

## Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS 3, Zustand for state
- **Backend:** Bun + Hono
- **DB:** PostgreSQL via Prisma (was SQLite — see `prisma/migrations-sqlite-archive/` for the old SQLite migrations)
- **Infra:** Docker Compose (client on :5173, server on :3001)
- **Mobile:** PWA (vite-plugin-pwa) + optional Capacitor native wrapper (Android/iOS)

## Mobile architecture

Athena adapts to phone/tablet/desktop via a **form-factor store** (`client/src/store/formfactor.ts`):
- Detects phone = coarse pointer AND max-width 820px, tablet = coarse pointer + wider, desktop = fine pointer
- Manual override persisted in localStorage (configurable in Settings → Mobile)
- Resize/orientationchange listeners update mode live

**App.tsx** branches: `mode === "phone"` → `<MobileShell />`, else `<DesktopEnvironment />`. Desktop behavior is completely unchanged.

**MobileShell** (`client/src/shell/mobile/`):
- Today agenda as the home screen (with pull-to-refresh)
- Bottom nav: Today / Tasks / Notes / Athena (sheet) / Apps (drawer)
- Single active app at a time via mobile stack in `store/windows.ts` (`mobileOpen`, `mobileClose`, `mobileBack`, `mobileGoHome`, `mobileSwitchTo`)
- `open()` in windows store is form-factor-aware: routes to `mobileOpen` on phone, so all existing call sites (CommandPalette, Today, Files, Athena tool-calls) work unchanged
- Browser back button / iOS edge-swipe pops the app stack via `popstate` + `pushState` history integration
- Bottom sheets: AppDrawer, AthenaSheet (reuses AthenaApp `mode="quick"`), NotificationSheet
- QuickCaptureFab triggers the existing QuickCapture overlay
- MiniPlayer (compact Spotify player) above bottom nav
- InstallBanner (PWA install prompt, iOS instructions)
- MobileAppFrame wraps apps with a mobile header (back chevron, title) + `@container` content area so existing container-query breakpoints resolve at phone width

**Cross-cutting touch infra:**
- `ContextMenu` renders as a bottom sheet on phone (vs. floating menu on desktop)
- `useLongPressMenu` hook + `LongPressArea` component for long-press → context menu on touch
- Files app: delegated long-press handler on file area using `data-file-id`/`data-folder-id`
- Tasks Kanban: `TouchSensor` (200ms delay) + snap-scrolling columns
- `index.css`: `@media (hover: none)` reveals hover-gated controls on touch, `overscroll-behavior: none`, safe-area helper classes

**Per-app mobile adaptations:**
- Viewer: pinch-to-zoom, double-tap zoom, mobile header with back button, auto-hiding controls
- Whiteboard: horizontally scrollable toolbar with larger touch targets
- Calendar: new "agenda" view (14-day scrollable list), defaults to agenda on phone
- VUT: grades as card list on phone (vs. 9-column table), timetable as day-by-day list (vs. weekly grid)
- Grades: header buttons collapse to icons, GPA summary wraps
- Flashcards: review rating buttons 2×2 grid on narrow
- Editor: status bar hides char/line/size on narrow
- Browser: secondary nav buttons hidden on narrow, quick links 3-col grid
- Notes: `group` class added to note items so MoreVertical reveals on touch
- Settings: new Mobile section with form-factor override

**Branding:** the master logo lives at `assets/logo.png`. Every derived asset (web favicons, PWA icons, Android launcher/adaptive icons, Android splash screens) is generated from it by `python3 scripts/generate-icons.py` (requires Pillow) — never hand-edit the generated PNGs. In-app the brand mark is rendered by `client/src/shell/AppLogo.tsx` (boot screen, login screen, taskbar start button).

**PWA:** vite-plugin-pwa generates service worker + manifest. Icons in `client/public/`. `usePwaInstall` hook + `InstallBanner` component handle install prompt (Android) and iOS instructions.

**Capacitor:** `capacitor.config.json` at root. `client/src/shell/mobile/capacitor.ts` dynamically imported on app start — initializes StatusBar, SplashScreen, hardware back button, haptics, and a background check for APK self-updates. Only runs on native platforms (`Capacitor.isNativePlatform()`). Scripts: `bun run cap:sync`, `bun run cap:add:android`, `bun run cap:add:ios`, `bun run cap:open:android`, `bun run cap:open:ios`.

**APK auto-update (Android only):** The Capacitor Android build can self-update from GitHub Releases.
- On native startup, `capacitor.ts` calls `checkForUpdate()` in `services/updater.ts`, which polls `https://api.github.com/repos/<owner>/<repo>/releases/latest`. The repo slug is auto-detected from `git remote get-url origin` at Vite build time and baked in via `__UPDATE_REPO__` (override with `VITE_UPDATE_REPO=owner/repo`). If a newer version is found (and not skipped), `store/updater.ts` surfaces `shell/UpdateDialog.tsx` with release notes + Download & Install.
- Tapping install calls the local `ApkUpdater` Capacitor plugin (`android/app/src/main/java/ai/athena/app/ApkUpdaterPlugin.java`, registered in `MainActivity.java`). It streams the APK to `<external-files-dir>/updates/athena.apk`, optionally verifies a SHA256 sidecar, and launches Android's system package installer via the existing FileProvider (`res/xml/file_paths.xml` has an `external-files-path` entry for `updates/`). Requires `REQUEST_INSTALL_PACKAGES` permission (declared in `AndroidManifest.xml`).
- A manual "Check for updates" button lives in Settings → About (`sections/AboutSection.tsx`), gated on `isAutoUpdateAvailable()`. The button passes `includeSkipped: true` so it ignores the auto-skip flag.
- `android/app/build.gradle` reads `versionName`/`versionCode` from Gradle properties (`-PversionName=… -PversionCode=…`) with `1.0`/`1` fallbacks for local debug builds.
- The release pipeline is `.github/workflows/build-android.yml`: on a `v*` tag push (or manual dispatch), it builds the client, `cap sync android`, builds a signed release APK with the keystore from secrets, computes SHA256, writes `latest.json`, and creates a GitHub Release with the APK + `*.apk.sha256` + `latest.json` as assets.
- **Required GitHub secrets:** `KEYSTORE_BASE64` (base64-encoded release keystore), `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Generate with `keytool -genkeypair -v -keystore athena-release.keystore -alias athena -keyalg RSA -keysize 2048 -validity 10000` then `base64 -w0 athena-release.keystore > athena-release.keystore.b64`. **Every release must be signed with the same keystore** — Android refuses in-place updates signed with a different key. Back up the keystore somewhere safe.
- **versionCode formula:** `major*10000 + minor*100 + patch` (e.g. `1.2.3` → `10203`). Must be monotonically increasing.
- Web/PWA builds are unaffected — all update logic is gated on `isCapacitor()`. The PWA uses vite-plugin-pwa's `prompt` registration with a top-level `ReloadPrompt` so users can reload when a new build is deployed.

## Moodle integration

A dedicated **Moodle** app (`client/src/apps/moodle/MoodleApp.tsx`) deep-integrates Moodle with the OS. It reuses the existing VUT SSO session — there are no separate Moodle credentials; the user logs in once via the VUT app and Moodle's OIDC ride-along (`moodleLogin` in `services/moodle.ts`) establishes a Moodle session in the shared per-user cookie jar.

**Auth flow:** `moodleLogin` calls `vutLogin` (if needed) → hits the Moodle OIDC login URL → id.vut.cz recognizes the session → redirects back to Moodle with a session. All subsequent Moodle fetches go through `fetchWithVutSession` (in `services/vut.ts`), which follows the cross-domain redirect chain collecting cookies from each hop.

**Session-fetch gotcha (fixed):** `fetchWithVutSession` returns a `Response` with an own `url` property. `Response.prototype.url` is a read-only getter, so `Object.assign(resp, { url })` throws `Attempted to assign to readonly property` in strict mode — which broke *all* Moodle source ingestion (Study Hub SourcePicker, sync, Athena tools). The fix uses `Object.defineProperty` to shadow the prototype getter with an own data property (`withFinalUrl` helper). Don't reintroduce `Object.assign` on the returned Response.

**Data flow:**
- **Courses/contents/assignments** are scraped from the Moodle web UI with cheerio (the REST API needs a token OIDC can't produce). `parseCourseContents` extracts sections + activities with due dates (`parseActivityDueDate` / `parseMoodleDateText`, EN + CS locales); `fetchAssignmentDetail` fetches the assign page when the course page hides the due date.
- **Sync** (`services/moodle-sync.ts`, `POST /api/moodle/sync/:courseId`): for each assignment with a due date → upserts a **Task** (deduped by a `[moodle:courseId:activityId]` marker in the description — Tasks have no source/sourceRef column) **and** a **Calendar event** (`source: "moodle"`, `sourceRef: "courseId:activityId"`, deduped by source+sourceRef). For each fetchable material → upserts a **virtual VFile** (`source: "moodle"`, `externalUrl` set, `storageKey` empty, no blob on disk) under a `Moodle / <course> / <section>` folder tree. Records state in the `MoodleSync` table.
- **Desync** (`DELETE /api/moodle/sync/:courseId`): deletes all rows whose `sourceRef` starts with `courseId:` (files/events) or whose task description contains the course's marker — no re-fetch needed.
- **One-click Study Hub:** each material row has Summarize / Flashcards buttons that open Study Hub with `payload: { mode, sourceKind: "moodle", sourceUrl, sourceName }`. `StudyApp` builds a `{ kind: "moodle", url, name }` SourceDescriptor from that payload, which `resolveSource` (server) fetches via `fetchResourceContent`.

**Virtual files in File Manager:** `VFile` has `externalUrl`, `source`, `sourceRef` columns. The files route (`GET /:id/download`, `GET /:id/content`) branches on `isManagedExternal()` and streams the body from Moodle through `fetchWithVutSession` (re-authing on a login page) instead of reading from `uploads/`. Moodle-managed files are read-only: rename/move/duplicate/save-content/delete return 403 (they're owned by the sync). The Files app shows a "Moodle" badge and hides destructive actions on them. Removing them is done via the Moodle app's desync.

**Endpoints** (`routes/moodle.ts`): `/status`, `/login`, `/courses`, `/courses/:id/contents`, `/courses/:id/assignments`, `/resource`, `/sync` (list), `/sync/:courseId` (POST/DELETE).

## Mapy.cz integration (Maps app & trip planning)

A dedicated **Maps** app (`client/src/apps/maps/MapsApp.tsx`) integrates [mapy.com](https://developer.mapy.com/) — Czech topographic maps with hiking trails, POI search, routing, and elevation. The legacy SMap JS SDK (api.mapy.cz) was permanently retired at the end of 2025; the new mapy.com REST API + **Leaflet** (the recommended third-party library) is the only supported path.

**API key:** per-user in the DB (`MapyCredentials` model, `apiKeyEnc` AES-256-GCM encrypted via `services/crypto.ts`), configured in Settings → Integrations (`MapyCard`). The user enters their own mapy.com developer API key (free credits available at developer.mapy.com). The key is sent to the client via `GET /api/mapy/credentials/key` because Leaflet tile layers load tiles as `<img>` tags with the `apikey` query param — the client must hold the key to construct tile URLs.

**Map rendering:** Leaflet + mapy.com raster tiles (`GET /v1/maptiles/{mapset}/256/{z}/{x}/{y}?apikey=…`). Four mapsets switchable in-app: `outdoor` (hiking/tourist trails with markings — default), `basic`, `aerial`, `winter`. The mapy.com logo control is required over the map (per their terms).

**REST API wrapper** (`services/mapy.ts`): wraps geocoding (`/v1/geocode`), reverse geocoding (`/v1/rgeocode`), routing (`/v1/routing/route` with `routeType` including `foot_hiking` / `bike_road` / `car_fast`), POI search (geocode with `type=poi`), elevation (`/v1/elevation` — used to compute ascent/descent for hiking routes), and nearby POI discovery. Results are cached in-memory for 60s to conserve API credits. Auth via `X-Mapy-Api-Key` header.

**POI categories:** mapy.com's geocode POI search is text-based, so hiking-relevant "categories" are mapped to Czech + English search terms (Czech yields best coverage for Czech hiking infrastructure): `water` (pramen/studna/pitná voda = springs/wells/drinking water), `sleeping` (prístrešák/bivak/chata/kemp = shelters/bivouacs/mountain huts/camps = legal sleeping spots), `landmarks` (hrad/rozhledna/zámek = castles/viewpoints/palaces), `amenities` (restaurace/občerstvení/ubytování = restaurants/refreshments/accommodation). `findNearbyPois` runs one search per term near the target point and merges + dedupes by name+coords.

**Trip persistence:** `Trip` Prisma model stores planned trips: name, type (hiking/bicycle/car), distance, duration, ascent/descent, route geometry (JSON array of [lat, lon]), waypoints (JSON), POIs (JSON), and a summary. CRUD via `/api/mapy/trips`.

**Athena tools** (`tools/maps.ts`): Athena fully controls the map via server-side data tools (`geocode`, `search_places`, `find_nearby_pois`, `plan_route`, `save_trip`, `list_trips`, `get_trip`, `delete_trip`, `mapy_status`) and client-action tools that drive the Maps app through the maps store (`open_maps`, `show_on_map`, `add_map_marker`, `draw_map_route`, `show_map_pois`, `open_trip`). `plan_route` with `mode="hiking"` automatically enriches the route with nearby water sources, sleeping spots, and landmarks (samples up to 8 points along the geometry and searches near each).

**Maps store** (`store/maps.ts`): a per-window command channel (mirrors `store/browser.ts`). Athena's client-action dispatch in `AthenaApp.tsx` calls `issueCommand(windowId, kind, payload)`; `MapsApp` consumes pending commands via a `useEffect` on `pendingCommand.seq`. The store also tracks current map centers so the Athena system prompt can report where the map is focused (`mapsContext` in `context.ts`).

**Endpoints** (`routes/mapy.ts`): `/credentials/{status,key}`, `/credentials` (PUT/DELETE), `/geocode`, `/reverse`, `/route`, `/pois`, `/nearby`, `/trips` (GET list, POST create), `/trips/:id` (GET, PUT, DELETE), `/trips/:id/gpx` (GPX download), `/tours/generate` (POST — run planner, no persist), `/tours` (GET list, POST create), `/tours/:id` (GET, DELETE), `/tours/:id/gpx` (whole-tour GPX), `/tours/:id/regenerate/:day` (POST — re-plan one day).

**Intermediate waypoints:** The route planner UI (`MapsApp.tsx`) uses a reorderable stops list (Start / Via 1..N / End) instead of just Start + End. The backend `route()` already supported up to 15 waypoints; only the UI was missing. A "click map to add stop" toggle reverse-geocodes a clicked point and inserts it as a via stop before the end.

**Multi-day hiking tour planner (advanced, LLM-integrated):** `services/tour-planner.ts` generates a multi-day hiking tour from a base point + number of days + difficulty. Two modes:
- **Hub & spoke:** loop hikes from a single base (accommodation). Each day heads in a different compass direction (spread evenly around the circle: day 1 → N, day 2 → SE, …) so loops don't overlap. Routes base → far point → base (two legs stitched). Returns to base each evening.
- **Through-hike:** point-to-point chain from base toward an end point. Each day covers ~targetDistance along the straight line to the end. The nearest legal sleeping spot (mountain hut / shelter / bivouac, via `findNearbyPois` category `sleeping`) to the day's endpoint becomes the overnight stop. If none is found within 3km, the day is flagged as wild-camp.

**Difficulty presets:** easy (~10 km/day, ≤400 m ascent), medium (~15 km, ≤800 m), hard (~20 km, ≤1200 m), expert (~28 km, ≤1600 m). If a day's actual ascent exceeds 150% of the target, it's flagged as a "hard day" with a rest-day suggestion.

**LLM narration (the "highly integrated" layer):** After the deterministic routing + POI enrichment, `narrateTour()` calls the user's LLM (via `acquireLlmModel` + `generateText`) with the REAL per-day stats + POIs + overnight spots, and produces a coherent Markdown plan: Overview, Day-by-day (terrain, water sources, landmarks, where you sleep, hard-day warnings), Packing list (calibrated to difficulty + hub/through mode), and Safety notes. The narrated plan is saved as the `HikingTour.summary` and returned to Athena so it can be echoed in the chat reply. If the LLM is unavailable, a plain-text fallback summary is used (the tour is still usable).

**Data model:** `HikingTour` Prisma model (name, mode, baseLat/lon/name, endLat/lon/name, numDays, difficulty, totals, summary). Each day is a `Trip` row linked via `tourId` + `dayNumber` (nullable — standalone trips have null tourId). `TripRow` now includes `tourId` + `dayNumber`.

**GPX export:** `tripToGpx()` / `tourToGpx()` build GPX 1.1 XML (no deps) — `<wpt>` for waypoints + POIs, `<trk>` per day. Download via `/trips/:id/gpx` (single trip) or `/tours/:id/gpx` (whole tour, one track per day). Loads into Garmin, Komoot, etc.

**Single-day regeneration:** `regenerateDay()` re-plans one day of a saved tour, keeping the others. For hub mode the compass bearing is reused; for through mode the from/to points are reused (so the chain stays consistent). Route: `POST /tours/:id/regenerate/:day`.

**TourPlanner UI** (`client/src/apps/maps/TourPlanner.tsx`): sidebar tab in the Maps app. Form: mode toggle (hub/through), base + end inputs, days stepper, difficulty select, optional notes for the LLM. "Generate tour" button (10-30s — multiple route API calls). Day-by-day itinerary with per-day stats, overnight spots, water sources, landmarks, hard-day/wild-camp badges. Day selector to view one day or all days overlaid (each in a distinct color via `drawTour`). Save / GPX export / regenerate-single-day / saved-tours list. `ElevationProfile.tsx` is a pure-SVG inline elevation chart (reuses the Analytics chart pattern).

**Athena tools** (`tools/maps.ts`): `plan_hiking_tour` (the flagship — geocodes base (+ end), runs the planner with LLM narration, saves the tour, returns the narrated summary + per-day stats, and emits an `open_tour` client action to display it), `list_tours`, `get_tour`, `open_tour` (client action — draws all days overlaid), `regenerate_tour_day`, `delete_tour`. The system prompt (`context.ts`) includes a workflow for "plan a 3-day hiking tour based in X" → `plan_hiking_tour` → narrate the returned summary.

## Quick start (local dev)

```bash
# Install all dependencies
bun install        # root (concurrently)
cd server && bun install && cd ..
cd client && bun install && cd ..

# Set up the database
cd server
ln -sf ../.env .env          # if not already linked
bunx prisma generate
bunx prisma migrate dev      # creates SQLite DB + migration
bun run src/db/seed.ts       # seeds admin/admin + demo data
cd ..

# Run both server + client (from root)
bun run dev
#   server → http://localhost:3001
#   client → http://localhost:5173
```

Open http://localhost:5173 → boot screen → login with `admin` / `admin`.

## Docker

```bash
cp .env.example .env   # fill in Spotify creds if you have them
docker compose up --build
#   server → http://localhost:3001
#   client → http://localhost:5173
```

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Run server + client concurrently (hot reload) |
| `bun run dev:server` | Server only (Bun --hot) |
| `bun run dev:client` | Client only (Vite) |
| `bun run typecheck` | TypeScript check for both server + client |
| `bun run typecheck:server` | Server only |
| `bun run typecheck:client` | Client only |
| `bun run build` | Build both |
| `bun run db:generate` | Prisma client generation |
| `bun run db:migrate` | Prisma migrate dev |
| `bun run db:seed` | Seed demo data |
| `bun run docker:up` | Docker Compose up --build |
| `bun run docker:down` | Docker Compose down |
| `bun run cap:sync` | Build client + sync to Capacitor native projects |
| `bun run cap:add:android` | Add Android platform to Capacitor |
| `bun run cap:add:ios` | Add iOS platform to Capacitor |
| `bun run cap:open:android` | Open Android project in Android Studio |
| `bun run cap:open:ios` | Open iOS project in Xcode |
| `bun run waydroid:deploy` | Build APK + install + launch in Waydroid emulator |
| `bun run waydroid:deploy:fast` | Install + launch existing APK in Waydroid (skip build) |

### Waydroid testing (local Android emulator)

[Waydroid](https://waydroid.org/) runs Android natively in a Linux container (Wayland only). It's useful for testing the Athena APK without a physical device or Android Studio.

**Setup (one-time):**
```bash
# Install Waydroid (Fedora)
sudo dnf install -y waydroid
sudo systemctl enable --now waydroid-container

# JDK 21 is required for Gradle (Fedora 44 ships Java 25, which Gradle 8.x can't run on)
mkdir -p ~/.local/share/jvm
curl -sL 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk' -o /tmp/jdk21.tar.gz
tar -xzf /tmp/jdk21.tar.gz -C ~/.local/share/jvm
# → installs to ~/.local/share/jvm/jdk-21.0.12+8
```

**Running:**
```bash
# 1. Start the Waydroid session (container service must already be running)
waydroid session start &

# 2. Start the Athena server on the host
bun run dev:server

# 3. Build + install + launch the APK
bun run waydroid:deploy
#   or skip rebuild if APK already exists:
bun run waydroid:deploy:fast
```

**Server address:** Inside Waydroid, `localhost` is the Android container — not the host. The host is reachable at `192.168.240.1` (the `waydroid0` bridge). On the Athena login screen, enter `http://192.168.240.1:3001` as the server address.

**Useful Waydroid commands:**
```bash
waydroid status              # check session + container status
waydroid app list            # list installed apps
waydroid app install <apk>   # install/update an APK
waydroid app launch <pkg>    # launch an app (e.g. ai.athena.app)
waydroid app remove <pkg>    # uninstall an app
waydroid show-full-ui        # bring the Waydroid window to front
waydroid log                 # container log (LXC-level)
sudo waydroid logcat         # Android logcat (needs root)
```

### Android release (APK auto-update)

Releases are produced by the `build-android.yml` GitHub Actions workflow — there are no local release scripts (signing keys live in GitHub secrets, not on your machine). To cut a release:

1. Make sure the four secrets are set: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (see "APK auto-update" section above for how to generate them).
2. Tag + push: `git tag v1.2.3 && git push origin v1.2.3`. The workflow builds, signs, and creates the GitHub Release automatically. Or use the Actions tab → "Build & Release Android APK" → "Run workflow" with a version string to test without tagging.

## Environment variables

See `.env.example`. Key ones:

- `SERVER_PORT` — server port (default 3001 in dev)
- `DATABASE_URL` — Prisma SQLite path
- `JWT_SECRET` — JWT signing secret
- `SEED_USERNAME` / `SEED_PASSWORD` — default user created by seed
- `VITE_API_URL` — backend URL for client (used by Vite proxy)
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REFRESH_TOKEN` — Spotify integration
- `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID` / `MS_REFRESH_TOKEN` — Microsoft Calendar sync (Graph API, requires `Calendar.ReadWrite` + `offline_access` scopes)
- `NTFY_SERVER_URL` / `NTFY_TOKEN` / `NTFY_DEFAULT_PRIORITY` — Ntfy server-wide fallback (per-user config in DB takes priority)
- `OPENAI_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` — Athena LLM server-wide fallback (per-user config in DB takes priority). All optional — if neither per-user nor server-wide keys are set, Athena AI is unavailable (no free fallback).
- `TAVILY_API_KEY` — optional but recommended. When set, the `web_search` and `research` tools use the Tavily Search API (designed for AI agents, free tier: 1,000 API credits/month, no credit card — https://app.tavily.com). Tavily also works in **keyless mode** (rate-limited, no registration) when no key is set, so search works out of the box for light use. Backend priority: Tavily → Brave → DuckDuckGo.
- `BRAVE_SEARCH_API_KEY` — optional. Secondary search backend (free tier discontinued). When set, used as a fallback if Tavily fails. Without any key, falls back to the free DuckDuckGo HTML scraper, which is often blocked by an anti-bot challenge (`anomaly.js`, HTTP 202) on datacenter/VPS IPs — in that case the tool returns a clear error directing you to set `TAVILY_API_KEY`. Recommended for any public deploy.

## Project structure

```
Athena/
├── docker-compose.yml
├── .env / .env.example
├── server/
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.ts              # Hono app entry
│       ├── db/{client.ts, seed.ts}
│       ├── routes/{auth, notes, tasks, files, spotify, lyrics, flashcards, grades, vut, ai, athena, conversations, study, moodle, calendar, habits, capture, microsoft, whiteboards, ntfy, voice, browser, focus, analytics}.ts
│       ├── services/{spotify.ts, lrclib.ts, jwt.ts, vut.ts, crypto.ts, moodle.ts, moodle-sync.ts, microsoft.ts, browser.ts, ntfy/{client, config, scheduler, subscriber, athena-turn}.ts}
│       ├── services/athena/{llm.ts, context.ts, tools/}  # multi-llm-ts client, system prompt, tool plugins
│       ├── services/study/{source, llm-json, prompts, quiz-store, logSession}.ts  # AI Study Hub helpers
│       ├── services/study/lecture/{ffmpeg, transcribe, slides, vision, align, pipeline}.ts  # Lecture Video → Notes pipeline
│       └── middleware/auth.ts
└── client/
    └── src/
        ├── main.tsx, App.tsx, index.css
        ├── shell/                # BootScreen, LoginScreen, Wallpaper, AnimatedBackground, MusicWidget, ChillView, ChillBackground, Desktop,
        │                         # Taskbar, StartMenu, SystemTray, ContextMenu,
        │                         # DesktopEnvironment, CommandPalette (Spotlight),
        │                         # QuickCapture (Ctrl+Shift+N overlay)
        ├── wm/                   # Window, WindowLayer, SnapPreview, AltTabSwitcher, WorkspaceSwitcher, WorkspaceOverview
        ├── apps/
        │   ├── registry.tsx      # app manifest
        │   ├── notes/            # Notes (markdown editor)
        │   ├── tasks/            # Tasks (Kanban)
        │   ├── files/            # File Manager (virtual FS, tree sidebar, list/grid, multi-select, context menus, drag-drop, bulk zip)
        │   ├── editor/           # Code Editor (CodeMirror 6, 40+ languages, markdown live-preview, auto-save)
        │   ├── viewer/           # File Viewer (image zoom/pan, PDF, audio, video, fullscreen)
        │   ├── pomodoro/         # Pomodoro/Focus Timer (SVG ring, DND)
        │   ├── flashcards/       # Flashcards (SM-2, 3D flip review)
        │   ├── grades/           # Grade Tracker (GPA, weighted assignments)
        │   ├── vut/              # VUT Studis (grades, timetable, updates, web view)
        │   ├── athena/           # Athena assistant (chat UI, tool-call chips, SSE stream)
        │   ├── study/            # Study Hub (AI flashcards, summarize, quiz, explain, study guide, syllabus→tasks)
        │   ├── calendar/         # Calendar / Planner (month/week/day, ICS import/export, task drag-to-schedule)
        │   ├── habits/           # Habit Tracker (streaks, heatmap, auto-complete from Pomodoro)
        │   ├── settings/         # Settings (Appearance, Wallpaper, Animated BG, Account, Sound & Athena, Athena Assistant, Integrations, Notifications, Users [admin], Apps [admin], Tiers & Plans [admin], LLM Config [admin], Storage Quotas [admin], Study Hub [admin], Error Logs [admin], Analytics [admin], Data & Storage, About). Split into apps/settings/sections/*.tsx + ui.tsx shared helpers; SettingsApp.tsx is the shell with section nav (admin sections gated behind role=ADMIN).
        │   └── whiteboard/      # Whiteboard (SVG vector canvas, pen/line/rect/ellipse/arrow/text/eraser, clipboard image paste, undo/redo, SVG/PNG export, multi-board)
        │   └── ntfy/            # Ntfy (bidirectional Athena push channel, message log, cron-job manager)
        │   └── voice/           # Voice Notes (mic recorder, Whisper transcription, linked Note) — useRecorder.ts shared hook
        │   └── browser/         # Browser (Athena-integrated web browser, backend reverse proxy, per-user cookie jar, Athena can open/navigate/read pages)
        │   └── analytics/      # Analytics & Gamification (unified dashboard: study hours, flashcard retention, grade trends, habit adherence, XP/level, achievements; pure-SVG charts)
        │   └── moodle/         # Moodle (course browser, assignment deadlines → Tasks/Calendar sync, materials → virtual Files, one-click Study Hub summarize/flashcards; rides VUT SSO)
        ├── store/                # Zustand stores (auth, windows, settings, music, notifications, browser)
        ├── services/             # API clients (api, notes, tasks, files, spotify, lyrics, flashcards, grades, vut, athena, conversations, study, moodle, calendar, habits, microsoft, users, whiteboards, ntfy, voice, browser, focus, analytics)
        └── types/                # shared TS types
```

## Implemented features

### Desktop shell
- Animated boot screen → login → desktop
- Draggable / resizable windows with 8 resize handles
- Window controls: minimize, maximize/restore, close — all with animations
  - Open: scale-in + fade-up
  - Close: scale-down + fade-down
  - Minimize: shrink toward taskbar
- **Grid snapping:**
  - Drag to screen edges: left half, right half, top (maximize)
  - Drag to screen corners: top-left, top-right, bottom-left, bottom-right quadrants
  - Snap preview overlay highlights target zone during drag
  - **Hold Shift while resizing** to snap dimensions to a 20px grid
  - **Keyboard shortcuts** (Win/Cmd key):
    - `Win+←` / `Win+→` — snap to left/right half
    - `Win+↑` — maximize
    - `Win+Shift+↑` — toggle maximize/restore
    - `Win+Shift+←` / `Win+Shift+→` — snap to top-left/top-right quadrant
    - `Win+Shift+↓` — minimize
    - `Win+↓` — restore from snapped/maximized
    - `Win+W` — close focused window
    - `Win+Y` — toggle Athena quick panel (rolls in from the selected edge)
    - `Ctrl+Alt+PgUp` / `Ctrl+Alt+PgDn` — switch to previous/next workspace
    - `Ctrl+Shift+PgUp` / `Ctrl+Shift+PgDn` — move focused window to previous/next workspace
    - `Alt+Space` — toggle workspace overview (GNOME Activities-style)
- Z-index focus management (click to focus)
- **Responsive window content (container queries):** The Window content div is a CSS `@container` (`wm/Window.tsx`). Each app uses Tailwind container-query breakpoints (`@sm`…`@7xl`, mapping to 384px…1280px) to adapt its layout to the **actual window width**, not the viewport. Sidebars collapse into toggleable overlays when narrow (`wm/CollapsibleSidebar.tsx` reusable component, or manual overlay pattern). Split-view modes auto-switch to single-pane below a threshold. `max-w-*` constraints on content relax to `max-w-none` when narrow. Tailwind safelist in `tailwind.config.js` covers the dynamically-constructed `@{breakpoint}:{utility}` classes used by `CollapsibleSidebar`.
- Alt+Tab window switcher (Shift+Alt+Tab for reverse) — scoped to the active workspace
- Start menu opens via the Start button (Win/Meta key is not bound — it triggers native OS shortcuts)
- **Multi-workspace support (GNOME-style):** Each window belongs to a workspace (`workspaceId` on `WindowInstance`). The `useWindows` store tracks `workspaces: Workspace[]` + `activeWorkspaceId`. `WindowLayer`/`AltTabSwitcher`/`retile()`/`cycleFocus()` are all scoped to the active workspace. The taskbar dash shows ALL running apps across workspaces; clicking an app on another workspace switches to it. Dynamic workspaces: the last workspace is always the "fresh empty" one — when it receives a window, a new empty workspace is auto-appended. Workspace structure (names, order, active id) persists to `localStorage` (`athena.workspaces` key). UI: `WorkspaceSwitcher` pills in the taskbar (click to switch, right-click for rename/delete/reorder, "+" to create), `WorkspaceOverview` full-screen overlay (Alt+Space — vertical stack of workspace strips with window cards, drag cards between strips to move windows, inline rename, delete/reorder buttons), window title-bar right-click → "Move to workspace" submenu. Keyboard shortcuts: `Ctrl+Alt+PgUp`/`Ctrl+Alt+PgDn` switch workspaces, `Ctrl+Shift+PgUp`/`Ctrl+Shift+PgDn` move the focused window, `Alt+Space` toggles overview. `open()` dedup now switches to the existing window's workspace. `closeAll()` closes only the active workspace; `closeAllEverywhere()` closes all. Athena's window snapshot reports all windows across workspaces (with workspace name); `focus()` switches to the target window's workspace. Desktop-only (MobileShell has its own navigation).
- Taskbar with running app indicators
- Start menu with app search
- System tray: clock, volume slider, notifications bell, DND toggle, mini-calendar
- Desktop right-click context menu (New Folder, Change Wallpaper, Animated Background, Refresh)
- Desktop icons for pinned apps
- Settings app: light/dark theme, accent color picker, wallpaper picker, **animated background picker** (14 canvas-based animations with category tabs + search), account info, notification preferences
- **Animated backgrounds** (`shell/AnimatedBackground.tsx`): 14 self-contained canvas animations (starfield, particle network, matrix rain, neon grid, aurora waves, ocean waves, bubbles, geometric pulse, fireflies, rain, plasma, constellation, bokeh, snowfall). Rendered on a `<canvas>` overlay above the static gradient wallpaper. Each animation uses `requestAnimationFrame`, handles resize + DPR scaling, and cleans up on unmount. The picker in Settings supports category filtering (Space, Nature, Abstract, Retro, Weather, Basic) + full-text search across names, tags, and descriptions. Also accessible via desktop right-click → "Animated Background" submenu. Selection persisted in `localStorage` via `settings.animatedBg`.

### Apps
1. **Notes** — Markdown editor with live preview, folder organization, tags, search, auto-save (debounced), pin, export to Markdown/PDF. **Realtime split editor** (CodeMirror 6 markdown + live preview, edit/split/preview modes), **full LaTeX** via KaTeX (`$...$` inline, `$$...$$` display), debounced auto-save (1.5s, saves on blur + `Ctrl/Cmd+S`, dirty indicator per note).
2. **Tasks** — Kanban board (To Do / In Progress / Done) with drag-and-drop, priority tags, due dates
3. **File Manager** — Full-featured virtual file system:
   - 3-pane layout: sidebar (folder tree + smart collections) | main (toolbar + breadcrumbs + file area) | quick-look panel
   - Smart collections: Home, Recent (last opened), Starred, All Files
   - Recursive folder tree sidebar with expand/collapse, file counts per folder, drag-drop to move
   - Grid and list views with sortable columns (name/size/modified/type, asc/desc)
   - Multi-select: click, Ctrl/Cmd+click (toggle), Shift+click (range), Ctrl+A (select all)
   - Selection bar: bulk download as ZIP, copy/cut/paste files, bulk delete
   - Right-click context menus (per file, per folder, empty space) using shared ContextMenu component
   - File operations: rename (F2), duplicate, star/unstar, move (drag-drop or paste), delete
   - Folder operations: rename, move (drag-drop with cycle detection), download as ZIP, delete (recursive)
   - Drag-and-drop file upload (drop anywhere in file area)
   - Search box (filters current view by name)
   - Storage usage bar in sidebar
   - Keyboard shortcuts: Delete, F2, Enter, Ctrl+A/C/X/V, F5, Backspace (go up)
   - Quick-look panel: single-click shows preview (image/PDF/audio/video/text) + file metadata + Open/Download buttons
   - Double-click opens file in Editor (text/code) or Viewer (media) window
4. **Code Editor** — CodeMirror 6-based text/code editor:
   - Syntax highlighting for 40+ languages (JS/TS, Python, Go, Rust, Java, C/C++, C#, PHP, HTML, CSS, JSON, SQL, XML, Markdown, YAML, TOML, Shell, Ruby, Lua, R, Swift, Kotlin, Scala, Dart, GraphQL, Diff, and more)
   - Markdown live-preview: edit / split / preview modes
   - Auto-save (debounced 1.5s for existing files; prompt for name on new files)
   - Ctrl+S manual save, word-wrap toggle, download
   - Light/dark theme follows app settings
   - Status bar: language, char count, line count, file size, save status
   - Dirty-state indicator (● in window title)
   - Opened via Files double-click or Command Palette
5. **File Viewer** — Media viewer for non-text files:
   - Image: zoom (wheel/buttons), pan (drag), fit-to-screen, actual size (1:1), fullscreen
   - PDF: embedded iframe viewer
   - Audio: native player with controls
   - Video: native player with controls
   - Fallback: "No preview available" + download button
   - Opened via Files double-click or Command Palette
6. **Music Widget** — Compact desktop overlay (`shell/MusicWidget.tsx`) fixed to the top-right corner of the wallpaper. Polls the user's active Spotify device every 3s (no Web Playback SDK — works with playback on any device: phone, desktop, etc.). Shows album art, track name, artist, current synced lyric line, play/pause + skip controls, and a click-to-seek progress bar. Expandable lyrics panel with auto-scrolling synced lyrics (LRCLIB), highlight active line, device name display. **Chill mode**: click the maximize button (or press ESC to exit) for a fullscreen immersive experience (`shell/ChillView.tsx` + `shell/ChillBackground.tsx`) — beat-reactive animated canvas background that captures system audio via `getDisplayMedia` (PipeWire on Fedora) and runs it through a Web Audio `AnalyserNode` for real-time beat detection. Renders floating color orbs (extracted from album art), particle field, beat ripples, and frequency bars — all reacting to the actual audio. Spinning vinyl-style album art, large centered synced lyrics with glow on the active line (proximity-based fade for surrounding lines), full playback controls, and spacebar play/pause. Falls back to simulated mode (pulses on lyric line changes) if audio capture is denied. State managed in `store/music.ts` (polling-only, no SDK). Backend: `routes/spotify.ts` + `routes/lyrics.ts` (unchanged).
7. **Pomodoro / Focus Timer** — Circular SVG progress ring, 25/5/15 work-break intervals, auto long-break after 4 sessions, Web Audio API chime on phase change, auto-enables Do-Not-Disturb during focus, daily session stats (localStorage), sound toggle. Each completed focus phase also logs a `FocusSession` row server-side (`POST /api/focus/sessions`, best-effort) so the Analytics dashboard can chart study hours over time; the localStorage write is kept for habit auto-completion.
8. **Flashcards** — SM-2 spaced repetition algorithm, deck browser with color tags, card CRUD, 3D flip-card review mode (CSS `rotateY` + `backface-visibility`), 4-level quality rating (Again/Hard/Good/Easy), due-date scheduling, progress bar during review. Each review also writes a `FlashcardReview` row (date + quality) for the Analytics dashboard's reviews/day + retention curve.
9. **Grade Tracker / GPA Calculator** — Course management with semester filtering, weighted assignment categories (Homework/Quiz/Exam/Lab/etc.), credit-weighted GPA on 4.0 scale, letter grade conversion (A/A-/B+/...), animated percentage bars, color-coded scores, expandable course cards
10. **VUT Studis** — Brno University of Technology integration:
   - One-time login with VUT credentials (id.vut.cz) — encrypted with AES-256-GCM, stored in DB
   - Backend handles full Shibboleth/SAML SSO flow with cookie jar + session caching (25min TTL)
   - **Overview tab**: today's classes, quick stats (graded courses, weekly classes, updates), recent subject updates, quick links
   - **Grades tab**: native grades table parsed from Studis `el_index` (course, code, credits, completion type, grade, ECTS), color-coded by grade, "Import to Grade Tracker" button
   - **Timetable tab**: weekly grid (Mon–Fri × time slots) parsed from `osobni_rozvrh`, color-coded per course, shows room/teacher/type
   - **Updates tab**: subject announcements feed parsed from `aktuality_predmet`, sorted by date
   - **Web View tab**: embedded browser via backend reverse proxy (strips X-Frame-Options, rewrites URLs for seamless navigation), address bar, open-in-new-tab
   - HTML parsing with cheerio, resilient multi-strategy parsers (table-based + div-based)
11. **Settings** — Split into 11 sections (sidebar nav, `apps/settings/sections/*.tsx`):
    - **Appearance** — theme (light/dark), accent color (presets + custom).
    - **Wallpaper** — static gradient picker.
    - **Animated Background** — 14 canvas animations with category tabs + search.
    - **Account** — editable display name + avatar color, change password (current-password verification), shows role badge. Backend: `PATCH /api/auth/profile`, `POST /api/auth/password`.
    - **Sound & Athena** — system volume slider, Athena quick-panel roll-in edge (bottom/top/left/right) + panel width/height. Exposes previously-hidden `settings.volume` / `athenaRollEdge` / `athenaQuickSize` store values.
    - **Athena Assistant** — LLM provider config (key + provider/baseURL/model, AES-256-GCM encrypted) **+ custom instructions** textarea (stored on `User.athenaInstructions`, injected into the Athena system prompt via `services/athena/context.ts`). Backend: `GET/PUT /api/athena/instructions`.
    - **Integrations** — consolidated connect/disconnect/status for Spotify (server-wide), VUT Studis (per-user encrypted creds), Microsoft Calendar (server-wide + sync), Moodle (reuses VUT creds). Reuses existing per-app client services.
    - **Notifications** — enable + Do-Not-Disturb toggles.
    - **Users** (admin-only, gated by `role=ADMIN`) — full user management: list, create (with role), edit (display name/avatar/role), reset password, delete. Blocks self-delete and self-demotion. Backend: `/api/users/*` guarded by `middleware/admin.ts`.
    - **Data & Storage** — storage usage bar (reuses `/api/files/storage`), export all user data as JSON (`GET /api/auth/export`), clear local cache, danger-zone account deletion (password-confirmed `DELETE /api/auth/account`).
    - **About** — client/server version, `/health` status, reset settings to defaults.
    - **Roles:** `User.role` is `USER` | `ADMIN` (String, SQLite has no enums). Seed user + first registered user become ADMIN. Existing installs backfilled via migration (earliest user promoted). `api.delete` supports an optional body (used by account deletion).
12. **Study Hub** — AI study workflows (one-click, structured) on top of the Athena LLM infra (`services/athena/llm.ts`):
    - **Generate Flashcards** — pick a note/file/pasted text → AI generates Q/A pairs → editable preview grid → save into a new Flashcards deck. Cards store `sourceRef` (the source label) shown as a badge in the deck list.
    - **Summarize** — TL;DR / outline / key-points modes → saves a new Note. Citation-aware: output includes `[1]` markers + a Sources section.
    - **Quiz Me** — AI generates MCQ + short-answer questions → answer one-by-one with instant AI grading + explanation → final score + wrong-answer review.
    - **Explain** — ELI5 / Standard / Expert depth → saves a new Note. Citation-aware.
    - **Study Guide** — pick multiple notes → AI consolidates into a cheat sheet → saves a Note. Citation-aware with `[n]` markers per source.
    - **Syllabus → Tasks** — paste a syllabus/outline → AI extracts tasks with due dates + priorities → editable preview → creates Tasks.
    - **Ask (grounded)** — NotebookLM-style source-grounded Q&A. Pick sources (notes/files/PDFs/URLs/pasted text/Moodle) → ask questions → streamed answers cite the source for every claim with clickable `[n]` chips. Conversations are persisted as `StudyChat` rows (resumable). Backend: `routes/study-chat.ts` (`/api/study/chat/*`) with SSE streaming (`POST /:id/stream`); sources injected as numbered SOURCE blocks via `groundedQaSystemPrompt`; citations extracted + persisted per assistant message. Client: `apps/study/SourceChat.tsx` + `CitationMarkdown.tsx` (renders `[n]` as superscript chips that open the source).
    - **Podcast** — generates a 2-host dialogue script from selected sources (LLM), saves the script as a Note, and plays it back in-browser via the Web Speech API (`usePodcastTts` hook: play/pause/skip/speed, alternating voices per host). Audio is playback-only (browser TTS can't be captured to a file); the script note is the persistent, downloadable artifact. Backend: `routes/study-podcasts.ts` (`/api/study/podcasts/*`); script prompt via `podcastScriptPrompt`. Client: `apps/study/Podcast.tsx`.
    - **Source library** — persistent `StudySource` rows (note/file/paste/moodle/url with cached extracted text) reusable across grounded Q&A, podcasts, and cited study materials. Deduped by (userId, kind, refId); re-resolving refreshes the cached text. Backend: `routes/study-sources.ts` (`/api/study/sources/*`) + `resolveAndCache` in `services/study/source.ts`. Source resolution now supports **PDF extraction** (via `pdf-parse` v2) and **URL fetching** (via `@postlight/parser` Readability, reusing `services/fetcher.ts`); `MAX_SOURCE_CHARS` bumped to 30000.
    - **Learning workspaces** — named, persistent groups of sources (`LearningWorkspace` model). The student builds a source set once and reuses it to start grounded chats or podcasts without re-picking sources each time. One workspace can back many chats/podcasts. StudyHome shows workspace cards with quick-launch "Ask" + "Podcast" buttons; `WorkspaceEditor` creates/edits/deletes workspaces and manages their sources (pick from the library or add new via SourcePicker). Backend: `routes/study-workspaces.ts` (`/api/study/workspaces/*` — CRUD + `POST /:id/sources` + `DELETE /:id/sources/:sourceId`). Client: `services/study-workspaces.ts` + `apps/study/WorkspaceEditor.tsx`. `SourceChat` and `Podcast` accept an `initialWorkspaceId` prop (and `StudyApp` payload `workspaceId`) to preload sources.
    - **Recent Activity** — feed of past study sessions (logged via `StudySession` model).
    - **Highlights & annotations** — persistent, user-driven highlighting across Study Hub reading surfaces (AI outputs, cited chat/teacher answers, podcast scripts) AND source documents (Notes + Editor). 5 colors (yellow/green/blue/pink/purple), optional annotations, and "Export as Note". Highlights are anchored by text snippet + before/after context (re-located via `findRangeInText` on render) and scoped to a `contentKey` (hash of the rendered content) so they reappear when the same content is shown again; for Notes/Editor (where content evolves) they're scoped to `(scope, scopeId)` and re-anchored by text search on every edit. Markdown surfaces use `HighlightableMarkdown` (post-render DOM walk wraps ranges in `<mark class="athena-hl athena-hl-<color>">`; selection → floating toolbar, or bottom sheet on phone). CodeMirror surfaces use `useCodemirrorHighlights` (persistent `StateField` of mark decorations, selection → `CodemirrorHighlightToolbar`). A central "Highlights" Study Hub mode (`Highlights.tsx`) lists all highlights with color/scope filters, inline annotation edit, delete, and "Export as Note". Backend: `StudyHighlight` model + `routes/study-highlights.ts` (`/api/study/highlights/*` — CRUD + `POST /export` builds a Note). Client: `services/study-highlights.ts` + `store/highlights.ts` + `apps/study/{HighlightableMarkdown,Highlights,highlightUtils}.tsx` + `apps/shared/{useCodemirrorHighlights,CodemirrorHighlightToolbar}.tsx`.
    - **Cross-app linking**: Study chats, podcasts, and sources auto-link to their underlying notes/files via `ItemLink` (`db/links.ts`). `LINK_TYPES` extended with `studySource`, `studyChat`, `podcast`; `LinkBadge` opens them in the Study app with a deep-link payload (`chatId` / `podcastId`).
    - Backend: `routes/study.ts` (`/api/study/*`) reuses `getUserConfig`/`buildModel`; structured JSON endpoints via `services/study/llm-json.ts` (robust JSON extraction + one re-prompt retry); source resolution in `services/study/source.ts` (note/file/PDF/paste/URL/Moodle); in-memory quiz store (`services/study/quiz-store.ts`, 30-min TTL). Citation-aware prompt variants in `services/study/prompts.ts` (`*CitedPrompt` functions) keep generated materials faithful to sources.
    - **Lecture Video → Notes** — upload a lecture recording (screen capture or camera footage) → background pipeline extracts audio → Whisper transcription with timestamps → dHash slide deduplication (keeps last frame per stable group for complete bullet builds) → vision LLM slide-region detection for camera footage (with OCR fallback via tesseract) → per-slide notes generated by LLM combining slide content + aligned transcript → single Note with embedded slide images, timestamps, and structured notes (Cornell/outline/summary/bullets). Background job tracked via `LectureJob` DB model with polling progress card. Output auto-linked to video + slides via `ItemLink`, cached as `StudySource` for reuse. Pipeline: `services/study/lecture/{ffmpeg, transcribe, slides, vision, align, pipeline}.ts`. Routes: `routes/study-lectures.ts` (`/api/study/lectures/*`). UI: `LectureNotes.tsx` in Study Hub.
    - **Moodle integration**: Study Hub can use Moodle course materials as a source. The SourcePicker has a "Moodle" tab that lists enrolled courses → course sections → activities (pages, files, assignments). Fetchable activities (text-based) are sent to the LLM. Authentication rides the existing VUT SSO (id.vut.cz OIDC) — no separate Moodle login needed. Backend: `services/moodle.ts` (auth via `fetchWithVutSession`, course/contents/resource scraping with cheerio), `routes/moodle.ts` (`/api/moodle/*`).
    - Athena tools: `generate_flashcards` (creates deck + opens Flashcards via client_action), `summarize_note`, `create_tasks_from_text`, `open_study_hub` (opens Study Hub with optional preselected mode/source), `list_moodle_courses`, `get_moodle_course_contents`, `read_moodle_resource`.
    - **Knowledge Graph** (NotebookLM-style persistent source representation) — instead of every feature independently re-reading and re-analyzing raw source text, a source-set is processed **once** into a structured `ConceptGraph`: concepts (with type, 1-2 sentence definition, importance 1-5, grounded facts) and typed relationships between them, everything cited back to `[n]` source indexes. Flashcards, Quiz, Summarize, Explain, and Study Guide then **derive** their output from this shared compact graph JSON instead of the full source text — cheaper (small JSON vs. up to 30k chars per call) and consistent (all five features reflect the same underlying facts/relationships). Study Guide is rendered as a pure Markdown template from the graph with **no LLM call at all**. Syllabus→Tasks, Podcast, and grounded Chat are unaffected (deadlines/dialogue/free-form Q&A don't fit the concept-graph shape).
      - **Model** (`ConceptGraph`): `sourceIds` (sorted JSON array of `StudySource` ids) + `sourceKey` (comma-joined, the dedupe/cache key — one graph per unique source-set per user) + `data` (JSON `ConceptGraphData`: `summary`, self-contained `sources` list, `concepts[]`, `relationships[]`).
      - **Extraction** (`services/study/graph.ts`): `buildConceptGraphData` — a single `generateJson` call via `conceptGraphPrompt`, with sanitization (slug dedup, clamps citation indexes to the actual source list, drops edges referencing unknown nodes). `getOrBuildGraph(userId, model, cachedStudySources, opts)` sorts source ids → looks up an existing `status:"ready"` row by `(userId, sourceKey)` → reuses it (`cached:true`) unless `forceRefresh`, else builds + upserts.
      - **Routes** (`routes/study-graph.ts`, `/api/study/graph/*`): `POST /` (resolve+cache sources via `resolveAndCache` → get-or-build), `GET /` (list, summary only), `GET /:id`, `POST /:id/refresh` (force rebuild from the stored `sourceIds`), `DELETE /:id`.
      - **Derived-feature integration** (`routes/study.ts`): `/flashcards`, `/summarize`, `/explain`, `/quiz/start`, `/study-guide` all accept either a `graphId` (reuse directly, skips resolution) or `source`/`sources` (auto-resolve → get-or-build → derive — transparent to the caller). Graph-based prompt variants (`flashcardsFromGraphPrompt`, `quizFromGraphPrompt`, `summarizeFromGraphPrompt`, `explainFromGraphPrompt`) and the pure-template `studyGuideFromGraph` live in `services/study/prompts.ts` next to the original raw-text `*CitedPrompt` variants (kept for Athena's lighter-weight `studyTools`).
      - **Athena tools** (`services/athena/tools/study-graph.ts`): `build_concept_graph` (resolve a source → get-or-build → return a compact overview: concept/relationship counts, top concepts, `graphId`), `get_concept_graph` (full structure for direct reasoning). `open_study_hub` accepts an optional `graphId` to deep-link into the graph view or seed a derived-feature mode from it.
      - **Client** (`apps/study/KnowledgeGraph.tsx`, new Study Hub mode `"graph"`): builds/lists/refreshes/deletes graphs (source picking reuses `WorkspaceSourceSelector`), renders an interactive force-directed graph via `react-force-graph-2d` — glowing nodes colored/sized by type/importance, hover/select dims unrelated nodes and highlights the neighborhood with flowing directional particles on active edges, a type-color legend, and zoom-to-fit. A side panel shows the selected concept's definition/facts/relationships (citation chips matching `CitationMarkdown`'s style) with an action bar that opens Flashcards/Quiz/Summarize/Explain/Study Guide seeded from the same `graphId` (`GenerateFlashcards`/`Summarize`/`Explain`/`QuizMe`/`StudyGuide` all accept an `initialGraphId` prop and show a `PinnedGraph` badge in place of the source picker). `useContainerSize`'s `ResizeObserver` **must** be attached via a callback ref (not a plain ref + `useEffect([])`) because the canvas container mounts conditionally once data loads — a mount-time effect would see `ref.current === null` and never re-attach. Canvas node-position accessors (`node.x`/`node.y`) can be transiently `NaN` before the first force-simulation tick; canvas draw callbacks guard with `Number.isFinite` before calling `createRadialGradient`/`arc` to avoid a hard crash.
      - **Async build/refresh (avoiding proxy timeouts):** graph extraction is a single LLM call that can take well over a minute on slower/free models — awaiting it synchronously in `POST /api/study/graph` and `POST /:id/refresh` got killed by Cloudflare's edge (**HTTP 524** — the VPS domain is Cloudflare-proxied, ~100s default timeout for proxied requests) before the response could be sent, even though the origin was still working fine. Fixed by making both endpoints fire-and-forget: `startBuildGraph`/the refresh route reserve the `ConceptGraph` row as `status:"building"` and return immediately (202) with just `{ graphId, status }`; the extraction runs in the background and updates the row to `"ready"`/`"error"` on completion via a detached promise chain (`void buildConceptGraphData(...).then(...).catch(...)`, not awaited by the request handler). `GET /:id` (`getGraphStatus`, unlike `getGraphById` which requires `"ready"` and backs the derived-feature routes) returns the row regardless of status so the client can poll it. `KnowledgeGraph.tsx`'s `pollGraph()` polls every 2.5s and resolves `data`/`error` once status leaves `"building"`; `loadGraph()` (deep-linking to a graph, e.g. from a recent-graphs click or Athena's `graphId` payload) also detects an in-progress build and starts polling instead of assuming ready data. `BuildProgress` continues to show the ticking elapsed time throughout. Note: the derived-feature auto-build path (`resolveGraphForRequest` in `routes/study.ts`, used when Flashcards/Summarize/etc. are called with `source`/`sources` instead of an existing `graphId`) still awaits `getOrBuildGraph` synchronously and is **not** immune to the same timeout on a cold (never-built) graph for a large source — building a graph via the Knowledge Graph app first (or generating flashcards/etc. from an already-built graph) avoids this.
13. **Athena** — LLM workspace assistant (chat UI) powered by `multi-llm-ts`:
    - Streaming chat over SSE (`POST /api/athena/chat`): content + tool-call progress + client-action events
    - Tool calling via `MultiToolPlugin` (per-request, per-user): `create_task`, `list_tasks`, `update_task_status`, `list_courses`, `get_course_grades`, `list_notes`, `read_note`, `create_note`, `list_files`, `search_files`, `read_file`, `edit_file`, `start_pomodoro`, `generate_flashcards`, `summarize_note`, `create_tasks_from_text`, `open_study_hub`, `list_moodle_courses`, `get_moodle_course_contents`, `read_moodle_resource`, `list_calendar_events`, `create_calendar_event`, `schedule_task`, `find_free_slots`, `open_calendar`, `sync_microsoft_calendar`, `list_habits`, `create_habit`, `log_habit`, `open_habits`, **web_search** (DuckDuckGo, no API key), **fetch_url** (Readability extraction), **research** (multi-step search→fetch→synthesize with [n] citations), **run_code** (Docker-isolated Python/JS/TS sandbox), **create_notes_from_url** / **create_notes_from_pdf** (auto notetaking), **create_task_from_note** / **create_tasks_from_note** / **create_note_from_task** / **schedule_note_review** (cross-app composites), **remember** / **recall_memory** / **forget_memory** / **list_memories** (persistent memory), **open_browser** / **navigate_browser** / **browser_back** / **browser_forward** / **browser_reload** / **get_browser_content** (Athena-driven Browser app)
    - **Advanced agent tools** (`services/athena/tools/{search,fetch,sandbox,notetake,crossapp,research,memory}.ts` + `services/{search,fetcher,sandbox}.ts`):
      - **Web search** (`web_search`): Tavily Search API (primary, AI-optimized, keyless mode available) → Brave Search API (if key set) → DuckDuckGo HTML scraper (fallback) via `services/search.ts` — 60s in-memory cache, gentle rate limiting. Returns titles + URLs + snippets.
      - **URL fetching** (`fetch_url`): `services/fetcher.ts` fetches a page with SSRF protection (blocks private/loopback/link-local ranges), extracts main article text via `@postlight/parser` (Readability), falls back to cheerio. Truncates to ~20k chars.
      - **Research** (`research`): multi-step orchestration — Tavily/Brave/DDG search → fetch top result pages in parallel (concurrency 4) → LLM synthesizes a cited answer with inline `[1]`/`[2]` markers + a Sources section. Depth: quick (2 sources), standard (4), deep (2 searches + 6 sources with an LLM-refined second query). Sources rendered as clickable chips in the chat.
      - **Code execution** (`run_code`): `services/sandbox.ts` runs Python/JS/TS in a throwaway Docker container (`--network=none`, `--read-only`, `--cap-drop=ALL`, `--user=65534`, 256MB memory, 10s timeout). Auto-disabled when Docker is missing or `SANDBOX_ENABLED=false`. Result (code + stdout/stderr + exit code + duration) rendered inline as a collapsible block. Requires Docker socket mounted (see docker-compose.yml). `requiresConfirmation` flag on the ToolDef triggers client confirmation before execution.
      - **Auto notetaking** (`create_notes_from_url`, `create_notes_from_pdf`): fetch a URL or extract PDF text → LLM generates structured notes (Cornell / outline / summary / bullets) → saves a Note + opens Notes app. PDF extraction reuses `pdf-parse`. Logs a `StudySession` (`type="notes"`).
      - **Cross-app composites** (`create_task_from_note`, `create_tasks_from_note`, `create_note_from_task`, `schedule_note_review`): bridge multiple apps in one tool call. `create_task_from_note` uses the LLM to extract the primary action item; `create_note_from_task` can optionally expand a task into detailed notes via the LLM; `schedule_note_review` creates a Calendar event linked to the note (`source="note"`).
      - **Persistent memory** (`remember`, `recall_memory`, `forget_memory`, `list_memories`): `AthenaMemory` Prisma model stores facts/preferences/goals. The 5 most recently updated memories are injected into the system prompt every turn (so Athena "knows" them without an explicit recall). Categories: general / preference / fact / goal / person.
      - **Name personalisation** (`set_user_name`, `get_user_name` in `services/athena/tools/profile.ts`): the user's name lives on `User.displayName` (same field as Settings → Account and the new onboarding "name" step). It is injected into the system prompt every turn, so Athena addresses the student by name; when the user states or changes their name in chat, Athena calls `set_user_name`, which persists it and emits a `profile_updated` client action that refreshes the auth store so all greetings update live. The legacy seeded placeholder `"Student"` is treated as "no name".
      - **Inline result rendering**: the client renders rich blocks below tool chips for `run_code` (collapsible code + colored stdout/stderr + exit badge + duration), `web_search` (clickable source chips), and `research` (numbered citation chips). Uses the `result` field already streamed in the `tool` SSE event.
    - **Recent-files context**: the 5 most recently opened files (id, path, type, size, short text preview — NOT full content) are injected into the system prompt every turn, so Athena already "knows" what files exist. Full contents are loaded on demand via `read_file`.
    - **Client-action dispatch**: tools that affect the desktop (e.g. `start_pomodoro`) return a payload streamed as a `client_action` SSE event; the client opens/controls the relevant app (Pomodoro auto-starts with the requested phase/duration).
    - Multi-turn conversation history sent each turn; abortable via the Stop button.
    - Any `multi-llm-ts` provider works (openai, deepseek, anthropic, openrouter, ollama, groq, mistralai, google, xai, meta, cerebras). Per-user config encrypted (AES-256-GCM) in DB; optional server-wide fallback via env vars. If neither is configured, Athena AI is unavailable.
    - **Quick panel mode** (`Win+Y`): Athena can be activated as a rolling quick panel that slides in from a user-selected screen edge (bottom/top/left/right) instead of a normal window. The panel occupies a partial area (~80% width, ~3/4 height by default), doesn't cover all apps, is resizable with remembered size (persisted in settings), and has an **Expand** button to switch to the full window mode. Roll edge is configurable via a dropdown in the quick panel header. Athena remains openable as a full window from the Start Menu / Command Palette.
    - **File attachments** (paperclip button in the composer): users can attach files (PDF, TXT, C/C++, Java, TS, JS, Python, Markdown) to the chat. When a file is attached:
      1. The file is uploaded to `POST /api/athena/attach`, which extracts text (text files: direct read; PDF: `pdf-parse` v2 library) and stores the file temporarily in `uploads/temp/`.
      2. The extracted text (max 50,000 chars, truncated if larger) is injected into the next chat message as context, so Athena can answer questions about the file content.
      3. A **"Save to Storage?"** dialog appears immediately, offering three options:
         - **Pick a folder manually** — scrollable folder list with full paths (e.g. `Lectures/Math`), plus a "Root" option.
         - **Let Athena suggest** — calls `POST /api/athena/suggest-folder`, which uses the per-user LLM (`generateJson` from `services/study/llm-json.ts`) to analyze the file name + content preview + the user's folder tree + course names, and returns `{ folderId, folderPath, reason, confidence }`. The suggested folder is auto-selected with a confidence badge and explanation.
         - **Don't save** — the file is used only for the current chat session (temp file is later cleaned up).
      4. If saved, `POST /api/athena/save-attached` copies the temp file to permanent storage (`uploads/{userId}/`), creates a `VFile` record in the DB with the chosen `folderId`, and sets `lastOpenedAt = now()` so the file immediately appears in the **Recent Files** context injected into Athena's system prompt on subsequent turns.
      - Accepted extensions: `.pdf, .txt, .c, .h, .cpp, .cc, .cxx, .hpp, .java, .ts, .tsx, .js, .jsx, .py, .md` (max 20 MB).
    - **Conversation history**: chats are persisted in the DB (`ChatConversation` model — single row per conversation with messages stored as a JSON array). The active conversation is automatically archived after 30 minutes of inactivity (checked on every `GET /api/conversations` call via `autoArchive`). The user can also start a new chat manually with the **New** button, which archives the current active conversation and creates a fresh one. A **History** dropdown in the header lists all conversations (active + archived) with auto-generated titles (LLM generates a short descriptive title from the first few messages via `POST /api/conversations/:id/generate-title`), timestamps, and delete buttons. Clicking a conversation loads its messages for viewing/resuming. Backend: `routes/conversations.ts` (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/generate-title`, `DELETE /:id`, `POST /archive-all`).
14. **Calendar / Planner** — Unified time-based view for all student events:
    - Month / Week / Day views with click-to-create, drag-to-reschedule, and a color-coded event editor (title, start/end, all-day, color, location, description).
    - **Layer toggles** to show/hide: My Events (manual), Tasks (due dates), VUT Classes (timetable projected onto the current week), Assignments, Microsoft (Outlook sync).
    - **Drag a Task onto a slot** → creates a "Study: …" calendar event linked to the task (`source="task"`, `sourceRef=taskId`).
    - **ICS import/export**: import `.ics` files (single VEVENTs + simple DAILY/WEEKLY/MONTHLY recurrence expanded into the visible range); export the user's events as a downloadable `.ics`.
    - **Microsoft Calendar sync** (`services/microsoft.ts` + `routes/microsoft.ts`): two-way sync with Microsoft (Outlook) calendars via Graph API.
      - **Pull sync**: `POST /api/microsoft/sync` fetches events from the user's default Outlook calendar for a date range, upserts them as `CalendarEvent` rows (`source="microsoft"`, `sourceRef=msEventId`), and removes local MS events that no longer exist remotely. Free/tentative events are shown in a dimmer color.
      - **Push**: `POST /api/microsoft/push` creates a local event in the user's Outlook calendar (or updates it if already linked), then links the local event to the MS event ID.
      - **Delete**: `DELETE /api/microsoft/event/:msId` removes an event from Outlook + deletes the local copy.
      - **Token management**: OAuth2 refresh-token flow with automatic rotation handling — Microsoft may return a new refresh token on each exchange, which is persisted in the `Setting` table (`key="ms_refresh_token"`) to survive restarts. The env var `MS_REFRESH_TOKEN` seeds the DB on first run.
      - **UI**: "Sync" button in the calendar toolbar (shows `Cloud` icon when configured, `CloudOff` when not); MS events are prefixed with `☁` and controlled by the "MS" layer toggle; event editor shows a "Microsoft" badge for MS-sourced events and a "Push to MS" button for local events.
      - Env vars: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID` (default `common`), `MS_REFRESH_TOKEN`. Requires `Calendar.ReadWrite` + `offline_access` scopes.
    - VUT timetable classes and assignment due dates are merged client-side from existing `vutApi.timetable()` and `gradesApi` — no backend duplication.
    - Athena tools: `list_calendar_events`, `create_calendar_event`, `schedule_task` (links a task to a time slot + opens Calendar via client_action), `find_free_slots` (reads events + VUT classes for a day, returns free windows), `open_calendar`, `sync_microsoft_calendar` (pulls MS events into local DB, returns synced/deleted counts).
    - Today app integration: "Today's Schedule" card shows today's events sorted by start time.
15. **Habit Tracker** — Streak-based daily/weekly habits:
    - Habit list with one-tap check-off, current streak, longest streak, and a 7-day mini strip per habit.
    - Detail panel with a GitHub-style 13-week heatmap, total completions, and delete.
    - **Auto-completion** for pomodoro-linked habits: reads the same `localStorage` `pomodoro-stats` the Pomodoro app writes (focusSessions / focusMinutes); when today's metric ≥ target, the habit shows an "auto" badge and one tap logs it.
    - Create form with icon picker, color picker, cadence (daily/weekly), target count, and optional linked app/metric.
    - Athena tools: `list_habits` (with current streaks + doneToday), `create_habit`, `log_habit` (marks today done), `open_habits`.
    - Today app integration: "Habits" card with one-tap check-off and streak display.
16. **Quick Capture** — Global capture inbox:
    - `Ctrl+Shift+N` (or `Cmd+Shift+N`) opens an animated overlay with a single text input.
    - On Enter, `POST /api/capture` uses the per-user LLM (via `services/study/llm-json.ts`) to classify the input as `task | note | flashcard | athena`, performs the action (creates the item), and returns a `clientAction` that opens the relevant app.
    - Falls back to creating a plain Task with the raw text if no LLM is configured or the LLM call fails.
    - Flashcard captures go into a "Quick Capture" deck (auto-created). Athena captures open Athena with the text prefilled as a prompt.
    - **Voice input**: a mic button toggles a compact recorder mode (reuses `apps/voice/useRecorder.ts`). On stop, `POST /api/voice` transcribes + cleans up the recording and opens the resulting linked Note. A "Text" button switches back to typed input.
    - Discoverable via the Command Palette ("Quick Capture" action).
17. **Whiteboard** — Interactive vector drawing canvas for learning/sketching:
    - SVG-based vector graphics (true vector, scalable, lossless). Fixed 2000×1400 canvas scaled to fit the window.
    - Tools: Select (move + 8-handle resize + Delete/Backspace to remove), Pen (freehand), Line, Rectangle, Ellipse, Arrow, Text, Eraser (click-to-delete).
    - Style controls: color swatches + custom color picker, stroke width (2/4/8px), fill toggle (shapes), font size (text).
    - **Images**: paste from clipboard (`Ctrl/Cmd+V` reads `image/*` clipboard items) or drag-drop image files onto the canvas. Pasted/dropped images are downscaled to max 1600px before storage to avoid DB bloat.
    - **Undo/redo** stacks (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`); Clear canvas.
    - **Export**: download as `.svg` (serialized SVG) or `.png` (rasterized via canvas).
    - **Persistence**: `Whiteboard` Prisma model (`content` = JSON array of vector elements). Multi-board list view (create/open/rename/delete). Debounced 1.5s auto-save + `Ctrl/Cmd+S` manual save + dirty indicator (● in window title). Backend: `routes/whiteboards.ts` (`GET/POST /api/whiteboards`, `GET/PUT/DELETE /api/whiteboards/:id`).
    - Client: `apps/whiteboard/{WhiteboardApp,Canvas,Toolbar,elements}.tsx` + `services/whiteboards.ts`.
18. **Ntfy** — Bidirectional push-notification channel for Athena + scheduled cron jobs:
    - Ntfy (ntfy.sh or self-hosted) as a **two-way communication channel**: Athena pushes notifications to the user's phone, and the user can message Athena from their phone — inbound messages trigger a full Athena LLM turn (with tools) and the reply is pushed back via ntfy. Works even when the web app is closed.
    - **Per-user config** (server URL + bearer token + topic names, AES-256-GCM encrypted in DB). Two topics per user: `notify` (Athena → user) and `inbox` (user → Athena). Topics auto-generated as unguessable random strings. Server-wide fallback via `NTFY_*` env vars.
    - **Background workers** (started on server boot): a 60s **cron scheduler** (`services/ntfy/scheduler.ts`) that fires due `NtfyCronJob` rows, and per-user **inbox subscribers** (`services/ntfy/subscriber.ts`) — persistent long-poll connections kept in sync with config changes (start/stop/restart per user).
    - **Cron jobs** (5-field cron expressions via `croner`): two types — `notification` (fires a fixed message) and `athena` (runs a prompt through the LLM at fire time and sends the generated reply via ntfy, e.g. "daily 8am: summarize my schedule + due tasks"). `nextRunAt` persisted; recomputed after each fire. Min interval enforced implicitly by cron expression validation.
    - **Athena tools**: `send_notification`, `list_cron_jobs`, `get_cron_job`, `create_cron_job`, `update_cron_job`, `delete_cron_job` — Athena can fully manage cron jobs from chat.
    - **App UI** (`apps/ntfy/NtfyApp.tsx`): three tabs — Setup (config + test notification + topic URLs to subscribe to), Messages (in/out/cron log + manual send), Cron Jobs (list/create/edit/delete/run-now with cron presets + live next-run preview). Status card in Settings → Integrations with "Open Ntfy" button.
    - Backend: `routes/ntfy.ts` (`GET /status`, `PUT/DELETE /config`, `POST /test`, `POST /send`, `GET /messages`, `GET /inbox-poll`, `GET/POST /cron`, `GET/PUT/DELETE /cron/:id`, `POST /cron/:id/run`, `POST /cron/preview`); `services/ntfy/{client,config,scheduler,subscriber,athena-turn}.ts`; `NtfyConfig` + `NtfyCronJob` + `NtfyMessage` Prisma models. Non-streaming Athena turns reuse `buildSystemPrompt`/`buildModel`/`AthenaToolsPlugin`/`ALL_TOOLS` from `services/athena/`.
19. **Voice Notes** — Microphone recorder → transcribed linked Note:
    - Records from the mic via `MediaRecorder` (Web Audio `AnalyserNode` for a live level/waveform meter). Picks the best supported container (`audio/webm;codecs=opus` → `audio/ogg` → `audio/mp4`). Pause/resume, elapsed timer, in-app playback of the recording.
    - On stop, `POST /api/voice` (multipart `audio` + optional `title`/`folderId`/`cleanup`): saves the audio to the virtual FS (`VFile`), transcribes via the OpenAI-compatible `/audio/transcriptions` endpoint (Whisper; model from `OPENAI_TRANSCRIPTION_MODEL`, default `whisper-1`), runs an LLM cleanup pass (`services/study/llm-json.ts` `generateJson` → `{title, content}`: punctuate, paragraph, remove filler, smart title), creates a `Note` tagged `voice,audio`, and links note↔file via `ItemLink` (`db/links.ts`). Returns `{ file, note, transcript, transcribed, cleaned }`.
    - `POST /api/voice/transcribe/:fileId` re-transcribes an existing audio file and updates (or creates) its linked note.
    - **Graceful degradation**: if no AI key is configured or the provider doesn't serve audio transcription, the audio is still saved and a placeholder note is created — no data loss. The UI points the user to Settings → Athena Assistant.
    - **Quick Capture integration**: the `Ctrl+Shift+N` overlay has a mic button that switches to a compact recorder mode; on stop it runs the same `POST /api/voice` pipeline and opens the resulting note.
    - No DB migration — reuses `VFile` + `Note` + `ItemLink`. Client: `apps/voice/{VoiceApp,useRecorder}.tsx` + `services/voice.ts`. The `useRecorder` hook is shared between the app and Quick Capture.
20. **Browser** — Athena-integrated web browser (`apps/browser/BrowserApp.tsx`):
    - Desktop web browser rendered through a backend reverse proxy (generalizes the VUT web-view pattern). Pages are fetched server-side, rewritten so all navigation stays inside the proxy, and served to a sandboxed `<iframe>` — bypassing `X-Frame-Options`/CSP so most sites embed cleanly.
    - **Per-user cookie jar** (in-memory, `services/browser.ts`): cookies are scoped per host, attached to every outbound fetch, and absorbed from `Set-Cookie` responses, so **login sessions persist across navigations** (~24h TTL, refreshed on activity). `DELETE /api/browser/cookies` clears the session (log out).
    - **Browser chrome**: back / forward / reload / home buttons, an address bar (Enter navigates; bare domains get `https://` prefixed, anything else becomes a DuckDuckGo search), open-in-new-tab, clear-session, and a loading spinner. A start page (`athena://home`) with a search box + quick links shows when no URL is open.
    - **Address-bar sync**: the proxy injects a `postMessage` script into each page that reports the real (post-redirect) URL + title back to the parent, so the address bar and window title stay accurate even after redirects or in-iframe link clicks.
    - **SSRF protection**: reuses the validated host-blocking from `services/fetcher.ts` (`isBlockedHost`/`validateUrl`, exported) — only http/https, private/loopback/link-local/CGNAT ranges blocked, redirect hops re-validated.
    - **SPA compatibility**: the proxy (a) passes through non-HTML responses (JSON API calls, etc.) untouched with their original content-type, so runtime `fetch`/XHR calls from SPAs work through the proxy; and (b) injects a JS interception script at the top of `<head>` (before the page's own scripts) that patches `window.fetch`, `XMLHttpRequest.prototype.open`, and `history.pushState`/`replaceState` to rewrite same-origin/relative URLs to route through the proxy, and postMessages SPA navigations to the parent so the Browser app reloads the iframe through the proxy. The script also reports the real (post-redirect) URL + title to the parent for address-bar sync. The proxy URL includes the auth `token` so the injected script can build authenticated proxy URLs for runtime requests.
    - **Graceful fallback**: if a page doesn't report back within 12s (heavy SPAs / consent walls / frame-busting JS that prevent rendering), the Browser shows a "This site may not render in the embedded browser" notice with an "Open in new tab" button + retry.
    - **Shared state** (`store/browser.ts`): maps window id → current URL (sent to Athena in the chat request as `browserUrl` on the window) + a per-window command channel so Athena's `client_action` dispatch can drive navigation.
    - **Athena integration** (`services/athena/tools/browser.ts`): `open_browser` (open/focus the Browser + navigate to a URL or search query — clientAction), `navigate_browser` (navigate an open browser window — clientAction), `browser_back` / `browser_forward` / `browser_reload` (clientAction), `get_browser_content` (server-side: fetches the page currently shown in a browser window via the cookie jar and extracts its main text, so Athena can read what the user is viewing — works on logged-in pages). The system prompt includes an "Open browser tabs" section so Athena knows what the user is looking at. Athena opens the Browser proactively for web questions where seeing the page would help.
    - Backend: `routes/browser.ts` (`GET /proxy` — proxied HTML + `X-Final-Url` header, `GET /content` — extracted page text, `DELETE /cookies` — clear session); `services/browser.ts` (`proxyPage`, `fetchPageText`, `clearBrowserSession`, cookie jar). Auth via `?token=` query param (iframes can't set headers).
    - **Limitations**: despite the fetch/XHR/pushState interception, some sites with aggressive frame-busting, consent walls, or `window.location` checks (YouTube, Google) may still not render in the embedded iframe — the 12s fallback notice offers "Open in new tab." For pure text extraction, `fetch_url`/`research` remain more reliable; the Browser is for *viewing* + logged-in session reading.
21. **Analytics & Gamification** — Unified dashboard (`apps/analytics/AnalyticsApp.tsx`) aggregating the user's own data across Habits, Pomodoro, Flashcards, Grades, Study Hub, and Tasks into charts, plus an XP/level system + achievements.
    - **Backend** (`GET /api/analytics/me`, user-scoped — distinct from the admin `GET /api/analytics/overview`): runs ~18 Prisma queries in parallel and returns one payload — per-day series (last 90 days) + all-time totals for focus minutes/sessions, flashcard reviews + retention (quality≥3 rate), card maturity distribution (by SM-2 repetitions bucket), grade trend (assignment % vs `createdAt`), habit adherence (fraction of habits logged/day) + per-habit streaks, study sessions per day + by type, tasks completed per day, XP per day, and the resolved achievement set.
    - **XP & level**: XP is **derived** from the dated event logs (no XP ledger) — focus minute = 1 XP, flashcard review = 2, habit log = 5, task done = 10, study session = 15. `level = floor(sqrt(xp)/10) + 1` (level n requires `((n-1)*10)^2` XP). Total + per-day XP are reconstructed by summing the weighted events.
    - **Achievements**: 20 tiered (bronze/silver/gold/platinum) achievements across focus, reviews, streaks, tasks, study sessions, grades, and level. Only the unlocked-id set is persisted (`GamificationState.unlockedAchievements`, JSON array, upserted on `/me`); the endpoint returns `newlyUnlocked` ids so the client toasts them once via the notifications store.
    - **Charts**: pure-SVG components (`apps/analytics/charts.tsx`) — `BarChart`, `LineChart`, `RateLineChart` (0–1 rate series w/ null gaps), `DonutChart`, `Heatmap` (GitHub-style), `LevelRing`. No charting dependency; themed via CSS vars.
    - **Data sources**: `FocusSession` (Pomodoro logs each completed focus phase via `POST /api/focus/sessions`), `FlashcardReview` (flashcard review route logs each review), `HabitLog`, `Task` (status=DONE, updatedAt), `StudySession`, `Assignment` (createdAt). Historical focus/review data starts from feature ship date (no backfill).
    - **Refresh**: subscribed to the cross-app data-refresh bus (`useDataRefreshVersion("analytics")`) so an open dashboard reloads after Athena mutates habits/flashcards/tasks/study data.

### Command Palette (Spotlight)
- Triggered with `Ctrl+Space` (or `Cmd+Space` on Mac)
- Fuzzy search across: apps, quick actions, files, notes, tasks
- File results open in Editor (text/code) or Viewer (media) depending on file type
- Built-in calculator: type a math expression → get instant result (click to copy)
- Keyboard navigation: `↑↓` to move, `Enter` to select, `Esc` to close
- Animated overlay with backdrop blur
- Quick actions include: New Note, New Task, Start Pomodoro, Review Flashcards, Open Calendar, Open Habits, Quick Capture

### Quick Capture
- Triggered with `Ctrl+Shift+N` (or `Cmd+Shift+N` on Mac)
- One-line input → AI classifies as task/note/flashcard/athena → creates + opens the result
- Animated overlay with backdrop blur; Esc to close
- Also reachable from the Command Palette ("Quick Capture" action)

### Backend
- JWT auth (login/register/me)
- Full CRUD for notes, note folders, tasks, files, virtual folders
- File management: upload/download, rename, move, duplicate, star, text content read/write, bulk zip download (fflate), folder zip, recursive folder tree, storage stats, file search, recent/starred filters
- File upload/download with streaming
- Spotify proxy: token refresh, player control (play/pause/skip/seek/volume/shuffle/repeat/transfer), currently-playing
- LRCLIB proxy: exact match (`/get`) with DB cache, fuzzy search (`/search`), manual cache, LRC parser, User-Agent header, 300ms throttle
- Flashcards: deck CRUD, card CRUD, SM-2 review endpoint (`POST /cards/:id/review` with quality 0-5), due cards aggregation (`GET /due`)
- Grades: course CRUD, assignment CRUD, semester listing, weighted percentage + GPA computation helpers (client-side in `services/grades.ts`)
- VUT: credential management (AES-256-GCM encrypted), Shibboleth/SAML SSO authentication, session caching, HTML parsing (cheerio), reverse proxy for iframe embedding
- Athena (assistant): per-user LLM provider config (AES-256-GCM encrypted in DB: apiKey + provider + baseUrl + modelId), unified via `multi-llm-ts` (`services/athena/llm.ts`), `POST /api/athena/chat` SSE streaming agent with tool calling (`MultiToolPlugin` per request, `services/athena/tools/`), `GET /api/athena/tools` manifest; system prompt built in `services/athena/context.ts` with workspace summary + 5 recent files; server-wide fallback via `OPENAI_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`
- Study Hub: `POST /api/study/{flashcards,summarize,explain,study-guide,syllabus-tasks,quiz/start,quiz/:id/answer,quiz/:id/finish}` + `GET /api/study/sessions`; reuses the per-user LLM config; structured JSON generation via `services/study/llm-json.ts`; outputs are written into existing Flashcards/Notes/Tasks models; activity logged in `StudySession` table. **NotebookLM-style additions:** source library (`/api/study/sources/*` — CRUD + refresh + bulk, `StudySource` model with cached extracted text), source-grounded Q&A (`/api/study/chat/*` — persisted `StudyChat` with SSE streaming at `POST /:id/stream`, citation extraction), podcast overviews (`/api/study/podcasts/*` — `Podcast` model, script saved as Note, `POST /generate`). Source resolution in `services/study/source.ts` supports note/file/**PDF** (`pdf-parse` v2)/paste/**URL** (`@postlight/parser` via `services/fetcher.ts`)/Moodle; `MAX_SOURCE_CHARS` = 30000; `resolveAndCache` persists sources. Citation-aware prompt variants in `services/study/prompts.ts`. **Learning workspaces** (`/api/study/workspaces/*` — `LearningWorkspace` model, named saved source sets reusable across chats/podcasts).
- Moodle: `GET /api/moodle/{status,courses,courses/:id/contents}` + `POST /api/moodle/{login,resource}`; rides the VUT SSO session (id.vut.cz OIDC) via `fetchWithVutSession` (exported from `services/vut.ts`); scrapes course lists + course contents + resource text with cheerio; `services/moodle.ts`
- Calendar: `GET /api/calendar/feed?from=&to=`, `GET/POST /api/calendar`, `PATCH/DELETE /api/calendar/:id`, `POST /api/calendar/ics/import` (parses ICS + expands simple recurrence), `GET /api/calendar/ics/export` (generates `.ics`); `CalendarEvent` model with `source` (manual|task|vut|assignment|ics|microsoft) + `sourceRef` linking
- Habits: `GET/POST /api/habits`, `PATCH/DELETE /api/habits/:id`, `GET /api/habits/:id/logs?from=&to=`, `POST /api/habits/:id/log` (upsert by date), `DELETE /api/habits/:id/log?date=`, `GET /api/habits/stats` (current/longest streak + last-30-day completion per habit); `Habit` + `HabitLog` models
- Quick Capture: `POST /api/capture` `{ text }` → uses per-user LLM (`services/study/llm-json.ts`) to classify as task/note/flashcard/athena → creates the item → returns `{ target, created, clientAction }`; falls back to a plain Task if no LLM configured
- Voice Notes: `POST /api/voice` (multipart `audio` + optional `title`/`folderId`/`cleanup`) → saves audio to `VFile`, transcribes via OpenAI-compatible `/audio/transcriptions` (model `OPENAI_TRANSCRIPTION_MODEL`, default `whisper-1`), LLM-cleans the transcript (`generateJson` → `{title, content}`), creates a `Note` tagged `voice,audio`, links note↔file via `ItemLink`, returns `{ file, note, transcript, transcribed, cleaned }`; `POST /api/voice/transcribe/:fileId` re-transcribes an existing audio file. Reuses per-user/server LLM config; degrades gracefully (audio + placeholder note saved) when transcription is unavailable. No DB migration.
- Whiteboard: `GET/POST /api/whiteboards` (list summaries / create), `GET/PUT/DELETE /api/whiteboards/:id`; `Whiteboard` model stores `content` as a JSON string of vector elements
- Microsoft Calendar: `GET /api/microsoft/status`, `POST /api/microsoft/sync` (pull Graph events → upsert as `CalendarEvent` with `source="microsoft"`, delete stale), `POST /api/microsoft/push` (push local event to Outlook), `DELETE /api/microsoft/event/:msId`; `services/microsoft.ts` handles OAuth2 token refresh with rotation persistence in `Setting` table
- Athena file attachments: `POST /api/athena/attach` (multipart upload → extract text from PDF/txt/code → store temp → return text + tempPath), `POST /api/athena/save-attached` (copy temp file to permanent storage + create `VFile` + set `lastOpenedAt`), `POST /api/athena/suggest-folder` (LLM analyzes file name + content + folder tree + courses → returns `{ folderId, folderPath, reason, confidence }`); uses `pdf-parse` v2 for PDF text extraction
- Athena conversation history: `GET /api/conversations` (list all, auto-archives active convs inactive >30min), `GET /api/conversations/:id` (full conv with messages), `POST /api/conversations` (create new active, archives previous), `PUT /api/conversations/:id` (save messages), `POST /api/conversations/:id/generate-title` (LLM generates short title from first messages), `DELETE /api/conversations/:id`, `POST /api/conversations/archive-all`; `ChatConversation` model stores messages as JSON array

## Deferred (future iterations)

- Pomodoro/Focus timer with DND
- Grade Tracker / GPA Calculator
- PDF/eBook Reader with annotations
- Terminal emulator
- Study Group chat (WebSocket)
- Flashcards / spaced repetition
- AI Study Assistant (LLM)
- Cloud sync / backup
- Multi-user / profile support
- Widgets dashboard (weather, calculator, sticky notes)

## Notes

- The server's `.env` is symlinked to the root `.env` (gitignored). Both `server/.env` and `client/.env` are symlinks.
- Port 3001 is used for the server in dev because port 3000 may be occupied on some machines.
- The Spotify Web Playback SDK requires a **Spotify Premium** account. The client does NOT pre-check for Premium (the `/me` endpoint only returns `product` with the `user-read-private` scope, which the stored refresh token may not have). Instead, the SDK's `initialization_error` / `account_error` events report genuine non-Premium failures with a clear message.
- The `getOAuthToken` callback fetches a fresh access token from the server each time the SDK requests one, so token expiry (1 hour) is handled automatically.
- LRCLIB (https://lrclib.net) is a free public API — no key needed. We set a descriptive `User-Agent` and throttle to 300ms between requests per their guidelines.

## App availability / tier-based gating + monetization

Apps are classified into subscription tiers (defined in `client/src/apps/registry.tsx` `minTier`/`requiresGrant` fields, mirrored server-side in `server/src/services/features.ts`):

- **Free** (`minTier: "free"`): Notes, Tasks, Files, Whiteboard, Study Hub (Teach Me lives here), Mavino assistant, Today, Settings, Plans. Always accessible to all users.
- **Paid** (`minTier: "paid"`): Pomodoro, Flashcards, Grades, Editor, Viewer, Calendar, Habits, Ntfy, Voice, Browser, Reminders, Analytics, Maps. Users on the Free tier see these in **preview mode** — the app opens but is overlaid with a paywall (`PaywallOverlay` / `LockedAppPreview`). Paid/Pro users get full access.
- **Pro** (`minTier: "pro"`): No apps default to Pro, but admins can reassign any app to the Pro tier via Settings → Tiers & Plans.
- **Admin-granted** (`requiresGrant: "vut"`): VUT + Moodle. Moodle rides on the VUT SSO session, so a single per-user `vut` grant covers both. Hidden unless an admin grants the user access (not tier-gated).

**Subscription tiers** are derived from `User.role`: `ADMIN`/`MANAGER`/`PRO` → pro, `PAID` → paid, `FREE`/`DEMO` → free. The `Subscription` Prisma model tracks Stripe subscription state (plan, status, Stripe IDs, billing period) and is kept in sync via webhooks.

**Flag storage:** all flags live in the `Setting` key/value table. Per-user flags use the user's id; global flags use `userId = null`. Keys: `app.tiers` (global, JSON appId→tier overrides), `vut.access` (per-user), `apps.disabled` (global, JSON string array), `stripe.price.paid` / `stripe.price.pro` (global, admin-configured Stripe price IDs).

**Client store:** `client/src/store/features.ts` loads `/api/features` on auth (in `App.tsx`) and exposes `useAccessibleApps()` (reactive, returns apps with `access: "full"|"preview"|"hidden"`), `isAppAccessible(appId)` (pure, used by the `windows.open()` guard), and `useAppAccessible(appId)`. All launch surfaces (StartMenu, Desktop, Taskbar, CommandPalette, MobileLauncher, OnboardingOverlay) show accessible apps with lock badges on preview-mode apps. `windows.open()` allows preview apps to open (with `payload.preview = true`) but blocks hidden apps. Settings is undisableable. `WindowLayer.tsx` wraps preview windows in `LockedAppPreview`, which renders the real app underneath a `PaywallOverlay` with an upgrade CTA that opens the Plans app.

**Server routes** (`server/src/routes/features.ts`, mounted at `/api/features`): `GET /` (own state: subscriptionTier, vutGranted, disabledApps, appTiers), and admin (`/admin`, adminMiddleware): `GET /` (app catalog + disabled list), `PUT /disabled` (set global kill-switch), `PUT /tiers` (set single app tier), `PUT /tiers/bulk` (set multiple app tiers), `GET /admin/users/:userId/grants` + `PUT /admin/users/:userId/grants` (`{ vut }`, admin or manager). The `requireVutAccess` middleware (`server/src/middleware/vut-access.ts`) gates `/api/vut` and `/api/moodle` (403 `VUT_NOT_GRANTED` when not granted).

**Admin UI:** Settings → **Apps** (admin) = global per-app kill switch (Settings always on). Settings → **Tiers & Plans** (admin) = assign each app to a tier (free/paid/pro) + configure Stripe price IDs. Settings → **Users** → edit user = per-user VUT/Moodle grant toggle + role assignment (Free/Paid/Pro/Manager/Demo/Admin).

**Locked states:** Preview-mode apps render the real app content with `pointerEvents: none` and a `PaywallOverlay` on top. The overlay can be dismissed to browse the preview, but a compact lock badge remains. The VUT and Moodle apps render a "not enabled" screen when `vutGranted` is false (defense-in-depth if a window is open when the grant is revoked).

### Stripe integration + subscription management

**Server** (`server/src/services/stripe.ts`): Handles checkout session creation, billing portal, cancellation, and webhook processing. The `Subscription` Prisma model tracks per-user subscription state. Webhooks (`checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`) sync the DB and update `User.role` (PAID/PRO on activation, FREE on cancellation). Price IDs are configurable via env vars (`STRIPE_PRICE_PAID`, `STRIPE_PRICE_PRO`) or admin override (Setting table).

**Server routes** (`server/src/routes/subscriptions.ts`, mounted at `/api/subscriptions`): `GET /` (own status), `POST /checkout` (create checkout session), `POST /portal` (billing portal), `POST /cancel` (cancel subscription), `POST /webhook` (Stripe webhook, no auth — signature verified), and admin (`/admin/prices` GET/PUT for price IDs).

**Client** (`client/src/services/subscriptions.ts`): API wrapper. **Plans app** (`client/src/apps/plans/PlansApp.tsx`): shows current plan, plan comparison cards (Free/Paid/Pro), upgrade buttons (Stripe checkout), billing portal + cancel buttons, and an apps-by-tier overview.

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PAID`, `STRIPE_PRICE_PRO`, `STRIPE_SUCCESS_URL` (optional, defaults to `PUBLIC_URL`).

## Error monitoring + LLM global key + tier-based rate limits

### Error logging (admin monitoring)

Errors from both client and server are persisted to the `ErrorLog` table so admins can monitor outages from Settings → **Error Logs** before users report them.

- **`ErrorLog` model** (`prisma/schema.prisma`): `timestamp`, `level` (error/warn/fatal), `source` ("client"|"server"), `message`, `stack`, `url`, `userAgent`, `userId` (nullable, SetNull on delete), `resolved` (boolean).
- **Client errors**: `routes/client-errors.ts` persists each batch to the DB via `services/error-log.ts` (in addition to console logging for `docker logs`).
- **Server errors**: `index.ts` `app.onError` + `process.on("unhandledRejection")` both call `logError()` to persist unhandled 500s and stray promise rejections.
- **Admin route** (`routes/admin-errors.ts`, mounted at `/api/admin/errors`): `GET /` (paginated list with source/resolved filters), `GET /stats` (summary counts: total, unresolved, client/server, last 24h), `PUT /:id/resolve`, `PUT /resolve-all`, `DELETE /:id`, `DELETE /resolved` (cleanup).
- **Admin UI**: `sections/ErrorLogSection.tsx` — stat cards, filterable list (unresolved/all/client/server), expandable stack traces, resolve/delete actions.

### Global LLM key + mode switch

The admin can choose between two LLM key modes in Settings → **LLM Config** (admin-only):

- **Per-user mode** (default): each user configures their own API key in Settings → Mavino Assistant. This is the original behavior.
- **Global mode**: a single admin-configured key is used for all LLM requests. Users don't need to set up their own key — Mavino AI works out of the box.

**Storage**: all global LLM config is in the `Setting` table (userId = null): `llm.mode` ("per-user"|"global"), `llm.global.key` (AES-256-GCM encrypted), `llm.global.provider`, `llm.global.baseUrl`, `llm.global.modelId`.

**Server**: `services/llm-config.ts` manages the global config. `services/athena/llm.ts` `getUserConfig()` checks the mode first — in global mode it returns the global key (ignoring per-user `AiCredential`); in per-user mode it uses the user's own key. `acquireLlmModel()` applies tier-based rate limits in global mode, or per-user rate limit config in per-user mode.

**Admin route** (`routes/admin-llm.ts`, mounted at `/api/admin/llm`): `GET /` (config, never returns the key), `PUT /mode`, `PUT /key`, `DELETE /key`, `GET /rate-limits`, `PUT /rate-limits`.

**Client UI**: `sections/LlmAdminSection.tsx` — mode switch (per-user vs global), global key input, tier rate limit config. In `AthenaSection.tsx`, the per-user key/rate-limit/fallback cards are hidden when global mode is active (replaced with an info banner).

### User tiers + rate limits

Four user tiers control AI rate limits when global key mode is active:

- **ADMIN** — unlimited (rpd=0, rpm=0). No restrictions.
- **PRO** — highest limits (default: 2000 rpd, 60 rpm). Admin-configurable. Also applies to MANAGER role.
- **PAID** — higher limits (default: 500 rpd, 30 rpm). Admin-configurable.
- **FREE** — lower limits (default: 50 rpd, 10 rpm). Admin-configurable.

**Role migration**: `User.role` is `"FREE"|"PAID"|"PRO"|"MANAGER"|"ADMIN"|"DEMO"`. The `PRO` role was added in a later migration for the monetization tier system. Open-registration users get "FREE"; bootstrap user gets "ADMIN". The `Subscription` Prisma model tracks Stripe subscription state and webhooks sync `User.role` with the subscription plan.

**Rate limit storage**: `Setting` table (userId = null): `ratelimit.pro.rpd`, `ratelimit.pro.rpm`, `ratelimit.paid.rpd`, `ratelimit.paid.rpm`, `ratelimit.free.rpd`, `ratelimit.free.rpm`. Admin tier is always unlimited (hardcoded, not configurable). Setting rpd or rpm to 0 means unlimited.

**Rate limiting**: `services/athena/llm.ts` `acquireLlmModel()` calls `getRateLimitsForUser(userId)` which looks up the user's role → tier → limits. The existing in-memory `llmRateLimiter` (sliding window) enforces the limits. In per-user mode, the user's own rate limit config applies instead.

**User-facing UI**: `AthenaSection.tsx` shows a **TierInfoCard** at the top with the user's tier, current mode (global/per-user), and rate limits + today's usage. In per-user mode, the existing rate limit + fallback cards are shown. In global mode, they're hidden (managed by admin).

**Admin user management**: `UsersSection.tsx` role dropdown has options: Free (limited AI), Paid (higher AI limits), Pro (highest AI limits), Manager (user management), Demo (pre-seeded trial), Administrator. The user list shows PRO/PAID/FREE badges next to each user.

## Performance / multi-user load test

`scripts/perf-test.ts` is a deployment-readiness test that spawns N temporary users (default 50) and runs a realistic concurrent workload against a running server: auth, notes CRUD, tasks CRUD, flashcards, calendar, Athena LLM chat (SSE), and Study Hub (summarize + flashcard generation). It verifies per-user data isolation and collects per-operation latency metrics (p50/p95/p99).

**Prerequisites:** server running, admin credentials, and an LLM API key (for LLM tests).

```bash
# Non-LLM tests only (no API key needed):
bun run scripts/perf-test.ts --skip-llm

# Full test with LLM (requires OPENAI_API_KEY):
OPENAI_API_KEY=sk-... bun run scripts/perf-test.ts

# Custom user count + server URL:
OPENAI_API_KEY=sk-... bun run scripts/perf-test.ts --users=20 --url=http://localhost:3001

# Keep test data for inspection (no auto-cleanup):
bun run scripts/perf-test.ts --no-cleanup
```

**CLI flags:** `--users=N` (default 50), `--url=URL` (default `http://localhost:3001`), `--admin-user=U` / `--admin-pass=P` (default admin/admin), `--no-cleanup`, `--skip-llm`, `--login-batch=N` (default 4, respects the 5-per-15s login rate limit), `--login-delay=Ms` (default 16000), `--verbose`.

**Env vars:** `OPENAI_API_KEY`, `OPENAI_PROVIDER` (default openai), `OPENAI_BASE_URL`, `OPENAI_MODEL` (default gpt-4o-mini).

**What it does:** admin login → enable open registration → set global LLM key → create N users via admin API → login users in batches (rate-limit-safe) → run concurrent per-user workloads → verify data isolation (no cross-user notes/tasks visible) → print metrics table → delete all test users + disable registration. Exit code 0 = all ops succeeded, 1 = any failures.

## Plugin / App Marketplace

A curated marketplace where **paid/pro** users can browse and install community-built plugins (apps + Athena tools) without touching core code. Free users are blocked entirely (402 on all marketplace routes, no Marketplace app).

**Prisma models:** `Plugin` (catalog — admin-published) + `UserPlugin` (per-user install). A plugin is defined by a **manifest** (JSON): `id` (slug), `name`, `icon` (lucide), `entryUrl` (remote ES module, default export = React component), `minTier` ("paid"|"pro"), `permissions[]`, and optional `tools[]` (Athena tool definitions with `handlerUrl` webhook).

**Server** (`services/plugins.ts`, `routes/plugins.ts`):
- `GET /api/plugins` — published catalog (with install counts + status). Paid/pro only (402 for free).
- `GET /api/plugins/installed` — user's installed+enabled plugins.
- `POST /api/plugins/:key/install` / `DELETE` — install/uninstall.
- `PUT /api/plugins/:key/enabled` — enable/disable.
- Admin (`/api/plugins/admin`): `GET` (all), `POST` (publish from manifest), `PUT /:key` (update), `DELETE /:key` (remove), `PUT /:key/featured`, `PUT /:key/published`.

**Plugin apps on the client:** installed plugins appear in the taskbar, start menu, desktop, and command palette alongside built-in apps. Each plugin app uses a synthetic `appId` of `plugin:<pluginKey>`. The `AppId` type includes a `(string & {})` catch-all to accept these while preserving autocomplete for built-in ids. `PluginAppWrapper` (`apps/plugins/`) is the single component used for all plugin apps — it looks up the plugin in the plugin store by `win.appId` and renders `PluginApp` (dynamic import of `entryUrl` + error boundary). `store/plugins.ts` loads installed plugins; `store/features.ts` merges them into `useAccessibleApps()`.

**Athena tool plugins:** a plugin manifest can declare `tools[]` with `handlerUrl` webhooks. `loadPluginTools()` in `services/plugins.ts` turns these into `ToolDef`s that proxy execution to the webhook (POST `{ plugin, arguments }`). The plugin's backend never sees the user's JWT/session. `toolsForUser()` in `services/athena/tools/index.ts` merges built-in + plugin tools per user (paid/pro only). The `athena.ts` chat route and `/api/athena/tools` endpoint use `toolsForUser()` instead of `toolsForRole()`.

**Security model:** plugins are admin-curated (published via Settings → Plugins). The entry module is loaded via dynamic `import()` on the client (same-origin execution — only publish plugins from trusted sources). Tool calls are proxied server-side so the plugin backend never receives credentials.

**Settings:** admin "Plugins" section (`sections/PluginsAdminSection.tsx`) — publish/edit/feature/delete plugins via raw JSON manifest. The Marketplace app (`apps/marketplace/MarketplaceApp.tsx`) is a paid-tier built-in app for browsing/installing.

