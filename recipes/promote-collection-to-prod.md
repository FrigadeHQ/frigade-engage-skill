# promote-collection-to-prod

**Promote a collection from dev to prod.** API-only. Calls the `syncRuleToProd` GraphQL mutation, which upserts the collection's metadata (name, description, cool-off, priority order, allowed component types) into the prod workspace, matching by slug. Flow associations are **not** transferred by this mutation — see "After promotion" below.

Note on naming: collections are called `Rule` in GraphQL; customer-facing language is always "collection".

Unlike flow promotion (a client-orchestrated multi-call sequence), collection promotion uses a single backend mutation that handles the dev→prod copy server-side. No orchestration is needed on the client.

Companion references: `reference/graphql-schema.md` §`syncRuleToProd`, `reference/operations.md` `syncRuleToProd` row.

## Pre-conditions

- `.env.local` contains `FRIGADE_API_KEY_SECRET` (dev key, used to call the mutation) and `FRIGADE_API_KEY_SECRET_PROD` (prod key, used to verify the result). If the prod key is missing, halt early with: *"Prod key required — see `recipes/first-run-setup.md` §'configuring prod keys'."*
- first-run-setup has bound the workspace (`.frigade/project.json` exists with both `workspaceId` and `prodWorkspaceId`).
- The target collection exists in the dev workspace.

## Step 1 — Resolve parameters

From the user's prompt, extract `collectionSlug` (required).

If missing, ask once: *"Which collection should I promote to prod? (slug)"*

## Step 2 — Resolve the dev collection

GraphQL `rules(skip: 0, take: 50)` against the DEV workspace using `FRIGADE_API_KEY_SECRET`. Filter client-side by slug.

    curl -sS -X POST "https://api3.frigade.com/graphql" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
      -H "Content-Type: application/json" \
      -d '{
        "query": "query List($skip: Int!, $take: Int!) { rules(skip: $skip, take: $take) { id slug name } }",
        "variables": { "skip": 0, "take": 50 }
      }'

Capture the matching collection's `id` (string — coerce with `Number(id)` for the mutation) and `name`.

If not found in dev: halt with *"Collection '<slug>' not found in dev. Create it first with `recipes/create-collection.md`."*

## Step 3 — Confirmation

`syncRuleToProd` is `dangerous` in prod per `operations.md`. Emit the canonical prompt:

> About to promote collection '<slug>' to prod. Confirm? (y/n)

Wait for explicit `y`/`yes`; anything else aborts without issuing the mutation.

## Step 4 — Call syncRuleToProd

The mutation is called against the DEV API using the DEV key — the backend handles the cross-environment write into the sibling prod org.

    curl -sS -X POST "https://api3.frigade.com/graphql" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
      -H "Content-Type: application/json" \
      -d '{
        "query": "mutation Promote($ruleId: Float!) { syncRuleToProd(ruleId: $ruleId) { id slug name type coolOffPeriod coolOffUnit enabled order } }",
        "variables": { "ruleId": <Number(devCollection.id)> }
      }'

On success, capture `data.syncRuleToProd` — this is the prod-side collection. The slug matches the dev side.

Error handling:
- `401` → halt (ownership/cross-env mismatch). Surface the error message verbatim.
- `403` → halt (bad/revoked dev key); route user to `first-run-setup.md` §2.7.
- `errors[]` in body → surface the messages verbatim and halt; do NOT retry automatically (the backend owns idempotency).

Log `promote-collection-to-prod:server-synced` to `.frigade/skill.log` with: dev id, slug, env=prod (the target). Redact Authorization.

## Step 5 — Verify prod has the collection

Switch to `FRIGADE_API_KEY_SECRET_PROD`. Call `rules(skip: 0, take: 50)` against prod and filter by the slug.

    curl -sS -X POST "https://api3.frigade.com/graphql" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET_PROD" \
      -H "Content-Type: application/json" \
      -d '{
        "query": "query List($skip: Int!, $take: Int!) { rules(skip: $skip, take: $take) { id slug name } }",
        "variables": { "skip": 0, "take": 50 }
      }'

Expected: the collection exists at the same slug, with name matching the dev side.

If 404 or name mismatch: report the discrepancy — do not retry automatically. Possible cause: backend transaction visibility lag (retry-after-a-beat is acceptable as a manual user action, not an automatic step).

## Step 6 — Log + report

Append `promote-collection-to-prod:success` to `.frigade/skill.log` with: dev id, prod id, slug, name. Redact Authorization.

Report to the user verbatim:

> Collection '<slug>' promoted to prod (dev id <devId> → prod id <prodId>).
>
> **Flow associations are not promoted with the collection.** To link flows in prod:
>   1. Promote each flow to prod via `recipes/promote-to-prod.md`.
>   2. Run `recipes/add-flows-to-collection.md` with the prod collection slug and the prod flow slugs (passing prod-env keys / `FRIGADE_API_KEY_SECRET_PROD`).
>
> Dashboard (prod): https://app.frigade.com/collections/<slug>

## Partial-failure handling

`syncRuleToProd` is atomic on the server. On failure (network/5xx/validation/GraphQL error), no state was changed; surface the error and halt. User may retry after addressing the underlying issue.

Step 5 (verify) failures are read-only — no write state to unwind. If verify fails, the canonical response is to surface the mismatch and let the user inspect. Do NOT automatically re-invoke `syncRuleToProd` in hopes of reconciling.

## Example

User: *"Promote the onboarding-suite collection to prod."*

1. `collectionSlug = "collection_1aBcDeF2"`.
2. Step 2: fetch dev collection → `{ id: "12345", slug: "collection_1aBcDeF2", name: "Onboarding Suite" }`.
3. Step 3: emit `"About to promote collection 'collection_1aBcDeF2' to prod. Confirm? (y/n)"`. User types `y`.
4. Step 4: `syncRuleToProd(ruleId: 12345)` → `{ id: "67890", slug: "collection_1aBcDeF2", name: "Onboarding Suite", type: "CUSTOM", ... }`.
5. Step 5: verify against prod → `rules` returns the matching collection. `name` matches.
6. Step 6: log + report *"Collection 'collection_1aBcDeF2' promoted to prod (dev id 12345 → prod id 67890). Flow associations are not promoted..."*.
