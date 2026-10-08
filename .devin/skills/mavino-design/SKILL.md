---
name: mavino-design
description: Apply Mavino's approved Calm Academic Workspace product and interface rules when auditing, designing, implementing, or reviewing UI.
allowed-tools:
  - read
  - grep
  - glob
  - exec
triggers:
  - user
  - model
---

# Mavino Design

Before UI work, read `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, and the relevant existing components. Treat those files as product truth.

## Product identity

Mavino is a calm, connected student workspace. Desktop supports deep spatial work; mobile supports quick sequential action. Athena is a contextual collaborator inside normal workflows, not a separate novelty chatbot.

The approved visual direction is **Calm Academic Workspace**. Use spatial design only to clarify real window, workspace, popover, and sheet relationships.

## Priority workflows

1. Understand what matters today.
2. Resume unfinished work.
3. Capture a task, note, source, or question.
4. Plan and complete study work.
5. Work with study sources and documents.
6. Ask Athena to act and understand what changed.
7. Organize parallel desktop work.
8. Review and act quickly on mobile.

## Required design behavior

- Establish hierarchy with typography, alignment, spacing, and content order before containers.
- Use semantic tokens and existing shared primitives.
- Preserve useful desktop density and touch-friendly mobile targets.
- Keep primary actions and current status obvious.
- Desktop and mobile share identity and terminology, not layout.
- Preserve the window manager, mobile navigation, PWA, and Capacitor behavior.

## Forbidden by default

Do not:

- wrap every section in a rounded card,
- add decorative gradients or gradient text,
- default to large radii,
- add a badge for ordinary metadata,
- apply universal glassmorphism,
- use raw palette colors where semantic tokens exist,
- invent a new button, input, card, dialog, banner, menu, or switch when a primitive exists,
- add shadows without an elevation role,
- add motion without informational or physical purpose,
- validate only with placeholders,
- treat mobile as stacked desktop,
- introduce shadcn, MUI, or another component system without explicit approval,
- rewrite broad unrelated surfaces in one pass.

## Accessibility checklist

- Visible `focus-visible` treatment.
- Accessible names for icon controls.
- Correct labels and descriptions for form controls.
- Dialog/sheet semantics, initial focus, containment, Escape/back dismissal, and focus restoration.
- Keyboard alternatives for drag, window management, and reordering.
- State communication beyond color.
- Minimum 44px touch target on mobile.
- Selectable reading content.
- Reduced-motion, reduced-transparency, and increased-contrast behavior.
- Text/list alternatives for required chart, canvas, and map workflows.
- Restrained live-region behavior for AI streaming.

## Motion checklist

- Immediate press feedback.
- 1:1 direct manipulation.
- Interruptible gesture-driven motion.
- Start from the current presentation value.
- Carry velocity from gesture to settling animation where relevant.
- Symmetric entry and exit paths.
- Origin-aware menus, windows, and overlays.
- Critically damped default; bounce only after momentum.
- Functional reduced-motion alternative.

## Implementation loop

1. Identify the real user workflow and current behavior.
2. Inspect related components and existing patterns.
3. Shape hierarchy and states before styling.
4. Implement with semantic tokens and primitives.
5. Run the application and inspect the exact real state.
6. Exercise desktop/mobile and keyboard/touch behavior.
7. Check realistic, long, empty, loading, error, and unavailable states.
8. Run automated verification.
9. Critique for unnecessary cards, borders, radii, gradients, blur, badges, and motion.

## Required verification

Use the narrowest relevant commands, then the full gates before completion:

```bash
bun run typecheck
bun test --cwd client
bun test --cwd server
bun run lint
bun run build
```

When Playwright coverage exists, run the relevant UI project and axe checks. Significant UI work must be inspected with browser preview at representative desktop and mobile viewports.
