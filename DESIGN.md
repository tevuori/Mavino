# Mavino Design

## Approved direction

Mavino uses **Calm Academic Workspace**: a quiet, highly readable interface with deliberate density, restrained materials, and clear study-oriented hierarchy.

Spatial behavior from **Spatial Student OS** is used only where it communicates real relationships: windows, workspaces, taskbar destinations, popovers, and mobile sheets. It is an interaction model, not a second visual style.

Editorial principles may remove unnecessary containers and strengthen content hierarchy, but must not introduce a separate typography system.

## Desired feeling

Calm, capable, focused, and trustworthy. Delight comes from clarity, continuity, and craft—not decorative effects.

## Composition

- Use typography, alignment, spacing, and dividers before adding a container.
- Canvas establishes the workspace; surfaces establish functional layers.
- Do not wrap every section in a card.
- Keep the primary action and current status visible.
- Desktop may be dense when the task benefits from comparison or scanning.
- Mobile presents a clear sequence with thumb-reachable primary actions.

## Semantic color roles

Every role has light and dark values:

- `canvas`: product or application background.
- `surface`: ordinary content surface.
- `surface-raised`: cards and controls requiring separation.
- `surface-overlay`: menus, dialogs, sheets, and floating chrome.
- `surface-sunken`: wells, tracks, and embedded regions.
- `text-primary`, `text-secondary`, `text-tertiary`, `text-disabled`, `text-inverse`.
- `border-subtle`, `border-default`, `border-strong`.
- `accent`, `accent-hover`, `accent-pressed`, `accent-soft`, `on-accent`.
- `focus-ring`.
- `success`, `warning`, `danger`, `info` and soft/background counterparts.
- `scrim`.

Raw palette colors remain valid only for intrinsically colored content such as user-picked colors, charts, syntax, maps, file types, and annotation colors.

## Typography

Use one primary sans family across shell and applications. The current system-first stack remains the baseline. A display face must not divide mobile and desktop identity.

Roles:

- `display`: rare onboarding or empty-state statement.
- `page-title`: primary page or app title.
- `section-title`: navigable content group.
- `body`: normal reading and controls.
- `body-compact`: dense desktop lists and toolbars.
- `label`: form and navigation labels.
- `metadata`: supporting status, timestamps, and counts.
- `numeric`: tabular statistics, grades, duration, and time.
- `code`: technical content only.

Large text uses tighter tracking; small text never relies on low contrast to appear secondary.

## Spacing and density

Use a constrained 4px-based scale. Prefer `4, 8, 12, 16, 24, 32, 48` for layout decisions.

- Compact desktop controls: 28–32px where pointer precision is expected.
- Standard controls: 36–40px.
- Touch controls: at least 44px target size.
- Dense data views may reduce visual height but retain accessible target expansion where possible.

## Radius

- Small control: 6px.
- Standard control: 8px.
- Panel/window: 10–12px.
- Overlay/sheet: 12–16px where separation requires it.
- Pill: only for tags, statuses, segmented controls, and genuinely pill-shaped actions.

Avoid 24px+ radii as a default product signature.

## Elevation and materials

- Level 0: canvas; no shadow.
- Level 1: separated surface; border or minimal shadow, usually not both strongly.
- Level 2: window or raised panel.
- Level 3: popover/menu.
- Level 4: modal/sheet with scrim.

Translucency is reserved for floating shell chrome and overlays where underlying context remains useful. Do not stack translucent surfaces. Reduced-transparency mode uses opaque surfaces.

## Components

All shared interactive primitives cover relevant default, hover, active, focus-visible, disabled, loading, selected, destructive, error, and touch states.

Do not create a new local button, input, card, dialog, banner, menu, or switch when a shared primitive satisfies the behavior. A shared `Surface` is not permission to card-wrap every section.

## Desktop shell

- Active and inactive windows must be distinguishable without making inactive content illegible.
- Window controls retain familiar placement and have accessible names.
- Drag and resize track 1:1; motion never delays direct manipulation.
- Window opening originates from the initiating surface when technically practical.
- Minimize travels toward its taskbar destination when practical.
- Workspaces expose location, destination, and a keyboard alternative.
- Taskbar separates start/workspaces, applications, and system status.

## Mobile shell

- Home answers “what matters now?” before presenting the full app catalog.
- Bottom navigation contains stable primary destinations.
- Sheets have one predictable dismissal model, a close/back alternative, focus management, and hardware/browser back support.
- Primary controls are thumb-reachable and at least 44px.
- The virtual keyboard must not hide the active field or commit action.
- Mobile is not stacked desktop and does not inherit desktop-only density.

## Motion

Motion communicates causality, destination, hierarchy, or state.

- Press feedback begins immediately on pointer/touch down.
- Direct manipulation tracks 1:1 and remains interruptible.
- Default UI motion is critically damped with no ornamental bounce.
- Momentum-driven gestures may use slight velocity-aware overshoot.
- Entry and exit paths are symmetric.
- Popovers originate from their trigger; sheets enter and leave through the same edge.
- Reduced motion replaces spatial movement with short crossfades or immediate state changes.
- Reduced transparency removes blur; increased contrast strengthens opaque backgrounds and borders.

## Accessibility

- Target WCAG 2.2 AA for primary workflows.
- Use visible `:focus-visible` states; never remove outline without replacement.
- Dialogs and sheets manage initial focus, focus containment, Escape/back dismissal, and focus restoration.
- Icon-only buttons have accessible names.
- Status is never communicated by color alone.
- Drag interactions have non-drag alternatives.
- Charts, canvas, and maps expose equivalent text/list information for required workflows.
- AI streaming uses restrained live regions and does not repeatedly steal focus.
- Text remains selectable in content; only shell chrome and direct-manipulation handles disable selection.

## Anti-patterns

- A rounded card around every section.
- Decorative gradients or gradient text in working UI.
- Universal glassmorphism.
- Large radii as a substitute for identity.
- Badges for ordinary metadata.
- Shadows without an elevation role.
- Raw palette colors for standard semantic states.
- Motion without physical or informational purpose.
- Placeholder-only validation.
- Mobile layouts produced by vertically stacking desktop panels.
- New component frameworks or ad hoc primitive families.

## Browser and verification requirements

For every meaningful surface:

1. Inspect the real state in the running application.
2. Check desktop and mobile composition where applicable.
3. Check light and dark themes.
4. Exercise pointer, keyboard, touch, and back/dismiss behavior.
5. Check realistic, long, empty, loading, error, and unavailable states.
6. Run relevant typecheck, tests, lint, build, Playwright, and axe checks.
