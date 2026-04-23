# recipes/update-targeting.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `update-yaml.md` (stub, same endpoint) + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/targeting-and-rules.md`.

## Intent
User asks to edit a flow's targeting — change the `targetingLogic` DSL string that controls which users see the flow. Typical phrasing: "only show the announcement to admins", "target this tour at users who have connected their bank", "restrict the banner to users in the Acme org", "clear the targeting so everyone sees it again". Edits the `targetingLogic` field on the flow record (NOT in the YAML `data` blob — `targetingLogic` is a top-level flow field per `yaml-spec.md` §"Targeting block").

## Pattern
Same endpoint and body shape as `update-yaml.md` (stub), but targets a different field. Deviations:
- Body is `{ "targetingLogic": "<DSL string>" }` (not `data`). Pass empty string `""` to clear targeting — server runs a parenthesis-balance sanity check and rejects unbalanced strings (per `rest-endpoints.md` §"PUT /v1/flows/:numericFlowId"). An empty string clears cleanly; do NOT pass `null`.
- DSL syntax: `user.property('<key>') == <value>`, `user.flowStepData('<flow>', '<step>', '<field>') == <value>`, AND/OR/NOT combinators, nested parens. See `reference/targeting-and-rules.md` (when that reference is fully authored) and `yaml-spec.md` §"Targeting block" for inline examples.
- **Do not edit the `data` YAML's step-level criteria (`completionCriteria`, `startCriteria`, `visibilityCriteria`)** in this recipe — those live in the YAML and belong to `update-yaml.md`. This recipe is about the flow-level `targetingLogic` only.
- Validate the DSL client-side before sending: parenthesis balance, quoting, no trailing operators.

## API op
See `reference/operations.md` §"Flow operations" → `updateFlow` row (same row as `update-yaml.md`; `targetingLogic` is one of the fields accepted by the DTO).
- REST call: see `reference/rest-endpoints.md` §"PUT /v1/flows/:numericFlowId".
- Endpoint: `PUT https://api3.frigade.com/v1/flows/<numericFlowId>`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod. Canonical prod prompt: `"About to update flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`. In prod, flag additionally: "Changing targeting may change who sees this flow on next session." (informational, not an extra prompt.)

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.
- Source flow exists — resolve slug → numeric id.

## Minimal flow

1. Parse: `slug`, the new targeting expression (or "clear targeting"), `environment`.
2. `GET /v1/flows/<slug>` → extract numeric `id`, current `targetingLogic`.
3. Build the new DSL string. Validate client-side (parenthesis balance, quote balance). If invalid, halt with the specific syntax issue called out.
4. **Prod confirmation gate** if `environment == "prod"`. Include current targeting and proposed new targeting in the confirmation body so the user can eyeball both.
5. `PUT /v1/flows/<id>` with body `{ "targetingLogic": "<new DSL>" }` (or `""` to clear). Response handling: a `400 { message: "Unbalanced parens in targetingLogic" }` means the server's sanity check rejected the DSL — surface it.
6. Re-fetch and verify the new `targetingLogic` round-tripped (server may normalize whitespace / quotes).
7. Report success; log `update-targeting:success` with slug, id, env, old/new targeting SHAs.

## Example invocation

User: "Only show the welcome announcement to users whose `isAdmin` property is true."

Claude's actions (abbreviated):
- `GET /v1/flows/welcome-to-my-product` → id 12345, current `targetingLogic: null`.
- Build new DSL: `user.property('isAdmin') == true`.
- Client-side validate: parens balanced (there are none), single quotes balanced. OK.
- `PUT /v1/flows/12345` with `{"targetingLogic": "user.property('isAdmin') == true"}`. → 200.
- Re-fetch; confirm round-trip.
- Report with: "Announcement now shows only to users where isAdmin == true; others see nothing."

## TODO (Phase 1)
- Write the fully-authored version.
- Cross-reference `reference/targeting-and-rules.md` once it's authored (Task 14 at time of writing). Embed common DSL snippets (admin gating, plan gating, cohort gating).
- Handle pasting in a malformed DSL: surface the exact syntax error client-side before the PUT, with a fix suggestion.
- Document the "clear targeting" UX (`targetingLogic: ""` means "show to everyone eligible via rules"; vs leaving it null which server treats the same way).
- Decide whether to emit an inline "who will see this after the change?" preview (requires eval'ing the DSL against the user list — may be too expensive for v1).
