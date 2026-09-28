# Teach Me — full-module mega test (2026-09-28)

Exhaustive QA pass over the **Teach Me** module (static audit + API-level +
SSE-level + UI-level). Report-only: no source code, config, or tests were
modified. All scratch material lives under `/tmp/teach-test/`.

## Environment

| | |
|---|---|
| Commit | `93fa2cf0f7428b239cffb6170f95b3945f63d9b0` |
| OS | Fedora 44 (kernel 7.2.7-200.fc44) |
| Server | Bun + Hono on :3001, client Vite on :5173 (`bun run dev`) |
| DB | PostgreSQL 16 (docker `mavino-db`), Prisma `migrate deploy`, seed applied |
| LLM | global mode, `deepseek` / `deepseek-flash` via `PUT /api/admin/llm/*` (temporary key, not persisted) |
| UI harness | Playwright 1.59 / Chromium — desktop 1600×950, mobile 390×844 touch |

## Fixtures

- `fixture.pdf` — 6 pages, unique keyword per page (`zephyr` p1 … `obsidian` p6)
- `fixture.pptx` — 6 slides with distinct titles + same keywords
- Note — multi-paragraph + fenced `python` code block + distinctive phrase
  ("luminescent chlorophyll signature")
- Paste — `kind:"paste"` with `name:"Cell Biology Paste"` (name honored ✓)
- Session `cmulal8n6000g5qgi0wmlxegk` with `sourceIds` = `[1] PDF, [2] PPTX,
  [3] note, [4] paste` (drives `[n]` citation labels)

## Verified working

| Feature | Evidence |
|---|---|
| Session CRUD, PATCH drops foreign `sourceIds` + preserves order | `api_tests.py` — bogus id dropped, `[3],[1]` order kept |
| `POST /` with on-the-fly `sources` array resolves + attaches | session `cmulaomix…` created with 1 paste source |
| SSE stream: `content`/`tool`/`client_action`/`done` events | `sse_actions.jsonl` — `show_source`+`check_comprehension` client_actions verbatim |
| `hidden:true` turn persists user msg as hidden | GET `/:id` after hidden stream → `hidden:true` on user message |
| `language:"cs"` answers in Czech | stream reply: "Jasně, pokračujeme! … fotosyntézy" |
| `teachingStyle:"socratic"`, `studentLevel:"advanced"` stored + used | session `cmulaua7s…` state; model lead with a question |
| `POST /:id/assess` real grading — **wrong answer FAILS** | `passed:false, score:0`, feedback + `misconception` populated |
| `POST /:id/assess` — correct answer passes | `passed:true, score:95` |
| mastery / `comprehensionLog` / `coveredConcepts` updated by assess | `state.mastery.mitochondria.checksTotal=1`, log + covered updated |
| `POST /:id/plan` — LLM agenda persisted, placeholder-only title replace | plan 6 concepts; custom title "QA Fixture Session" NOT clobbered |
| `POST /:id/title` — real topic title generated | "One-Line Intros for Four Sources" |
| `POST /:id/export` all 4 targets | noteId + markdown body; deck 4 cards; quiz 3 q; task `Review: mitochondria` |
| Error paths | bad id→404, empty-sources stream→400, empty export→400 |
| `POST /api/tts/synthesize/timed` | mp3 audio + 6 word boundaries (Edge TTS) |
| `show_source` app routing | note→`notes` `{noteId}`, PDF/PPTX→`viewer` `{fileId}` (SSE payloads) |
| `resolveAnchor` verbatim span + offsets + fuzzy + warning | `tool_direct.ts`: unmatched phrase → `warning`; paraphrase → span+posStart/posEnd; page+text both forwarded |
| `list_source_pages` used by model | `listpages` turn: `list_source_pages` called, then `show_source` page 5 |
| Temporal ordering — tools before referencing sentences | SSE: `tool` chunks precede the referencing `content` text each turn |
| Announced-check repair pass | turns where the model ended asking a question produced a `check_comprehension` client_action via the forced repair (multiple `[system note]` repairs in log) |
| Desktop: PDF pane lands on requested page | `shots/21-pdf.png` — PDF.js on page 4 ("Fixture Chapter 4") |
| Desktop: PPTX pane shows "Slide N of M" | `shots/22-pptx.png` — "Slide 3 of 6" |
| Desktop: `.cm-teacher-highlight` on exact note passage | ui_test4 — highlighted text = "luminescent chlorophyll signature" |
| Citation chips render `[n]`, `[n, page X]`, `[n, slide X]` | 23 chips enumerated incl. `[2, slide 3]` (S4 form) |
| Citation index = session `sourceIds` order (B1) | history chips `[3] Photosynthesis Notes`, `[4] Cell Biology Paste` |
| "Open sources:" history chips | `shots/50-chips.png` bottom row; click refocuses |
| Tool-progress chips during tool calls | `ToolChipRow` + TOOL_LABELS (static + chips observed during streams) |
| Pace feedback row → state | `PaceFeedbackRow` → `updateTeachState` → PATCH (verified "Just right" persisted) |
| Lesson agenda `n/N concepts` | `shots/50` agenda "Rare Concept Vocabulary Tour … /6 concepts" |
| Comprehension card renders + graded for real | graded card visible (`shots/50`), assess API verified |
| Export menu all four targets | `ExportMenu` + API artifacts verified in DB |
| `finish_lesson` recap + needsReview | SSE `finish` run — `needsReview` array delivered |
| Auto-speak toggle + mic capability-gated | toggle "Auto-speak (Voice)" + mic button present |
| Error/retry UX | `canRetry`/`retry()` in `useTeacherSession`; bad-key stream → clean `error` SSE (`401 Authentication Fails`) |
| Mobile (390×844): launcher, list, session, typed turn, check card | `shots/61–67`; streamed reply + Comprehension check card + Play buttons |

## Bugs found

### NEW — NB1 (severe): source pane permanently poisoned after the first display error

**Observed:** Once any source fails to render in `TeachSourcePane` (e.g. the
paste source → "File not found"), the pane never recovers. Later citation-chip
clicks and `show_source` switches update the pane *title* correctly
("fixture.pdf", "Photosynthesis Notes") but the body keeps showing the old
error and **zero network fetches fire** (verified: no `/api/files/all`, no
`/api/notes/*` requests after chip clicks; `shots/41-chip.png`,
`shots/50-chips.png`, `shots/51-notechip.png`).

**Root cause:** `TeachSourcePane.tsx:97` renders `{source && !error && (
<SourceContent …/>)}` — when `error` is set, `SourceContent` unmounts. But the
only place `error` is cleared is the reset effect *inside* `SourceContent`
(lines 138–141: `onError(null)` on `[source.refId, source.appId]` change).
Dead-lock: error → unmount → nothing ever clears error → pane dead until the
whole Teach Me view remounts.

**Fix direction:** lift the reset into `TeachSourcePane` itself — e.g. a
`useEffect` on `[source?.refId, source?.appId]` that calls `setError(null)` +
`setLoading(true)` (or simply always render `SourceContent` and let it own the
error UI), instead of gating the component on `!error`.

### NEW — NB2 (minor): `close_source`/`focus_source` silently no-op on invented windowIds

When `sourceHistory` was empty (driver-level turns), the model invented ids
(`win-1`, `win-2`, `win-pdf`) and the client dispatcher found neither a history
entry nor an `attachedSources` refId match → silent no-op. Graceful, but the
model gets no feedback that the window doesn't exist.
`tools/teacher.ts:298–313`, `TeacherMode.tsx:351–401`.

### NEW — NB3 (minor): model intermittently skips tool calls entirely

`scroll_only` ("just scroll the PDF to page 6, no highlight") and one
`note_hl`/`paste` turn produced prose ("I'll highlight it") with **zero** tool
events (persisted `tools:[]` confirmed server-side). Nondeterministic
`deepseek-flash` behavior — same prompts worked on retry. Worth noting as a
prompt-robustness gap rather than a code bug. The repair pass only covers
`check_comprehension`, not show/highlight promises.

### REGRESSION STILL LIVE — N3: `show_source` `kind` enum omits `paste`

`server/src/services/athena/tools/teacher.ts:105` — `enum: ["note","file","url"]`.
The handler itself accepts `kind:"paste"` (verified via `tool_direct.ts`), so
paste works through `sourceId`, but the schema never tells the model it can.
**Fix:** add `"paste"` to the enum (+ teach the prompt to pass the
`paste:<hash>` refId or the StudySource id).

### REGRESSION STILL LIVE — N4: desktop source pane cannot display paste sources

`appForSource("paste")` → `"viewer"` and `payloadForSource` → `{}`
(`tools/teacher.ts:63–83`). Desktop `FileViewer` looks up `refId` =
`paste:<sha256>` in `filesApi.all()` → `!found` → **"File not found"**
(`TeachSourcePane.tsx:296–332`; verified in `shots/31-paste.png` and by the
tool payload). Mobile is fine (`resolveSourceText` reads `textCache`,
`MobileTeach.tsx:110–145, 773–780`).
**Fix:** give paste sources a dedicated client branch — e.g. return
`appId:"notes"`-style payload or a `paste` action carrying `textCache`, and
render it like the mobile `SourceText` (or open a read-only note/CodeMirror
view from the cached text).

### REGRESSION STILL LIVE — N5: mid-session settings PATCH wipes `sourceHistory`

Verified dynamically: persisted `sourceHistory` `[w1,w2]` → PATCH `state` with a
stale client copy `[w1]` → persisted is now **1 entry**.
Two sides contribute:
- server `mergeState` (`routes/teacher.ts:131`): `merged = {...persisted,
  ...incoming}` — `incoming.sourceHistory` always wins; it's not
  length-union-protected like `comprehensionLog`/`coveredConcepts`.
- client `updateTeachState` (`useTeacherSession.ts:327–336`): sends
  `teachStateRef.current`, whose `sourceHistory` is only refreshed at
  `applySession` time — any mid-session PATCH (pace, followPlan, sourceIssues,
  imageAware, finish-lesson timestamp) can ship a stale array.
**Fix:** inject fresh `sourceHistory: sourceHistoryRef.current` into the PATCH
in `updateTeachState`, and/or union/max-length-merge `sourceHistory` in
`mergeState`.

### REGRESSION STILL LIVE — N6: `/api/plugins/installed` → 404

`plugins.ts:52` registers `GET /:pluginKey` before `GET /installed` (line 63)
→ "installed" resolves as a pluginKey → `Plugin not found` 404. Seen repeatedly
in dev log (console noise on desktop).
**Fix:** register `/installed` before `/:pluginKey`.

## Prior-bug sweep

| Bug | Verdict | Evidence / note |
|---|---|---|
| B1 citations mapped to open-order | **fixed** | `[3]`/`[4]` history chips follow `sourceIds` order; `loadSessionSources` indexes by session order |
| B2 fake comprehension grading | **fixed** | deliberately wrong answer → `passed:false` + misconception; correct → `passed:true` |
| B3 no tool-call progress | **fixed** | `tool` SSE → `ToolChipRow` chips |
| B4 title = raw first message | **fixed** | `/title` generates "One-Line Intros for Four Sources", "PDF Page 4 Nautilus Highlight" |
| B5 dead speech highlighting | **fixed** | `onWordBoundary` wired through `useTeacherTts` → segment map → pane re-anchor |
| B6 `coveredConcepts` empty | **fixed** | `mark_concept_covered` + `applyAssessmentToState` populate it |
| B7 no mid-session management | **fixed** | `SessionSettings` popover (attach/remove/reorder/level/style/imageAware) |
| B8 provider failure degrades badly | **partial** | bad key → clean `error` SSE + `canRetry` retry button; no catastrophic stall |
| B10 paste sources lose name | **fixed** | "Cell Biology Paste" honored |
| N1 shared paste cache identity | **fixed** | refId = `paste:<sha256>` (`source.ts:123`) |
| N2 hard-coded "Pasted text" | **fixed** | name fallback only when `name` absent |
| N3 `show_source` omits paste | **still live** | `teacher.ts:105` enum |
| N4 desktop can't display paste | **still live** | "File not found" (NB1 makes it session-poisoning) |
| N5 PATCH wipes sourceHistory | **still live** | verified 2→1 entry drop |
| N6 `/api/plugins/installed` 404 | **still live** | route shadowed by `/:pluginKey` |
| S1 chips remount/swallow clicks | **fixed** | stable `components` map + ref indirection (`HighlightableMarkdown.tsx:214–252`) |
| S2 history persisted one turn behind | **fixed** | post-`done` PATCH sends live `sourceHistoryRef.current` |
| S3 file citation → "Not a text file" | **fixed** | `inferSourceApp` ext-checks PDF/PPTX→viewer; history `appId`/`openPayload` fallback |
| S4 `[2, slides 2–3]` not linkified | **fixed** | regex consumes plural+range; chips render/parse `{index:2,label:slide,page:2}` |
| S5 page+text drops text search | **fixed** | `FileViewer` sets both `pdfPage` and `pdfSearch` (pending + live-command paths) |

## Not covered

- Real STT (headless Chromium has no mic) — mic button presence/capability-gating verified only.
- ElevenLabs TTS path (Edge TTS + word boundaries verified instead).
- Speech-synced highlight timing verified statically + wiring check; not audibly validated.
- Image-aware turns with real images (`imageAware` gating verified statically; `deepseek-flash` is not vision-capable so attachments are skipped by design).
- Comprehension-card answer flow through the UI (graded via API; card rendered in UI but not click-answered end-to-end).
- Drag-reorder inside the settings popover (reorder verified via PATCH API; drag UX not exercised).

## Artifacts (`/tmp/teach-test/`)

- `api_tests.py` + `api_results.log` — 32/32 API checks
- `source_driver.py`, `tool_direct.ts`, `sse_actions.jsonl`, `driver*.log` — SSE-level tool/payload transcripts
- `ui_test*.py`, `debug_pane.py`, `ui*_log.txt` — Playwright drivers + logs
- `shots/` — `05,21,22,30,31,32,41,43,50,51` (desktop), `60–67` (mobile)
