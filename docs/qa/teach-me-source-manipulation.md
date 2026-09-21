# Teach Me — source manipulation dynamic test

Focused retest of **source handling only** (documents opening relative to the
conversation, PDF/PPTX handling, highlighting, inline `[n]` / `[n, page X]` /
`[n, slide X]` references, source switching across turns). Follow-up to
`teach-me-retest.md`; no source code was modified.

Environment: local dev (`bun run dev`, server :3001, client :5173), PostgreSQL,
`admin` user, `deepseek-flash` configured as the global LLM via the admin API
(temporary key, not persisted anywhere in the repo). Desktop UI tested with
Playwright/Chromium at 1600×950; SSE turns were also driven directly at the API
level (`/api/teacher/:id/stream`) to separate server/tool behavior from UI
behavior.

Fixtures: multi-page PDF (`respiration.pdf`, 5 pages, unique keyword per page),
PPTX (`algorithms.pptx`, 5 slides), note (`Biology Notes - Mitosis`). Attached
to one session as `[1]` PDF, `[2]` PPTX, `[3]` note.

## Verified working

| Feature | Result |
|---|---|
| `show_source` opens PDF in the side pane, `scrollToPage` lands on the right page | OK — page 2 opened on first turn, page 1 + page 4 on later turns |
| `focus_source` returns to an already-open source | OK — PDF refocused after note/PPTX were shown |
| `show_source` on PPTX opens `PptxViewer`, `scrollToSlide` lands on the right slide | OK — "Slide 3 of 5", later "Slide 2 of 5" |
| `show_source` on a note opens the CodeMirror pane with resolved `posStart`/`posEnd` | OK — "cleavage furrow forms" passage visibly highlighted (`.cm-teacher-highlight`) |
| Source switching as the conversation progresses (note → PDF → PPTX) | OK — pane swaps correctly, "Open sources:" history chips appear |
| History chips ("Open sources: [n] name") | OK — clicking refocuses the source (verified: `[1] Respiration PDF` re-opens the PDF) |
| Citation chips render for `[n]`, `[n, page X]`, `[n, slide X]` | OK — chips render with correct labels |
| Pane restore after reload | Partially — a source IS restored, but the wrong one (see S2) |
| LLM side: model uses `show_source`/`highlight_source`/`focus_source` correctly, cites `[n, page X]` inline | OK — the model itself behaved well |

## Bugs / problems found

### S1 — Citation chips are remounted on every render → real clicks get swallowed

Observed (headless Chromium, reproducible): `pointerdown` on a citation chip
hits the `<button>`, but by the time `mousedown` is dispatched the button is
already gone (event targets `pointerdown:button`, then `mousedown:P`, then
`mouseup:button` — no `click` is synthesized). The chip is destroyed and
re-created between the two phases of the same click, so the press never
completes. Verified with a capture-phase document listener: the click produces
**zero** DOM events.

Cause: `attachedSources` in `useTeacherSession.ts` is a plain expression
(`session.sourceIds.map(id => library.find(...))`), i.e. a **new array identity
on every render**. It is a dependency of `openCitation` (`useCallback`) in
`TeacherMode.tsx`, which is a dependency of the `components` `useMemo` in
`HighlightableMarkdown.tsx`. So every re-render of `TeacherMode` produces a new
`a` renderer function → react-markdown treats it as a different element type →
**all citation chip buttons are unmounted and remounted** on every render.
Any state change landing mid-click (window focus on pointerdown, TTS progress,
tool-chip timers, streaming) replaces the chip under the cursor and the click
dies. Same mechanism also means chips lose hover/focus state whenever anything
re-renders.

Fix direction: `useMemo` for `attachedSources` (keyed on `session.sourceIds` +
`library`), and/or keep the markdown `components` map stable by reading
`onOpenCitation` through a ref inside the `a` renderer.

### S2 — `state.sourceHistory` persists one turn behind; last opened source is lost on reload

Observed: after turns that opened note → PDF → PPTX, the persisted
`state.sourceHistory` contained only the note and PDF entries — the PPTX entry
(the most recent source) was missing. After page reload the pane therefore
restored `Respiration PDF - page 1` instead of the last-shown `Algorithms
slides / slide 2`.

Cause: the stream request body carries `state` (incl. `sourceHistory`)
snapshotted in `send()` **before the turn runs**
(`useTeacherSession.ts` ~line 434). The server merges and persists that
snapshot at stream end (`routes/teacher.ts` ~lines 642, 814-826 —
`mergeState` replaces `sourceHistory` wholesale). Entries added by the turn's
own `show_source`/`focus_source` dispatches never reach the server; they are
only included in the *next* turn's snapshot. Net effect: the newest
sourceHistory entry is always lost if the session ends or reloads after that
turn, and a single-turn session persists an empty history.

Fix direction: after `onDone`, PATCH the session state with
`sourceHistory: sourceHistoryRef.current` (or send the post-turn history to the
server when the stream completes).

### S3 — Citation chip for a file source with no history entry opens the wrong pane → "Not a text file"

Observed: clicking a `[2, slide 3]` chip for the PPTX (dispatched via
`dispatch_event`, bypassing S1) switched the pane to `algorithms.pptx` but
rendered an error: **"Not a text file"**.

Cause: `openCitation` looks up `sourceHistory` for the source's `appId` /
`openPayload`; when the entry is missing (fresh reload, or the entry lost via
S2) it falls back to `inferSourceApp(kind, refId)`, which maps `kind:"file"` →
`appId:"editor"` unconditionally (`TeacherMode.tsx` ~line 76). The pane then
mounts `CodemirrorPane`, which calls `filesApi.getContent(fileId)` — the server
rejects binary files with 400 "Not a text file". So citations to PDFs/PPTX only
work while the source has a history entry carrying `appId:"viewer"` in the
current page-load.

Fix direction: `inferSourceApp` needs the file's mime type/name — e.g. resolve
via `filesApi` (or store `appId` on the StudySource) instead of guessing
`editor` for every `file` source.

### S4 — `[n, slides X–Y]` / plural and ranged citations are not linkified

Observed: the model emitted `[2, slides 2–3]` in a real turn. It renders as
plain text, not a citation chip.

Cause: `preprocessStudyMarkdown` (`studyMarkdown.ts` line 15) only accepts a
singular label (`p|page|str|strana|slide|slid|slidu`) followed by a single
number and `]`. Plural `slides`, en-dash ranges (`2–3`), and comma lists are
not matched. Models naturally produce these forms.

Fix direction: extend the regex (plural labels, `X–Y` ranges; probably
navigate to the first page/slide of the range).

### S5 — `highlight_source`/`show_source` on PDF drops the text when `pageNumber` is also passed

Observed + code: for a PDF in the pane, when a highlight command carries both
`page` and `text` (the model sends `highlight_source` with `text` +
`pageNumber`), `FileViewer` takes the page branch
(`TeachSourcePane.tsx` ~lines 341-348 and 360-365): `setPdfPage(page)` runs,
`setPdfSearch` is cleared, the text is never searched, and the command reports
`ok`. Result: the pane scrolls to the right page but **no passage is
highlighted**, even though PDF.js search (`searchText` → find controller
`highlightAll`) is implemented and works when no page is given.

Fix direction: when both are present, navigate to the page AND still run the
text search scoped to (or starting at) that page.

### Minor / cosmetic

* `currentPageNumber: "0" is not a valid page.` — PDF.js console error on
  restore; a `scrollToPage` of 0/undefined is passed through somewhere in the
  restore path.
* The LLM named a `show_source` title `Respiration PDF - page 1`; that literal
  name lands in `sourceHistory.name` and in the "Open sources" chip label.
  Harmless but noisy.
* `focus_source` for a source with no history entry silently no-ops (no
  fallback `show_source`); mostly masked by S2 but the same empty-history case
  makes it reachable.

## Test artifacts

* SSE driver: `/tmp/teach-test/stream_turn.py`
* UI scripts: `/tmp/teach-test/ui_test.py`, `debug_click.py`, `debug_click2.py`
* Screenshots: `/tmp/teach-test/*.png`
* Session used: `cmubjssrn005a5q57jvvpqvok` ("Teach Me: respiration.pdf")
