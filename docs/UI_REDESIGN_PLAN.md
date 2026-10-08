# Mavino UI Redesign Plan

## 1. Executive summary

The goal is not merely to make Mavino look more polished. The redesign must create a coherent, recognizable, accessible, and maintainable product interface for a student operating system spanning:

- a desktop shell and window manager,
- a dedicated mobile shell,
- many productivity and study applications,
- Athena/AI workflows,
- mouse, keyboard, touch, and gesture input,
- PWA and Capacitor deployments.

The redesign will proceed from product definition to foundations, shell, application families, and final validation. The core toolchain is:

> **Impeccable + Apple Design + Mavino-specific rules + browser iteration + Playwright/axe**

Taste Skill may be used as an optional second design critic. Image generation may only be used for moodboards and early exploration, not as the source of production architecture.

The central constraint is that Mavino must have one product opinion. AI tools assist with research, critique, implementation, and verification; they do not independently invent a new visual language for every screen.

---

## 2. Core principles

### 2.1 One product, one design language

Unify typography, semantic color, spacing, radius, elevation, materials, navigation, component states, motion, UX copy, and information density across the shell and applications.

### 2.2 Foundations before mass migration

Do not redesign every application independently. First establish product truth, design direction, tokens, primitives, patterns, and automated checks. Applications are migrated only after these foundations are usable.

### 2.3 AI is an implementer and critic, not an autonomous art director

Skills may propose variants, find inconsistencies, apply the approved system, and audit results. Product identity and major design directions require explicit approval.

### 2.4 Design around user workflows

Prioritize workflows such as:

- understanding what needs attention today,
- planning study and tasks,
- capturing a note or task quickly,
- opening and organizing applications,
- working with study sources and documents,
- asking Athena for help,
- returning to unfinished work.

### 2.5 Desktop and mobile share a language, not necessarily a layout

Desktop is a spatial workspace with windows. Mobile is sequential and touch-first. They share identity, tokens, component behavior, terminology, and motion principles, but should not be forced into identical layouts.

### 2.6 Validate real behavior, not prompt output

Every significant UI change must be inspected in the running application and verified across representative viewports, themes, content states, and input modes.

---

## 3. Goals

### Product goals

- Users quickly understand what Mavino is and where to begin.
- Frequent tasks require fewer decisions and steps.
- The desktop behaves as a useful workspace, not merely an OS imitation.
- Mobile feels intentionally mobile rather than a compressed desktop.
- Athena is integrated into workflows rather than isolated as a chatbot.
- Advanced features do not overwhelm new users.

### Visual goals

- Clear and consistent hierarchy.
- A recognizable identity without generic SaaS patterns.
- Deliberate typography and information density.
- Restrained use of cards, borders, badges, gradients, blur, and shadows.
- Consistent light and dark themes.
- High-quality hover, press, focus, loading, empty, success, and error states.

### Technical goals

- Centralized semantic design tokens.
- Shared accessible UI primitives.
- Fewer raw Tailwind colors and arbitrary values.
- Visual regression coverage for critical states.
- Automated accessibility checks.
- Preservation of the window manager, PWA, and Capacitor behavior.
- No second competing component framework unless explicitly approved.

---

## 4. Tooling strategy

## 4.1 Impeccable

Use Impeccable as the primary design workflow for:

- product/design initialization,
- documenting the incumbent design,
- shaping UX before implementation,
- design critique,
- technical and accessibility audits,
- extracting repeated patterns into reusable components,
- final polish.

Typical commands include:

```text
/impeccable init
/impeccable document
/impeccable shape
/impeccable critique
/impeccable audit
/impeccable extract
/impeccable polish
```

Rules:

- Never run an uncontrolled rewrite across the entire frontend.
- Work on a specific surface or vertical slice.
- Separate critique from implementation.
- Check recommendations against `PRODUCT.md` and `DESIGN.md`.
- Inspect all significant changes in the browser.

## 4.2 Apple Design

Use Apple Design for interaction quality rather than visual imitation of macOS:

- window open/close/minimize behavior,
- dragging, resizing, and snapping,
- taskbar and start menu interactions,
- command palette and context menus,
- mobile sheets and navigation,
- pull-to-refresh and back gestures,
- drag-and-drop and pinch-to-zoom.

Required principles:

- immediate feedback on pointer-down,
- 1:1 tracking during direct manipulation,
- interruptible motion,
- animation from the current presentation value,
- velocity-aware handoff after gestures,
- symmetric entry and exit paths,
- spatial relationships between trigger and destination,
- motion with a functional purpose,
- reduced-motion, reduced-transparency, and increased-contrast alternatives.

## 4.3 Project skill: `mavino-design`

Create a repository-specific skill at:

```text
.devin/skills/mavino-design/SKILL.md
```

It must define:

- Mavino's product identity and audience,
- priority workflows,
- visual personality,
- desktop and mobile rules,
- approved primitives and patterns,
- anti-patterns,
- accessibility and motion checklists,
- browser iteration requirements,
- required verification commands.

The skill should forbid, unless explicitly justified:

- wrapping every section in a rounded card,
- decorative gradients without semantic purpose,
- automatic use of large radii,
- badges for every data point,
- universal glassmorphism,
- raw palette colors where semantic tokens exist,
- new button/input/card patterns when a primitive exists,
- shadows without a defined elevation role,
- motion without informational or physical purpose,
- placeholder-only design validation,
- treating mobile as vertically stacked desktop,
- introducing shadcn, MUI, or another parallel design system by default.

## 4.4 Browser iteration

For every meaningful UI change:

1. Start the application.
2. Open the exact state being redesigned.
3. Inspect hierarchy, alignment, density, and contrast.
4. Exercise the interaction with the appropriate input mode.
5. Revise the implementation.
6. Repeat on desktop and mobile viewports.

Representative coverage must include:

- small laptop, standard desktop, and wide desktop,
- narrow phone, large phone, and tablet/touch,
- light and dark themes,
- empty, realistic, long-content, loading, error, and integration-unavailable states.

## 4.5 Playwright and axe

Use Playwright for:

- critical end-to-end workflows,
- keyboard navigation,
- focus behavior,
- responsive viewport checks,
- stable visual baselines,
- dialogs, sheets, and overlays,
- reduced-motion behavior.

Use axe against the real DOM for accessibility checks. Do not accept a skill's claim that generated markup is accessible without testing it.

## 4.6 Optional Taste Skill

Use Taste Skill only as a manually invoked second critic for:

- comparing design directions,
- identifying generic AI patterns,
- reviewing a major surface before approval.

It must not override `DESIGN.md` or automatically rewrite production code.

---

## 5. Project artifacts

### `PRODUCT.md`

Stable product truth:

- target users,
- problems solved,
- primary workflows,
- role of Athena,
- platform priorities,
- constraints,
- voice and terminology,
- success criteria.

### `DESIGN.md`

Evolving implementation-oriented design specification:

- selected visual direction,
- hierarchy and composition,
- typography,
- semantic color,
- spacing and density,
- radii,
- elevation and materials,
- components and patterns,
- navigation,
- motion,
- desktop/mobile rules,
- correct and incorrect examples.

### Component inventory

Track existing components, variants, usage locations, duplicates, target primitives, and migration status.

### Migration matrix

Track each application by family, priority, primitive adoption, mobile status, accessibility, visual QA, and completion state.

### Decision log

For significant decisions, record the problem, alternatives, chosen direction, rationale, impacts, and conditions for reconsideration.

---

## 6. Delivery phases

## Phase 0 — protect current functionality

### Work

- Confirm current build, typecheck, lint, and test commands.
- Identify critical desktop and mobile workflows.
- Add baseline Playwright smoke tests before redesigning behavior.
- Capture reference screenshots of the current interface.
- Establish representative desktop/mobile test states.
- Audit all third-party skills before installation.
- Pin versions where practical.

### Deliverables

- functional baseline,
- critical workflow list,
- reference screenshots,
- initial automated tests,
- known-existing-issues list.

### Exit gate

Login, shell navigation, window management, mobile navigation, and primary workflows can be verified before and after changes.

## Phase 1 — product and UX research

### Work

- Identify primary student groups and behaviors.
- Determine most frequent and most valuable workflows.
- Review user feedback and observe task completion where possible.
- Identify undiscovered features and major points of cognitive load.
- Clarify desktop versus mobile usage.
- Define Athena's role within normal workflows.
- Perform a five-second and first-click assessment of key surfaces.

### Deliverables

- approved `PRODUCT.md`,
- priority workflows,
- ranked UX problems,
- information architecture principles,
- success metrics.

### Exit gate

The team can clearly explain what Mavino is, who it serves, and why its integrated workspace is valuable.

## Phase 2 — comprehensive UI audit

### Token audit

Inventory colors, raw hex/RGB values, Tailwind palette classes, spacing, radii, shadows, opacity, blur, type sizes, line heights, breakpoints, z-index layers, durations, and easing.

### Component audit

Inventory buttons, icon buttons, inputs, selects, checkboxes, tabs, cards, panels, list rows, tables, dialogs, sheets, menus, tooltips, banners, toasts, and empty/loading/error states.

### UX audit

Review orientation, hierarchy, navigation consistency, discoverability, cognitive load, progressive disclosure, recovery from errors, keyboard workflows, and mobile reachability.

### Accessibility audit

Review semantics, focus order, focus visibility, keyboard operation, labels, accessible names, dialog behavior, contrast, reflow, touch targets, and reduced motion.

### Motion audit

Review entry/exit paths, gesture tracking, interruptibility, easing consistency, layout animation, press feedback, and reduced-motion alternatives.

### Deliverables

- prioritized audit report,
- component inventory,
- duplication map,
- design debt list,
- shell/application map,
- quick-win candidates.

## Phase 3 — design directions

Create three distinct directions using the same representative vertical slice:

- login or onboarding,
- desktop shell,
- active window,
- taskbar/start menu,
- Today,
- Tasks,
- Athena quick panel,
- mobile home and navigation,
- dialog/sheet,
- empty and error states.

Suggested directions:

1. **Calm Academic Workspace** — quiet, focused, highly readable.
2. **Spatial Student OS** — stronger spatial continuity, depth, and physical interaction.
3. **Editorial Productivity** — stronger typography, fewer containers, deliberate density.

Evaluate identity, usability, readability, scalability, desktop/mobile fit, accessibility, implementation cost, and resistance to generic AI aesthetics.

### Deliverables

- three browser-based prototypes,
- comparison matrix,
- one approved direction,
- explicit list of elements that must not be mixed across directions.

### Exit gate

A single direction is approved before foundation work begins.

## Phase 4 — design foundations

### Semantic color

Define roles such as:

```text
canvas
surface
surface-raised
surface-overlay
surface-sunken
text-primary
text-secondary
text-disabled
border-subtle
border-strong
accent
accent-hover
accent-pressed
focus-ring
success
warning
danger
info
```

Every token needs light and dark values.

### Typography

Define display, page title, section title, body, compact body, label, metadata, code, and tabular/numeric roles with size, line height, weight, tracking, usage, and mobile behavior.

### Spacing and density

Create a constrained spacing scale and document stack, inline, section, shell, and touch-control usage. Define where comfortable and dense modes are appropriate.

### Radius

Use a small set of semantic roles for controls, panels, overlays, windows, and genuine pill elements.

### Elevation and materials

Define levels for canvas, embedded content, raised content, floating controls, popovers/menus, and modal sheets. Tie blur, translucency, border, and shadow to these levels.

### Motion

Define immediate feedback, micro transitions, content transitions, overlay transitions, window transitions, spring presets, momentum presets, and reduced-motion alternatives.

### Deliverables

- expanded `DESIGN.md`,
- implemented CSS/Tailwind tokens,
- documented utilities,
- internal UI gallery or demonstration surface.

### Exit gate

A new component can be created without inventing a raw color, arbitrary radius, or custom shadow.

## Phase 5 — shared UI primitives

Build accessible shared primitives for:

- Button, IconButton, LinkButton,
- TextField, TextArea, Select, SearchField,
- Checkbox, Radio, Switch, SegmentedControl,
- Tabs, SidebarItem, NavigationItem, Breadcrumb, MobileTabItem,
- Surface, Panel, Toolbar, ListRow, SectionHeader, Stat, Badge, Avatar,
- Alert, Banner, Toast, Progress, Skeleton, Spinner, EmptyState, ErrorState,
- Dialog, ConfirmDialog, Sheet, Popover, Tooltip, Menu, ContextMenu.

Every interactive primitive must cover default, hover, active, focus-visible, disabled, loading, selected, destructive, error, and touch states where relevant.

### Deliverables

- shared primitive layer,
- component tests,
- gallery of states,
- usage guidance.

### Exit gate

Applications no longer need ad hoc versions of common controls.

## Phase 6 — desktop shell redesign

Redesign:

- wallpaper/desktop contrast,
- desktop organization and widgets,
- windows and title bars,
- active/inactive window distinction,
- resizing and snapping,
- maximize/minimize/close behavior,
- taskbar and running/pinned applications,
- start menu and system tray,
- workspace overview,
- command palette,
- context menus,
- quick capture,
- Athena quick panel,
- dialogs, notifications, and update prompts.

Apply Apple Design principles to direct manipulation and motion. Preserve 1:1 dragging, avoid blocking input during transitions, keep entry/exit spatially consistent, and supply reduced-motion behavior.

### Exit gate

The desktop shell works as a coherent product environment before most applications are migrated.

## Phase 7 — mobile shell redesign

Redesign:

- home,
- bottom navigation,
- launcher/apps,
- Athena,
- tool pages,
- sheets,
- browser/hardware back,
- safe areas,
- keyboard behavior,
- install/update UI,
- mini player,
- notifications,
- quick capture.

Requirements:

- primary actions are thumb-reachable,
- touch targets are sufficient,
- sheets have a predictable dismissal model,
- back navigation is consistent,
- the virtual keyboard does not break layout,
- haptics are reserved for meaningful commit/success/snap events.

### Exit gate

Primary mobile workflows can be completed one-handed without desktop assumptions.

## Phase 8 — migrate applications by family

### A. Daily planning

Today, Tasks, Calendar, Reminders, Habits, Plans.

### B. Study

Study Hub, Flashcards, Grades, lecture notes, quiz, explain, knowledge graph, syllabus tasks.

### C. Content creation

Notes, Editor, Viewer, Whiteboard, Scribe.

### D. Information-dense/admin

Analytics, Grades, settings, storage, performance, users, admin surfaces.

### E. Spatial/external tools

Maps, Browser, Files, Marketplace, integrations.

### F. AI and communication

Athena, Circle, Bridge, Echo, and related tools.

For each application:

1. Audit existing behavior and code.
2. Define primary user tasks.
3. Shape the redesign with Impeccable.
4. Establish information hierarchy.
5. Replace ad hoc elements with primitives.
6. Iterate in the browser.
7. Verify responsive and touch behavior.
8. Run accessibility checks.
9. Add or update Playwright tests.
10. Establish a visual baseline.
11. Update the migration matrix.

## Phase 9 — UX copy and content design

Standardize:

- tone and form of address,
- application and action names,
- confirmation dialogs,
- errors,
- empty states,
- loading and offline messaging,
- AI status language,
- destructive action wording.

Rules:

- action labels describe the action,
- errors explain what happened and what the user can do,
- empty states point to a relevant first action,
- product UI avoids unnecessary marketing language,
- AI states distinguish waiting, generating, tool execution, success, and failure.

## Phase 10 — accessibility, performance, and stabilization

Target WCAG 2.2 AA for primary workflows.

Mavino-specific requirements include:

- keyboard alternatives for moving/resizing windows,
- non-drag alternatives for reordering tasks,
- textual/table alternatives for charts,
- list-based information alongside map interactions,
- state communication beyond color,
- controlled live-region behavior for AI streaming,
- focused audits of CodeMirror and canvas-based surfaces.

Finish with:

- Playwright and axe coverage,
- focus and keyboard review,
- responsive and zoom/reflow testing,
- reduced-motion and increased-contrast testing,
- performance profiling,
- low-end mobile testing,
- PWA and Capacitor smoke testing,
- user validation of priority workflows.

---

## 7. Quality gates

Every significant UI change must pass:

### Product gate

- Solves a real problem.
- Supports a priority workflow.
- Does not add unnecessary complexity.

### Design-system gate

- Uses approved tokens and primitives.
- Introduces a new variant only when generally reusable.
- Matches `DESIGN.md`.

### Interaction gate

- Predictable behavior.
- Appropriate keyboard, mouse, and touch support.
- Interruptible, purposeful motion.

### Accessibility gate

- axe passes within the agreed baseline.
- Focus order and visibility are correct.
- Gesture/drag interactions have alternatives.
- Reduced-motion behavior exists.

### Technical gate

- Relevant typecheck, lint, tests, and build pass.
- No known shell, mobile, PWA, or Capacitor regression.

### Visual gate

- Reviewed on desktop and mobile.
- Reviewed in light and dark themes.
- Reviewed with long, empty, loading, and error content.

---

## 8. Visual QA checklist

- Is the primary action obvious?
- Is hierarchy understandable before reading every label?
- Is density appropriate to the task?
- Can a container or border be removed?
- Do radii, materials, and elevation reflect semantic roles?
- Are spacing values from the approved scale?
- Does motion communicate causality or spatial continuity?
- Is system status obvious?
- Are interactive elements recognizable without relying on hover?
- Does the screen work with long content and realistic data?
- Does it work using keyboard and touch?

---

## 9. Success metrics

### UX

- task completion rate,
- steps and time to primary action,
- misclicks and navigation reversals,
- discoverability of critical functions,
- successful return to unfinished work,
- perceived clarity and confidence in Athena.

### Design-system health

- number of raw colors and arbitrary values,
- number of unique radii and shadows,
- number of ad hoc control variants,
- percentage of migrated surfaces using primitives,
- number of exceptions to the design system,
- visual regression count.

### Accessibility

- axe violation count,
- keyboard-completable workflow coverage,
- correct focus management coverage,
- accessible naming coverage,
- reduced-motion coverage.

### Technical

- build/test stability,
- bundle and runtime performance,
- interaction latency,
- shell regression count,
- mobile overflow and viewport issue count.

---

## 10. Milestones

1. **Protected baseline** — tests, critical flows, screenshots, known issues.
2. **Product definition** — approved `PRODUCT.md` and workflow priorities.
3. **Selected direction** — three explored directions and one approved choice.
4. **Design foundations** — tokens, typography, materials, motion, gallery.
5. **Shared primitives** — accessible components and documented states.
6. **New shell** — desktop and mobile shells, overlays, navigation, windows.
7. **Primary workflows** — Today, Tasks, Calendar, Athena, Study Hub.
8. **Full application migration** — all application families and reduced duplication.
9. **Stabilization** — accessibility, visual QA, performance, PWA/Capacitor, user validation.

---

## 11. Implementation status

### Completed foundations

- `PRODUCT.md`, `DESIGN.md`, and `.devin/skills/mavino-design/SKILL.md` define the approved Calm Academic Workspace direction.
- Runtime semantic tokens cover canvas, surfaces, ink hierarchy, edges, focus, accent, success, warning, danger, info, and scrim in light and dark themes.
- Shared primitives cover buttons, icon buttons, fields, surfaces, alerts, switches, desktop dialogs, and mobile sheets.
- Shared overlays provide dialog semantics, initial focus via `data-autofocus`, focus containment, Escape/backdrop dismissal, and focus restoration.
- Desktop shell, window controls, taskbar, Start menu, command palette, Quick Capture, update prompt, system feedback, and mobile shell use the shared material and overlay model.
- Ocean is the default wallpaper and `#3b82f6` is the default accent. A one-time `mavino.appearance-reset.v1` migration resets stored browser profiles to those values after deployment while preserving theme and unrelated preferences.
- User-facing copy uses Mavino; Athena remains only as an internal technical codename.

### Migration matrix

| Surface family | Status | Notes |
| --- | --- | --- |
| Desktop shell | Migrated | Windows, taskbar, Start menu, tray, command palette, Quick Capture, update prompt, onboarding, boot, and error surfaces. |
| Mobile shell | Migrated | Home, bottom navigation, launcher, primary sheets, mobile modal system, notifications, and Mavino mobile workflow. |
| Daily planning | Migrated | Today, Tasks, Calendar, Reminders, Habits, Plans. Workspace/task dialogs use shared primitives; planning status uses semantic colors. |
| Study | Migrated | Study Hub, Flashcards, Grades, podcast, teacher, lecture, quiz, highlight, graph, and source workflows use shared feedback and semantic state colors. |
| Documents and creation | Migrated | Notes, Files, Editor, Viewer, Whiteboard, Scribe, uploads, preview, and generation flows use semantic surfaces and shared overlays where modal. |
| Information/admin | Migrated | Settings sections, users, integrations, storage, maintenance, analytics, plugins, and admin controls use grouped navigation, switches, alerts, and semantic status. |
| Spatial/external tools | Foundation migration complete | Maps, Browser, Marketplace, Files, integrations, Compass, Atlas, Crunch, Echo, Pulse, Forge, Circle, Bridge, Ntfy, Voice, and related tools use shared tokens and accessible modal patterns; canvas/map/chart color encodings remain domain data. |
| AI workflows | Migrated | Mavino desktop and mobile surfaces, quick capture, intelligent upload, teach/study generation, and tool/status feedback use Mavino naming and restrained status language. |

### Remaining intentional exceptions

- User-selectable palette values (avatars, decks, habits, categories, graph/document colors) remain explicit content colors.
- Full-screen PDF, PPTX, LaTeX, map, canvas, graph, and recording viewers remain specialized surfaces rather than generic dialogs.
- Quick Capture and Command Palette are custom overlays because their interaction model differs from a form dialog, but they now use the shared focus/overlay rules.
- Server-side code and technical identifiers may still use Athena where the name is an API, file, store, or compatibility concern.

### Automated validation

- Playwright covers login, desktop shell, mobile shell, launcher search, window controls, command palette focus restoration, Quick Capture focus restoration, keyboard navigation, reduced motion, axe, and visual baselines.
- Visual baselines cover dark and light login, desktop shell, command palette, and mobile launcher.
- Semantic scan: production client source no longer uses raw Tailwind palette utility classes for UI colors; remaining explicit colors are content/data values or non-TSX assets.

---

## 12. Standard execution loop

```text
Research
  → product context
  → audit
  → Impeccable shape/critique
  → check against mavino-design
  → Apple Design interaction review
  → implementation with tokens and primitives
  → browser iteration
  → Playwright + axe
  → human design review
  → visual baseline
  → next surface
```

This process combines the useful parts of broad design-skill research with a constrained workflow designed specifically for Mavino. The goal is not to maximize the number of skills, but to give each tool one clear responsibility:

- **Impeccable** governs the design process.
- **Apple Design** governs interaction and motion quality.
- **`mavino-design`** protects product identity and project conventions.
- **Browser iteration** validates the real visual result.
- **Playwright and axe** validate behavior and accessibility.
