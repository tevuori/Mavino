# Mega prompt — full Teach Me module test (for a Devin AI agent)

Paste everything below the line into a Devin AI agent session, replacing `<API_TOKEN>` with a real DeepSeek API key.

---

You are a QA engineer testing the **Teach Me** module of the **Athena / Mavino** app — a desktop-environment-style student productivity dashboard (Vite + React 18 + TS + Tailwind client, Bun + Hono server, PostgreSQL/SQLite via Prisma, Zustand state). The repo root is the current working directory.

Teach Me is the flagship mode of the **Study Hub** app: a live, source-grounded tutor. An LLM streams teaching turns and drives the student's screen via client-action tools — opening sources in a side pane, scrolling to pages/slides/lines, highlighting passages, linking inline `[n]` citations, and running comprehension checks.

## Hard rules

- **REPORT ONLY. Do not modify any source code, config, or tests in the repo.** The only files you may create are: (a) the final report under `docs/qa/`, (b) throwaway test scripts/screenshots under `/tmp/teach-test/`.
- The LLM API key is a temporary secret. Never write it into the repo, never commit it, never print it in the report. Configure it only through the admin API as described below.
- Prefer real, reproducible evidence: curl commands, SSE transcripts, Playwright traces, screenshots. Every "works" claim in your report must be backed by something you actually ran.
- Do not stop at the first success or first failure. The goal is exhaustive coverage of the checklist below.

## Phase 0 — Environment bring-up

```bash
bun install
cd server && bun install && cd ..
cd client && bun install && cd ..
cp .env.example .env
cd server && ln -sf ../.env .env
bunx prisma generate
bunx prisma migrate dev --name init   # or `migrate deploy` if migrations exist
bun run src/db/seed.ts                # seeds admin/admin + demo data
cd .. && bun run dev                  # server :3001, client :5173
```

- Readiness check: `http://localhost:5173/` returns 200 and the dev log shows `[athena-server] Bun serving on http://0.0.0.0:3001`. **`GET /api/health` does not exist — do not use it.**
- Login (UI): `admin` / `admin`. Dismiss the onboarding "Welcome to Athena" dialog via the **× Skip** link in its top-right corner.
- Login (API): `POST /api/auth/login` with `{ "username": "admin", "password": "admin" }` → JWT; use `Authorization: Bearer <token>` for all API calls.

### Configure the LLM (deepseek-flash)

```bash
curl -X PUT localhost:3001/api/admin/llm/mode -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"mode":"global"}'
curl -X PUT localhost:3001/api/admin/llm/key  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"apiKey":"<API_TOKEN>","provider":"deepseek","modelId":"deepseek-flash"}'
curl localhost:3001/api/admin/llm -H "Authorization: Bearer $TOKEN"   # verify provider=deepseek, modelId=deepseek-flash (key is never returned)
```

A turn failing with `No AI provider configured` means this step didn't take.

## Phase 1 — Fixtures

Create these sources via `POST /api/study/sources` (`{kind, id?, text?, url?, name?}` where kind ∈ `note|file|paste|url`) and the Files API (`/api/files`, multipart upload):

1. **PDF**: multi-page (≥5 pages), one unique rare keyword per page (e.g. "zephyr" p1, "quokka" p2 …) so page-targeted scrolls are verifiable. Upload via Files API, then attach as `kind:"file"`.
2. **PPTX**: ≥5 slides with distinct titles. Same flow.
3. **Note**: multi-paragraph text with a fenced code block and a distinctive mid-document phrase.
4. **Paste**: `kind:"paste"` with `text` + `name` — verify the name is honored (regression: pasted sources used to be saved as "Pasted text").

Then create one Teach Me session whose `sourceIds` order is `[1]=PDF, [2]=PPTX, [3]=note, [4]=paste` — the index order drives `[n]` citation labels.

## Phase 2 — Static audit

Read the following files and verify them against the checklist. Re-verify the mechanisms behind previously-found bugs (listed at the end) — confirm each is fixed or still live.

**Server:**
- `server/src/routes/teacher.ts` — session CRUD; `POST /` create schema (kinds `note|file|paste|url`, ≤10 sources); `GET /`, `GET /:id`, `PATCH /:id` (invalid foreign sourceIds filtered, order preserved), `DELETE /:id`; `POST /:id/plan`; `POST /:id/assess` (real LLM grading, mastery/`coveredConcepts`/`comprehensionLog` update); `POST /:id/title`; `POST /:id/export` (note/flashcards/quiz/tasks); `POST /:id/stream` SSE events `content | tool | client_action | data_change | usage | done | error`; `mergeState` client-vs-server ownership; the announced-check repair pass (forced `check_comprehension`); image attach path (`imageAware`, vision gating).
- `server/src/services/athena/tools/teacher.ts` — all tools: `show_source`, `highlight_source`, `scroll_source`, `clear_highlight`, `focus_source`, `close_source`, `check_comprehension`, `mark_concept_covered`, `finish_lesson`, `list_source_pages`. Check: does `show_source`'s `kind` enum include `paste` (was missing — N3)? Does `appForSource`/`payloadForSource` map every kind correctly? Does `resolveAnchor` return verbatim spans + offsets + fuzzy-match warnings?
- `server/src/services/study/teacher-prompt.ts` — `SOURCE [n]` labels must index the session's `sourceIds` order (B1 regression); `announcedUndeliveredCheck`; `mergeState`/`applyAssessmentToState`/`inferAdaptiveLevel`.
- `server/src/services/study/teacher-lesson.ts`, `source.ts`, `highlight-anchor.ts`, `source-outline.ts`, `teacher-images.ts`.
- `server/src/services/athena/tools/index.ts` + `index.test.ts` — teacher mode gets an isolated tool set; no maps/browser/app tools leak in.

**Client:**
- `client/src/services/teacher.ts` — SSE parsing, `hidden` flag, `sourceHistory`/`state` sent in stream body.
- `client/src/apps/study/useTeacherSession.ts` — **re-verify**: is `attachedSources` memoized (S1: unstable identity remounted citation chips)? Is `sourceHistory` sent post-turn or snapshotted pre-turn (S2: newest entry lost)? Does `updateTeachState` PATCH strip `sourceHistory` (N5: clobbered persisted history)?
- `client/src/apps/study/TeacherMode.tsx` — `openCitation`, `inferSourceApp` (S3: `file` kind → `editor` guess → "Not a text file" for PDF/PPTX with no history entry), settings popover, pace row, export menu.
- `client/src/apps/study/TeachSourcePane.tsx` — PDF page+text highlight combination (S5: page branch dropped text search); paste-source branch (N4: paste used to hit `filesApi` → "File not found"); note `posStart`/`posEnd` CodeMirror highlight.
- `client/src/apps/study/studyMarkdown.ts`, `CitationMarkdown.tsx`, `HighlightableMarkdown.tsx` — citation linkification for `[n]`, `[n, page X]`, `[n, slide X]`, and plural/range forms like `[2, slides 2–3]` (S4).
- `client/src/apps/study/teachPanels.tsx`, `useTeacherTts.ts`, `teacherSpeech.ts` — word-boundary highlighting actually wired to `onWordBoundary` (B5).
- `client/src/mobile/MobileTeach.tsx`, `client/src/mobile/MobileStudy.tsx` — Teach Me reachable on phone.

## Phase 3 — Dynamic API tests

Drive all endpoints directly (curl or a Python driver under `/tmp/teach-test/`):

- Session create/list/load/patch/rename/reorder-sources/delete; verify invalid `sourceIds` are dropped on PATCH.
- `POST /:id/stream` — verify SSE sequence: `content` chunks, `tool` events with states, `client_action` for each clientAction tool, `done`. Test `hidden:true` comprehension-answer turns persist as hidden. Test `language:"cs"` turn answers in Czech. Test `teachingStyle:"socratic"` and `studentLevel:"advanced"`. Test creating a session with on-the-fly `sources` array.
- `POST /:id/assess` — a **deliberately wrong** answer must be graded failed with corrective feedback (not auto-pass — B2 regression); a correct answer passes; mastery + coveredConcepts update in `state`.
- `POST /:id/plan` — 5-objective plan persisted into `state.lessonPlan`; placeholder title replaced only for `Teach Me…` titles.
- `POST /:id/title` — short generated title.
- `POST /:id/export` — all four targets; verify artifacts in DB (note body markdown, flashcard deck cards, quiz questions, task rows with `Review:` titles).
- Error paths: bad session id → 404; empty sources → 400; export on empty session → 400.
- `POST /api/tts/synthesize/timed` — Edge TTS returns word boundaries.

## Phase 4 — Dynamic source-manipulation tests (core focus)

This is the most important part. Test **both layers**:

**(a) SSE/driver level** — write a Python driver that POSTs `/api/teacher/:id/stream` and logs every `client_action` payload verbatim. This separates LLM/server correctness from UI correctness. Ask the model things that force each tool: "show me page 4 of the PDF", "highlight the sentence about X in my notes", "go back to the slides", "what's on slide 2?", "quiz me".

Verify in payloads and effects:
- `show_source` returns the right `appId` per kind: note→`notes`, text file→`editor`, PDF/PPTX/image→`viewer`, url→`browser`; `openPayload` carries `noteId`/`fileId`/`url`.
- `highlightText` is resolved to a verbatim span + `posStart`/`posEnd` (`resolveAnchor`); unmatched phrases produce a `warning`, not a silent failure.
- `pageNumber`/`slideNumber`/`highlightLine`/`lineEnd` are forwarded correctly; `list_source_pages` is used by the model when it needs page indices.
- The model calls `show_source`/`highlight_source` **before** the sentence that references the passage (temporal ordering in the stream).

**(b) UI level** — Playwright/Chromium, 1600×950, logged in, Study Hub → Teach Me:

- Open the fixture session. For each source kind, trigger the tool and verify the **right pane renders the right content at the right location**: PDF.js lands on the requested page; PPTX viewer shows "Slide N of M"; note pane shows `.cm-teacher-highlight` on the exact passage (including inside a fenced code block); paste source renders its text (not "File not found" — N4); scroll-only commands move without highlighting; `clear_highlight` clears.
- Page+text combo on PDF: when a command carries both `pageNumber` and `text`, the passage must actually be highlighted, not just paged (S5 regression).
- Citation chips: `[n]`, `[n, page X]`, `[n, slide X]` render as chips; **dispatch real pointer events** and confirm a click opens/focuses the right source at the right location (S1 regression: chips were remounted mid-click and swallowed clicks). Also test chips for sources with no history entry after a fresh reload (S3 regression: must not open "Not a text file").
- Citation index mapping: `[n]` must resolve to the **session sourceIds order**, not the order sources were opened (B1 regression — mix open order on purpose).
- "Open sources:" history chips appear as sources are shown; clicking refocuses; last-shown source survives a reload (S2 regression: the newest history entry used to be dropped because the client sent a pre-turn snapshot).
- Source switching across turns: note → PDF → PPTX → paste, the pane swaps correctly every time.
- Mid-session management: settings popover — attach a new source, remove one, reorder; the `[n]` labels update and citations still map correctly; a PATCH must not wipe persisted `sourceHistory` (N5).
- `focus_source`/`close_source` act on the right window; `focus_source` on a source with no history entry should fall back gracefully, not silently no-op.

## Phase 5 — Remaining dynamic UI coverage

Desktop (1600×950): session sidebar list; source-picker multi-select; Start launches an auto-first-turn; streaming renders with LaTeX; lesson agenda with `n/N concepts` progress ticking via `mark_concept_covered`; `check_comprehension` card renders, answer graded for real; tool-progress chips appear during tool calls; pace feedback row (`too_easy`/`just_right`/`too_hard`) reaches state; auto-speak toggle + mic button present and capability-gated; rename; Export menu → all four targets; `finish_lesson` recap card with needsReview; reload restores messages, graded checks, agenda, title, pace, last-opened source; error/retry UX (`retry`/`canRetry`) — if feasible, induce a provider failure (bad key on a second session) and observe degradation.

Mobile (390×844, touch, form-factor `phone`): More → Teach Me launcher; session list; session open; collapsible agenda; pace row; per-message Play buttons; mic + send icons; typed turn streams and answers; comprehension cards render.

## Phase 6 — Prior-bug regression sweep

Produce an explicit table. Previous runs (`docs/qa/teach-me-audit.md`, `teach-me-retest.md`, `teach-me-source-manipulation.md`) reported these — verify each:

- B1 citation indices mapped to open-order, not session order
- B2 fake comprehension grading (auto-pass)
- B3 no tool-call progress feedback
- B4 session title = raw first message
- B5 dead speech-synced highlighting (`onWordBoundary` never wired)
- B6 `coveredConcepts` never populated
- B7 no mid-session source/level management
- B8 provider failures degrade badly (partial — retry exists, UX unverified)
- B10 paste sources lose their name
- N1–N2 paste sources shared one cache identity / hard-coded name
- N3 `show_source` schema omits `paste` kind
- N4 desktop source pane can't display paste sources
- N5 mid-session settings PATCH wipes `sourceHistory`
- N6 `/api/plugins/installed` route ordering → 404 noise (unrelated module, still check console)
- S1 citation chips remounted every render → clicks swallowed
- S2 `sourceHistory` persisted one turn behind → wrong source restored on reload
- S3 citation to file source without history entry → `inferSourceApp` guesses `editor` → "Not a text file"
- S4 plural/ranged citations (`[2, slides 2–3]`) not linkified
- S5 `highlight_source`/`show_source` with both `pageNumber` and `text` drops the text highlight

## Deliverable

Write `docs/qa/teach-me-<YYYYMMDD>-report.md` in the same style as the existing QA docs in `docs/qa/`:

1. **Environment** block (commit hash, OS, DB, LLM provider/model — never the key).
2. **Verified working** table (feature → evidence).
3. **Bugs found** — each with: observed behavior (repro steps), root cause with `file:line`, fix direction. Separate regressions of previously-fixed bugs from new bugs.
4. **Prior-bug sweep table** — fixed / still live / not verified (with reason).
5. **Not covered** — e.g. real STT (headless has no mic), ElevenLabs, induced provider-failure retry UX, image-aware turns with real images.
6. **Artifacts** — paths to the driver scripts and screenshots under `/tmp/teach-test/`.

Depth expectations: static audit covers every file listed; API tests cover every endpoint; source-manipulation tests cover every source kind × every navigation mode (open, scroll, highlight, focus, close, citation click) × both layers (SSE payloads and rendered UI). Take your time — thoroughness beats speed.
