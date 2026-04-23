# recipes/create-card.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §CARD.

## Intent
User asks to create an inline card — a UI component card that lives **inside** the product (sidebar tip, inline setup nudge, in-page promo). Typical phrasing: "add a card in the sidebar promoting X", "create an inline setup card", "drop a promo card on the dashboard". Structurally similar to a banner but rendered as a card shape rather than a horizontal strip; mount site is usually page-scoped rather than app-layout-scoped.

## Pattern
Follows the same shape as `create-announcement.md`. Deviations:
- `type: CARD` (not ANNOUNCEMENT) on the `POST /v1/flows` body.
- YAML uses the shared step shape (just `steps[]`, typically 1 step). See `yaml-spec.md` §CARD. Minimal cards have only `title` + `subtitle` with no buttons.
- SDK component is `<Frigade.Card>` (see `sdk-react.md` §`<Frigade.Card>`). Card has optional **sub-parts**: `<Frigade.Card.Header>`, `.Media`, `.Title`, `.Subtitle`, `.Footer`, `.Primary`, `.Secondary` — this recipe emits the default tree unless the user asked for a custom layout.
- Default placement: **page-scoped**, not layout-scoped. Most users want a card on a specific page (e.g. the dashboard). Default mount site is `app/<route>/page.tsx` or `pages/<route>.tsx`. If the user says "on every page", fall back to layout-scoped like banners.
- Cards are inline (they flow with the page content), not overlay. No `as={Frigade.Dialog}` pattern for cards.

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
- **Placement target known.** Ask the user: "Which page should the card appear on?" if not clear from the prompt (rare to want an app-wide card).

## Minimal flow

1. Parse inputs: card `title`, `subtitle`, optional buttons, **placement** (which page / component the card goes on). Derive `slug`; collision-check.
2. Build YAML per `yaml-spec.md` §CARD (Example 1 is the dashboard default — title + subtitle + single button; Example 2 shows a truly minimal card with no buttons at all).
3. Lint YAML locally, then `POST /v1/flows/` with `type: CARD`.
4. Framework-detect + install `@frigade/react`.
5. Ensure `<Frigade.Provider>` is mounted.
6. Mount `<Frigade.Card flowId="<slug>" />` in the target page/component. Default tree:
   ```tsx
   <Frigade.Card flowId="<slug>">
     <Frigade.Card.Header dismissible />
     <Frigade.Card.Media />
     <Frigade.Card.Title />
     <Frigade.Card.Subtitle />
     <Frigade.Card.Footer>
       <Frigade.Card.Secondary />
       <Frigade.Card.Primary />
     </Frigade.Card.Footer>
   </Frigade.Card>
   ```
7. Env hygiene + ask-to-start-dev-server.
8. Report success; log `create-card:success`.

## Example invocation

User: "Drop a card on the dashboard promoting the new AI feature — 'Try AI-powered analytics' with a 'Learn more' button linking to /ai."

Claude's actions (abbreviated):
- Ask confirm: "Mount on `app/dashboard/page.tsx`?" (if unambiguous, skip the ask).
- Parse title → slug `try-ai-powered-analytics`, single-step card with primary CTA.
- Build YAML per §CARD Example 1.
- POST /v1/flows with `type: CARD`.
- Install, wire provider, mount card tree in `app/dashboard/page.tsx`.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Sub-part decision tree: when to use `<Frigade.Card.Media>` vs skip it; when to split into a custom layout using `Card.Primary` / `Card.Secondary` directly.
- Placement disambiguation flow: default to asking "which page" when the user doesn't name one, vs app-wide card fallback.
- Worked example where the card replaces a hardcoded promo component in the target page.
