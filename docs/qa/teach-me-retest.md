# Teach Me — dynamic retest (follow-up to teach-me-audit.md)

Environment: local dev (`bun run dev`, server :3001, client :5173), PostgreSQL,
seeded `admin` user, DeepSeek `deepseek-flash` configured as the **global** LLM
via the admin API. Desktop tested with Playwright/Chromium at 1500×900; mobile
tested at 390×844 with touch (form-factor `phone`).

Fixtures: seeded note `Lecture 3 — Data Structures` + a pasted-text source
("Gradient Descent Basics", multi-paragraph with a fenced Python block).

## Verified working — backend API

| Feature | Result |
|---|---|
| Session create/list/load/patch/delete, rename, source reorder | OK |
| Invalid `sourceIds` filtered out on PATCH | OK |
| SSE turn streaming (`content`/`tool`/`client_action`/`done`) | OK |
| `show_source`, `highlight_source`, `check_comprehension`, `mark_concept_covered`, `finish_lesson` | OK — finish returns recap + `needsReview` list |
| `POST /assess` real grading | OK — wrong answer graded with corrective feedback; correct answer passes; mastery + coveredConcepts update |
| `POST /plan` | OK — 5-objective lesson plan persisted |
| `POST /title` | OK — generates a short lesson title |
| `POST /export` → note / flashcards / quiz / review-tasks | OK — artifacts verified in DB (note body, Q/A cards, quiz questions, task rows) |
| Hidden comprehension-answer turns persist as hidden | OK |
| `state` merging (level/style/followPlan/pace) | OK, except sourceHistory clobber (N5) |
| Czech-language turn | OK |
| `POST /api/tts/synthesize/timed` | OK — Edge TTS, word boundaries with offsets/durations |
| Error paths: bad session 404, empty sources 400, empty-session export 400 | OK |
| Socratic style, advanced level, on-the-fly `sources` array | OK |

## Verified working — desktop UI (Playwright, 22 checks)

Login → Study Hub → Teach Me; session sidebar with existing sessions; source
picker multi-select; Start launches auto-first-turn; streaming render with LaTeX;
lesson agenda with `n/N concepts` progress; comprehension card with real grading;
tool-progress chips; citation chips; source pane column with open-source chips;
settings popover (attach/remove/reorder sources, level, style, image-aware);
pace feedback row; auto-speak toggle; mic button present; rename; Export menu →
note; reload restores messages, graded check, agenda progress, title, pace.

## Verified working — mobile UI (Playwright, 390×844 touch)

More → Teach Me launcher; session list; session open; collapsible agenda;
pace row; per-message Play buttons; mic + send icons; typed turn streamed and
answered; comprehension cards render.

## New bugs found this run

* ~~**N1 — pasted sources share one cache identity (data loss).**~~
  **Fixed.** `resolveSource` returned `ref: "paste"` for every paste, and the
  StudySource cache deduped on `(userId, kind, refId)` — a second paste
  overwrote the first one's `textCache`. Paste refIds are now content-keyed
  (`paste:<sha256-16>`) so identical pastes still dedupe but distinct pastes
  get their own row. `refId === "paste"` guards updated to `startsWith` in
  `study-podcasts.ts`, `study-chat.ts`, `RecentActivity.tsx` (old literal
  `"paste"` rows remain compatible).
* ~~**N2 — B10 persists:** paste `name` hard-coded to `"Pasted text"`.~~
  **Fixed** — honors the caller-supplied name, falls back to `"Pasted text"`.
* **N3 — `show_source` tool schema omits `paste`.** The prompt's `SOURCE [n]`
  labels say `kind=paste`, but the tool's `kind` enum lists only
  `note | file | url`. The model burned several failed calls
  (`StudySource not found`, `Note not found`) on the first turn before guessing
  `kind="paste"`. Extend the enum (and `appId` mapping) to include `paste`.
  (`server/src/services/athena/tools/teacher.ts`)
* **N4 — desktop source pane can't display paste sources.** `show_source`
  returns `appId: "viewer"`, `sourceRef: "paste"`; `TeachSourcePane` routes
  `viewer` to `FileViewer`, which looks up `filesApi` for id `"paste"` →
  **"File not found"**. The tool reports success so the student just sees a
  broken pane. The pane needs a paste branch that reads the source's
  `textCache` (the mobile bottom-sheet already does this via `resolveSourceText`).
  (`client/src/apps/study/TeachSourcePane.tsx`)
* **N5 — mid-session settings PATCH wipes persisted `sourceHistory`.**
  `applySession` spreads `loaded.state` into `teachState`, so `teachState`
  carries a stale `sourceHistory: []`. Every `updateTeachState` PATCH
  (level/style/followPlan/pace) rewrites it over the real history maintained
  in the separate `sourceHistory` ref → after reload the pane can't restore
  and open-source chips disappear. Fix: strip `sourceHistory` from the PATCH
  payload in `updateTeachState`. (`client/src/apps/study/useTeacherSession.ts`)
* **N6 (unrelated module, surfaced in console):** `GET /api/plugins/installed`
  is registered **after** `GET /api/plugins/:pluginKey` in Hono, so it routes
  to the detail handler → 404 on every app load (both console errors in the
  desktop run trace to this). Reorder the route.
  (`server/src/routes/plugins.ts:51-63`)

## Audit re-check (teach-me-audit.md)

| Bug | Status |
|---|---|
| B1 citation index mapping | **Fixed** — `citationMeta` now derives from `attachedSources`; chips resolve correctly |
| B2 fake comprehension grading | **Fixed** — `/assess` does real grading with feedback |
| B3 no tool-call feedback | **Fixed** — tool-progress chips render during turns |
| B4 raw session titles | **Fixed** — `POST /title` generates titles; rename works |
| B5 dead speech highlighting | **Fixed** — word boundaries wired to `onWordBoundary` (mobile + desktop) |
| B6 `coveredConcepts` never populated | **Fixed** — concepts checked off in agenda (`1/5`) |
| B7 no mid-session management | **Fixed** — settings popover: sources/level/style |
| B8 provider-failure degradation | **Partially** — `retry`/`canRetry` exist in the hook, but not dynamically verified under induced failure |
| B9 no export/plan/replay | **Fixed** — plan, 4 export targets, finish_lesson recap |
| B10 paste name lost | **Fixed** — supplied `name` honored; refIds now content-hashed (N1/N2) |

## Environment note

The local DB was missing the `VFile.internal` migration (pending but
unapplied), which made `show_source` fail with a Prisma column error until
`bunx prisma migrate dev` was run. Code is fine; stale DBs will hit it.

## Not covered

- STT (headless Chromium has no mic; button is correctly gated on
  `isSpeechRecognitionSupported`)
- Provider-failure retry UX (no induced failure)
- PDF / PPTX / URL source types in the source pane (no fixtures)
- Image-aware turns with actual image attachments
