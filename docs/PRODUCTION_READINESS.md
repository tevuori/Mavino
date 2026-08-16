# Mavino — Production Readiness Audit

Assessment date: 2026-08-07

## Verdict

Mavino is **feature-complete and functionally working**, but **not yet production-ready**.
Typecheck and build both pass cleanly, all 23 apps are implemented with proper
loading/error/empty states, and external-service dependencies degrade gracefully.
However, there are critical security defaults, zero CI quality gates, near-zero test
coverage, and no observability — the safety nets a production deployment needs.

It is at the stage of a polished personal/hobby deployment, but not a multi-user
production product yet.

---

## What's Working Well

- **Build & types clean** — `bun run typecheck` and `bun run build` pass with zero errors.
- **21 apps all implemented** — Notes, Tasks, Files, Editor, Viewer, Pomodoro, Flashcards,
  Grades, Settings, Mavino, Study Hub, Today, Calendar, Habits, Whiteboard, Ntfy,
  Voice, Browser, Reminders, Analytics, Maps. Each has loading/error/empty states.
- **Solid auth foundation** — JWT with 15-min access / 90-day refresh tokens, refresh
  rotation, device fingerprint binding, rate limiting on login/register, bootstrap-only
  registration.
- **Zod validation everywhere** — no raw SQL, no unsafe `orderBy`, proper input schemas.
- **Encrypted secrets in DB** — AES-256-GCM for Spotify/Microsoft/Mapy/AI credentials.
- **Sandboxed code execution** — Docker with gVisor, network disabled, read-only FS,
  dropped caps, memory limits.
- **Deployment tooling exists** — `deploy/deploy.sh` generates strong secrets, nginx
  config with TLS + SSE support.
- **Mobile/PWA/Capacitor** — full mobile shell, form-factor store, APK self-update.

---

## Critical Issues (Production Blockers)

### 1. Insecure defaults that silently activate if env vars are unset
- **`JWT_SECRET` defaults to `"dev-secret-change-me"`** (`server/src/services/jwt.ts:6`)
  — if unset, anyone can forge tokens. **FIXED**: now required in production.
- **`SEED_PASSWORD` defaults to `"admin"`** (`server/src/db/seed.ts:10`) — weak default.
- **CORS wide open when `CLIENT_ORIGIN` unset** (`server/src/index.ts:67-84`) — accepts
  any origin. **FIXED**: now required in production.

### 2. No CI quality gates
- The only workflow runs on `v*` tags for APK releases. Nothing runs on push/PR — no
  typecheck, no test, no build, no lint. **FIXED**: added CI workflow for PR validation.

### 3. File upload security gaps
- **No per-upload size limit** on `/files/upload` — relies on the global 2GB limit. DoS
  vector. **FIXED**: added 100MB per-upload limit.
- **No extension validation** on general upload — executables can be uploaded via Files.
  **FIXED**: added extension blocklist.
- **Client-provided MIME type trusted** — no magic-number validation (future work).

### 4. Near-zero test coverage
- Only 3 test files total (2 server, 1 client), all for Study Hub teacher logic. No API
  tests, no integration tests, no E2E, no component tests.

### 5. No linter or formatter
- No ESLint, Biome, or Prettier config. No pre-commit hooks. Code style unenforced.

---

## High-Priority Issues (Not Yet Fixed)

### 6. Token leakage in logs
- `server/src/services/microsoft.ts:147` logs partial access tokens.
- `server/src/db/seed.ts:23` logs the seeded password in plaintext.

### 7. Auth token in query parameter
- `server/src/middleware/auth.ts:19-22` allows `?token=` fallback. Tokens in URLs get
  logged by proxies/referrers. Should be restricted or removed.

### 8. No observability
- No error reporting (Sentry etc.), no structured logging, no metrics, no alerting.
- 113 bare `console.log/error` calls. Production errors are invisible unless someone
  reads `docker logs`.

### 9. No backups
- SQLite in a Docker volume, no backup script/cron. Volume corruption = total data loss.

### 10. No Docker healthchecks
- `/health` endpoint exists but `docker-compose.yml` has no `healthcheck:` directive.

---

## Medium-Priority Issues (Not Yet Fixed)

### 11. Single 3.7MB JS bundle (1MB gzipped)
- `registry.tsx` statically imports all 23 apps; no `React.lazy()` anywhere; no
  `manualChunks` in `vite.config.ts`. The entire app loads upfront. Code-splitting
  per-app would cut initial payload dramatically.

### 12. SQLite for multi-user
- Fine for single-user/small-scale, but write concurrency (single writer) becomes a
  bottleneck with concurrent users. Prisma makes a Postgres migration straightforward.

### 13. In-memory rate limiting
- `server/src/middleware/rateLimit.ts` uses an in-memory `Map` — lost on restart, not
  shared across instances. Fine for single-container; breaks with horizontal scaling.

### 14. `as never` type assertions
- `server/src/routes/notes.ts:77,94,104` use `as never` to bypass TS checking on Prisma
  queries. Zod validates input, but this weakens static analysis.

### 15. No unhandled rejection handler
- **FIXED**: Added `process.on('unhandledRejection')` in `server/src/index.ts`.

### 16. 20+ empty catch blocks
- Mostly intentional (browser proxy, file unlink), but some should log at debug level.

---

## Feature Gaps Worth Considering

- **Offline mode** — PWA SW caches assets, but no explicit offline data sync/queue.
- **Multi-user / sharing** — currently single-user. No shared-collaboration app.
- **Export/backup UI** — no user-facing "download all my data" beyond per-note export.
- **Password reset flow** — no email-based reset. No self-service password recovery.
- **2FA** — no two-factor auth, relevant if exposed publicly.
- **Accessibility audit** — no evidence of a11y review (keyboard nav, screen readers).

---

## Recommended Priority Order

### Done in this pass
1. **Make `JWT_SECRET` and `CLIENT_ORIGIN` required in production** — fail to start if unset.
2. **Add CI workflow** running typecheck + test + lint + build on every PR.
3. **Add file upload size + extension limits** to `/files/upload`.
4. **Remove token/password logging** — stripped partial access tokens from MS logs,
   removed plaintext password from seed log, restricted `?token=` query auth to only
   the 2 route files that need it (files, browser), added unhandled rejection handler.
5. **Add Docker healthchecks** — server + client healthcheck directives, client waits
   for server to be healthy before starting.
6. **Add SQLite backup script + cron** — `deploy/backup.sh` uses `VACUUM INTO` for
   consistent snapshots, 14-day retention, auto-installed as a daily cron by `deploy.sh`.
7. **Configure ESLint + Prettier** — flat config with TypeScript + React hooks plugins,
   pragmatic ruleset (0 errors, 535 warnings), lint job added to CI.
8. **Code-split the app bundle** — all 23 apps lazy-loaded via `React.lazy()`, vendor
   libraries split into separate chunks. Initial bundle: 1,035 KB → 245 KB gzipped (76% reduction).
9. **Add error reporting** — self-hosted client error reporting (no Sentry account needed):
   `GlobalErrorBoundary` catches React crashes, `errorReporter.ts` hooks into
   `window.onerror` + `unhandledrejection`, sends to `/api/client-errors` endpoint.
10. **Expand test coverage** — added `security.test.ts` (JWT secret validation, file upload
    limits, CORS validation) and `auth.test.ts` (token extraction, Hono integration).
    Test count: 15 → 36.

### Remaining (future work)
11. Migrate to PostgreSQL for multi-user production
12. Add Redis-backed rate limiting for horizontal scaling
13. Remove `as never` type assertions in Prisma queries
14. Add Sentry integration (forward client errors to Sentry if `SENTRY_DSN` is set)
15. Add E2E tests (Playwright)
16. Add user-facing data export ("download all my data")
17. Add password reset flow
18. Add 2FA
19. Accessibility audit
