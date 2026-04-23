# recipes/create-survey.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `create-form.md` (stub) + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §FORM.

## Intent
User asks to create a generic survey — a multi-question feedback collector (not NPS-specific). Typical phrasing: "build a user-research survey", "create a 5-question product-feedback survey", "add a post-tour feedback survey". For NPS-style 0-10 rating, use `create-nps-survey.md` instead; this recipe is for multi-question structured feedback with mixed field types.

## Pattern
Follows the same shape as `create-form.md` (stub) — a SURVEY is structurally a FORM with a dedicated `FlowType` for analytics distinction. Deviations from `create-form.md`:
- `type: SURVEY` (not FORM, not NPS_SURVEY) on the `POST /v1/flows` body. `SURVEY` is a distinct `FlowType` per `yaml-spec.md` §FlowType enum.
- YAML shape is identical to FORM — `steps[]` with `fields[]` per step. All the same field types (`text`, `textarea`, `select`, `radio`, `checkbox`).
- SDK component: `<Frigade.Form>` — there is no separate `<Frigade.Survey>` component for generic surveys (only `<Frigade.Survey.NPS>` for NPS). Typically wrapped in `as={Frigade.Dialog}` for modal rendering.
- Defaults: `dismissible: true` at flow-level `props`; multi-step typical (cover topic groups per step — e.g. "feelings" → "product use" → "demographics").
- Analytics distinction: SURVEY shows up in Frigade's dashboard analytics differently from FORM (separate funnel category). Prefer SURVEY for user-research / feedback; FORM for input-collection / registration / qualification.

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

1. Parse inputs: survey `name`, a list of questions → `steps[]` with `fields[]` per step (each field: `id`, `type`, `label`, `required?`, `options?`). Derive `slug`; collision-check.
2. Build YAML per `yaml-spec.md` §FORM (structurally identical to FORM). Common pattern:
   ```yaml
   props:
     dismissible: true
   steps:
     - id: question-1
       title: <q1>
       fields: [{ id, type, label, options?, required? }]
       primaryButton: { title: "Next" }
     - id: question-2
       title: <q2>
       fields: [...]
       primaryButton: { title: "Submit" }  # last step
   ```
3. Lint YAML locally, then `POST /v1/flows/` with `type: SURVEY`.
4. Framework-detect + install `@frigade/react` (inherit).
5. Ensure `<Frigade.Provider>` is mounted.
6. Mount `<Frigade.Form flowId="<slug>" as={Frigade.Dialog} dismissible />` — or without `as` for an inline survey.
7. Env hygiene + ask-to-start-dev-server.
8. Report success; log `create-survey:success`.

## Example invocation

User: "Build a 3-question post-tour feedback survey — ask 'Was the tour helpful?' (yes/no), 'What was confusing?' (textarea), 'Rate the overall experience' (1-5 radio)."

Claude's actions (abbreviated):
- Parse 3 questions → 3-step survey with mixed `radio` / `textarea` / `radio` fields.
- Build YAML per `yaml-spec.md` §FORM with `type: SURVEY` on the wire-level record.
- POST /v1/flows.
- Install, wire provider, mount `<Frigade.Form flowId="post-tour-feedback" as={Frigade.Dialog} dismissible />` in app shell.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Worked example with branching via `visibilityCriteria` (e.g. ask the "what was confusing" question only if the user said "no" to "was the tour helpful").
- Decision doc: when to use SURVEY vs FORM vs NPS_SURVEY (analytics funneling implications; user mental model).
- Should this recipe and `create-form.md` share a stub? Revisit in Phase 1 — they may collapse to one recipe parameterized by `type`.
