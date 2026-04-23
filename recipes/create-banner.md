# recipes/create-banner.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §BANNER.

## Intent
User asks to create a banner — a persistent strip (top or bottom of the page/container) with a title, subtitle, and optional CTA. Typical phrasing: "add a banner about the new pricing", "create a top-of-page banner announcing X", "add a promo strip". Single-step flows are the norm; banners tend to be simpler than announcements (no multi-page wizard shape).

## Pattern
Follows the same shape as `create-announcement.md` — single-POST flow create + SDK mount. Deviations:
- `type: BANNER` (not ANNOUNCEMENT) on the `POST /v1/flows` body.
- YAML uses the shared step shape (just `steps[]`; typically 1 step). See `yaml-spec.md` §BANNER.
- SDK component is `<Frigade.Banner>` (see `sdk-react.md` §`<Frigade.Banner>`). Renders as a horizontal strip, not a modal.
- Banners often have no buttons at all — a built-in close X dismisses them. For an outbound link, use the shared `secondaryButton` with `action: false, uri, target: _blank` pattern.
- Semantics: on a dismiss CTA, consider `action: flow.skip` (marks state "skipped" for analytics) vs the default `step.complete` (marks "completed"). See `yaml-spec.md` §BANNER fields note.
- Placement (top vs bottom) is a **rendering** choice on the React component, not in the YAML — typically handled by where you mount `<Frigade.Banner>` in the layout tree.

## API op
See `reference/operations.md` §"Flow operations" → `createFlow` row.
- REST call: see `reference/rest-endpoints.md` §"POST /v1/flows/".
- Endpoint: `POST https://api3.frigade.com/v1/flows/`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod. Canonical prod prompt: `"About to create flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Dev private key available (or prod for prod ops).
- Host project framework is supported.

## Minimal flow

1. Parse inputs: banner `title`, `subtitle`, optional `primaryButton` / `secondaryButton`, optional `placement: "top" | "bottom"` (used to decide mount site). Derive `slug`; collision-check.
2. Build YAML per `yaml-spec.md` §BANNER (Example 1 is the dashboard default; Example 2 is the live demo banner chained after a tour via `targetingLogic`). Typically a single step.
3. Lint YAML locally, then `POST /v1/flows/` with `type: BANNER`.
4. Framework-detect + install `@frigade/react` (inherit).
5. Ensure `<Frigade.Provider>` is mounted.
6. Mount `<Frigade.Banner flowId="<slug>" />` in the appropriate layout site — top of `<body>` for a top banner, bottom for a bottom banner. In App Router, wrap in a `'use client'` component if not already in one.
7. Env hygiene + ask-to-start-dev-server.
8. Report success; log `create-banner:success`.

## Example invocation

User: "Add a top-of-page banner announcing our new enterprise plan — 'Enterprise is live!' with a 'Learn more' CTA that opens /enterprise in the current tab."

Claude's actions (abbreviated):
- Parse title `"Enterprise is live!"`, CTA title `"Learn more"` → slug `enterprise-is-live`, single-step banner.
- Build YAML with 1 step: `{id, title, subtitle, primaryButton: { title: "Learn more", action: false, uri: "/enterprise", target: _self }}`.
- POST /v1/flows with `type: BANNER`.
- Install, wire provider, mount `<Frigade.Banner flowId="enterprise-is-live" />` at the top of `app/layout.tsx` body.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Worked example that exercises placement decision (top vs bottom, monorepo shared layout vs page-scoped).
- Decision doc: when to use `action: flow.skip` vs `step.complete` on dismiss CTA; analytics implications.
- Interaction with `targetingLogic` (e.g. "show banner only after tour X completes") — cross-link to `targeting-and-rules.md` once that reference exists.
