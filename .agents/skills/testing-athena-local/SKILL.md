---
name: testing-athena-local
description: How to bring up the Athena web app locally (Bun + Prisma + Vite) and test UI changes such as branding/shell assets.
---

# Testing Athena locally (web app)

## Bring-up (from repo root, ~2 min)

```bash
bun install                                # root
cd server && bun install && cd ..
cd client && bun install && cd ..          # client/node_modules may already exist
cp .env.example .env                       # no secrets needed for shell/UI testing
cd server && ln -sf ../.env .env
bunx prisma generate
bunx prisma migrate dev --name init        # creates SQLite DB
bun run src/db/seed.ts                     # seeds admin/admin + demo notes/tasks
cd .. && bun run dev                       # server :3001, client :5173
```

Then open `http://localhost:5173` → boot screen (~2 s) → login `admin` / `admin` → an
onboarding "Welcome to Athena" dialog appears on first login; dismiss it with the **× Skip**
link in its top-right corner before testing the desktop.

Notes:
- No API keys are required for shell/branding/UI testing. Spotify / Microsoft / OpenAI /
  Brave / Moodle-VUT features need the env vars listed in `AGENTS.md` and will be
  unavailable without them.
- `GET /api/health` does not exist — don't use it as a readiness probe. Check that
  `http://localhost:5173/` returns 200 and that `/tmp` dev log shows
  `[athena-server] Bun serving on http://0.0.0.0:3001`.

## Shell UI landmarks (desktop mode)

- Boot screen: `client/src/shell/BootScreen.tsx` — brand mark inside two rotating rings.
- Login card: `client/src/shell/LoginScreen.tsx` — brand mark above the "Athena" heading.
- Taskbar Start button: `client/src/shell/Taskbar.tsx`, `button[title="Start"]` at the
  bottom-left; clicking toggles `StartMenu` (app grid + "Search apps…" + user row).
- Brand mark component: `client/src/shell/AppLogo.tsx` → `<img src="/icon-512.png">`.
  Generated icons live in `client/public/`; regenerate with
  `python3 scripts/generate-icons.py` (Pillow) from `assets/logo.png` — never hand-edit.

## Verifying icon/asset changes

- Compare old vs new artwork to make the test discriminating:
  `git show HEAD~1:client/public/icon-512.png > /tmp/old.png` and diff visually with Pillow.
- Serve-check assets and confirm bytes match the repo:
  `curl -o /tmp/x.png -w '%{http_code} %{content_type}' localhost:5173/icon-192.png && cmp /tmp/x.png client/public/icon-192.png`.
- **Gotcha:** `vite dev` *and* `vite preview` return `200 text/html` (index.html SPA
  fallback) for any missing path, so you cannot observe a real 404 for a deleted public
  asset (e.g. `/icon.svg`). Prove deletion instead by: (a) `bun run build` in `client/` and
  checking the file is absent from `client/dist/`, (b) grepping `dist/index.html` for the
  reference, and (c) showing the browser renders the app instead of the asset. A true 404
  only appears behind the production static host (docker/nginx).
- Broken-image check without devtools UI: evaluate
  `Array.from(document.querySelectorAll('img')).map(i=>({src:i.src, ok:i.complete&&i.naturalWidth>0}))`.

## Devin secrets needed

None for local shell/branding/UI testing.

## Testing the redesigned Mavino shell / dashboard

- The local DB is PostgreSQL (via Docker Compose). Reset with `cd server && bunx prisma migrate reset --force && bun run src/db/seed.ts` if a prior run changed the seeded `admin` password.
- If login with `admin/admin` fails, reset the password directly:
  `bunx prisma studio` or a Prisma script that sets `User.password = bcrypt("admin")`.
- The login form inputs are React controlled; raw `computer`/xdotool typing may not update state. Authenticate via CDP with a `fetch('/api/auth/login', ...)` call and write the returned tokens into `localStorage` under `athena.token` (and `athena.refresh` with `rememberMe=true`).
- `client/src/wm/Window.tsx` uses `setPointerCapture(e.target)`; clicking child spans in the titlebar can break drag/resize. For automated testing, prefer the titlebar maximize/restore buttons or target the titlebar `div` precisely. This was fixed in the glow-up PR; if testing older branches, work around it.
- Watch server logs for `401` spikes after workspace switches or after ~15 minutes of inactivity — the access token expires and apps may show empty/Unauthorized states until re-authenticated.
