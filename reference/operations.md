# Operations Inventory

Every Frigade operation reachable with a private API key, tagged for safety per environment. This table is the authoritative source for the skill's confirmation logic (D09): `safe` ops run immediately; `dangerous` ops emit a confirmation prompt and wait for an explicit `y`/`yes` before proceeding.

Companion refs: `graphql-schema.md` (full GraphQL surface), `rest-endpoints.md` (full REST surface + canonical error shape), `errors.md` (recovery on failures), `decisions.md` D09 (safety model), D26 (dev→prod is multi-call), D27 (`GET /v1/me` not skill-reachable).

## Safety model recap (D09)

- **Dev = open.** Almost every op is `safe` in dev, including writes that would be `dangerous` in prod (create/update/publish flow, collection CRUD, webhook/integration CRUD). The exceptions are ops that are destructive *regardless of environment* — user delete, user reset, user-group delete, remove-from-group, collection delete — those are `dangerous` in both.
- **Prod = two-tier.** Reads are `safe`. Anything that (a) writes to prod state, (b) is destructive, or (c) crosses environments (dev→prod promotion) is `dangerous`. The skill MUST emit a confirmation prompt and wait for `y`/`yes` before running.
- **No `forbidden` class in v1.** If a composite operation feels too risky for a single confirmation, it decomposes into multiple `dangerous` confirmations rather than being outright disallowed.

Environment is determined by which private API key the skill is using for the call — each key is bound to a single Organization record (dev or prod). There is no per-request `environment` argument; the binding is implicit (see D23/D27).

## How Claude uses this table

For every write operation in a recipe:
1. Look up the operation by name in the table below.
2. Resolve the column for the target environment (`dev` or `prod`) — determined by which private key is being used for this call.
3. If `safe` → proceed. If `dangerous` → emit the canonical confirmation prompt and wait for explicit `y`/`yes`. Anything else aborts, no partial state.
4. If `n/a` → the op does not apply in that environment; return a clear error rather than attempting it.

Confirmation template (canonical):

> `"About to <verb> <target> in <env>. Confirm? (y/n)"`

**Batch confirmations:** one prompt per operation-target batch. Example — promoting 3 flows to prod = one confirmation listing all 3 slugs, not three separate confirmations. Example — bulk-resetting 12 users = one confirmation with the user count and flow slug.

**Never silent-escalate.** Anything other than `y` or `yes` aborts. No `remember-yes-for-session` short-circuit in v1 (see D09 REVISIT).

## Operations

Legend:
- `safe` — run immediately, no confirmation.
- `dangerous` — emit canonical confirmation prompt, wait for `y`/`yes`.
- `n/a` — operation doesn't apply in this environment.

Column "Surface" is `REST` or `GraphQL`; "Op" gives the HTTP path or GraphQL field name.

### Flow operations

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| listFlows (private) | REST | GET /v1/flows | safe | safe | rest-endpoints.md |
| listFlows (public-ok) | REST | GET /v1/public/flows | safe | safe | rest-endpoints.md |
| getFlow (by slug or id) | REST | GET /v1/flows/:id | safe | safe | rest-endpoints.md |
| getFlow (public-ok) | REST | GET /v1/public/flows/:slug | safe | safe | rest-endpoints.md |
| getFlow (GraphQL) | GraphQL | query `flow(id: Float!)` | safe | safe | graphql-schema.md |
| listFlowVersions | REST | GET /v1/flows/:slug/versions | safe | safe | rest-endpoints.md |
| createFlow | REST | POST /v1/flows | safe | **dangerous** | rest-endpoints.md |
| updateFlow | REST | PUT /v1/flows/:numericFlowId | safe | **dangerous** | rest-endpoints.md |
| createFlowVersion (duplicate / new draft) | REST | POST /v1/flows/:id/versions | safe | **dangerous** | rest-endpoints.md |
| activateFlow (publish draft) | REST | PUT /v1/flows/:id/activate | safe | **dangerous** | rest-endpoints.md |
| deactivateFlow (set `active:false`) | REST | PUT /v1/flows/:numericFlowId `{active:false}` | safe | **dangerous** | rest-endpoints.md |
| deleteFlow | REST | DELETE /v1/flows/:numericFlowId | **dangerous** | **dangerous** | rest-endpoints.md — destructive regardless of env |
| promoteFlow (dev → prod) | composite | see `recipes/promote-to-prod.md` (D26) | n/a | **dangerous** | rest-endpoints.md — multi-call orchestration; prod-only direction |

### User operations

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| getUser (by userId / foreignId) | REST | GET /v1/users | safe | safe | rest-endpoints.md |
| getUser (by numeric id) | GraphQL | query `user(slug: Float!)` | safe | safe | graphql-schema.md — arg named `slug` but is numeric `id` |
| listUsers (with query DSL) | GraphQL | query `users(...)` | safe | safe | graphql-schema.md |
| getTotalUsers (facet count) | GraphQL | query `getTotalUsers(...)` | safe | safe | graphql-schema.md |
| upsertUser | REST | POST /v1/public/users | safe | safe | rest-endpoints.md — (public-ok); non-destructive upsert |
| createSession (upsert user + group) | REST | POST /v1/public/sessions | safe | safe | rest-endpoints.md — (public-ok) |
| deleteUser | REST | DELETE /v1/users | **dangerous** | **dangerous** | rest-endpoints.md — cascades to UFS + FlowResponse |
| deleteUser | GraphQL | mutation `deleteUser(id: Float!)` | **dangerous** | **dangerous** | graphql-schema.md — equivalent to REST `DELETE /v1/users` |

### User-flow-state operations

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| listUserFlowStates (private) | REST | GET /v1/userFlowStates | safe | safe | rest-endpoints.md |
| listUserFlowStates (GraphQL, with DSL) | GraphQL | query `userFlowStates(...)` | safe | safe | graphql-schema.md |
| getUserFlowState | REST | GET /v1/userFlowStates/:flowSlug/:userSlug | safe | safe | rest-endpoints.md |
| getUserFlowState (public-ok) | REST | GET /v1/public/userFlowStates/:flowSlug | safe | safe | rest-endpoints.md |
| listUserFlowStates (public-ok) | REST | GET /v1/public/userFlowStates | safe | safe | rest-endpoints.md |
| listFlowStatesV2 (public-ok) | REST | GET /v1/public/flowStates | safe | safe | rest-endpoints.md |
| recordFlowStateTransition (public-ok) | REST | POST /v1/public/flowStates | safe | safe | rest-endpoints.md — writes user progress event; not destructive, safe even in prod (used by SDK on every step) |
| recordFlowResponse (public-ok) | REST | POST /v1/public/flowResponses | safe | safe | rest-endpoints.md — event primitive; non-destructive |
| resetUserFlowState | REST | DELETE /v1/userFlowStates/:flowSlug/:userSlug | **dangerous** | **dangerous** | rest-endpoints.md — wipes user's progress on this flow |
| resetUserAllFlows (composite) | composite | loop of resetUserFlowState | **dangerous** | **dangerous** | requires iteration over UFS rows — one confirmation per batch |
| exportFlowResponses (CSV) | REST | GET /v1/flowResponses/export/:flowSlug | safe | safe | rest-endpoints.md — read-only export |

### User-group operations

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| getUserGroup (by groupId) | REST | GET /v1/groups | safe | safe | rest-endpoints.md |
| getUserGroup (by numeric id) | GraphQL | query `userGroup(slug: Float!)` | safe | safe | graphql-schema.md |
| listUserGroups | GraphQL | query `userGroups(...)` | safe | safe | graphql-schema.md |
| getTotalUserGroups (facet count) | GraphQL | query `getTotalUserGroups(...)` | safe | safe | graphql-schema.md |
| upsertUserGroup | REST | POST /v1/public/groups | safe | safe | rest-endpoints.md — (public-ok); non-destructive |
| upsertUserGroup (alias) | REST | POST /v1/public/userGroups | safe | safe | rest-endpoints.md — legacy alias |
| deleteUserGroup | REST | DELETE /v1/groups | **dangerous** | **dangerous** | rest-endpoints.md — cascades membership + tracking rows |
| deleteUserGroup | GraphQL | mutation `deleteUserGroup(id: Float!)` | **dangerous** | **dangerous** | graphql-schema.md |
| removeUserFromUserGroup | GraphQL | mutation `removeUserFromUserGroup(...)` | **dangerous** | **dangerous** | graphql-schema.md — destructive membership change |

### Collection operations (GraphQL-only)

The `Rule` GraphQL entity is surfaced to users as "collection" — operation names in the left column match the GraphQL field verbatim, but confirmation prompts and user-facing prose say "collection."

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| rules (list collections) | GraphQL | query `rules(...)` | safe | safe | graphql-schema.md — read-only listing |
| createRule | GraphQL | mutation `createRule(...)` | safe | **dangerous** | graphql-schema.md — creates a collection |
| updateRules (bulk) | GraphQL | mutation `updateRules(rules: [...])` | safe | **dangerous** | graphql-schema.md — bulk update; flows are associated via the `flowIds` arg, not a separate endpoint |
| deleteRule | GraphQL | mutation `deleteRule(id: Float!)` | **dangerous** | **dangerous** | graphql-schema.md — destructive regardless of env; deletes a collection |
| syncRuleToProd | GraphQL | mutation `syncRuleToProd(ruleId: Float!)` | n/a | **dangerous** | graphql-schema.md — promotes a collection from dev to prod; prod-only direction (only meaningful when caller is a prod key with a dev sibling) |

### Webhook subscription operations (GraphQL-only)

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| listWebhookSubscriptions | GraphQL | query `webhookSubscriptions(...)` | safe | safe | graphql-schema.md |
| createWebhookSubscription | GraphQL | mutation `createWebhookSubscription(...)` | safe | **dangerous** | graphql-schema.md — live webhook once created |
| updateWebhookSubscription | GraphQL | mutation `updateWebhookSubscription(...)` | safe | **dangerous** | graphql-schema.md |
| deleteWebhookSubscription | GraphQL | mutation `deleteWebhookSubscription(id)` | **dangerous** | **dangerous** | graphql-schema.md — destructive regardless of env |
| sendWebhookTest | GraphQL | mutation `sendWebhookTest(id)` | safe | safe | graphql-schema.md — test fire; non-destructive (but does POST to the configured URL — worth noting to the user) |

### Integration operations (GraphQL-only)

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| listIntegrations | GraphQL | query `integrations(...)` | safe | safe | graphql-schema.md |
| upsertIntegration (connect/update) | GraphQL | mutation `upsertIntegration(...)` | safe | **dangerous** | graphql-schema.md — affects prod data flow once live |
| deleteIntegration (disconnect) | GraphQL | mutation `deleteIntegration(id)` | **dangerous** | **dangerous** | graphql-schema.md — destructive (CDP data pipeline severed) |
| getHubSpotProperties | GraphQL | query `hubspotProperties(objectType)` | safe | safe | graphql-schema.md — read via connected HubSpot integration |

### Tracking events (read-only)

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| getTrackingEvent | GraphQL | query `trackingEvent(id: Float!)` | safe | safe | graphql-schema.md |

### API key operations

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| listApiKeys | REST | GET /v1/apiKeys | safe | safe | rest-endpoints.md — response includes secret `key` values; skill MUST avoid logging the response body wholesale |
| createApiKey / revokeApiKey | not skill-reachable | — | n/a | n/a | GAP: no public endpoint exists (see rest-endpoints.md GAPS). Dashboard-only path via Clerk. |

### CDP webhook ingestion (skill not intended to call directly)

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| ingestSegmentWebhook | REST | POST /v1/thirdParty/cdp/segment | safe | safe | rest-endpoints.md — server-to-server from Segment; the skill won't normally hit this. Reads/writes per-event, not a destructive op in the Frigade-state sense. |
| ingestMixpanelWebhook | REST | POST /v1/thirdParty/cdp/mixpanel | safe | safe | rest-endpoints.md — same story as Segment |

### CDN / uploads

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| uploadAsset | REST | POST /v1/cdnUpload | safe | safe | rest-endpoints.md — adds a new blob; no overwrite/delete capability in v1 |

### Organization / "me" (not skill-reachable)

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| getMe | REST | GET /v1/me | n/a | n/a | rest-endpoints.md — handler requires Clerk `request.user`; throws for API-key callers (D27). Use `GET /v1/apiKeys` or `GET /v1/flows` to confirm workspace binding instead. |

### Introspection / metadata

| Operation | Surface | Op | Dev | Prod | Reference |
|---|---|---|---|---|---|
| graphqlIntrospection | GraphQL | `{ __schema { ... } }` | safe | n/a | graphql-schema.md — introspection is disabled in prod (D24); dev-only schema probe |
| known-safe schema probe (prod fallback) | GraphQL | `{ rules(skip:0,take:1){ id } }` | safe | safe | graphql-schema.md — use instead of introspection when prod introspection fails |

## Operations explicitly NOT skill-reachable

These appear in the REST/GraphQL surface but the skill cannot invoke them with a private API key. If a recipe wants to use one, it must fall back to asking the user to operate the Frigade dashboard manually.

- **`GET /v1/me`** — handler throws without Clerk session (D27; see rest-endpoints.md GAPS). Do not call from recipes; use `GET /v1/apiKeys` or `GET /v1/flows` as the workspace-binding probe.
- **Create / revoke API key** — no REST or GraphQL endpoint; dashboard-only (rest-endpoints.md GAPS). Skill asks the user to create the key in-dashboard and paste it.
- **Triggers** — `TriggersModule` has no controller and no resolver (rest-endpoints.md GAPS). Plumbed internally via flow-level `triggerType`; no API to CRUD triggers directly.
- **Changelog publish** — audit rows are written as side effects of mutations only; no user-facing publish endpoint.
- **Environment / organization create or rename** — Clerk-session-only; no public endpoint.
- **Unpublish flow as a distinct op** — no `/unpublish` endpoint; use `deactivateFlow` (PUT with `active:false`) or `activateFlow` on a replacement draft.
- **Incoming third-party webhook receivers** (Clerk, Stripe, DigitalOcean, Heap, etc.) — these are handlers for Frigade receiving events from others, not endpoints the skill calls.

## Confirmation prompt templates (canonical)

All `dangerous` ops use these wordings. Use the closest matching template; fall back to the generic one for any op not listed.

- **Generic (default):**
  `"About to <verb> <target> in <env>. Confirm? (y/n)"`
- **Flow delete:**
  `"About to delete flow '<slug>' (version <n>) in <env>. This cannot be undone. Confirm? (y/n)"`
- **Flow create / update in prod:**
  `"About to <create|update> flow '<slug>' in prod. This affects live flow state. Confirm? (y/n)"`
- **Flow publish (activate):**
  `"About to publish flow '<slug>' in prod. Users matching the targeting rules will begin seeing it. Confirm? (y/n)"`
- **Flow deactivate:**
  `"About to deactivate flow '<slug>' in prod. Users will stop seeing it on next session. Confirm? (y/n)"`
- **Dev → prod promotion (D26):**
  `"About to promote flow(s) <slug list> from dev to prod. Sequence: fetch source → switch to prod key → create/update prod version → activate. Confirm? (y/n)"`
- **User delete:**
  `"About to delete user '<userId>' in <env>. This cascades to all their flow-state and flow-response rows. Confirm? (y/n)"`
- **User reset (single flow):**
  `"About to reset user '<userId>' on flow '<slug>' in <env>. This clears all their progress on this flow. Confirm? (y/n)"`
- **User reset (all flows, batch):**
  `"About to reset user '<userId>' on <n> flow(s) in <env>: <slug list>. This clears all their progress on every listed flow. Confirm? (y/n)"`
- **User-group delete:**
  `"About to delete user-group '<groupId>' in <env>. Membership + tracking rows cascade; user rows are kept. Confirm? (y/n)"`
- **Remove-from-group:**
  `"About to remove user '<userId>' from user-group '<groupId>' in <env>. Confirm? (y/n)"`
- **Collection delete:**
  `"About to delete collection '<name>' in <env>. Flows attached to this collection will lose the association. Confirm? (y/n)"`
- **Collection create / update in prod:**
  `"About to <create|update> collection '<name>' in prod. Confirm? (y/n)"`
- **syncRuleToProd (collection promotion):**
  `"About to promote collection '<name>' from dev to prod. Confirm? (y/n)"`
- **Webhook subscription delete:**
  `"About to delete webhook subscription '<url>' in <env>. Outbound events will stop firing. Confirm? (y/n)"`
- **Webhook create / update in prod:**
  `"About to <create|update> webhook subscription '<url>' in prod. Confirm? (y/n)"`
- **Integration disconnect:**
  `"About to disconnect integration '<type>' in <env>. Data pipeline from <type> into Frigade will be severed. Confirm? (y/n)"`
- **Integration connect / update in prod:**
  `"About to <connect|update> integration '<type>' in prod. Confirm? (y/n)"`

Batch example — promoting three flows:

```
About to promote flow(s) flow_abc123, flow_def456, flow_ghi789 from dev to prod.
Sequence: fetch source → switch to prod key → create/update prod version → activate.
Confirm? (y/n)
```

Batch example — resetting a user on every flow they've touched:

```
About to reset user 'user-abc-123' on 7 flow(s) in prod:
  flow_onboarding, flow_welcome, flow_tour, flow_survey_nps,
  flow_checklist_v2, flow_announcement_q1, flow_tour_billing.
This clears all their progress on every listed flow.
Confirm? (y/n)
```

All confirmations are explicit — no silent escalation, no "remember yes for session" shortcut in v1 (D09 REVISIT). Anything other than `y` or `yes` aborts the operation, and any composite recipe aborts with no partial state applied where that is possible (cross-env promotions are a known exception — see `errors.md` on partial-progress recovery across two keys).

## "n/a" operations (rationale)

- **`promoteFlow (dev → prod)` is `n/a` in dev** — direction is prod-bound; there's no "promote to dev" concept. If a recipe is running with a dev key and tries to promote, the skill aborts with "wrong-environment" before consulting confirmation.
- **`syncRuleToProd` is `n/a` in dev** — same reason; only meaningful when called with a prod key against a dev-sibling collection.
- **`getMe` is `n/a` in both** — handler isn't API-key-reachable (D27). The skill treats this as "not skill-reachable" and uses an alternative probe.
- **`createApiKey` / `revokeApiKey` are `n/a` in both** — no public endpoint exists; dashboard-only.
- **`graphqlIntrospection` is `n/a` in prod** — introspection is disabled in prod (D24). The skill falls back to the known-safe probe `{ rules(skip:0,take:1){ id } }` to sanity-check the prod schema.

## Forbidden operations

None in v1 (per D09). The skill never refuses outright. If an operation feels too risky for a single confirmation, it decomposes into multiple `dangerous` confirmations — each confirmed separately, or batched with an exhaustive list in the prompt.

If a composite recipe crosses environments (dev→prod promotion is the canonical example), every cross-env sub-op that is `dangerous` in its target env gets confirmed separately, not rolled into a single "big" confirmation. The skill's job is transparency, not minimizing prompts.
