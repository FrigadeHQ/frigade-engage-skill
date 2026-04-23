# recipes/get-flow.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `reference/operations.md` + `reference/rest-endpoints.md`. No confirmation needed, safe in both envs.

## Intent
User asks to look up a single flow by slug (or numeric id) — inspect its YAML, check its status / active state / targeting, find its id, or prep the context for a downstream operation. Typical phrasing: "show me `welcome-to-my-product`", "what does the NPS survey look like?", "what's the targeting on the banner?", "get me the YAML for my tour". Read-only; no state changes.

## Pattern
Simple GET. No orchestration. Often called as a pre-step from other recipes (update-yaml.md, delete-flow.md, publish-flow.md, duplicate-flow.md all GET the flow first to get the numeric id and current state).

## API op
See `reference/operations.md` §"Flow operations" → `getFlow (by slug or id)` row.
- REST call: see `reference/rest-endpoints.md` §"GET /v1/flows/:id".
- Endpoint: `GET https://api3.frigade.com/v1/flows/<slug-or-id>` (accepts either — controller detects via `String(params.id).startsWith('flow')` vs `parseInt`).
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).
- Optional query params: `version` (fetch a specific version for a slug); `startDate` / `endDate` / `includeTimeSeriesStats` / `forceStatsRefresh` (shape `internalData.flowStats`).

## Confirmation
Safety tag: **safe** in both dev and prod. No confirmation prompt. Read-only.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.

## Minimal flow

1. Parse `slug-or-id` (the user may give either; pass it through verbatim to the API), optional `version`, `environment` (default `dev`).
2. `curl -sS "https://api3.frigade.com/v1/flows/<slug-or-id>" -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"` (append `?version=<n>` if specified).
3. Handle `404` (no such flow — halt with a pointer at `list-flows.md` to find nearby slugs).
4. Format the response for the user. Compact version: slug, id, type, status/active, version, modifiedAt. Extended version (for "show me the YAML"): also dump the `data` YAML and `targetingLogic`.

## Example invocation

User: "Show me the welcome announcement."

Claude's actions (abbreviated):
- `GET /v1/flows/welcome-to-my-product` with dev key.
- Parse response.
- Format as:
  ```
  welcome-to-my-product (id: 12345)
    Type:     ANNOUNCEMENT
    Status:   ACTIVE (active: true, version 1)
    Modified: 2026-04-17
    Dashboard: https://app.frigade.com/flows/welcome-to-my-product
    Targeting: (none)

    YAML:
      steps:
        - id: welcome-step
          title: Welcome to my product
          subtitle: Get started in a few clicks
          ...
  ```

## Example response shape

Per `rest-endpoints.md` §Types `ExternalizedFlow` + `InternalFlowData`:

```json
{
  "id": 12345, "slug": "welcome-to-my-product", "type": "ANNOUNCEMENT",
  "name": "Welcome to my product", "data": "<YAML string>",
  "targetingLogic": null, "active": true, "status": "ACTIVE", "version": 1,
  "createdAt": "2026-04-17T10:30:00Z", "modifiedAt": "2026-04-17T12:00:00Z",
  "internalData": { "flowStats": {}, "productionDraftFlowId": null, "productionActiveFlowId": null, "rules": [] }
}
```

## TODO (Phase 1)
- Write the fully-authored version.
- Decision for default verbosity: compact (one-liner summary) vs extended (YAML dump). Default compact for "what is X?", extended for "show me the YAML of X" or "what does the targeting on Y look like?".
- Cross-ref: when the user asks "what flows have I created?", route to `list-flows.md` rather than looping this recipe.
- Handle the "user passed a numeric id by accident" case cleanly — same endpoint handles both inputs.
