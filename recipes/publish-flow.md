# recipes/publish-flow.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `promote-to-prod.md` (which ends in an activate call) + `reference/operations.md` + `reference/rest-endpoints.md`.

## Intent
User asks to publish (activate) a flow — move a flow from draft status to active status so users start seeing it. Typical phrasing: "publish the welcome announcement", "make `welcome-tour` live", "activate the NPS survey in prod", "launch the checklist". Related op: `deactivateFlow` (the inverse: "unpublish X", "turn off Y in prod") — covered by the same recipe.

## Pattern
Follows the same shape as `promote-to-prod.md` Step 4.1 Call 2 (the activate call) + Step 4.2 Call 2 (the conditional deactivate). Deviations:
- Single-env (no cross-env orchestration).
- Two distinct endpoints depending on direction:
  - **Publish (activate)** — `PUT /v1/flows/<id>/activate` with body `{ "archiveBehavior": "EXIT_EXISTING_USERS" | "RESTART_EXISTING_USERS" | "RESTART_ALL_USERS" }`. Defaults to `EXIT_EXISTING_USERS` (safest — doesn't re-target users who've already seen the flow). Requires the flow id to be a **draft**; firing against an already-active flow or one with no draft returns 500.
  - **Unpublish (deactivate)** — `PUT /v1/flows/<id>` with body `{ "active": false }`. Per `rest-endpoints.md` §"PUT /v1/flows/:numericFlowId" + `operations.md` §`deactivateFlow`. There is no `/deactivate` endpoint (see `rest-endpoints.md` §GAPS "Publish / unpublish flow as distinct ops").
- Path takes **numeric** id (not slug); resolve via `GET /v1/flows/<slug>`.
- In prod this matters — users will start or stop seeing the flow on their next session. Emit the specific prod-prompt wording (publish vs deactivate).

## API op
See `reference/operations.md` §"Flow operations".
- Publish: `activateFlow (publish draft)` → `PUT /v1/flows/:id/activate` (see `rest-endpoints.md` §"PUT /v1/flows/:id/activate").
- Unpublish: `deactivateFlow (set active:false)` → `PUT /v1/flows/:numericFlowId` with `{"active":false}` (see `rest-endpoints.md` §"PUT /v1/flows/:numericFlowId").
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod for both publish and deactivate (per `operations.md`).
- Publish canonical prompt: `"About to publish flow '<slug>' in prod. Users matching the targeting rules will begin seeing it. Confirm? (y/n)"`.
- Deactivate canonical prompt: `"About to deactivate flow '<slug>' in prod. Users will stop seeing it on next session. Confirm? (y/n)"`.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.
- Source flow exists and — for publish — is a draft; for deactivate, is currently active. Verify with `GET /v1/flows/<slug>` before proceeding.

## Minimal flow

**Publish path:**

1. Parse `slug`, `environment`, optional `archiveBehavior` (default `EXIT_EXISTING_USERS`).
2. `GET /v1/flows/<slug>` → extract numeric `id`, current `status`. If `status != DRAFT`, halt: "Flow is already `<status>`; nothing to publish."
3. Prod confirmation if env is prod.
4. `PUT /v1/flows/<id>/activate` with body `{"archiveBehavior": "<value>"}`. Expect 200.
5. Re-fetch to verify `status == ACTIVE`, `active == true`.
6. Report success; log `publish-flow:success`.

**Deactivate path:**

1. Parse `slug`, `environment`.
2. `GET /v1/flows/<slug>` → extract numeric `id`, current `active`. If already `active: false`, halt: "Flow is already inactive."
3. Prod confirmation if env is prod.
4. `PUT /v1/flows/<id>` with body `{"active": false}`. Expect 200.
5. Re-fetch to verify `active == false`.
6. Report success; log `publish-flow:deactivate-success`.

## Example invocation

User: "Publish the welcome announcement in prod."

Claude's actions (abbreviated):
- `GET /v1/flows/welcome-to-my-product` (with prod key) → id 555001, status DRAFT.
- Confirmation: `About to publish flow 'welcome-to-my-product' in prod. Users matching the targeting rules will begin seeing it. Confirm? (y/n)`. User: `y`.
- `PUT /v1/flows/555001/activate` with `{"archiveBehavior": "EXIT_EXISTING_USERS"}`. → 200.
- Re-fetch; confirm active.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Handle the `archiveBehavior` choice: default `EXIT_EXISTING_USERS` is safest, but `RESTART_EXISTING_USERS` / `RESTART_ALL_USERS` matter for tours/announcements where the user wants to re-show the flow to existing users. Offer the 3 options explicitly when the user says "relaunch" / "re-show".
- Batch publishing ("publish these 3 flows in prod") — wrap in one batch confirmation per `operations.md` §"Batch confirmations".
- Error handling for "activate on a flow with no draft" (500 per `rest-endpoints.md`) — surface as "no draft found for <slug>; create one first with `duplicate-flow.md` Variant B".
