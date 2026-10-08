# Mavino Product

## Product promise

Mavino is a student workspace that turns scattered academic work into one calm, connected place to understand what matters, make progress, and return to unfinished work.

It is not an operating-system imitation for its own sake. The desktop shell supports deep, parallel work; the mobile shell supports quick orientation and action. Athena connects workflows and context instead of living as a separate chatbot.

## Primary users

- Secondary-school and university students managing courses, deadlines, source material, and independent study.
- Students who benefit from one workspace across planning, writing, revision, files, and AI assistance.
- New users who need an obvious next step and experienced users who need dense, keyboard-friendly workflows.

## Priority workflows

1. Understand what needs attention today.
2. Continue recently active work with minimal reconstruction.
3. Capture a task, note, source, or question quickly.
4. Plan and complete study work.
5. Work with notes, files, documents, and learning sources.
6. Ask Athena to act within the current workspace and verify what it changed.
7. Organize parallel work across windows and workspaces on desktop.
8. Review, capture, and take quick action one-handed on mobile.

## Platform roles

### Desktop

A spatial workspace for deep and parallel work. Windows, workspaces, keyboard shortcuts, drag and drop, and information-dense tools are first-class. Spatial behavior must improve continuity and recall rather than merely resemble a desktop OS.

### Mobile

A sequential, touch-first companion centered on Today, quick capture, tasks, calendar, and Athena. Mobile shares identity and behavior with desktop but does not reproduce desktop window layouts.

### PWA and native

The web, PWA, and Capacitor builds are one product. Safe areas, browser and hardware back, virtual keyboards, offline/update states, and install behavior are product requirements.

## Athena's role

Athena is a contextual collaborator that can explain, organize, create, navigate, and operate Mavino tools. It must:

- use the user's real workspace context,
- distinguish suggestions from completed actions,
- expose tool progress and failures clearly,
- preserve user agency and make consequential actions reviewable,
- move users into normal product workflows rather than trap them in chat.

## Product principles

- Orientation before options: every primary surface reveals what matters and what to do next.
- Calm does not mean empty: preserve useful density while removing visual noise.
- Progressive disclosure: common paths are visible; advanced controls are nearby, not mixed into every state.
- One product language: shared terminology, hierarchy, states, and interaction rules across applications.
- Platform-appropriate composition: desktop is spatial; mobile is sequential.
- User agency: predictable back paths, undo where practical, confirmation only for consequential irreversible actions.
- Real status: loading, offline, integration, AI, success, and error states describe what is happening and what the user can do.

## Voice and terminology

- Clear, direct, supportive, and specific.
- Use action labels such as “Create task” rather than “Continue”.
- Avoid marketing copy inside working surfaces.
- Avoid infantilizing students or presenting AI as infallible.
- Use “Mavino” for the product and “Athena” only where retained as the assistant's explicit feature name; do not alternate names accidentally.
- Errors explain the problem and a recovery action when one exists.

## Constraints

- Preserve the desktop window manager, mobile navigation model, PWA, and Capacitor behavior.
- Meet WCAG 2.2 AA for primary workflows.
- Support keyboard, pointer, touch, reduced motion, increased contrast, and reduced transparency.
- Do not introduce a parallel component framework without explicit approval.
- Do not require decorative animation, blur, gradients, or large radii for product identity.

## Success criteria

- A new user can identify Mavino's purpose and next action within seconds.
- Today, capture, task planning, and return-to-work workflows require fewer decisions.
- Desktop users can complete window-management workflows with pointer or keyboard.
- Mobile primary workflows are reachable and usable one-handed.
- Athena action status and results are understandable without reading internal tool details.
- Critical workflows pass automated accessibility, keyboard, responsive, and visual regression checks.
