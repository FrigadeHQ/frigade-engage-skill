# Frigade REST Endpoints (snapshot)

**Source:** backend-app commit `d245b4fd` (pulled 2026-04-17).
**Base URL (prod):** `https://api3.frigade.com/` (confirmed against `frigade-web/.env.vercel` → `NEXT_PUBLIC_FRIGADE_API_URL=https://api3.frigade.com/`; same cluster as the GraphQL endpoint at `https://api3.frigade.com/graphql`).
**Base URL (dev cluster):** `https://ei.frigade.com/` (from `frigade-web/.env.local.example` — ignore for the skill, which targets prod).
**Auth header:** `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (private key, keys starting with `api_private_`). Put a placeholder at the start of every shell: `export FRIGADE_API_KEY_SECRET="api_private_..."`. **Never** interpolate the key value into these docs, issue trackers, or logs.

## Conventions

- Every endpoint below requires a **private API key** (`api_private_*`) unless explicitly marked `(public-ok)` — those accept publishable keys (`api_public_*`) as well and are the ones the frontend SDK uses; you can still call them from the skill with a private key if you need to.
- TypeScript-style notation is used for request/response shapes. Optional fields are marked `?`. Shapes mirror backend-app DTO classes (e.g. `CreateFlowDto`, `AddPropertyOrEventsToUserDTO`); `ExternalizedFoo` classes are the response payloads.
- Every path shown is **appended to the base URL**. Nest fastify sets no global prefix; endpoints begin with `v1/...`. A request URL is therefore `{BASE_URL}{PATH}`, e.g. `https://api3.frigade.com/v1/flows`.
- **Trailing slashes matter on collection paths.** `GET /v1/flows` and `POST /v1/flows` are the correct paths (no trailing slash). Appending a trailing slash (`GET /v1/flows/`, `POST /v1/flows/`) returns `404 Not Found` from the Fastify router. Per-id paths (`GET /v1/flows/:id`, `PUT /v1/flows/:id`, `DELETE /v1/flows/:id`) are unaffected.
- **`Content-Type` must be omitted on bodiless requests.** `DELETE /v1/flows/:id` with no body but `Content-Type: application/json` fails with `400 "Body cannot be empty when content-type is set to 'application/json'"`. Only set the content-type header when you actually send a JSON body.
- The CORS policy on backend-app allows `GET / PUT / POST / DELETE / OPTIONS`. There are **no** `PATCH` endpoints — use `PUT` for partial updates too (yes, even though the body is partial; see `PUT /v1/flows/:numericFlowId`).
- Auth guard mapping (from `src/middlewares/private-api.guard.ts` and `src/middlewares/public-api.guard.ts`):
  - `PrivateAuthGuard` — accepts (a) an `api_private_*` key, OR (b) a Clerk dashboard session token. The guard validates and sets `req.organization`. Public keys are rejected.
  - `PublicApiGuard` — accepts **any** API key type (`api_public_*` or `api_private_*`). If private, `req.viewPrivateData = true` is set and the response may contain extra fields.
  - `RateLimitGuard` — often stacked after one of the above. Throws `429` if the organization's MAU plan cap is exceeded. Skill-callable so long as the underlying org isn't rate-limited.
  - `NotFoundInterceptor` — wraps GETs so that any falsy (`null`/`undefined`) return body becomes a `404`.
- Controllers routinely combine decorators in order: `@UseGuards(RateLimitGuard) @UseGuards(PublicApiGuard) @Get(...)`. When two `@UseGuards` are stacked, both must pass.

## Flows

### GET /v1/public/flows/:slug — get flow by slug (public-ok)
- Auth: `PublicApiGuard` (public or private key).
- Path params: `slug: string` (either a flow slug like `flow_abc123` or the numeric flow id serialized as string).
- Response: `ExternalizedFlow` (see Types section). With a public key, private fields (`organizationId`, `customerId`, `publishedAt`, `publishedById`, `archivedAt`, `archivedById`, `modifiedById`, `archiveBehavior`, `codeSnippet`, `lastSeenAt`, `internalData`) are stripped.
- Controller: `src/flows/flows.controller.ts:70-85`.
- Notes: `NotFoundInterceptor` turns missing flows into `404`. This is what the public SDK uses to fetch flow definitions; the skill can use it as a lightweight read that doesn't require dev-key-scoped access — but for any skill use, stick to `GET /v1/flows/:id` below.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/public/flows/flow_abc123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/public/flows — list flows for the org (public-ok)
- Auth: `RateLimitGuard` + `PublicApiGuard`.
- Response: `PaginatedResult<ExternalizedFlow>` — `{ data: ExternalizedFlow[], offset: 0, limit: 100 }`. Legacy JS SDK versions receive only `active: true` flows; newer versions get the full list. The skill should prefer `GET /v1/flows` below for completeness.
- Controller: `src/flows/flows.controller.ts:95-116`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/public/flows" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/flows — list flows (dashboard view, private)
- Auth: `PrivateAuthGuard`.
- Query params:
  - `startDate?: string` (ISO 8601). Optional. Scopes the returned `internalData.flowStats` to the time window.
  - `endDate?: string` (ISO 8601). Optional.
  - `timeZoneOffset?: string` (minutes; e.g. JS `new Date().getTimezoneOffset()`).
- Response: `PaginatedResult<Flow>` — includes the raw `Flow` (no `ExternalizedFlow` transformation) plus `internalData` when private-key auth is detected.
- Controller: `src/flows/flows.controller.ts:205-226`.
- Notes: The dashboard hits this for the Flows list with optional stats windowing. For the skill, calling without query params gets you the plain list.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/flows" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/flows/:id — get a single flow with stats (private)
- Auth: `PrivateAuthGuard` + `SecureHeaders()` (just sets response headers).
- Path params: `id: string` — accepts **either** a numeric flow id (e.g. `12345`) **or** a slug (e.g. `flow_abc123`). The controller detects which by `String(params.id).startsWith('flow')` vs `parseInt`.
- Query params:
  - `version?: string` (specific version number to fetch for a slug).
  - `startDate?: string` / `endDate?: string` / `timeZoneOffset?: string` / `includeTimeSeriesStats?: "true"|"false"` / `forceStatsRefresh?: "true"|"false"` — shape of `FlowStats.*OverTime[]` arrays.
- Response: `Flow & { internalData: InternalFlowData }` (see Types). The `internalData` includes `flowStats`, `createdByProfile`, `publishedByProfile`, `modifiedByProfile`, `archivedByProfile`, `rules`, `productionDraftFlowId`, `productionActiveFlowId` — the last two are what the dashboard uses to decide dev→prod UI for the flow.
- Controller: `src/flows/flows.controller.ts:148-200`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/flows/flow_abc123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/flows/:id/versions — list versions of a flow (private)
- Auth: `PrivateAuthGuard` + `SecureHeaders()`.
- Path params: `id: string` — pass a **slug** here (the service delegates to `getFlowVersions(slug, ...)`). Despite the parameter name, passing a numeric id will return an empty list because versions share slugs across revisions.
- Response: `PaginatedResult<Flow>` — all rows with the same slug, ordered by `createdAt desc` (newest first). Includes drafts, archived, and active versions.
- Controller: `src/flows/flows.controller.ts:118-146`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/flows/flow_abc123/versions" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### POST /v1/flows — create flow (private)
- Auth: `PrivateAuthGuard` + `SecureHeaders()`.
- Body (`CreateFlowDto`):
  ```ts
  {
    slug?: string,               // optional; if not set or malformed, one is generated as `flow_<nanoid8>`
    name: string,
    data: string,                // YAML-encoded flow steps; JSON strings also accepted (converted server-side)
    codeSnippet?: string,        // optional JSX/HTML snippet for the copy-paste UI
    version?: number,            // ignored on create; versions start at 1
    targetingLogic?: string,     // e.g. `user.property('isAdmin') == true`
    completionBehavior?: "ON_ALL_STEPS_COMPLETED" | "ON_LAST_STEP_COMPLETED",
    type?: FlowType,             // ANNOUNCEMENT | BANNER | CARD | CHECKLIST | CUSTOM | FORM | SURVEY | TOUR; default CHECKLIST
    active?: boolean             // default true
  }
  ```
- Response: full `Flow` row (no externalization).
- Controller: `src/flows/flows.controller.ts:255-274`.
- Notes: The flow is created in **draft** status by default inside the organization bound to the API key. To activate, call `PUT /v1/flows/:id/activate`. The newly created flow gets `customerId` auto-set to the org's first customer if the actor (API key) doesn't have one.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/flows" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"name":"Welcome","type":"ANNOUNCEMENT","data":"steps:\n  - id: step_1\n    title: Welcome","active":true}'
  ```

### PUT /v1/flows/:numericFlowId — update flow (private)
- Auth: `PrivateAuthGuard`.
- Path params: `numericFlowId: string` — **must be numeric** (the `Flow.id`). Passing a slug returns `null`. The dashboard always passes `flow.id`.
- Body (`UpdateFlowDto`, all fields optional — server treats unspecified as "no change"):
  ```ts
  {
    name?: string,
    data?: string,            // JSON or YAML; JSON is normalized to YAML server-side
    description?: string,
    targetingLogic?: string,  // pass empty string "" to clear; server runs a parenthesis-balance sanity check and rejects unbalanced
    type?: FlowType,
    triggerType?: "MANUAL" | "AUTOMATIC",
    active?: boolean
  }
  ```
- Response: updated `Flow` row.
- Controller: `src/flows/flows.controller.ts:301-319`.
- Notes: Every update creates an audit row in `changelogs` (see GraphQL's `getChangelog`). `PATCH` is **not** supported — PUT is used for partials.
- Curl template:
  ```bash
  curl -sS -X PUT "https://api3.frigade.com/v1/flows/12345" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"name":"Updated name","targetingLogic":"user.property('\''isAdmin'\'') == true"}'
  ```

### PUT /v1/flows/:id/activate — publish a draft version (private)
- Auth: `PrivateAuthGuard`.
- Path params: `id: string` — numeric flow id of the **draft** to activate. The draft becomes `status=ACTIVE`; the previously-active version for the same slug is archived with the specified `archiveBehavior`.
- Body (`ActivateFlowDto`):
  ```ts
  {
    archiveBehavior?: "EXIT_EXISTING_USERS" | "RESTART_EXISTING_USERS" | "RESTART_ALL_USERS"
  }
  ```
- Response: the newly activated `Flow`.
- Controller: `src/flows/flows.controller.ts:276-299`.
- Notes: If no draft exists for the flow id you pass, the service throws (surfaces as a `500`). Always call after `POST /v1/flows/:id/versions`.
- Curl template:
  ```bash
  curl -sS -X PUT "https://api3.frigade.com/v1/flows/12345/activate" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"archiveBehavior":"EXIT_EXISTING_USERS"}'
  ```

### POST /v1/flows/:id/versions — create a new draft version of an existing flow (private)
- Auth: `PrivateAuthGuard` + `SecureHeaders()`.
- Path params: `id: string` — **numeric** flow id of an existing (active or archived) flow. Passing a slug returns `null`.
- Body: empty `{}`.
- Response: new draft `Flow` row (`status=DRAFT`, version = latest + 1, same slug as the source).
- Controller: `src/flows/flows.controller.ts:228-253`.
- Notes: Fails with `"Draft already exists for this flow"` if a draft already exists for the slug. The dashboard uses this as the "duplicate flow" action and as step 1 of dev→prod copy.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/flows/12345/versions" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{}'
  ```

### DELETE /v1/flows/:numericFlowId — delete a flow (private)
- Auth: `PrivateAuthGuard`.
- Path params: `numericFlowId: string` — must parse as an integer.
- Response: `204 No Content` on success.
- Controller: `src/flows/flows.controller.ts:321-336`.
- Notes: Deletes only the specific version. Other versions sharing the slug remain. Cascade behavior: `FlowResponse` rows referencing the deleted flow are not removed; they become orphan history.
- Curl template:
  ```bash
  curl -sS -X DELETE "https://api3.frigade.com/v1/flows/12345" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

## Users

### GET /v1/users — get user by foreignId / userId (private)
- Auth: `PrivateAuthGuard`.
- Query params:
  - `userId?: string` — preferred, your app's ID for the user.
  - `foreignId?: string` — deprecated synonym for `userId`; `userId` takes precedence when both are passed.
- Response: `ExternalizedUser` with nested `userFlowStates: UserFlowState[]` of **every** flow the user has touched. Returns `null` (→ `404` via `NotFoundInterceptor`) if no user matches.
- Controller: `src/users/users.controller.ts:77-120`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/users?userId=user-abc-123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### DELETE /v1/users — delete user by userId (private)
- Auth: `PrivateAuthGuard`.
- Query params: `userId: string` (required; alias `foreignId` also accepted, deprecated).
- Response: `200` with empty body; cascades delete of the user's `UserFlowState` and `FlowResponse` rows.
- Controller: `src/users/users.controller.ts:122-164`.
- Notes: Returns `404` if no user is found. The GraphQL `deleteUser(id: Int!)` mutation also exists (see `graphql-schema.md`); functionally equivalent.
- Curl template:
  ```bash
  curl -sS -X DELETE "https://api3.frigade.com/v1/users?userId=user-abc-123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### POST /v1/public/users/ — upsert user properties / events (public-ok)
- Auth: `PublicApiGuard` (public or private key).
- Body (`AddPropertyOrEventsToUserDTO`):
  ```ts
  {
    foreignId?: string,                  // your app's user id
    userId?: string,                     // preferred; alias for foreignId
    properties?: { [key: string]: any }, // e.g. { email, firstName, ... }
    bootstrapFlowStates?: boolean,       // retroactively complete eligible flows for historic users
    events?: ExternalizedTrackingEvent[], // each: { event: string, properties?: object }
    linkGuestId?: string                 // merges a guest session into a non-guest user on first signup
  }
  ```
- Response: `undefined` (empty 201).
- Controller: `src/users/users.controller.ts:53-75`.
- Notes: This is how the SDK records user data. Called with a private key from the skill, same behavior. Acts as an upsert: creates the user if `userId` doesn't exist yet.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/public/users/" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"userId":"user-abc-123","properties":{"email":"a@b.co","firstName":"Ada"}}'
  ```

### POST /v1/public/sessions — create a session (upsert user + group in one call) (public-ok)
- Auth: `RateLimitGuard` + `PublicApiGuard`.
- Body (`SessionDTO`):
  ```ts
  {
    userId: string,                      // required
    groupId?: string,
    userProperties?: { [key: string]: any },
    userEvents?: ExternalizedTrackingEvent[],
    groupProperties?: { [key: string]: any },
    groupEvents?: ExternalizedTrackingEvent[],
    linkGuestId?: string,
    bootstrapFlowStates?: boolean
  }
  ```
- Response: `undefined` (empty 201). Both the user and group are upserted atomically.
- Controller: `src/users/users.controller.ts:166-182`.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/public/sessions" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"userId":"user-123","groupId":"org-xyz","userProperties":{"email":"a@b.co"}}'
  ```

## User Flow States

### GET /v1/userFlowStates — list all user-flow-state rows (private)
- Auth: `PrivateAuthGuard`.
- Query params:
  - `userQuery?: string` — same DSL as the GraphQL `userFlowStates(userQuery: ...)` query (`flowId:<id>`, `userGroupId:<id>`, `targeting:<expr>`, or free text).
- Response: `PaginatedResult<UserFlowState>` — `{ data: UserFlowState[], offset: 0, limit: 100 }`. When no `userQuery` is passed, returns every UFS row for the org (hard cap ~some service-internal threshold; avoid for big orgs).
- Controller: `src/user-flow-states/user-flow-states.controller.ts:128-159`.
- Notes: Prefer the GraphQL `userFlowStates(skip, take, userQuery)` query for paginated access with `skip`/`take` controls.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/userFlowStates?userQuery=flowId:12345" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/userFlowStates/:flowSlug/:userSlug — get a single UFS row (private)
- Auth: `PrivateAuthGuard`.
- Path params:
  - `flowSlug: string` — e.g. `flow_abc123`.
  - `userSlug: string` — the Frigade-generated `user_...` slug (not the `userId`/`foreignId`). Returned on `ExternalizedUser.slug`.
- Response: `UserFlowState` with `flowResponses` populated. `null` → `404` if the user hasn't touched the flow yet.
- Controller: `src/user-flow-states/user-flow-states.controller.ts:113-125`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/userFlowStates/flow_abc123/user_xyz789" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### DELETE /v1/userFlowStates/:flowSlug/:userSlug — reset a user's state in a flow (private)
- Auth: `PrivateAuthGuard`.
- Path params: same as the GET above.
- Response: `null` → `200 OK` with empty body (the `NotFoundInterceptor` only fires on GET). Does not error if the UFS row was already absent.
- Controller: `src/user-flow-states/user-flow-states.controller.ts:161-175`.
- Notes: This is the dashboard "reset flow state" action. Removes the user's step progress for the flow so they see it again from scratch on next session.
- Curl template:
  ```bash
  curl -sS -X DELETE "https://api3.frigade.com/v1/userFlowStates/flow_abc123/user_xyz789" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/public/userFlowStates/:flowSlug — get one UFS by flowSlug + foreignUserId (public-ok)
- Auth: `PublicApiGuard`.
- Path params: `flowSlug: string`.
- Query params:
  - `foreignUserId: string` (**required**; `400 Bad Request` if missing).
  - `foreignUserGroupId?: string`.
- Response: `PublicUserFlowState` — lean version without internal IDs; `flowResponses` are included only when called with a private key.
- Controller: `src/user-flow-states/user-flow-states.controller.ts:55-79`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/public/userFlowStates/flow_abc123?foreignUserId=user-abc-123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/public/userFlowStates/ — list all UFS for a foreignUserId (public-ok)
- Auth: `RateLimitGuard` + `PublicApiGuard`.
- Query params: `foreignUserId: string` (required), `foreignUserGroupId?: string`.
- Response: `PaginatedResult<PublicUserFlowState>` — `{ data, offset: 0, limit: 500 }`.
- Controller: `src/user-flow-states/user-flow-states.controller.ts:81-111`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/public/userFlowStates/?foreignUserId=user-abc-123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### GET /v1/public/flowStates — list v2 stateful flows for a userId (public-ok)
- Auth: `RateLimitGuard` + `PublicApiGuard`.
- Query params: `userId: string` (required; returns `400` if missing), `groupId?: string`.
- Response: `PublicUserFlowStateV2` — `{ eligibleFlows: StatefulFlow[], ineligibleFlows: string[], ruleGraph?, rules?, collections? }`. Each `StatefulFlow` embeds the raw flow definition plus `$state` with the user's progress across all steps. This is the "one call, everything a user needs" endpoint.
- Controller: `src/user-flow-states/user-flow-states.controller.ts:177-219`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/public/flowStates?userId=user-abc-123" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### POST /v1/public/flowStates — record a step/flow state transition (public-ok)
- Auth: `RateLimitGuard` + `PublicApiGuard`.
- Body (`UserFlowStateDTO`):
  ```ts
  {
    userId: string,                      // required
    groupId?: string,
    flowSlug?: string,                   // required in practice
    stepId?: string,                     // set when updating a specific step; omit when setting a flow-level state
    data?: string,                       // JSON-encoded payload (e.g. form values)
    actionType?: "STARTED_STEP" | "COMPLETED_STEP" | "SKIPPED_STEP" | "NOT_STARTED_STEP"
                 | "STARTED_FLOW" | "COMPLETED_FLOW" | "SKIPPED_FLOW" | "NOT_STARTED_FLOW",
    createdAt?: Date,
    context?: { url?: string, userAgent?: string, registeredCollectionIds?: string[] }
  }
  ```
- Response: `PublicUserFlowStateV2` (same shape as the GET above, re-computed after applying the state change).
- Controller: `src/user-flow-states/user-flow-states.controller.ts:221-246`.
- Notes: This is the SDK's "complete step" / "mark flow done" primitive. The skill can use it to simulate user progress for testing.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/public/flowStates" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"userId":"user-abc-123","flowSlug":"flow_abc123","stepId":"step_1","actionType":"COMPLETED_STEP"}'
  ```

## User Groups

### GET /v1/groups — get a group by groupId (private)
- Auth: `PrivateAuthGuard`.
- Query params: `groupId: string` (your app's group/org identifier).
- Response: `ExternalizedUserGroup`. `404` if not found.
- Controller: `src/user-groups/user-groups.controller.ts:67-101`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/groups?groupId=org-xyz" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### DELETE /v1/groups — delete a group (private)
- Auth: `PrivateAuthGuard`.
- Query params: `groupId: string` (required; `404` if missing or no match).
- Response: `undefined` (200 empty body).
- Controller: `src/user-groups/user-groups.controller.ts:103-131`.
- Notes: Cascades to remove group membership rows and associated tracking-event rows keyed by this group. Does not delete user rows.
- Curl template:
  ```bash
  curl -sS -X DELETE "https://api3.frigade.com/v1/groups?groupId=org-xyz" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

### POST /v1/public/groups — upsert group properties/events (public-ok)
- Auth: `PublicApiGuard`.
- Body (`AddPropertyOrEventsToUserGroupDTO`):
  ```ts
  {
    foreignUserId?: string,              // Frigade-era naming; deprecated in favor of userId
    foreignUserGroupId?: string,         // deprecated in favor of groupId
    userId?: string,
    groupId?: string,                    // required in practice
    properties?: { [key: string]: any }, // e.g. { name, companyUrl, logoUrl }
    events?: ExternalizedTrackingEvent[]
  }
  ```
- Response: `undefined` (201 empty body).
- Controller: `src/user-groups/user-groups.controller.ts:47-65`.
- Notes: Upsert semantics — creates the group if the `groupId` doesn't exist.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/public/groups" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"groupId":"org-xyz","properties":{"name":"Acme Inc.","companyUrl":"https://acme.com"}}'
  ```

### POST /v1/public/userGroups/ — alias of POST /v1/public/groups (public-ok)
- Auth: `PublicApiGuard`.
- Body: same `AddPropertyOrEventsToUserGroupDTO`.
- Response: `undefined`.
- Controller: `src/user-groups/user-groups.controller.ts:133-152`.
- Notes: Same implementation as `POST /v1/public/groups`; kept for backwards compat with older SDK versions that used the `userGroups` path segment. Prefer `POST /v1/public/groups` in new code.
- Curl template: See `POST /v1/public/groups` above — same body.

## API Keys

### GET /v1/apiKeys — list api keys for the org (private)
- Auth: `PrivateAuthGuard` + `SecureHeaders()`.
- Response: `PaginatedResult<ApiKey>` — `{ data, offset: 0, limit: 100 }`. Each `ApiKey` has `{ id, key, organizationId, createdAt, modifiedAt, type: "PUBLIC" | "PRIVATE" }`. **The `key` field is the full secret**; treat with appropriate care — don't log this response wholesale.
- Controller: `src/api-keys/api-keys.controller.ts:27-45`.
- Notes: There is **no create/delete api-key REST endpoint** — those actions happen exclusively via the dashboard UI (backed by Clerk-authenticated internal code paths that don't live in any public controller). This is a gap; see GAPS section.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/apiKeys" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

## Organization / "me"

### GET /v1/me — get the current customer + organization context (private; Clerk-only in practice)
- Auth: `PrivateAuthGuard` + `SecureHeaders()`.
- Query params:
  - `env?: string` — the dashboard passes `"dev"|"prod"` here for analytics.
  - `resyncOrganization?: "true"` — forces a background re-sync of user/event properties.
  - `selectedClerkOrganization?: string` — switches the logged-in user to a different Clerk org.
- Response: `ExternalizedCustomer` — a merged blob of customer + organization data including `primaryOrganizationId`, `primaryOrganizationDomain`, `devOrganizationId`, `userPropertyNames`, `userEventNames`, `userGroupPropertyNames`, `userGroupEventNames`, `stats` (MAUs / flow completion rollups), `totalProductionFlows`, `invoices`, `planId`, `isRateLimited`, `clerkOrganizationId`.
- Controller: `src/app.controller.ts:42-139`.
- **Skill caveat:** Although the guard accepts private API keys, the implementation **requires `request.user` (Clerk)** to populate `customerId`. With an API-key request, `customer` is `null` and the handler throws. Practically, **this endpoint is not skill-reachable** — the skill should derive org info from the fact that each private key is bound to exactly one Organization (dev or prod). The key binding itself carries the environment.
- Curl template (will fail with API key — included for reference):
  ```bash
  curl -sS "https://api3.frigade.com/v1/me" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
  ```

## CDN (Uploads)

### POST /v1/cdnUpload — upload an image/video asset (private)
- Auth: `PrivateAuthGuard`. Uses `FileInterceptor('file')` with a 100 MB max and a whitelist of mime types: `image/png`, `image/webp`, `image/jpeg`, `image/jpg`, `image/gif`, `image/svg+xml`, `video/mp4`, `video/mov`, `video/webm`.
- Body: `multipart/form-data` with a single file field named `file`. No other fields are read.
- Response:
  ```json
  { "url": "https://<cdn-host>/..." }
  ```
- Controller: `src/cdn/cdn.controller.ts:24-60`.
- Notes: The returned URL is public and can be pasted straight into flow YAML / rich-text step bodies. Files are tracked in a `CDNFile` table per org — the dashboard Media Library reads them.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/cdnUpload" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -F "file=@./hero-image.png"
  ```

## Flow Responses

### POST /v1/public/flowResponses — record a flow/step response (public-ok)
- Auth: `PublicApiGuard`.
- Body (`CreateFlowResponseDTO`):
  ```ts
  {
    foreignUserId: string,               // required — your app's user id
    foreignUserGroupId?: string,
    flowSlug: string,                    // required
    stepId: string,                      // required
    actionType: "STARTED_STEP" | "COMPLETED_STEP" | "SKIPPED_STEP" | "NOT_STARTED_STEP"
                | "STARTED_FLOW" | "COMPLETED_FLOW" | "SKIPPED_FLOW" | "NOT_STARTED_FLOW",
    data: string,                        // JSON-encoded payload
    createdAt: Date                      // ISO 8601 or JS Date
  }
  ```
- Response: `ExternalizedFlowResponse` (the stored response row).
- Controller: `src/flow-responses/flow-responses.controller.ts:35-49`.
- Notes: This is the lowest-level "event" primitive. `POST /v1/public/flowStates` is usually preferable from the dashboard perspective because it recomputes the whole stateful view after the transition; this endpoint is more for direct event ingestion.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/public/flowResponses" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"foreignUserId":"user-abc-123","flowSlug":"flow_abc123","stepId":"step_1","actionType":"COMPLETED_STEP","data":"{}","createdAt":"2026-04-17T12:00:00Z"}'
  ```

### GET /v1/flowResponses/export/:flowSlug — download flow responses as CSV (private)
- Auth: `PrivateAuthGuard`.
- Path params: `flowSlug: string`.
- Query params: `version: string` (the flow version to export).
- Response: `Content-Type: text/csv` — binary CSV stream. Not JSON.
- Controller: `src/flow-responses/flow-responses.controller.ts:51-71`.
- Curl template:
  ```bash
  curl -sS "https://api3.frigade.com/v1/flowResponses/export/flow_abc123?version=2" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -o responses.csv
  ```

## Integrations (CDP webhooks from us → them)

These two endpoints are technically reachable with a private key but are intended for server-to-server use from the respective CDP vendors' webhook rules — not for the skill to invoke directly. Documented for completeness.

### POST /v1/thirdParty/cdp/segment — Segment webhook ingestion (private)
- Auth: `PrivateAuthGuard`.
- Body: raw Segment payload (any shape — no DTO validation).
- Response: whatever `SegmentService.processRequest` returns, or `{}` if no body.
- Controller: `src/third-party/cdp/segment.controller.ts:16-24`.
- Notes: You configure this URL in Segment's Destination / Webhook settings to forward user/track events into Frigade.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/thirdParty/cdp/segment" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"type":"identify","userId":"user-abc","traits":{}}'
  ```

### POST /v1/thirdParty/cdp/mixpanel — Mixpanel Cohorts webhook (private)
- Auth: `PrivateAuthGuard`.
- Body: Mixpanel's webhook-event shape — `{ action: "members"|..., ... }`.
- Response: `MixpanelWebhookResponse` — `{ action, status: "success"|"failure", error? }`.
- Controller: `src/third-party/cdp/mixpanel.controller.ts:20-49`.
- Curl template:
  ```bash
  curl -sS -X POST "https://api3.frigade.com/v1/thirdParty/cdp/mixpanel" \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"action":"members","profiles":[]}'
  ```

## Types (referenced by the shapes above)

These are the externalized shapes returned by controllers; they mirror Prisma models with some fields excluded when a public key is used.

```ts
// src/flows/flows.interface.ts
interface ExternalizedFlow {
  id: number;
  name: string;
  data: string;                                 // YAML
  description: string;
  targetingLogic: string | null;
  type: "ANNOUNCEMENT" | "BANNER" | "CARD" | "CHECKLIST" | "CUSTOM" | "FORM" | "SURVEY" | "TOUR";
  triggerType: "MANUAL" | "AUTOMATIC";
  slug: string;                                 // e.g. "flow_abc123"
  organizationId?: number;                      // stripped for public keys
  customerId?: number;                          // stripped for public keys
  createdAt: Date;
  modifiedAt: Date;
  version: number;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  publishedAt?: Date;                           // stripped for public keys
  publishedById?: number;                       // stripped for public keys
  archivedAt?: Date;                            // stripped for public keys
  archivedById?: number;                        // stripped for public keys
  modifiedById?: number;                        // stripped for public keys
  archiveBehavior?: "EXIT_EXISTING_USERS" | "RESTART_EXISTING_USERS" | "RESTART_ALL_USERS";
  active: boolean;
  codeSnippet?: string;                         // stripped for public keys
  completionBehavior: "ON_ALL_STEPS_COMPLETED" | "ON_LAST_STEP_COMPLETED" | null;
  lastSeenAt?: Date;                            // stripped for public keys
  internalData?: InternalFlowData;              // only on dashboard GETs, populated server-side
}

// Nested on `internalData` for private-key calls
interface InternalFlowData {
  flowStats: FlowStats;
  createdByProfile?: MiniProfile;
  publishedByProfile?: MiniProfile;
  archivedByProfile?: MiniProfile;
  modifiedByProfile?: MiniProfile;
  rules?: ExternalizedRule[];
  productionDraftFlowId?: number;               // the id of the draft in prod (if flow is in dev)
  productionActiveFlowId?: number;              // the id of the active in prod (if flow is in dev)
}

// src/users/users.interface.ts
interface ExternalizedUser {
  id: number;
  organizationId: number;
  name: string;
  foreignId: string;                            // = userId — your app's id
  userId: string;                               // same as foreignId
  createdAt: Date;
  modifiedAt: Date;
  slug: string;                                 // e.g. "user_abc123"
  properties: string;                           // JSON-encoded; parse client-side
  imageUrl?: string;
  isGuest: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  userFlowStates: UserFlowState[];
  currentUserFlowState?: UserFlowState;
  trackingEvents?: ExternalizedTrackingEvent[];
}

// src/user-groups/user-groups.interface.ts
interface ExternalizedUserGroup {
  id: number;
  organizationId: number;
  name: string;
  foreignId: string;                            // stringified groupId
  groupId: string;                              // your app's group id
  createdAt: Date;
  modifiedAt: Date;
  slug: string;                                 // "group_abc123"
  properties: string;                           // JSON-encoded
  logo?: string;
  membersCount: number;
  trackingEvents?: ExternalizedTrackingEvent[];
  users?: ExternalizedUser[];
}

// src/user-flow-states/user-flow-states.interface.ts
interface UserFlowState {
  flowId: number;
  flowSlug: string;
  flowState: "COMPLETED_FLOW" | "STARTED_FLOW" | "NOT_STARTED_FLOW" | "SKIPPED_FLOW";
  lastStepId: string;
  userId: number;
  userSlug: string;
  foreignUserId: string;
  stepResponses: { stepId: string, latestFlowResponse: ExternalizedFlowResponse }[];
  flowResponses: ExternalizedFlowResponse[];
  shouldTrigger?: boolean;
  organizationId: number;
  flow: ExternalizedFlow;                       // lazy-loaded
  lastActionAt?: Date;
  currentStepIndex?: number;
  totalSteps?: number;
  stepsCompleted?: number;
  ineligibilityReasons: string[];
}

// src/flow-responses/flow-responses.interface.ts
interface ExternalizedFlowResponse {
  id: string;
  flowId: string;
  flowSlug: string;
  stepId: string;
  userId: number;
  userSlug: string;
  foreignUserId: string;
  data: string;                                 // JSON-encoded
  actionType: FlowState;
  createdAt: Date;
  blocked: boolean;
  hidden: boolean;
}

interface ExternalizedTrackingEvent {
  event: string;
  properties?: object;
  createdAt?: Date;
  organizationId?: number;
  createdByUserId?: number;
  createdByUserGroupId?: number;
}

interface PaginatedResult<T> {
  data: T[];
  offset: number;                               // always 0 in practice
  limit: number;                                // usually 100 or 500; see per-endpoint notes
}
```

## Error format

Nest + Fastify throws the standard shape:

```json
{
  "statusCode": 400,
  "message": "string or array of validation failures",
  "error": "Bad Request"
}
```

Examples:
- `400 Bad Request` — client-supplied validation failure (e.g. `BadRequestException('foreignUserId is required')` → `{ statusCode: 400, message: "foreignUserId is required", error: "Bad Request" }`). When `class-validator` runs on a DTO, `message` is a string array of per-field errors.
- `401 Unauthorized` — guard rejected the token. Usually `{ statusCode: 401, message: "Unauthorized", error: "Unauthorized" }`.
- `404 Not Found` — either a raw `NotFoundException('User not found')` or the `NotFoundInterceptor` tripping on a GET that returned `null`.
- `429 Too Many Requests` — the `RateLimitGuard` threw: `{ statusCode: 429, message: "Your account has used its maximum allowed MAUs. Contact Frigade support to upgrade." }`.
- `500 Internal Server Error` — any uncaught service exception (e.g. flow activation with no draft) surfaces as a 500. Fastify returns a body like `{ statusCode: 500, message: "Internal server error" }`; the original error detail is **not** echoed to the client — you have to check backend-app logs / Sentry for the stack.

Unlike GraphQL — which globally wraps all errors in the opaque `"An unexpected error occurred in graphql"` via `formatError` in `app.module.ts` — **REST errors pass through with their real message**. This makes REST the more debuggable surface for the skill when things go wrong.

## GAPS — dashboard features with no public-API path

Flag these to Eric before dogfood. Each is something the Frigade dashboard does that the skill **cannot** replicate via REST + GraphQL alone.

- **Create or revoke an API key.** `GET /v1/apiKeys` lists them, but no REST or GraphQL endpoint issues or revokes. The dashboard does this through Clerk-authenticated internal paths that aren't exposed on any public controller. Skill workaround: ask the user to create the key in the dashboard and copy-paste it.
- **Dev → prod promotion of flows as a single operation.** The dashboard implements this as a client-side orchestration: `GET /v1/flows/:id` in dev → fetch the `internalData.productionDraftFlowId` / `productionActiveFlowId` → switch API key to prod → `POST /v1/flows/:id/versions` or `PUT /v1/flows/:id` depending on whether a draft already exists. See `frigade-web/src/components/dialogs/dialog-copy-flow-to-prod.tsx`. The skill can reproduce this by calling the primitives itself — document the multi-call shape in a recipe.
- **Organization / customer read via API key.** `GET /v1/me` is Clerk-only in practice (see caveat above). No REST endpoint returns "what organization is this key bound to" without going through Clerk. Skill workaround: the key binding itself is implicit (dev vs prod), so the skill should ask the user to confirm which environment they expect to operate in instead of trying to read it.
- **Environment / organization create / rename.** No public endpoint exists for either environment provisioning (dev org creation happens as a side effect of Clerk sign-up via `BootstrapService`) or renaming. These are Clerk-session-only.
- **Rules + collections + webhook subscriptions + integrations.** Only available through GraphQL (see `graphql-schema.md`); no REST mirror. For the skill, that's fine — GraphQL is equally skill-reachable with the same key.
- **Changelog publish.** `ChangelogsService` writes audit rows as a side-effect of flow mutations. There is no user-facing "publish changelog" endpoint; the dashboard surfaces them via `changelog`/`changelogs` GraphQL queries only.
- **Triggers (cron-style flows).** `TriggersModule` exists in backend-app but has **no controller and no resolver** — it runs entirely as a server-side scheduled service. The graphql-schema.md claim that `src/triggers/triggers.controller.ts` exists is incorrect (no such file in the commit snapshot). There is no API to create/modify triggers; they're plumbed internally via flow-level `triggerType` settings on the flow row. Flag this correction for the graphql-schema.md author.
- **User-group create/update with only a group record (no user).** `POST /v1/public/groups` requires a group id and always upserts properties/events — there is no separate "register a group without adding data" endpoint. Not a real gap in practice since any `POST /v1/public/groups` with just `{ groupId, properties: {} }` works.
- **Publish / unpublish flow as distinct ops.** There is no `/unpublish` or "disable flow" REST endpoint. The closest are `PUT /v1/flows/:numericFlowId` with `{ active: false }` (turns the flow off from serving) or `PUT /v1/flows/:id/activate` (publishes a draft → active). Archiving a flow happens as a side effect of activating its replacement — not as a standalone action.

## Endpoints NOT covered here (cross-reference)

- **All rules, collections, integrations, webhook-subscriptions, analytics-events, changelogs operations** — GraphQL-only. See `graphql-schema.md`.
- **Triggers** — no public API at all (see GAPS).
- **Incoming webhook receivers** — `POST /v1/webhooks/clerk`, `POST /v1/webhooks/stripe`, `POST /v1/thirdParty/payment/stripe`, `POST /v1/thirdParty/cdp/heap`, `POST /v1/thirdParty/digitalocean/*`. These are handlers for **us receiving** from third parties, not endpoints **we call**. Skip from the skill.
- **Root ping** — `GET /` returns `undefined`. No value to the skill.
