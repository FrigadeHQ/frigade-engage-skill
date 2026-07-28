# recipes/create-form.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §FORM.

## Intent
User asks to create a form or survey — a multi-step input collection (registration, feedback, qualification, waitlist sign-up). Typical phrasing: "build a waitlist form", "add a feedback form after users complete the tour", "create a 3-question qualification form". Covers FORM flows; NPS-specific surveys go to `create-nps-survey.md` and generic multi-page surveys to `create-survey.md`.

## Pattern
Follows the same shape as `create-announcement.md` (single-POST flow create + SDK mount). Deviations:
- `type: FORM` (not ANNOUNCEMENT) on the `POST /v1/flows` body.
- YAML adds a `fields: FormField[]` array on each step — see `yaml-spec.md` §FORM fields table. Field types: `text`, `textarea`, `select`, `radio`, `checkbox`, `nps`, plus any custom key mapped via `<Frigade.Form fieldTypes={{...}}>`.
- SDK component is `<Frigade.Form>` (see `sdk-react.md` §`<Frigade.Form>`). Often wrapped in `as={Frigade.Dialog}` for a modal-style survey.
- Forms commonly use `visibilityCriteria: user.flowStepData(<flow>, <step>, <field>) == 'value'` on later steps for branching — see `yaml-spec.md` §FORM Example 2 (the demo-v2 branching form).
- Field validation lives in `fields[].pattern.value` (regex) + `fields[].pattern.message` (error text). `required: true` or `required: "<custom message>"`.

## API op
See `reference/operations.md` §"Flow operations" → `createFlow` row.
- REST call: see `reference/rest-endpoints.md` §"POST /v1/flows/".
- Endpoint: `POST https://api3.frigade.com/v1/flows/`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).

## Confirmation
Safety tag: **safe** in dev, **`steer` → dangerous** in prod. Creating a flow directly in prod is discouraged — emit the **prod steer** first (`operations.md` §"Prod is promote-only"): offer to create it in dev and promote it (`promote-to-prod.md`). Only if the user types the exact override `edit prod directly` do you fall through to the canonical prod prompt: `"About to create flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Dev private key available (or prod for prod ops).
- Host project framework is supported; otherwise halt the code-emission half.

## Minimal flow

1. Parse inputs: form `name`, `steps[]` with `fields[]` per step (each field: `id`, `type`, `label`, `required?`, `pattern?`, `options?` for select/radio). Do not set a slug -- Frigade generates it on create; capture the returned `flow_...` slug from the response and use it for wiring.
2. Build YAML per `yaml-spec.md` §FORM (Example 1 is the dashboard default multi-field form; Example 2 covers branching with `visibilityCriteria`).
3. Lint YAML locally, then `POST /v1/flows/` with `type: FORM`.
4. Framework-detect + install `@frigade/react` (inherit Steps 4–5 from `create-announcement.md`).
5. Ensure `<Frigade.Provider>` is mounted.
6. Mount `<Frigade.Form flowId="<slug>" />` in the app shell; surface `as={Frigade.Dialog}` + `dismissible` props if user asked for modal rendering.
7. Env hygiene + ask-to-start-dev-server.
8. Report success; log `create-form:success`.

## Example invocation

User: "Create a 3-question qualification form — ask for company size (dropdown with 1-10/20-100/100+), industry (select), and name (text input)."

Claude's actions (abbreviated):
- Parse 3 fields → single-step form with `fields: [{id: company-size, type: select, options: [...]}, {id: industry, type: select, ...}, {id: name, type: text, required: true}]`.
- Build YAML per `yaml-spec.md` §FORM; default `primaryButton: { title: "Submit" }` on the step.
- POST /v1/flows with `type: FORM`.
- Install, wire provider, mount `<Frigade.Form flowId="flow_frm78ef9" />` in app shell.
- Report.

## TODO (Phase 1)
- Write the fully-authored version after dogfood.
- Worked example that exercises branching (`visibilityCriteria`).
- Guidance for `as={Frigade.Dialog}` vs inline Form; when to emit `dismissible`.
- Custom field-type handoff: document the pattern for wiring user-provided components through `fieldTypes={{...}}` — `yaml-spec.md` §FORM Example 2 shows `movie-typeahead` / `mandatory-video` / `custom-typeahead` as custom types.
