# add-flows-to-collection

**Add one or more flows to an existing collection.** API-only (no code emission). Fetches the collection's current `flowIds`, unions with the new IDs (no duplicates), and issues a single `updateRules` bulk mutation with the resulting membership plus every other required field from the fetched collection. Atomic on the server side.

Referenced decisions: **D02** (dashboard parity), **D09/D23** (per-env safety tags), **D16** (atomic server-side transaction), **D17** (log to `.frigade/skill.log`), **D28** (403 = bad key, 401 = ownership), **D31** (GraphQL `Rule` = product `Collection`; customer-facing language is "collection").

Companion references: `reference/graphql-schema.md` §`updateRules` + §`rules`, `reference/operations.md` `updateRules` row, `reference/errors.md` (partial-failure patterns).

## Pre-conditions

- `.env.local` contains `FRIGADE_API_KEY_SECRET` (and `FRIGADE_API_KEY_SECRET_PROD` if the user is operating in prod).
- first-run-setup has bound the workspace (`.frigade/project.json` exists).
- The target collection exists (was created via `recipes/create-collection.md` or via the dashboard).
- Each incoming flow exists in the current environment. (This recipe fails fast if any flow is 404; it does NOT create missing flows.)

## Step 1 — Resolve parameters

From the user's prompt, extract:

- `collectionSlug` (required) — the slug of the target collection, e.g., `collection_AbCdEf12`.
- `flowSlugs[]` (required) — one or more flow slugs to add to the collection.

If the user didn't provide the collection slug, ask once: *"Which collection should I add these flows to? (slug)"*
If the user didn't provide flow slugs, ask once: *"Which flow(s) should I add? (comma-separated slugs or flow IDs)"*

## Step 2 — Fetch the collection (full metadata)

GraphQL `rules(skip: 0, take: 50)` against the active environment. Filter client-side by `slug == <collectionSlug>`.

    curl -sS -X POST "https://api3.frigade.com/graphql" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
      -H "Content-Type: application/json" \
      -d '{
        "query": "query List($skip: Int!, $take: Int!) { rules(skip: $skip, take: $take) { id slug name description coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents flows { id slug } } }",
        "variables": { "skip": 0, "take": 50 }
      }'

Capture the matching collection. You will need EVERY field returned — not just `id` and `flowIds`. (See Step 5 for why.)

If not found: halt with the message *"Collection '<slug>' not found. Create it first with `recipes/create-collection.md`, or check `reference/operations.md` for the list ops."*

## Step 3 — Resolve each flow slug to its numeric id

For each `flowSlug`, via REST:

    curl -sS "https://api3.frigade.com/v1/flows/<slug>" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"

Capture `data.id` (numeric). If any flow returns 404, halt and list every missing slug — do NOT partially add. Example: *"Flow(s) 'flow_xxx, flow_yyy' not found. Create them first."*

## Step 4 — Union the IDs

Given `existingFlowIds = collection.flows.map(f => Number(f.id))` and `newFlowIds = [...each resolved id]`:

    unionedFlowIds = uniq([...existingFlowIds, ...newFlowIds])

If every incoming id is already in `existingFlowIds` (the union equals `existingFlowIds`), report *"No change — all requested flows are already in this collection."* and exit WITHOUT issuing the mutation.

## Step 5 — Build the full UpdateRuleDTO (CRITICAL)

**Gotcha:** the `UpdateRuleDTO` input type requires every metadata field to be non-null. A thin patch like `{ id, flowIds: [...] }` will be rejected server-side. You MUST preserve every required field from the fetched collection and override only `flowIds`.

Construct:

    patch = {
      "id": Number(collection.id),
      "name": collection.name,
      "description": collection.description,
      "coolOffPeriod": collection.coolOffPeriod,
      "coolOffUnit": collection.coolOffUnit,
      "coolOffEnabled": collection.coolOffEnabled,
      "color": collection.color,
      "enabled": collection.enabled,
      "order": collection.order,
      "allowedComponents": collection.allowedComponents,
      "flowIds": unionedFlowIds
    }

## Step 6 — Environment + confirmation gate (D09)

- `dev`: `updateRules` is `safe` per `operations.md`; proceed.
- `prod`: emit canonical prompt:

  > About to update collection '<collectionSlug>' in prod (adding <N> flows). Confirm? (y/n)

  Anything other than `y`/`yes` aborts without issuing the mutation.

## Step 7 — Issue the bulk update

    curl -sS -X POST "https://api3.frigade.com/graphql" \
      -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
      -H "Content-Type: application/json" \
      -d '{
        "query": "mutation Update($rules: [UpdateRuleDTO!]!) { updateRules(rules: $rules) { id slug flows { id slug } } }",
        "variables": { "rules": [<patch from Step 5>] }
      }'

The mutation is atomic — either the whole update lands or none does. Standard error handling:
- `401` → halt per **D28** (ownership/cross-env mismatch).
- `403` → halt per **D28** (bad/revoked key); route to `first-run-setup.md` §2.7.
- `errors[]` in body → surface the messages verbatim and halt. Do NOT retry automatically.

## Step 8 — Verify

Re-fetch the collection (repeat Step 2). Confirm `flows` now contains exactly `unionedFlowIds`. If mismatch: report the discrepancy — do not retry automatically; this indicates a backend inconsistency and the user should investigate.

## Step 9 — Log + report

Append `add-flows-to-collection:success` to `.frigade/skill.log` with: collection slug, flow slugs added, previous membership count, new membership count, env. Redact Authorization.

Report to the user:

> Added <N> flow(s) to collection '<slug>': [<added flow slugs>].
> New membership: <K> total.

## Partial-failure handling

`updateRules` is a single server-side transaction — there is no partial-membership state to unwind. If Step 7 fails (network/5xx/validation/GraphQL error), no change was committed. Surface the error, halt, and let the user retry after addressing the cause.

Preflight failures (Step 2 collection-not-found, Step 3 flow-not-found) halt cleanly without any mutation issued — nothing to unwind.

## Example

User: *"Add flows welcome-announcement and product-tour to collection onboarding-suite."*

1. `collectionSlug = "collection_1aBcDeF2"` (user gave a friendly name; skill maps it via `rules` query or asks for the slug).
2. Step 2: fetch collection → `{ id: "12345", slug: "collection_1aBcDeF2", name: "Onboarding Suite", description: "New-user flows", coolOffPeriod: 2, coolOffUnit: "DAYS", coolOffEnabled: true, color: "#F5B945", enabled: true, order: 0, allowedComponents: ["announcement","card","tour"], flows: [{ id: "100", slug: "getting-started" }] }`.
3. Step 3: resolve flow IDs → `welcome-announcement → 200`, `product-tour → 201`.
4. Step 4: union → `[100, 200, 201]`. Non-empty delta; proceed.
5. Step 5: build full patch preserving all fields, `flowIds: [100, 200, 201]`.
6. Step 6: env = dev, no confirmation.
7. Step 7: `updateRules` returns the updated collection.
8. Step 8: re-fetch confirms `flows` = 3 entries.
9. Step 9: log + report: *"Added 2 flow(s) to collection 'collection_1aBcDeF2'. New membership: 3 total."*
