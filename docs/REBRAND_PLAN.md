# Athena — Rebrand & Expansion Plan

> Status: **Draft / proposal** — not yet implemented.
> Author: planning document, July 2026.

## 1. Why rebrand

Athena started as a "Student OS" but the codebase outgrew that label a long time
ago. Of the 22 apps in `client/src/apps/registry.tsx`, only ~3 are genuinely
student-specific (Grades, Study Hub, Flashcards). The rest — Tasks,
Notes, Files, Calendar, Habits, Reminders, Browser, Voice Notes, Whiteboard,
Athena AI, Analytics, Pomodoro — are general-purpose personal productivity.

The name **Athena** itself is not student-bound (goddess of wisdom), so we do
**not** rename the product. We reposition it.

### Target personas (in priority order)

1. **Students** (existing, keep as the origin story + differentiator).
2. **Freelancers / solo knowledge workers** — people who bill time, manage
   clients, juggle projects, and want one place for tasks + files + notes +
   an AI that actually remembers their context.
3. **Self-improvement nerds** — people who track habits, mood, sleep, goals,
   reading, and want AI-driven weekly reflections and a single analytics
   dashboard for "how is my life trending."

The pitch becomes:

> **Athena — your personal AI operating system.**
> A self-hosted desktop-style assistant that adapts to who you are: a student,
> a freelancer, or someone on a self-improvement journey. Bring your own LLM,
> own your data, run it anywhere (web, PWA, Android).

The student features stay — they become one of several built-in **modes**.
"Personal assistant that also deeply understands your university" is a stronger
pitch than either angle alone.

### What we explicitly avoid

- A double-barreled tagline like "Student & Personalised assistant" — reads as
  unfocused. One umbrella, with student tools as a sub-category.
- Treating "personalised assistant" as license to add every feature. We pick a
  second persona (freelancer) and a third (self-improvement) and build toward
  them deliberately, not opportunistically.

---

## 2. Rebrand scope (positioning + UI, not new features)

This phase is ~1–2 days of work, zero new data models, zero new backend routes.
It is the cheapest, highest-leverage part of the whole plan.

### 2.1 Copy changes

| File | Current | New |
|---|---|---|
| `client/src/shell/BootScreen.tsx:57` | `Student OS` | `Your personal AI OS` |
| `client/src/shell/LoginScreen.tsx:63` | `Sign in to your Student OS` | `Sign in to your Athena` |
| `client/src/shell/OnboardingOverlay.tsx:190` | `Student OS — your desktop for learning` | `Athena — your desktop for everything` |
| `README.md` header | `Athena — Student OS` / `productivity dashboard for students` | `Athena — Personal AI OS` / `self-hosted desktop-style assistant for students, freelancers, and self-trackers` |
| `AGENTS.md:1-3` | `Athena — Student OS` / `desktop-environment-style productivity dashboard for students` | `Athena — Personal AI OS` / `self-hosted desktop-style personal assistant (students, freelancers, self-trackers)` |

The student-specific apps (Grades, Study Hub, Flashcards) keep their existing copy — they
are still student tools, just no longer the *whole* product.

### 2.2 First-run mode picker

Add a step to `OnboardingOverlay` (before the current "welcome" content, or as
part of it) that asks:

> **What do you want Athena for?**
> - Student
> - Freelancer / Work
> - Self-improvement
> - Everything

The choice is stored as `settings.profile` (a new field in the existing
`useSettings` Zustand store, persisted to localStorage — no DB change needed
for v1). It controls **only** which apps are pinned to the desktop and which
are hidden from the launcher by default. All apps remain available from the
full app list / Command Palette regardless of profile.

Suggested default pin sets:

| App | Student | Freelancer | Self-improvement |
|---|---|---|---|
| Notes | pin | pin | pin |
| Tasks | pin | pin | pin |
| Calendar | pin | pin | pin |
| Athena | pin | pin | pin |
| Today | pin | pin | pin |
| Files | pin | pin | pin |
| Habits | – | – | pin |
| Pomodoro | pin | pin | pin |
| Flashcards | pin | – | – |
| Grades | pin | – | – |
| Study Hub | pin | – | – |
| Analytics | pin | pin | pin |
| Browser | pin | pin | pin |
| Voice Notes | pin | pin | pin |
| Whiteboard | pin | pin | – |
| Time Tracking *(new)* | – | pin | – |
| Goals *(new)* | – | pin | pin |
| Journal *(new)* | – | – | pin |
| Health Log *(new)* | – | – | pin |
| Finance *(new)* | – | pin | – |

Profiles are **not** locked — Settings → Appearance gets a "Profile /
pinned apps" editor so users can mix and match. The picker is just a sensible
default, not a fork of the product.

### 2.3 Launcher categorization

The Start menu / app drawer currently shows a flat grid. Group apps into
categories with section headers:

- **Productivity** — Tasks, Calendar, Notes, Files, Reminders, Browser
- **Focus & Time** — Pomodoro, Time Tracking *(new)*
- **Learning** — Study Hub, Flashcards, Grades
- **Self & Growth** — Habits, Goals *(new)*, Journal *(new)*, Health Log *(new)*,
  Analytics
- **Money** — Finance *(new)*
- **Creative** — Whiteboard, Editor, Voice Notes, Viewer
- **System** — Settings, Ntfy

Implementation: add an optional `category` field to `AppDefinition` in
`client/src/apps/registry.tsx`, render grouped sections in `StartMenu.tsx` (and
the mobile `AppDrawer`). Flat list remains available via search.

### 2.4 Settings reorganization

The Settings sidebar already has 13 sections. Add a top-level **"Profile &
Apps"** section that bundles:
- the mode picker (from 2.2),
- the per-app pin/visibility toggles,
- launcher category order.

This replaces scattering these across Appearance.

---

## 3. New features — Freelancer persona

Ordered by fit (reuse of existing infra first) and impact.

### 3.1 Time Tracking  ⭐ flagship for freelancer

**Why:** Pomodoro already logs `FocusSession` rows server-side
(`POST /api/focus/sessions`). Generalize this into project-tagged time
tracking — Toggl-style.

**Scope:**
- New `TimeEntry` model: `{ id, userId, projectId, taskId?, label, startedAt,
  endedAt, billable, hourlyRate?, source: "manual" | "pomodoro" }`.
- New `Project` model: `{ id, userId, name, color, client?, hourlyRate?,
  archived }`.
- Pomodoro's existing `FocusSession` write also creates/links a `TimeEntry`
  when a project is selected in the Pomodoro UI.
- A new **Time Tracking** app: start/stop timer (big play button), current
  running entry shown in the taskbar/system tray, manual entry editor, project
  switcher, weekly grid view, CSV export.
- Athena tool `time.query` ("how many hours on project X this week?") and
  `time.start` / `time.stop`.
- Analytics dashboard gets a "billable hours" chart reusing the existing
  pure-SVG chart components.

**Reuse:** Pomodoro UI patterns, `FocusSession` write path, Analytics charts,
Athena tool plugin system (`server/src/services/athena/tools/`).

### 3.2 Clients & Contacts  ⭐ pairs with Time Tracking

**Why:** Freelancers think in terms of clients. Contacts also feed
self-improvement ("people I met this month") and Athena's memory.

**Scope:**
- New `Contact` model: `{ id, userId, name, email?, phone?, company?, role?,
  notes, tags[], lastContactedAt?, followUpAt? }`.
- A **Contacts** app: list + detail, tag filter, "follow up due" smart list.
- Athena tools: `contact.search`, `contact.recall` (returns AI-summarized
  context — reuses `AthenaMemory` pattern), `contact.log_interaction`.
- Link contacts to Tasks ("task for client X") and Time Entries via the
  existing `ItemLink` system (`db/links.ts`).

**Reuse:** `ItemLink`, `AthenaMemory` recall pattern, Athena tool plugins.

### 3.3 Invoicing (lite)

**Why:** Natural extension of Time Tracking + Contacts. Don't build a full
accounting suite — just "generate an invoice from billable hours on project X
this month."

**Scope:**
- New `Invoice` model: `{ id, userId, clientId, projectId, lineItems[],
  total, currency, status: draft|sent|paid, issuedAt, dueAt }`.
- Generate from a Time Entry query; render as a printable HTML/PDF view
  (reuse the existing PDF export path from Notes).
- Athena tool `invoice.draft` ("draft invoice for Acme Co for July").

**Reuse:** Notes PDF export, Time Entry queries, Athena tools.

### 3.4 Read-later / Bookmarks  (also useful for self-improvement)

**Why:** Browser exists but there's no "save this, summarize it, read it
later." Tightens the Browser → Athena loop and is useful for *every* persona.

**Scope:**
- New `Bookmark` model: `{ id, userId, url, title, summary?, tags[],
  savedAt, readAt?, source: "browser" | "athena" }`.
- Browser "Save to Athena" action → fetches via `@postlight/parser`
  (already used by Study Hub source resolution) → stores title + Athena
  one-line summary + tags.
- A **Bookmarks** view (could live inside the Browser app as a tab, or be its
  own app) with tag filter, unread filter, "summarize all unread in tag X"
  Athena action.
- Athena tools: `bookmark.search`, `bookmark.recall`, `bookmark.summarize`.

**Reuse:** `@postlight/parser`, `services/fetcher.ts`, Study Hub source
resolution, Athena `research`/`fetch` tools.

### 3.5 Email integration

**Why:** The biggest real-world PIM gap. "Email says submit X by Friday" →
Task is the killer AI-assistant demo.

**Scope (start small):**
- Microsoft Graph Mail (you already have MS Graph wired for Calendar —
  `MS_CLIENT_ID` etc. in `.env`). Read-only inbox first: list threads,
  summarize, extract tasks.
- Athena tools: `email.list`, `email.read`, `email.summarize`,
  `email.extract_tasks` (returns Task objects ready to insert), `email.draft`.
- Sending/drafting is phase 2 — read + extract first.

**Reuse:** `services/microsoft.ts`, MS Graph token refresh, Athena tools,
Tasks upsert.

**Note:** This is the highest-effort item on the list. Only commit if you're
serious about the freelancer persona — it's the feature that makes the
assistant feel real for knowledge workers.

---

## 4. New features — Self-improvement persona

### 4.1 Goals / OKRs  ⭐ flagship for self-improvement (also freelancer)

**Why:** Tasks are granular; there's nothing for "get fit this quarter" or
"ship side project X." A goal layer above Tasks gives the assistant something
to reason about weekly.

**Scope:**
- New `Goal` model: `{ id, userId, title, kind: "outcome" | "process",
  targetMetric?, targetValue?, currentValue?, unit?, dueAt, status,
  linkedTaskIds[], linkedHabitIds[] }`.
- A **Goals** app: list with progress bars, link tasks/habits to a goal,
  manual or auto progress (auto = % of linked tasks done, or habit streak
  length).
- Athena **weekly check-in**: every Sunday, AI reviews goal progress + linked
  tasks/habits + journal entries and writes a reflection to the journal.
  Reuses the ntfy cron + Athena turn infra
  (`services/ntfy/athena-turn.ts`).
- Analytics dashboard gets a "goal progress over time" chart.

**Reuse:** ntfy cron scheduler, `athena-turn`, Analytics charts, Tasks +
Habits reads.

### 4.2 Journal / daily diary  ⭐ flagship for self-improvement

**Why:** Different from Notes — structured daily entries with mood + AI
reflection prompts. The natural home for the weekly goal check-in output.

**Scope:**
- New `JournalEntry` model: `{ id, userId, date, mood: 1-5, energy: 1-5,
  content, promptId?, aiReflection? }`.
- A **Journal** app: today's entry with mood/energy selectors + free text
  (reuse the Notes CodeMirror markdown editor), calendar heatmap of entry
  days, prompt-of-the-day.
- Athena daily reflection: after each entry, optionally run a prompt that
  returns a short reflection stored in `aiReflection`.
- Athena tools: `journal.write`, `journal.search`,
  `journal.reflect` (on-demand), `journal.summary` ("how was my month?").

**Reuse:** Notes editor component, Athena tool plugins, ntfy for daily
prompt reminders.

### 4.3 Health / mood / sleep logging

**Why:** Habits is binary streak-based. A numeric-log layer (weight, sleep
hours, mood, HRV, workouts) with charts is the self-tracker's core ask.

**Scope:**
- New `HealthLog` model: `{ id, userId, date, metric: "weight" | "sleep" |
  "mood" | "energy" | "workout" | "hrv" | "steps" | ..., value, unit, note? }`.
- A **Health** app: log form, metric picker, line charts (reuse Analytics
  pure-SVG charts), correlation view ("sleep vs mood this month").
- Optional: manual entry only for v1 — no wearable integration (out of scope,
  huge surface area). Apple Health / Google Fit import is a possible later
  phase.
- Athena tools: `health.log`, `health.query`, `health.correlate` ("does my
  sleep predict my mood?").

**Reuse:** Analytics chart components, Athena tools.

### 4.4 Reading tracker

**Why:** Self-improvement nerds track books/articles. Pairs with Bookmarks
(3.4) — articles saved → "currently reading" → "finished" with rating +
notes.

**Scope:**
- New `Book` model: `{ id, userId, title, author, status: "reading" |
  "finished" | "want", startedAt?, finishedAt?, rating?, notes?, pages?,
  currentPage? }`.
- A **Reading** app (or a tab in Bookmarks): shelves, progress %, yearly
  reading goal (links to Goals 4.1).
- Athena tools: `reading.list`, `reading.finish`, `reading.recommend` (uses
  `research`/`web_search` to suggest next reads based on history).

**Reuse:** Bookmarks data, Goals, Athena `research` tool.

---

## 5. Cross-cutting features (all personas)

### 5.1 Morning briefing / daily digest  ⭐ highest "wow" per unit of work

**Why:** You already have `ProactiveAlertConfig`, ntfy cron, reminders, and
Athena tools that read calendar/tasks/habits/goals. Formalize a generated
daily briefing.

**Scope:**
- A new ntfy cron job type `"briefing"` that, at a user-set time, runs an
  Athena turn with a system prompt that pulls: today's calendar, top 3
  tasks, overdue tasks, habit reminders, goal progress, weather (if a
  weather tool is added), unread journal prompt.
- Output pushed via ntfy AND rendered as a card at the top of the Today
  screen (`client/src/apps/today/TodayApp.tsx`).
- No new models — reuses ntfy cron + Athena turn + Today screen.

**Reuse:** `services/ntfy/scheduler.ts`, `athena-turn.ts`, all existing
read tools, Today screen.

### 5.2 Weather widget

**Why:** Trivial, expected on any "OS" / Today screen, feeds the morning
briefing.

**Scope:**
- Server route `GET /api/weather?lat=&lon=` proxying a free API (Open-Meteo,
  no key needed). Per-user location in Settings.
- Small widget on the Today screen + a weather line in the briefing.
- ~half a day of work.

### 5.3 Athena "memory" expansion

**Why:** `AthenaMemory` exists but is underused. For a personalised
assistant, memory is the moat.

**Scope:**
- Surface memory in Settings → Athena Assistant ("what Athena remembers
  about you") with add/edit/delete.
- Auto-capture: Athena automatically writes memories from chat context
  ("user is a freelance designer, uses Figma, bills €60/hr").
- Memory used in every Athena turn's system prompt (already partially done
  via `services/athena/context.ts`).

---

## 6. Recommended build order

Don't build everything. Ship in this order, each step independently useful:

1. **Rebrand phase (§2)** — copy + mode picker + launcher categories.
   ~1–2 days, zero risk, immediately reframes perception.
2. **Morning briefing (§5.1) + Weather (§5.2)** — highest "this is an
   assistant" payoff per unit of work; 90% of infra exists.
3. **Bookmarks / Read-later (§3.4)** — small, tightens Browser→Athena loop,
   useful to all personas.
4. **Goals (§4.1) + Journal (§4.2)** — the self-improvement flagship pair.
   They reinforce each other (journal hosts the weekly goal check-in).
5. **Time Tracking (§3.1)** — the freelancer flagship. Reuses Pomodoro +
   Analytics heavily.
6. **Contacts (§3.2)** — pairs with Time Tracking and Athena memory.
7. **Health Log (§4.3)** — only if self-improvement persona gets traction.
8. **Email (§3.5) + Invoicing (§3.3)** — only if committed to freelancer.
   Highest effort, highest real-world value.
9. **Reading tracker (§4.4)** — nice-to-have, low priority.

### What to deliberately defer / skip

- **No-code automation/rules engine** — generalize ntfy cron into "when X
  then Y." Powerful but huge surface area; defer until there's clear demand.
- **Wearable / Apple Health / Google Fit sync** — out of scope for v1 of
  Health Log; manual entry first.
- **Full accounting / tax** — Invoicing lite only. Don't become QuickBooks.
- **Google Workspace integration** — you have MS Graph; Google is a bigger
  market but a separate OAuth + API investment. Defer unless email proves
  the concept on MS first.

---

## 7. Data model summary (new Prisma models)

All new models follow the existing pattern (per-user, SQLite, Prisma
migration). Listed in build order:

```
model Profile              // OR just a settings field — see §2.2, prefer no model
model Bookmark             // §3.4
model Goal                 // §4.1
model JournalEntry         // §4.2
model Project              // §3.1
model TimeEntry            // §3.1
model Contact              // §3.2
model HealthLog            // §4.3
model Invoice              // §3.3  (deferred)
model Book                 // §4.4  (low priority)
```

Profile (§2.2) intentionally does **not** get a model in v1 — it's a
localStorage setting in `useSettings`, since it only affects client-side app
visibility. Promote to a DB column later if it needs to sync across devices.

---

## 8. Risks & open questions

- **Scope creep.** The biggest risk. "Personalised assistant" invites
  feature bloat. Mitigation: the build order above is deliberately staged;
  each step must ship before the next starts.
- **Athena AI cost/availability.** Several new features (briefing, journal
  reflection, goal check-in, email summarization) lean heavily on the LLM.
  All already gated on per-user or server-wide keys (`OPENAI_*` /
  `AiCredential`). No free fallback is provided — features degrade
  gracefully (e.g. briefing without AI = plain agenda list).
- **Profile picker rigidity.** Users won't fit neatly into one persona.
  Mitigation: profiles only set defaults; everything is editable in
  Settings → Profile & Apps.
- **Student features feeling deprioritized.** Mitigation: keep
  Grades/Study Hub pinned by default in the Student profile and featured in
  marketing. They are the differentiator, not a relic.
- **Email integration effort.** MS Graph Mail is real work (token refresh,
  thread pagination, attachment handling). Validate demand before building.

---

## 9. What NOT to change

- The desktop shell, window manager, mobile shell, PWA, Capacitor, APK
  auto-update — all untouched. The rebrand is positioning + app
  organization + new apps, not an architecture change.
- Existing student apps keep their names and behavior.
- The "Athena" product name stays.
