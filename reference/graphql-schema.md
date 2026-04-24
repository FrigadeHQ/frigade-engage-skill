# Frigade GraphQL Schema (snapshot)

**Source:** backend-app commit `d245b4fd` (pulled 2026-04-17).
**Endpoint (prod):** `https://api3.frigade.com/graphql`
**Endpoint (legacy prod alias):** `https://api.frigade.com/graphql` (older SDK builds / Storybook still point here; resolves to the same cluster)
**Auth header:** `Authorization: Bearer $FRIGADE_API_KEY_SECRET` (private key only; keys starting with `api_public_` will authenticate on read guards via `PublicApiGuard` for the REST surface, but the GraphQL resolvers documented here all use `PrivateAuthGuard` and require a key starting with `api_private_`).

## Conventions

- Every operation listed here is gated by `@UseGuards(PrivateAuthGuard)` in `backend-app/src/**/*.resolver.ts`. `PrivateAuthGuard` accepts two auth modes: (a) a Clerk session token from a signed-in dashboard user, or (b) an API key whose DB record has `type = PRIVATE`. Public/publishable keys (`api_public_*`) are rejected by the guard before the resolver runs. Inside the resolver, the actor's organization is derived from the API key's bound org — there is **no** per-request `environment` argument on the GraphQL surface; environment selection happens by which private API key you use (each key is scoped to either the dev or the prod Organization record).
- TypeScript-style notation is used for field types for readability. GraphQL kind is noted in parentheses when it differs (e.g. `ID` vs `Int`). The server uses `@nestjs/graphql` / Apollo auto-schema generation, so `Number` parameters surface as GraphQL `Float!` and numeric IDs surface as `ID!`.
- String-valued enum args (e.g. `CoolOffUnit`, `IntegrationType`, `IntegrationStatus`) are accepted as quoted strings over the wire — the resolver signature uses the TypeScript enum type but `@nestjs/graphql` serializes them as `String`.
- All list queries paginate with `skip: Int!` (min 0) and `take: Int!` (min 1, **max 50** — enforced by `PaginatedArgs` in `src/shared/models.ts`, even though the class default value is 250). Pass explicit `take <= 50`.
- Mutations generally return the mutated object with at least `{ id }` available for optimistic UI updates.
- There is **no** GraphQL mutation for create/update/delete/duplicate/publish/activate of `Flow` or `FlowResponse` — those live on the REST surface (see `skill/reference/rest-api.md`, Task 5). The single GraphQL op for `Flow` is a read by numeric id.

## Queries

### flow
Read a single flow by its numeric id.
- GraphQL: `query GetFlow($id: Float!) { flow(id: $id) { ...FlowFields } }`
- Args: `id: Float!` (the numeric `Flow.id`, not the `flow_*` slug — resolvers use number ids everywhere)
- Returns: `ExternalizedFlow` (see Types)
- Resolver: `FlowsResolver.flow` in `src/flows/flows.resolver.ts`
- Curl template:
  ```bash
  curl -X POST https://api3.frigade.com/graphql \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"query":"query GetFlow($id: Float!) { flow(id: $id) { id slug name type status version active data targetingLogic createdAt modifiedAt } }","variables":{"id":12345}}'
  ```

### userFlowStates
List user-flow-state records for an organization, optionally filtered by a user query string.
- GraphQL: `query ListUserFlowStates($skip: Int!, $take: Int!, $userQuery: String) { userFlowStates(skip: $skip, take: $take, userQuery: $userQuery) { ...UserFlowStateFields flow { id slug name type } } }`
- Args: `skip: Int!` (default 0), `take: Int!` (default 250 in code but capped at 50), `userQuery: String` (optional; same DSL as `users` query — supports prefixes like `flowId:<id>`, `userGroupId:<id>`, `targeting:<expr>`, or a free-text substring over foreignId/email/name)
- Returns: `[UserFlowState]`
- Resolver: `UserFlowStatesResolver.userFlowStates` in `src/user-flow-states/user-flow-states.resolver.ts`
- The nested `flow` field is a `@ResolveField` that lazy-loads the related `ExternalizedFlow` per state row.
- Curl template:
  ```bash
  curl -X POST https://api3.frigade.com/graphql \
    -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"query":"query ListUserFlowStates($skip: Int!, $take: Int!, $userQuery: String) { userFlowStates(skip: $skip, take: $take, userQuery: $userQuery) { flowId flowSlug flowState lastStepId userSlug foreignUserId lastActionAt currentStepIndex totalSteps stepsCompleted ineligibilityReasons } }","variables":{"skip":0,"take":50,"userQuery":"flowId:12345"}}'
  ```

### users
List users with a flexible query DSL. Used by the Users page in the dashboard.
- GraphQL: `query ListUsers($skip: Int!, $take: Int!, $query: String, $startDate: DateTime, $endDate: DateTime) { users(skip: $skip, take: $take, query: $query, startDate: $startDate, endDate: $endDate) { ...UserFields } }`
- Args: `skip: Int!`, `take: Int!`, `query: String` (optional), `startDate: DateTime` (optional), `endDate: DateTime` (optional)
- `query` DSL supported prefixes (from `UsersResolver.users`):
  - `targeting:<expression>` — run a targeting-logic eval against user properties/events
  - `flowId:<numericFlowId>[query:<action>]` — users who triggered a flow; `<action>` ∈ {`completed`, `skipped`, `dismissed`, `inprogress`, `incomplete`, `in progress`, `started`, `COMPLETED_FLOW`, `SKIPPED_FLOW`, `STARTED_FLOW`}
  - `userGroupId:<numericGroupId>[query:<freetext>]` — group members, optionally filtered
  - anything else — substring match on `foreignId`, `email`, `name`, etc.
- Returns: `[ExternalizedUser]`. Nested resolvers available on each user: `userFlowStates`, `currentUserFlowState`, `trackingEvents`.
- Resolver: `UsersResolver.users` in `src/users/users.resolver.ts`

### user
Read a single user by numeric id. (The arg is named `slug` in the schema for legacy reasons but accepts a `Float!` and passes it through to `usersService.get(orgId, id)`.)
- GraphQL: `query GetUser($slug: Float!) { user(slug: $slug) { id foreignId userId email firstName lastName properties } }`
- Args: `slug: Float!` — **the numeric `User.id`**, despite the argument name.
- Returns: `ExternalizedUser`
- Resolver: `UsersResolver.user` in `src/users/users.resolver.ts`

### getTotalUsers
Facet count for the `users` query — used to populate the Total pill in paginated tables.
- GraphQL: `query GetTotalUsers($skip: Int!, $take: Int!, $query: String, $startDate: DateTime, $endDate: DateTime) { getTotalUsers(skip: $skip, take: $take, query: $query, startDate: $startDate, endDate: $endDate) { name count } }`
- Args: same as `users`.
- Returns: `[FacetCount]` — in practice always a one-element array with `name: "Total"`.
- Resolver: `UsersResolver.getTotalUsers`

### userGroups
List user groups.
- GraphQL: `query ListUserGroups($skip: Int!, $take: Int!, $query: String) { userGroups(skip: $skip, take: $take, query: $query) { id name foreignId groupId properties membersCount createdAt } }`
- Args: `skip: Int!`, `take: Int!`, `query: String` (optional — substring over name/foreignId)
- Returns: `[ExternalizedUserGroup]`. Nested `@ResolveField` fields: `trackingEvents`, `users`.
- Resolver: `UserGroupsResolver.userGroups` in `src/user-groups/user-groups.resolver.ts`

### userGroup
Read a single user group by numeric id. Same `slug` naming quirk as `user` — it's a `Float!`.
- GraphQL: `query GetUserGroup($slug: Float!) { userGroup(slug: $slug) { id name foreignId groupId properties membersCount } }`
- Args: `slug: Float!` — the numeric `UserGroup.id`.
- Returns: `ExternalizedUserGroup`
- Resolver: `UserGroupsResolver.userGroup`

### getTotalUserGroups
Facet count for `userGroups`.
- GraphQL: `query GetTotalUserGroups($skip: Int!, $take: Int!, $query: String) { getTotalUserGroups(skip: $skip, take: $take, query: $query) { name count } }`
- Args: same as `userGroups`
- Returns: `[FacetCount]`
- Resolver: `UserGroupsResolver.getTotalUserGroups`

### trackingEvent
Read a single tracking event by id.
- GraphQL: `query GetTrackingEvent($id: Float!) { trackingEvent(id: $id) { event properties createdAt createdByUserId createdByUserGroupId } }`
- Args: `id: Float!`
- Returns: `ExternalizedTrackingEvent`
- Resolver: `TrackingEventsResolver.trackingEvent` in `src/user-groups/tracking-events.resolver.ts`

### rules
List rules (a.k.a. "collections" in the dashboard — same underlying `Rule` Prisma model).
- GraphQL: `query ListRules($skip: Int!, $take: Int!) { rules(skip: $skip, take: $take) { ...RuleFields flows { id slug name type } } }`
- Args: `skip: Int!`, `take: Int!`
- Returns: `[ExternalizedRule]`. Nested `@ResolveField flows` returns `[ExternalizedFlow]` for flows attached to the rule.
- Resolver: `RulesResolver.rules` in `src/rules/rules.resolver.ts`

### integrations
List third-party integrations connected for the org (Segment, Amplitude, HubSpot, etc.).
- GraphQL: `query ListIntegrations($skip: Int!, $take: Int!) { integrations(skip: $skip, take: $take) { id type status connectionData createdAt modifiedAt } }`
- Args: `skip: Int!`, `take: Int!`
- Returns: `[ExternalizedIntegration]`
- Resolver: `IntegrationsResolver.integrations` in `src/integrations/integrations.resolver.ts`

### hubspotProperties
Utility query: fetches HubSpot contact or company property definitions via the org's connected HubSpot integration.
- GraphQL: `query GetHubSpotProperties($objectType: String!) { hubspotProperties(objectType: $objectType) }`
- Args: `objectType: String!` (`contacts` or `companies`)
- Returns: `Object` (arbitrary JSON — uses `ObjectScalarType`)
- Resolver: `IntegrationsResolver.hubspotProperties`

### webhookSubscriptions
List webhook subscriptions for the org.
- GraphQL: `query ListWebhookSubscriptions($skip: Int!, $take: Int!) { webhookSubscriptions(skip: $skip, take: $take) { id url secret createdAt flattenData eventTypes flowId } }`
- Args: `skip: Int!`, `take: Int!`
- Returns: `[ExternalizedWebhookSubscription]`
- Resolver: `WebhookSubscriptionsResolver.webhookSubscriptions`

## Mutations

### deleteUser
Delete a single user by numeric id. Returns the deleted user shell (id only is safe to select).
- GraphQL: `mutation DeleteUser($id: Float!) { deleteUser(id: $id) { id } }`
- Args: `id: Float!`
- Returns: `ExternalizedUser` (the now-deleted row — only `id` is guaranteed useful)
- Resolver: `UsersResolver.deleteUser`

### deleteUserGroup
Delete a user group.
- GraphQL: `mutation DeleteUserGroup($id: Float!) { deleteUserGroup(id: $id) { id } }`
- Args: `id: Float!`
- Returns: `ExternalizedUserGroup`
- Resolver: `UserGroupsResolver.deleteUserGroup`

### removeUserFromUserGroup
Remove a specific user from a user group (does not delete the user or the group).
- GraphQL: `mutation RemoveUserFromUserGroup($userGroupId: Float!, $userId: Float!) { removeUserFromUserGroup(userGroupId: $userGroupId, userId: $userId) { id membersCount } }`
- Args: `userGroupId: Float!`, `userId: Float!`
- Returns: `ExternalizedUserGroup` (the updated group)
- Resolver: `UserGroupsResolver.removeUserFromUserGroup`

> Note: the `Rule` entity in this schema is product-facing known as **Collection**. All customer-facing language in recipes and prompts uses "collection"; the GraphQL schema retains the legacy `Rule` name.

### createRule
Create a new rule/collection. `coolOffPeriod` defaults to 2 and `coolOffUnit` to `DAYS` if omitted.
- GraphQL: `mutation CreateRule($name: String!, $description: String!, $flowIds: [Float!], $coolOffPeriod: Float, $coolOffUnit: String) { createRule(name: $name, description: $description, flowIds: $flowIds, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit) { id slug name color enabled order } }`
- Args: `name: String!`, `description: String!`, `flowIds: [Float!]` (optional — numeric flow ids), `coolOffPeriod: Float` (optional), `coolOffUnit: String` (optional — one of `CoolOffUnit` enum values)
- Returns: `ExternalizedRule`
- Resolver: `RulesResolver.createRule`

### updateRules
Bulk-update rules. Pass an array of `UpdateRuleDTO` — every field is required on each DTO except `flowIds` and `allowedComponents`.
- GraphQL:
  ```graphql
  mutation UpdateRules($rules: [UpdateRuleDTO!]!) {
    updateRules(rules: $rules) {
      id slug name enabled order color
    }
  }
  ```
- `UpdateRuleDTO` input type fields: `id: Float!`, `name: String!`, `description: String!`, `coolOffPeriod: Float!`, `coolOffUnit: String!`, `coolOffEnabled: Boolean!`, `color: String!`, `enabled: Boolean!`, `order: Float!`, `flowIds: [Float!]` (optional), `allowedComponents: [String!]` (optional).
- Returns: `[ExternalizedRule]`
- Resolver: `RulesResolver.updateRules`

### deleteRule
Delete a rule.
- GraphQL: `mutation DeleteRule($id: Float!) { deleteRule(id: $id) { id } }`
- Args: `id: Float!`
- Returns: `ExternalizedRule`
- Resolver: `RulesResolver.deleteRule`

### syncRuleToProd
Promote a rule from dev to prod. Takes the dev-env rule's numeric id and syncs (or creates) the equivalent rule in the prod organization. Only meaningful when the authenticated org has a linked `devOrganization` — i.e. when you are calling with a **prod** private API key that controls a dev sibling, or a dashboard user on prod.
- GraphQL: `mutation SyncRuleToProd($ruleId: Float!) { syncRuleToProd(ruleId: $ruleId) { id slug productionRuleId } }`
- Args: `ruleId: Float!` (the dev-side rule id)
- Returns: `ExternalizedRule` (the prod-side rule)
- Resolver: `RulesResolver.syncRuleToProd`

### upsertIntegration
Create or update an integration row for the org. Because the `Integration` model has a `@@unique([organizationId, type])`, a second call with the same `type` updates the existing row.
- GraphQL: `mutation UpsertIntegration($type: String!, $status: String!, $connectionData: String!) { upsertIntegration(type: $type, status: $status, connectionData: $connectionData) { id type status connectionData } }`
- Args: `type: String!` (one of `IntegrationType` enum), `status: String!` (one of `IntegrationStatus` enum), `connectionData: String!` (**JSON-stringified** — the resolver calls `JSON.parse` on it, so pass e.g. `"{\"apiKey\":\"...\"}"`)
- Returns: `ExternalizedIntegration`
- Resolver: `IntegrationsResolver.upsertIntegration`

### deleteIntegration
Delete an integration by numeric id.
- GraphQL: `mutation DeleteIntegration($id: Float!) { deleteIntegration(id: $id) { id type status } }`
- Args: `id: Float!`
- Returns: `ExternalizedIntegration`
- Resolver: `IntegrationsResolver.deleteIntegration`

### createWebhookSubscription
Register a new webhook endpoint. If `flowId` is null, the webhook fires for every flow in the org.
- GraphQL: `mutation CreateWebhookSubscription($url: String!, $flattenData: Boolean, $eventTypes: [String!], $flowId: Float) { createWebhookSubscription(url: $url, flattenData: $flattenData, eventTypes: $eventTypes, flowId: $flowId) { id url secret eventTypes flattenData flowId createdAt } }`
- Args: `url: String!`, `flattenData: Boolean` (optional, default false), `eventTypes: [String!]` (optional — see event constants: `flowResponse.startedFlow`, `flowResponse.completedFlow`, `flowResponse.skippedFlow`, `flowResponse.startedStep`, `flowResponse.completedStep`), `flowId: Float` (optional — nullable, scope to one flow)
- Returns: `ExternalizedWebhookSubscription`. The `secret` field is server-generated; capture it on create since it cannot be re-fetched plaintext later.
- Resolver: `WebhookSubscriptionsResolver.createWebhookSubscription`

### updateWebhookSubscription
Update an existing webhook subscription. All mutable fields except `id` are optional on the server (any field left `null` keeps its prior value in the service layer).
- GraphQL: `mutation UpdateWebhookSubscription($id: Float!, $url: String, $flattenData: Boolean, $eventTypes: [String!], $flowId: Float) { updateWebhookSubscription(id: $id, url: $url, flattenData: $flattenData, eventTypes: $eventTypes, flowId: $flowId) { id url eventTypes flattenData flowId } }`
- Args: `id: Float!`, plus optional `url`, `flattenData`, `eventTypes`, `flowId`
- Returns: `ExternalizedWebhookSubscription`
- Resolver: `WebhookSubscriptionsResolver.updateWebhookSubscription`

### deleteWebhookSubscription
Delete a webhook subscription.
- GraphQL: `mutation DeleteWebhookSubscription($id: Float!) { deleteWebhookSubscription(id: $id) { id url } }`
- Args: `id: Float!`
- Returns: `ExternalizedWebhookSubscription`
- Resolver: `WebhookSubscriptionsResolver.deleteWebhookSubscription`

### sendWebhookTest
Trigger a synthetic test event to a webhook subscription's URL. Returns a string (success message or human-readable error); the resolver inspects the return for `"Error"` and re-throws on the client side — treat any returned string containing `Error` as a failure.
- GraphQL: `mutation SendWebhookTest($id: Float!) { sendWebhookTest(id: $id) }`
- Args: `id: Float!`
- Returns: `String`
- Resolver: `WebhookSubscriptionsResolver.sendWebhookTest`

## Types

### ExternalizedFlow (`flow`)
Source: `src/flows/flows.interface.ts`. Backing table: `Flow` in Prisma schema.
- `id: ID` — numeric primary key (auto-increment int on the DB)
- `slug: String` — stable identifier like `flow_abc123`; same slug across environments and versions
- `name: String`
- `description: String`
- `data: String` — JSON-encoded (or YAML source, per `UpdateFlowDto` docstring) flow definition; the `steps` array lives inside this blob
- `targetingLogic: String` (nullable) — expression string, e.g. `user.property('isAdmin') == true`
- `type: FlowType` — see enum
- `triggerType: TriggerType` — `MANUAL | AUTOMATIC`
- `status: FlowStatus` — `DRAFT | ACTIVE | ARCHIVED`
- `active: Boolean`
- `version: Int`
- `organizationId: Int`
- `customerId: Int`
- `createdAt: Date`, `modifiedAt: Date`
- `publishedAt: Date` (nullable), `publishedById: Int` (nullable)
- `archivedAt: Date` (nullable), `archivedById: Int` (nullable)
- `modifiedById: Int` (nullable)
- `archiveBehavior: ArchiveBehavior` (nullable)
- `completionBehavior: FlowCompletionBehavior` (nullable) — `USER | USER_GROUP`
- `codeSnippet: String` (nullable) — original code snippet captured at create time
- `lastSeenAt: Date` (nullable)
- `internalData: InternalFlowData` (nullable) — see below

### InternalFlowData (`internalFlowData`)
Attached to `ExternalizedFlow.internalData`. Admin-facing enrichments.
- `flowStats: FlowStats`
- `createdByProfile: MiniProfile` (nullable)
- `publishedByProfile: MiniProfile` (nullable)
- `archivedByProfile: MiniProfile` (nullable)
- `modifiedByProfile: MiniProfile` (nullable)
- `rules: [ExternalizedRule]` (nullable)
- `productionDraftFlowId: Int` (nullable)
- `productionActiveFlowId: Int` (nullable)

### FlowStats (`flowStats`)
- `lastUserActionAt: Date`
- `numberOfUsersSeenFlow: Int`, `numberOfUsersStartedFlow: Int`, `numberOfUsersCompletedFlow: Int`, `numberOfUsersSkippedFlow: Int`
- `flowCompletionRate: Float`
- `stepCounts: [StepCount]` (nullable)
- `numberOfUsersCompletedFlowOverTime: [AnalyticsDataPoint]` (nullable) + `...ComparedToPreviousPeriod: Int`
- `numberOfUsersSkippedFlowOverTime: [AnalyticsDataPoint]` (nullable) + `...ComparedToPreviousPeriod: Int`
- `numberOfUsersSeenFlowOverTime: [AnalyticsDataPoint]` (nullable) + `...ComparedToPreviousPeriod: Int`
- `surveyStats: SurveyStats` (nullable)

### StepCount (`stepCount`)
- `stepId: String`, `title: String` (nullable)
- `numberOfUsersSeenStep: Int`, `numberOfUsersCompletedStep: Int`
- `index: Int`

### AnalyticsDataPoint (`flowStatsTimePoint`)
- `count: Int`, `date: Date`, `label: String`

### SurveyStats (`surveyStats`)
- `nps: [AnalyticsDataPoint]` (nullable)

### UserFlowState (`userFlowState`)
Source: `src/user-flow-states/user-flow-states.interface.ts`.
- `flowId: ID`, `flowSlug: String`
- `flowState: String` — one of `COMPLETED_FLOW | STARTED_FLOW | NOT_STARTED_FLOW | SKIPPED_FLOW` (GraphQL encodes it as `String`, not as an enum — see [Known gaps](#known-gaps--not-covered))
- `lastStepId: String`
- `userId: ID`, `userSlug: String`, `foreignUserId: ID`
- `stepResponses: [StepResponseMap]`
- `flowResponses: [ExternalizedFlowResponse]`
- `shouldTrigger: Boolean`
- `organizationId: Int`
- `flow: ExternalizedFlow` — resolved via `@ResolveField`
- `lastActionAt: Date` (nullable)
- `currentStepIndex: Int` (nullable), `totalSteps: Int` (nullable), `stepsCompleted: Int` (nullable)
- `ineligibilityReasons: [String]`

### StepResponseMap (`StepResponseMap`)
- `stepId: String`
- `latestFlowResponse: ExternalizedFlowResponse`

### ExternalizedFlowResponse (`flowResponse`)
Source: `src/flow-responses/flow-responses.interface.ts`.
- `id: ID`, `flowId: ID`, `flowSlug: String`, `stepId: ID`
- `userId: ID`, `userSlug: String`, `foreignUserId: ID`
- `data: String` — JSON blob
- `actionType: String` — `STARTED_STEP | COMPLETED_STEP | SKIPPED_STEP | NOT_STARTED_STEP | STARTED_FLOW | COMPLETED_FLOW | SKIPPED_FLOW | NOT_STARTED_FLOW`
- `createdAt: Date`
- `blocked: Boolean`, `hidden: Boolean`

### ExternalizedUser (`user`)
Source: `src/users/users.interface.ts`.
- `id: ID`, `organizationId: Int`, `slug: String`
- `name: String`, `foreignId: String`, `userId: String` (alias for foreignId on the wire)
- `email: String` (nullable), `firstName: String` (nullable), `lastName: String` (nullable), `companyName: String` (nullable)
- `imageUrl: String` (nullable)
- `isGuest: Boolean`
- `properties: String` — JSON-serialized (server can double-serialize when coming from `toExternalizedUser`; parse defensively)
- `createdAt: Date`, `modifiedAt: Date`
- `userFlowStates: [UserFlowState]` (nullable) — resolved via `@ResolveField`
- `currentUserFlowState: UserFlowState` (nullable) — resolved via `@ResolveField`; if the caller's operation text contains `flowId:<n>`, this returns the most recent state *for that flow*; otherwise the user's most recent overall state
- `trackingEvents: [ExternalizedTrackingEvent]` (nullable) — resolved via `@ResolveField`; hard-capped to the 25 most recent

### ExternalizedUserGroup (`userGroup`)
Source: `src/user-groups/user-groups.interface.ts`.
- `id: ID`, `organizationId: Int`, `slug: String`
- `name: String`, `foreignId: String`, `groupId: String` (alias for foreignId)
- `properties: String` (nullable) — JSON-serialized
- `logo: String` (nullable)
- `membersCount: Int` — populated by the list query; for `userGroup` (singular) this field reflects whatever counter is attached at the time (may be 0 from `toExternalizedUserGroup` default)
- `createdAt: Date`, `modifiedAt: Date`
- `trackingEvents: [ExternalizedTrackingEvent]` (nullable) — resolved via `@ResolveField`, 25 most recent
- `users: [ExternalizedUser]` (nullable) — resolved via `@ResolveField`; returns all members

### ExternalizedTrackingEvent (`trackingEvent`)
Source: `src/users/users.interface.ts`.
- `event: String` (the event name)
- `properties: Object` (uses `ObjectScalarType` — arbitrary JSON)
- `createdAt: Date` (nullable)
- `organizationId: Int` (nullable)
- `createdByUserId: Int` (nullable), `createdByUserGroupId: Int` (nullable)
- Nested: `user: ExternalizedUser` via `@ResolveField` on `TrackingEventsResolver`

### ExternalizedRule (`rule`)
Source: `src/rules/rules.interface.ts`. Backing table: `Rule` in Prisma schema. Note: product-facing known as **Collection**; the GraphQL type retains the legacy `Rule` name.
- `id: ID` — serialized as string over the wire; coerce to number client-side when comparing
- `organizationId: Int`, `slug: String`
- `name: String`, `description: String`
- `coolOffPeriod: Int`, `coolOffUnit: CoolOffUnit`, `coolOffEnabled: Boolean`
- `color: String`, `enabled: Boolean`
- `createdAt: Date`, `createdById: Int`, `modifiedAt: Date`, `modifiedById: Int`
- `createdByProfile: MiniProfile` (nullable), `modifiedByProfile: MiniProfile` (nullable)
- `type: CollectionType` — `CUSTOM | DEFAULT`
- `allowedComponents: [String]`
- `lastSeenAt: Date` (nullable)
- `order: Int`
- `productionRuleId: Int` (nullable) — the prod sibling id if this is a dev rule that has been synced
- `flows: [ExternalizedFlow]` — resolved via `@ResolveField`

### UpdateRuleDTO (InputType)
See the `updateRules` mutation above for required vs optional fields.

### ExternalizedIntegration (`integration`)
Source: `src/integrations/integrations.interface.ts`.
- `id: ID`, `organizationId: Int`
- `type: IntegrationType`, `status: IntegrationStatus`
- `connectionData: Object` — uses `ObjectScalarType` (returned as a real JSON object)
- `createdAt: Date`, `modifiedAt: Date`
- `createdByProfile: MiniProfile` (nullable), `modifiedByProfile: MiniProfile` (nullable)

### ExternalizedWebhookSubscription (`webhookSubscription`)
Source: `src/webhook-subscriptions/webhook-subscriptions.interface.ts`.
- `id: ID`, `url: String`, `secret: String`
- `createdAt: Date`
- `flattenData: Boolean`
- `eventTypes: [String]`
- `flowId: ID` (nullable)

### MiniProfile (`miniProfile`)
Source: `src/customers/customers.interface.ts`.
- `id: ID`, `firstName: String`, `lastName: String`, `name: String`, `email: String`, `slug: String`, `profileImageUrl: String`

### FacetCount (`facetCount`)
Source: `src/shared/models.ts`.
- `name: String`
- `count: Int`

### PaginatedArgs (`@ArgsType`)
Source: `src/shared/models.ts`. Extended by `UserQuery`, `UserGroupQuery`, `UserFlowStatesUserQueryArgs`, etc.
- `skip: Int!` — validated `>= 0`, default 0
- `take: Int!` — validated `>= 1` and `<= 50`, default 250 (but caps enforce 50 at the validator layer)

### Object (custom scalar)
Source: `src/shared/models.ts`. Name `Object`. Behaves like an arbitrary-JSON scalar — parses objects or JSON strings in, serializes objects out. Used by `trackingEvent.properties`, `integration.connectionData`, `hubspotProperties` return.

## Enums

All enum values below come from `src/database/schema.prisma` unless noted. `@nestjs/graphql` serializes them over the wire as strings; send the raw name (e.g. `"CHECKLIST"`).

### FlowType
`CHECKLIST | FORM | TOUR | SUPPORT | CUSTOM | BANNER | EMBEDDED_TIP | NPS_SURVEY | ANNOUNCEMENT | SURVEY | CARD`
(Note: `src/flows/flows.interface.ts` references `FlowType.CARD` and `FlowType.NPS_SURVEY` which exist in the enum even though they are less commonly used by the dashboard.)

### FlowStatus
`DRAFT | ACTIVE | ARCHIVED`

### TriggerType
`MANUAL | AUTOMATIC`

### FlowCompletionBehavior
`USER | USER_GROUP`

### ArchiveBehavior
`EXIT_EXISTING_USERS | RESTART_EXISTING_USERS | RESTART_ALL_USERS`

### CoolOffUnit
`SECONDS | MINUTES | HOURS | DAYS | WEEKS | MONTHS | YEARS`

### CollectionType
`CUSTOM | DEFAULT`

### IntegrationType
`SEGMENT | POSTHOG | MIXPANEL | AMPLITUDE | HEAP | HUBSPOT | SALESFORCE | ZAPIER | SEGMENT_WEBHOOK | MIXPANEL_WEBHOOK | SALESFORCE_SANDBOX`
(The web client's `IntegrationType` also includes `SLACK` and `UNKNOWN` — those are client-side aliases and not recognized by the server enum. Don't send them.)

### IntegrationStatus
`ACTIVE | INACTIVE`

### ApiKeyType
`PUBLIC | PRIVATE` — referenced by auth only; not a field on any externalized type returned from GraphQL.

### EntityType (changelogs — not exposed in GraphQL today)
`FLOW | USER | USER_GROUP`

### ChangeType (changelogs — not exposed in GraphQL today)
`CREATE | UPDATE | DELETE | ACTIVATE_VERSION | CREATE_VERSION | ACTIVATE | DEACTIVATE`

## Introspection fallback

If this snapshot is stale and Claude needs to verify the schema at runtime, introspection is enabled on all non-`production` `NODE_ENV` builds (per `GraphQLModule.forRoot({ introspection: process.env.NODE_ENV !== 'production' })` in `src/app.module.ts`). **Production has introspection disabled.** When introspecting a prod endpoint fails, fall back to running a known-safe field query (e.g. `{ rules(skip:0,take:1){ id } }`) to probe for schema drift.

```bash
curl -X POST https://api3.frigade.com/graphql \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __schema { types { name kind } queryType { fields { name args { name type { name kind ofType { name kind } } } type { name kind } } } mutationType { fields { name args { name type { name kind ofType { name kind } } } type { name kind } } } } }"}'
```

If the response is `"An unexpected error occurred in graphql"` (the server's `formatError` wraps every error into that opaque message), introspection is off — snapshot this file against a non-prod clone of the stack instead.

## Known gaps / not covered

- **Flow CRUD is REST-only via private-key auth:** `POST /v1/flows/`, `PUT /v1/flows/:numericFlowId`, `PUT /v1/flows/:id/activate`, `DELETE /v1/flows/:numericFlowId`, `POST /v1/flows/:id/versions`, `GET /v1/flows/`, `GET /v1/flows/:id`, `GET /v1/flows/:id/versions` all live on `FlowsController` in `src/flows/flows.controller.ts`. They require the private-key `PrivateAuthGuard`. Use `skill/reference/rest-api.md` (Task 5) for those.
- **Flow duplicate / publish / promote**: not GraphQL. `POST /v1/flows/:id/versions` handles version creation and `PUT /v1/flows/:id/activate` handles publish/activate. Cross-environment promotion (dev→prod) is handled by the REST flow-sync controller; GraphQL only exposes `syncRuleToProd` for rules, not for flows.
- **User-flow-state reset**: REST-only, `DELETE /v1/userFlowStates/:flowSlug/:userSlug` (see `src/user-flow-states/user-flow-states.controller.ts` via `useResetFlowState` in frigade-web).
- **User segmentation / targeting**: no dedicated `segment` or `targeting` mutation. You embed targeting logic as a string on the flow (`Flow.targetingLogic`) via the REST update endpoint, and query users by targeting via `users(query: "targeting:<expr>")`.
- **User-group create/update**: no GraphQL mutation. REST endpoints on `src/user-groups/user-groups.controller.ts` handle create/update through `AddPropertyOrEventsToUserGroupDTO`.
- **User create/update**: no GraphQL mutation. REST endpoints on `src/users/users.controller.ts` handle create/update through `AddPropertyOrEventsToUserDTO` / `SessionDTO`.
- **Organization read/update**: no GraphQL query or mutation exists. Organization info is derived from the Clerk session or API key server-side; there is no public `organization(...)` query. The dashboard pulls org data via `/v1/organization/...` REST routes under `OrganizationsService`.
- **API-keys CRUD**: no GraphQL resolver; handled by `src/api-keys/api-keys.controller.ts` (REST). Dashboard-only surface.
- **Triggers**: `TriggersModule` exposes no public surface at all — no GraphQL resolver and no REST controller. `TriggersService` is internal-only; triggers are evaluated server-side when flows/rules change. Skill cannot CRUD triggers directly.
- **Flow-responses (public writes)**: REST-only under `src/flow-responses/flow-responses.controller.ts`. GraphQL only exposes `ExternalizedFlowResponse` as a nested field on `UserFlowState`.
- **Environment enum:** There is **no** GraphQL `Environment` enum. Environment scoping in Frigade is done by binding a private API key to either the dev or prod `Organization` record. To inspect dev data, use a dev-env private key; to inspect prod, use a prod-env private key. The dashboard's `x-environment-organization` header is only honored on Clerk-authenticated (session-cookie) requests; API-key requests ignore it.
- **Enum typing for `flowState` and `actionType`**: both are serialized as `String` in GraphQL (not true enums), because the server types them as TypeScript union types rather than exporting a Prisma enum. Treat them as strings that take the documented values.
- **Operations with subtle quirks**:
  - `user(slug: Float!)` and `userGroup(slug: Float!)` accept numeric `id`s despite the arg name.
  - `take` is documented as defaulting to 250 in `PaginatedArgs` but the `@Max(50)` validator enforces 50; always set `take` explicitly.
  - `upsertIntegration.connectionData` must be a JSON-encoded **string**, not a nested object literal.
  - `sendWebhookTest` returns a plain `String`; errors are encoded in the string body rather than as a GraphQL error.
  - The server's `formatError` in `app.module.ts` collapses every resolver exception to the literal message `"An unexpected error occurred in graphql"`, so detailed errors don't come back over the wire — check server logs if a mutation silently fails.
