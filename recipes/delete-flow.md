# recipes/delete-flow.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `reset-user.md` (simpler destructive op pattern) + `reference/operations.md` + `reference/rest-endpoints.md`.

## Intent
User asks to delete a flow — remove a specific flow version from Frigade. Typical phrasing: "delete the welcome tour", "remove `welcome-to-my-product` from dev", "clean up the test flow I made earlier". Destructive regardless of environment per `operations.md` — the `deleteFlow` row is `dangerous` in both dev and prod.

## Pattern
Follows the same shape as `reset-user.md` (confirm-then-delete, simple destructive op). Key deviations:
- Endpoint is `DELETE /v1/flows/:numericFlowId` (not `DELETE /v1/userFlowStates/...`).
- Path takes the **numeric** flow id, not the slug (per `rest-endpoints.md` §"DELETE /v1/flows/:numericFlowId"). Slug-to-id resolution is required: `GET /v1/flows/<slug>` → extract `id`.
- **Deletes only the specific version**, not the slug. Other versions sharing the same slug remain. `FlowResponse` rows referencing the deleted flow become orphan history — they are NOT cascade-deleted.
- If the flow is mounted in the host codebase, the `<Frigade.Announcement flowId="<slug>">` / `<Frigade.Tour flowId="<slug>">` tag will start silently failing (SDK 404s on the flow fetch). Optionally offer to also clean up the mount site as a follow-up — but don't chain destructive code edits into a destructive API op without user opt-in.

## API op
See `reference/operations.md` §"Flow operations" → `deleteFlow` row.
- REST call: see `reference/rest-endpoints.md` §"DELETE /v1/flows/:numericFlowId".
- Endpoint: `DELETE https://api3.frigade.com/v1/flows/<numericFlowId>`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **dangerous in both dev and prod** (destructive regardless of env). Canonical prompt per `operations.md` §"Flow delete": `"About to delete flow '<slug>' (version <n>) in <env>. This cannot be undone. Confirm? (y/n)"`. **Always** confirm, even in dev — no silent escalation.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for the target env available.
- Source flow exists — resolve slug → numeric id via `GET /v1/flows/<slug>`.

## Minimal flow

1. Parse `slug` + optional `version` (default: the version returned by `GET /v1/flows/<slug>` without the `version` query param, i.e. the currently-active version). Parse `environment` (default `dev`).
2. `GET /v1/flows/<slug>` → extract numeric `id` + `version`. If 404, halt: "No flow with slug `<slug>` in `<env>`. Nothing to delete."
3. **Canonical delete confirmation** (always — dev and prod): `"About to delete flow '<slug>' (version <version>) in <env>. This cannot be undone. Confirm? (y/n)"`. Wait for explicit `y` / `yes`.
4. `DELETE /v1/flows/<numericFlowId>` with the right env key. Response: `204 No Content` on success.
5. Error handling per `reference/errors.md`:
   - `404` → already gone; treat as success (idempotent). Log and move on.
   - `401` / `403` → halt and route to `first-run-setup.md` Section 2.7 for key re-verification.
   - `5xx` → retry once, then halt with timestamp.
6. Optionally offer to clean up the mount site in the host codebase (search for `flowId="<slug>"` usages; ask "Delete the mount at `<file>:<line>` too? (y/n)"). Don't chain automatically.
7. Report success; log `delete-flow:success` event with slug, version, env.

## Example invocation

User: "Delete the welcome tour — I want to start over with a new slug."

Claude's actions (abbreviated):
- Resolve `welcome-tour` → id 12346 via `GET /v1/flows/welcome-tour`.
- Confirmation: `About to delete flow 'welcome-tour' (version 1) in dev. This cannot be undone. Confirm? (y/n)`. User: `y`.
- `DELETE /v1/flows/12346` → 204.
- Offer: "Found mount at `app/app-flows.tsx:7` — delete it too? (y/n)". Act on response.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Handle "delete all versions of a slug" — iterate `GET /v1/flows/<slug>/versions`, DELETE each. Batch confirmation per `operations.md`.
- Handle mount-site cleanup as an explicit batch confirmation step (list all usages, one prompt per recipe invocation, then edit).
- Partial-failure template: mount cleanup fails after API delete succeeds — flow is gone upstream, mount is stale. Surface clearly.
