# recipes/create-nps-survey.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `create-announcement.md` + `reference/operations.md` + `reference/rest-endpoints.md` + `reference/yaml-spec.md` §NPS_SURVEY.

## Intent
User asks to create an NPS (Net Promoter Score) survey — a rating question ("how likely are you to recommend…") followed by an optional free-text follow-up. Typical phrasing: "add an NPS survey after checkout", "build an NPS with a 0-10 scale", "create a customer-satisfaction survey with emoji faces". Variant of FORM with `type: nps` as the first field.

## Pattern
Follows the same shape as `create-announcement.md`. Deviations:
- `type: NPS_SURVEY` on the `POST /v1/flows` body. (Note: `NPS_SURVEY` is a distinct `FlowType` per `yaml-spec.md` §FlowType enum — not the same as `SURVEY` or `FORM`.)
- YAML structure is a **FORM-shaped** flow where the first step has an `nps`-typed field. See `yaml-spec.md` §NPS_SURVEY Example 1 (default 0-10 scale) and Example 2 (emoji scale via `props.options` at flow-level).
- SDK component is `<Frigade.Survey.NPS>` (see `sdk-react.md` §`<Frigade.Survey.NPS>`). Not `<Frigade.Form>` — the NPS variant has its own dedicated component that knows how to render the scale.
- Defaults: numeric 0-10 scale, `positiveLabel: "Extremely likely"`, `negativeLabel: "Not likely at all"`, `dismissible: true` at flow-level `props`. For an emoji / custom scale, emit `props.options: [{label, value}, ...]` at the flow level (not per-field).
- First step auto-advances on NPS selection (no `primaryButton` on the NPS step). Follow-up textarea step has a `Submit` button.

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

1. Parse inputs: NPS `question` ("how likely...?"), follow-up prompt ("why did you choose this rating?"), optional scale override (default 0-10 numeric; emoji or custom via `props.options`). Derive `slug`; collision-check.
2. Build YAML per `yaml-spec.md` §NPS_SURVEY. Default template:
   ```yaml
   props:
     dismissible: true
   steps:
     - id: nps-score-page
       title: <question>
       fields:
         - id: nps-score
           type: nps
           positiveLabel: "Extremely likely"
           negativeLabel: "Not likely at all"
     - id: nps-feedback-page
       title: <follow-up>
       primaryButton:
         title: "Submit"
       fields:
         - id: nps-feedback-text
           type: textarea
           placeholder: "Your answer goes here"
   ```
3. Lint YAML locally, then `POST /v1/flows/` with `type: NPS_SURVEY`.
4. Framework-detect + install `@frigade/react` (inherit).
5. Ensure `<Frigade.Provider>` is mounted.
6. Mount `<Frigade.Survey.NPS flowId="<slug>" dismissible />` in the appropriate location (often a shared layout so the survey can fire based on `targetingLogic`).
7. Env hygiene + ask-to-start-dev-server.
8. Report success; log `create-nps-survey:success`.

## Example invocation

User: "Add an NPS survey after checkout — 'How likely are you to recommend us to a friend?' with a follow-up asking why."

Claude's actions (abbreviated):
- Parse question + follow-up → slug `checkout-nps-survey`.
- Build YAML per §NPS_SURVEY Example 1.
- POST /v1/flows with `type: NPS_SURVEY`.
- Install, wire provider, mount `<Frigade.Survey.NPS flowId="checkout-nps-survey" />` in the checkout route or post-checkout page.
- Report.

## TODO (Phase 1)
- Write the fully-authored version.
- Worked example with the emoji-scale variant (Example 2 from yaml-spec).
- Decision tree: NPS vs generic SURVEY vs FORM (NPS for 0-10 satisfaction; SURVEY for multi-question structured feedback; FORM for input collection). Currently this stub only covers NPS — the `create-survey.md` stub covers generic SURVEY.
- Targeting handoff: NPS surveys are usually triggered by a rule ("fire 30 days after signup", "after flow X completes") — cross-link to `targeting-and-rules.md`.
