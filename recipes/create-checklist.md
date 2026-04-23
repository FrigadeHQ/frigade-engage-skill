# recipes/create-checklist.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §CHECKLIST.

## Intent
User asks to create a checklist — an ordered (or unordered) list of completion-tracked tasks that persists across sessions. Typical phrasing: "build an onboarding checklist", "create a getting-started list of tasks", "add a 4-step setup checklist for new users". Classic product-onboarding primitive.

## Pattern
Follows the same shape as `create-announcement.md` (single-POST flow create + SDK mount). Deviations:
- `type: CHECKLIST` (not ANNOUNCEMENT) on the `POST /v1/flows` body.
- YAML accepts **root-level** `title` + `subtitle` + `sequential` keys (checklist-only; see `yaml-spec.md` §CHECKLIST fields) plus `steps[]` — announcements only use `steps[]`.
- SDK component is `<Frigade.Checklist.Collapsible>` or `<Frigade.Checklist.Carousel>` or `<Frigade.Checklist.Floating>` (see `sdk-react.md` §`<Frigade.Checklist>`). Default to `Collapsible` unless the user said "carousel" / "floating" / "attached to X".
- Checklist steps commonly set `completionCriteria` (auto-complete on a user property) or `startCriteria` (lock step until prior step done) — see `yaml-spec.md` §CHECKLIST Example 2. Announcements rarely do.
- `iconUri` is a carousel-only field — don't emit for collapsible.
- Checklist steps often have NO `primaryButton` at all (completion driven by in-product event via `step.complete()` in React).

## API op
See `reference/operations.md` §"Flow operations" → `createFlow` row.
- REST call: see `reference/rest-endpoints.md` §"POST /v1/flows/".
- Endpoint: `POST https://api3.frigade.com/v1/flows/`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod (same as all `createFlow` calls — see `operations.md` row). Canonical prod prompt: `"About to create flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Dev private key available (or prod for prod ops).
- Host project is a supported framework (Next App/Pages Router, or Vite/CRA plain React); otherwise halt the code-emission half per `create-announcement.md` Step 4.

## Minimal flow

1. Parse inputs: checklist `title`, `subtitle`, `sequential?` flag, and a `steps[]` array (each with `id`, `title`, `subtitle`, optional `primaryButton`, optional `completionCriteria`). Derive `slug` from title; collision-check via `GET /v1/flows/<slug>`.
2. Build YAML per `yaml-spec.md` §CHECKLIST (Example 1 is the canonical dashboard template — 4 steps with `iconUri` for carousel; Example 2 shows `startCriteria` branching).
3. Lint YAML locally, then `POST /v1/flows/` with `type: CHECKLIST`.
4. Framework-detect and install `@frigade/react` (inherit Steps 4–5 from `create-announcement.md`).
5. Ensure `<Frigade.Provider>` is mounted (Step 6 inherit).
6. Mount `<Frigade.Checklist.Collapsible flowId="<slug>" />` (or `.Carousel` / `.Floating` per user ask) in the app shell (Step 7 pattern).
7. Env hygiene + ask-to-start-dev-server (Steps 8–9 inherit).
8. Report success with dashboard URL + mount path; log `create-checklist:success` to `.frigade/skill.log`.

## Example invocation

User: "Build me a 4-step onboarding checklist — 'Getting started' — that walks new users through connecting their account, inviting a teammate, creating their first project, and reviewing the tutorial."

Claude's actions (abbreviated):
- Parse title `"Getting started"` → slug `getting-started`; 4 steps as described.
- Build YAML with root-level `title: "Getting started"` + 4 `steps[]` entries, each with `id`, `title`, `subtitle`, default `primaryButton: { title: "Mark complete" }`.
- POST /v1/flows with `type: CHECKLIST`; extract new id + slug.
- Install `@frigade/react`, wire provider, mount `<Frigade.Checklist.Collapsible flowId="getting-started" />` in app shell.
- Report.

## TODO (Phase 1)
- Write the fully-authored version after dogfood surfaces edge cases.
- Include at least one worked example end-to-end, like `create-announcement.md` §Worked example.
- Flesh out: layout decision tree (Collapsible vs Carousel vs Floating — when to pick which), `sequential` default guidance, common `completionCriteria` / `startCriteria` patterns from `yaml-spec.md` §CHECKLIST Example 2, and the "no primaryButton = completion driven by React `step.complete()`" handoff.
