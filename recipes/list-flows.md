# recipes/list-flows.md — STUB

**Status:** Phase-1 target. v1 dogfood uses pattern-match off `reference/operations.md` + `reference/rest-endpoints.md`. This recipe is small — no confirmation needed, safe in both envs.

## Intent
User asks to list flows in the workspace, optionally filtered by type, env, or active status. Typical phrasing: "show me all my flows", "list the active tours in prod", "what checklists do I have in dev?", "what have I created this week?". Read-only; no state changes.

## Pattern
Simple GET + client-side filter. No multi-call orchestration, no atomic batches, no confirmation.

## API op
See `reference/operations.md` §"Flow operations" → `listFlows (private)` row.
- REST call: see `reference/rest-endpoints.md` §"GET /v1/flows/" (note the trailing slash is required).
- Endpoint: `GET https://api3.frigade.com/v1/flows/`
- Auth: `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (or `_PROD` for prod).
- Optional query params: `startDate` / `endDate` / `timeZoneOffset` to scope `internalData.flowStats` (usually unused by the skill).

## Confirmation
Safety tag: **safe** in both dev and prod. No confirmation prompt. Read-only.

## Pre-conditions
- `first-run-setup.md` Section 1 state-check passed.
- Private key for target env available.

## Minimal flow

1. Parse `environment` (default `dev`) and any filter criteria: `type` (ANNOUNCEMENT/CHECKLIST/FORM/TOUR/SUPPORT/CUSTOM/BANNER/EMBEDDED_TIP/NPS_SURVEY/SURVEY/CARD), `active` (bool), free-text search on `name` or `slug`.
2. `curl -sS "https://api3.frigade.com/v1/flows/" -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"`.
3. Parse `data: Flow[]` from the paginated response (`{ data, offset: 0, limit: 100 }` shape per `rest-endpoints.md`).
4. Apply client-side filters (server doesn't filter by type/active; that happens here).
5. Format a compact list — one row per flow with slug, type, active status, modifiedAt, short name. If the list is empty after filtering, say so explicitly rather than returning an empty block.

## Example invocation

User: "List all my active tours in dev."

Claude's actions (abbreviated):
- `GET /v1/flows/` with dev key.
- Filter `data[]` where `type == "TOUR" && active == true`.
- Format as:
  ```
  3 active tour(s) in dev:
    - welcome-tour           (Welcome tour, modified 2026-04-17) — https://app.frigade.com/flows/welcome-tour
    - onboarding-tour        (Onboarding tour, modified 2026-04-15)
    - billing-walkthrough    (Billing walkthrough, modified 2026-04-12)
  ```

## Example response shape

Abbreviated (per `rest-endpoints.md` §Types `ExternalizedFlow`):

```json
{
  "data": [
    {
      "id": 12345,
      "slug": "welcome-to-my-product",
      "type": "ANNOUNCEMENT",
      "name": "Welcome to my product",
      "active": true,
      "status": "ACTIVE",
      "version": 1,
      "modifiedAt": "2026-04-17T12:00:00Z",
      "createdAt": "2026-04-17T10:30:00Z"
    }
  ],
  "offset": 0,
  "limit": 100
}
```

## TODO (Phase 1)
- Write the fully-authored version.
- Pagination: if the workspace has > 100 flows, surface that and offer to page (or use the query params if the API grows them).
- Rich filter DSL: support compound filters like "tours modified after 2026-04-01 AND active". Keep simple for v1.
- Output formatting variants: table for compact listing, JSON for machine output, per-flow detail when only one flow matches.
