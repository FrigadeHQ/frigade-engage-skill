# recipes/update-yaml.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `promote-to-prod.md` (which does UPDATE internally) + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md`.

## Intent
User asks to edit a flow's YAML content — change copy, add/remove steps, tweak field definitions, change CTA labels, swap images, adjust completion criteria. Typical phrasing: "change the welcome announcement's title to X", "add a 4th step to my onboarding checklist", "update the NPS question copy", "rename the primary button on the tour". Edits the `data` field on the flow record; does NOT touch targeting, `active` status, or type.

## Pattern
Follows the same shape as `promote-to-prod.md` §4.2 UPDATE-path (which does an in-place content update). Deviations:
- Single-env (stays in dev or stays in prod — no cross-env orchestration).
- Endpoint is `PUT /v1/flows/:numericFlowId` (see `rest-endpoints.md`). Path takes **numeric** id, not slug — resolve via `GET /v1/flows/<slug>` first.
- Body omits fields that shouldn't change. For a pure content edit, body is `{ "data": "<new YAML string>" }` — nothing else. Preserving `name`, `description`, `targetingLogic`, `active` by omitting them.
- **Do NOT change `type`** — repurposing an ANNOUNCEMENT into a TOUR changes the YAML shape and users' state becomes orphaned. If the user asks for a type change, surface a warning and halt; suggest delete + recreate instead.
- YAML lint locally before PUT (per `create-announcement.md` Step 2's lint pattern). Server-side YAML parse failures surface as 422.
- Step `id` immutability — per `yaml-spec.md` §"Common validation gotchas", changing a step's `id` orphans users' state. Warn before applying if any `id` changed vs the current server copy.

## API op
See `reference/operations.md` §"Flow operations" → `updateFlow` row.
- REST call: see `reference/rest-endpoints.md` §"PUT /v1/flows/:numericFlowId".
- Endpoint: `PUT https://api3.frigade.com/v1/flows/<numericFlowId>`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **dangerous** in prod. Canonical prod prompt: `"About to update flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.
- Source flow exists — resolve slug → numeric id via `GET /v1/flows/<slug>`.

## Minimal flow

1. Parse: `slug`, what-to-change (copy, step count, field, CTA, etc.), `environment` (default dev).
2. `GET /v1/flows/<slug>` → extract numeric `id`, current `data` string (YAML), current `name` / `type` / `targetingLogic` (for context only — we won't change them).
3. Parse the current YAML; apply the user's requested changes; re-emit as a YAML string. Preserve step `id`s (warn if changing); preserve flow `type` (halt if the changes implicitly require a different type).
4. Lint the new YAML locally (`yaml.safe_load`).
5. **Prod confirmation gate** if `environment == "prod"`.
6. `PUT /v1/flows/<id>` with body `{ "data": "<new YAML>" }`. Response handling per `reference/errors.md` §400-array (validation) / §422 / §5xx.
7. Re-fetch and verify the `data` round-trip matches (server may normalize; accept lossless round-trip).
8. Report success; log `update-yaml:success` with slug, id, env, a content SHA. Point the user at the dashboard URL to eyeball.

## Example invocation

User: "Change the title of the first step of `welcome-to-my-product` from 'Welcome to my product' to 'Welcome aboard!'"

Claude's actions (abbreviated):
- `GET /v1/flows/welcome-to-my-product` → id 12345, current YAML.
- Parse YAML, find step `welcome-step`, change `title` to `"Welcome aboard!"`, re-emit YAML.
- Lint locally, diff it for the user: "Here's the change — applying?". (Or just apply if in dev without prompt; per `operations.md` `updateFlow` is safe in dev.)
- `PUT /v1/flows/12345` with `{"data": "<new YAML>"}`. → 200.
- Re-fetch and verify.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Interactive editing flow: show a diff before PUT for multi-field changes; confirm per edit batch.
- Step `id` collision / change handling — surface the state-orphan warning from `yaml-spec.md` §"Step `id` immutability".
- Cross-cutting: this recipe will be called from many others (e.g. `create-checklist.md` may hand off here if the user says "add another step" post-creation). Document the handoff points.
