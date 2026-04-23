# Targeting & Rules

How to decide who sees a flow. Read this when the task is "show this to X users and nobody else," when editing `targetingLogic` on a flow, when authoring step-level `startCriteria` / `completionCriteria` / `visibilityCriteria`, or when deciding whether to use a Rule/Collection at all.

**Source of truth.** All DSL behavior documented here is lifted from `backend-app/src/triggers/triggers.service.ts` (the evaluator, ~1552 lines, the only place the expression is actually parsed) and `backend-app/src/rules/` (the Rule/Collection entities). Public docs at `docs/platform/targeting.mdx` and `docs/platform/collections.mdx` cover the user-facing surface but are not the complete spec.

Cross-refs:
- **`yaml-spec.md`** — the `completionCriteria` / `startCriteria` / `visibilityCriteria` step fields that use the same DSL.
- **`rest-endpoints.md`** — `PUT /v1/flows/:id` for writing `targetingLogic`.
- **`graphql-schema.md`** — `Rules` (resolver + mutations: `createRule`, `updateRules`, `deleteRule`, `syncRuleToProd`).
- **`operations.md`** — end-to-end "set audience on a flow" recipe.

## Two separate mechanisms, do not confuse them

1. **Inline `targetingLogic` on a flow** (per-flow DSL string). Stored at `Flow.targetingLogic: string?`. Evaluated per user at flow-fetch time by `TriggersService.checkShouldTrigger`. **This is the DSL reference this file documents.** Most "who sees it" logic belongs here.

2. **Named `Rule` / Collection entities** (orchestration containers). `Rule` is the legacy database name for what the dashboard now calls a **Collection**. A Rule/Collection is a **bucket of flows** with cool-offs, priorities, and allowed component types — *not* an expression. There is no DSL on a Rule. You put flows into Rules to govern *which eligible flow to show when multiple are eligible* (cool-offs, ordering). Each flow still carries its own `targetingLogic` string that decides individual eligibility.

   This is confirmed from `backend-app/src/rules/rules.interface.ts:9-57` (the `ExternalizedRule` type has `coolOffPeriod`, `coolOffUnit`, `allowedComponents`, `order`, `enabled`, flows — no DSL field) and `backend-app/src/rules/rules.service.ts` (only CRUD + cool-off logic, no expression evaluator).

   **Implication:** There is no `rule:<slug>` shorthand in `targetingLogic`. You cannot reference a Rule from a DSL expression. Rules and `targetingLogic` are orthogonal axes — the flow's own `targetingLogic` gates individual eligibility; its Rule/Collection membership gates scheduling/priority/cool-off against siblings.

## DSL at a glance

```
(user.property('email') endsWith '@frigade.com' && user.property('plan') == 'pro')
|| user.property('accountCreatedDate') within 7d
```

The DSL looks JavaScript-ish but is not JS. It's evaluated by `TriggersService.checkShouldTrigger` via a multi-pass regex pipeline that rewrites LHS expressions into literal values, then hands the result to the `boolean-parser` npm package. The pipeline is ordered; see **Evaluation pipeline** at the bottom for the exact sequence (matters when debugging).

**Hard facts about the syntax:**
- The whole thing is a single string, max 2000 chars (over that, evaluator replaces with `true == false` and bails — `triggers.service.ts:1372-1375`). Keep expressions compact.
- Outer wrapping parentheses are required for compound expressions as written by the dashboard audience-builder: it groups like `(term1) && (term2) || (term3)`. Nested parens (`((...))`) cause the dashboard to flag the expression as **legacy / unsupported** (`frigade-web/src/components/audience/audience-builder.tsx:73-77`) — the evaluator still accepts them, but you'll lose editability in the UI.
- String literals must use **single quotes** (`'value'`). Double quotes are auto-converted to single quotes pre-parse (`triggers.service.ts:1318`), but author in single quotes to avoid surprises.
- `&&` / `||` are canonical. `AND` / `OR` also work (internal rewrite at `triggers.service.ts:1311-1312`).
- `===` and `!==` are normalized to `==` / `!=` (`triggers.service.ts:1324-1325`).

## Operators (enumerated from source)

### Logical

| Operator | Notes |
|---|---|
| `&&` | Conjunction. Dashboard-preferred form. |
| `\|\|` | Disjunction. |
| `AND`, `OR` | Aliases. Rewritten to `&&`/`\|\|` before parsing. |

There is **no `not` keyword**. Negate by flipping the operator (`!=` instead of `not ==`), by using a bang-prefixed op (`!contains`, `!isIn`, `!within`, `!matches`), or by testing `== false` / `!= true`.

### Comparison (numeric / equality)

| Operator | Notes |
|---|---|
| `==`, `===` | Equality. `===` normalized to `==`. |
| `!=`, `!==` | Inequality. `!==` normalized to `!=`. |
| `>`, `<`, `>=`, `<=` | Numeric comparison. If one side is a number and the other is not a number (and not `null`), **evaluator returns `false`** — no implicit coercion (`triggers.service.ts:413-418`). |

### String

| Operator | LHS forms it works on | Notes |
|---|---|---|
| `contains` / `!contains` | `user.property('…')`, `group.property('…')`, `user.currentUrl()` | Case-**insensitive** substring match (`triggers.service.ts:585-591`). Also searches inside serialized JSON for object/array property values. |
| `startsWith` / `!startsWith` | any string-typed LHS | Shorthand. Rewritten internally to `matches '^<literal>.*'` (`triggers.service.ts:1397-1405`). Regex-escape the literal yourself if it contains regex metacharacters. |
| `endsWith` / `!endsWith` | any string-typed LHS | Shorthand. Rewritten to `matches '.*<literal>'`. Same metachar caveat. |
| `matches` / `!matches` | any string-typed LHS | RE2 regex match. Runs via [`re2js`](https://www.npmjs.com/package/re2js), so Perl-only features (backreferences, lookaheads) are **not** supported — RE2 syntax only. |

### Collection

| Operator | Notes |
|---|---|
| `isIn` | `user.property('country') isIn 'US,CA,UK'` — comma-separated values inside a quoted string. True if the user's property is any of the listed values. |
| `!isIn` | Inverse. Also supports `user.memberOfGroup() !isIn 'groupA,groupB'`. |

### Presence

| Operator | Notes |
|---|---|
| `isSet true` | Shorthand for `!= null` (`triggers.service.ts:1420-1426`). |
| `isNotSet true` | Shorthand for `== null`. |

### Time / relative-date

| Operator | Notes |
|---|---|
| `within <N><unit>` | True if LHS timestamp is within the last N units. Unit letters: `s` (seconds), `i` (minutes), `h` (hours), `d` (days), `w` (weeks), `m` (months = 30d). Example: `user.property('signup') within 7d`. Lowered at parse time to `> (Date.now() - N*unit)`. |
| `!within <N><unit>` | True if LHS is older than N units. Lowered to `< (Date.now() - N*unit)`. |

For flow state, `within`/`!within` is also supported on the `user.flow('…')` form; the evaluator rewrites it via `user.daysSinceFlowDone(...)` (`triggers.service.ts:804-820`). Note the **inversion** — `user.flow('x') > <ms>` becomes `daysSinceFlowDone < …`; this is an implementation detail, you mostly don't need to think about it, just use `within` / `!within` directly.

## Left-hand-side (LHS) sources

The evaluator resolves each of these to a literal value before boolean parsing. If a source returns nothing, it generally becomes `null` and the comparison degrades to `false == true` (i.e. `false`) — see **Error / unknown behavior** below.

### User properties

| LHS | What it resolves to |
|---|---|
| `user.property('key')` | Value of `user.properties.<key>` (set via `POST /v1/public/users` or the SDK `identify`). |
| `user.properties.key` | Same as above, dotted form. |
| `user.propertyContains('key', 'substring')` | Boolean. Case-insensitive `includes` — works on strings, JSON-stringified objects, and arrays. **Not supported by the dashboard audience-builder** (`frigade-web/.../audience-builder.tsx:70-72`); authoring via API is fine. |
| `user.daysSinceNow('key')` | `N` such that the property's date is `N` days before now. Pair with `>`/`<`. Rewritten via `new Date() - 86400000 * N`. Property must hold a parsable date. |

**The property must already exist on the user.** Properties are set server-side by `upsertUser` / `POST /v1/public/users` (see `rest-endpoints.md`). If the property has never been set, the evaluator replaces the LHS with `null` and the expression evaluates to `false`. Setting `user.property('plan') == 'pro'` and expecting it to work "soon" after identify: confirm the identify call has landed first.

### Session / identity flags

| LHS | Resolves to |
|---|---|
| `user.isGuest()` | `true` if `user.foreignId` begins with the string `guest` (convention: anonymous SDK users are created with IDs like `guest_<random>`), else `false` (`triggers.service.ts:1244-1261`). |
| `user.memberOfGroup() == 'groupA,groupB'` | `true` if the user is a member of any of the listed group **foreign IDs**. `!=` / `isIn` / `!isIn` all supported. Reads `user.properties.groupIds` (array of group foreign IDs set when the user is added to a group — see `operations.md` user-group ops). |
| `user.memberOfGroup('groupA,groupB')` | Legacy single-arg form. Still supported (`triggers.service.ts:1292-1304`). |

### Current URL

`user.currentUrl()` resolves to the URL the SDK reports via `FlowStateContext` (what the browser is on). It's **only populated when the flow is fetched with a context that includes a URL** — otherwise the expression degrades to `false == true`. Operators that work on it: `==`, `!=`, `>`, `<`, `<=`, `>=`, `contains`, `!contains`, `matches`, `!matches`. No URL-parsing helpers — match on the raw string (use `endsWith '?myParam=123'`, `contains '/settings'`, or `matches`).

### Events

| LHS | Resolves to |
|---|---|
| `user.event('eventName').count` | Integer — total events with that name for this user, all-time. |
| `user.eventCount('eventName')` | Shorthand. Auto-rewritten to the `.count` form. |
| `group.event('eventName').count` | Integer — total events for the user's group. Internally rewritten to `organization.event(…)` (legacy alias). |
| `group.eventCount('eventName')` | Shorthand. |

Events are fetched by the evaluator with a separate DB call per expression — be sparing in how many distinct event names you reference in a single `targetingLogic` string.

### Flow state (cross-flow dependencies)

| LHS | Resolves to |
|---|---|
| `user.flow('flow_slug')` | One of: `NOT_STARTED_FLOW`, `STARTED_FLOW`, `COMPLETED_FLOW`, `SKIPPED_FLOW` (string, compare with `==`). If the referenced flow does not exist in the org, the expression is replaced with `false` (`triggers.service.ts:757`). |
| `user.flow('flow_slug') within 30d` | Shorthand for "completed within the last 30d." Rewritten to `daysSinceFlowDone('flow_slug') > …`. |
| `user.daysSinceFlowDone('flow_slug')` | Number of days since the flow was completed/skipped. If the flow is not yet done, resolves to `false` (which collapses subsequent comparisons to false). Note: **not supported by the dashboard audience-builder** — API-only. |
| `user.flowStep('flow_slug', 'step_id')` | One of `NOT_STARTED_STEP`, `STARTED_STEP`, `COMPLETED_STEP`. |
| `user.flowStepData('flow_slug', 'step_id', 'field_id')` | The literal value the user submitted for that field on that step. Useful for branching surveys: `user.flowStepData('nps-flow', 'score', 'nps_score') < '7'`. |

### Group / organization

| LHS | Notes |
|---|---|
| `group.property('key')`, `group.properties.key`, `group.propertyContains('key', '…')` | Same semantics as `user.property*`, but over the user's active group. |
| `organization.property('key')` | Legacy alias, rewritten to `group.property('key')` (`triggers.service.ts:700-703`). |

### Dates / time

| LHS | Notes |
|---|---|
| `now()` | Rewritten to `new Date()` then to `Date.now()` (ms epoch). |
| `new Date()` | Rewritten to `Date.now()`. |
| ISO-ish date literals | Multiple formats accepted: `'2023-03-01T00:00:00Z'`, `'2023-03-01T00:00'`, `'2023-03-01 00:00:00'`, `'2023-03-01'`. All are converted to ms epoch (`triggers.service.ts:1161-1182`) so you can write `user.property('createdAt') > '2023-03-01 00:00:00'` directly. |

Numeric arithmetic inside the string is evaluated (e.g. `Date.now() - 86400000 * 7` — `triggers.service.ts:1191-1242`), but you almost never need this: prefer `within 7d`.

## Built-in helpers summary

There are no "user-defined functions" — just the fixed set of LHS forms above. The table below is the complete list of function-shaped things you can write:

| Helper | Returns | Use for |
|---|---|---|
| `user.property('k')`, `user.properties.k` | any | Reading user custom props. |
| `user.propertyContains('k', 'sub')` | boolean | Case-insensitive substring on a user prop (supports JSON-stringified values). |
| `user.daysSinceNow('k')` | number | Days since a user-prop date. Pair with `<`/`>`. |
| `user.isGuest()` | boolean | Anonymous check. |
| `user.currentUrl()` | string | Current URL, context-dependent. |
| `user.memberOfGroup()` / `user.memberOfGroup('…')` | boolean | Group membership by foreign ID. |
| `user.event('name').count`, `user.eventCount('name')` | number | Total matching events for the user. |
| `user.flow('slug')` | string (flow state) | Cross-flow dependency. |
| `user.flowStep('slug','step')` | string (step state) | Cross-step dependency. |
| `user.flowStepData('slug','step','field')` | any | Read a previously-submitted form value. |
| `user.daysSinceFlowDone('slug')` | number | Time-window on a completed flow (API-only — dashboard rejects). |
| `group.property('k')`, `group.properties.k`, `group.propertyContains(...)` | any / boolean | Group props. |
| `group.event('name').count`, `group.eventCount('name')` | number | Group events. |
| `organization.property('k')` | any | Legacy alias for `group.property('k')`. |
| `now()`, `new Date()` | number (ms) | Current time. |

## Audience examples

All of these are drop-in for `flow.targetingLogic` (or any step-level `startCriteria` / `completionCriteria` / `visibilityCriteria` — same DSL).

### New users in the last 7 days who haven't completed onboarding

```
(user.property('accountCreatedDate') within 7d) && (user.flow('flow_welcome-tour') != 'COMPLETED_FLOW')
```

Swap `flow_welcome-tour` for the real slug of the onboarding flow. If the referenced flow doesn't exist, the right side evaluates to `false` and nothing is shown — verify the slug first.

### Paid-plan users on the `/settings` page

```
(user.property('plan') == 'pro') && (user.currentUrl() contains '/settings')
```

Requires both:
1. `plan` has been set on the user via `identify` / `upsertUser` before this evaluation runs.
2. The SDK is passing the current URL in the fetch context (default for `@frigade/react`).

### Users in group `admins` but not in group `internal`

```
(user.memberOfGroup() == 'admins') && (user.memberOfGroup() != 'internal')
```

`admins` / `internal` here are group **foreign IDs** (the external ID you created the group with), not numeric `Group.id` values.

### Users who completed flow X but not flow Y

```
(user.flow('flow_product-tour') == 'COMPLETED_FLOW') && (user.flow('flow_power-features') != 'COMPLETED_FLOW')
```

Classic "next step in a sequence" targeting. Combine with a Rule/Collection if you also need cool-off ordering — the `targetingLogic` gates eligibility per-flow; the Rule/Collection decides which eligible flow to show at the top of the queue.

### Users who submitted NPS score 7+ in an earlier flow

```
user.flowStepData('flow_nps-survey', 'score-step', 'nps_score') >= '7'
```

Numeric values inside `flowStepData` come back as strings; the evaluator still does numeric comparison if both sides parse as numbers (`triggers.service.ts:413-418`).

### Enterprise users seeing a billing nudge, idempotent to "already reminded within 30d"

```
(user.property('plan') == 'enterprise') && (user.flow('flow_billing-reminder') !within 30d)
```

The right side is true only when the billing-reminder flow either hasn't been completed or was completed more than 30 days ago.

### Users who have logged in more than 10 times AND seen the upsell feature

```
(user.event('login').count > 10) && (user.event('upsell_feature_used').count > 0)
```

Each `user.event(...)` adds a DB lookup, so keep the count of distinct event names small per expression.

## Applying rules to flows

### Inline `targetingLogic` (the common case)

Set the `targetingLogic` string on the flow itself.

**REST** (authoritative — no `PATCH`; `PUT` with a partial body is the idiom — see `rest-endpoints.md`):
```bash
curl -sS -X PUT "https://api3.frigade.com/v1/flows/<numericFlowId>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "targetingLogic": "(user.property('\''plan'\'') == '\''pro'\'') && (user.currentUrl() contains '\''/settings'\'')"
  }'
```

Notes:
- The path param is the **numeric** flow id, not the slug. `GET /v1/flows/:slug` accepts either; `PUT /v1/flows/:numericFlowId` requires numeric. Look up the id first with a list-flows call.
- The body is partial — only `targetingLogic` is sent; other fields on the flow remain unchanged.
- Setting `targetingLogic` to `""` (empty string) or omitting it **disables targeting** for this flow (evaluator short-circuits on length ≤ 1 — `triggers.service.ts:132, 337`). This is the way to revert to "everyone eligible."

**GraphQL** (for dashboard parity) — use the same mutation the dashboard uses (see `graphql-schema.md` → Flows section).

### Named Rule / Collection (orchestration, not DSL)

Create a Rule/Collection when you need **cool-offs, priorities, or allowed-component type gates** across multiple flows. Do NOT expect it to contain a DSL expression — it doesn't.

GraphQL mutations (see `graphql-schema.md`):

```graphql
mutation {
  createRule(
    name: "Upsell campaign"
    description: "All upsell flows, max 1 per day"
    flowIds: [1234, 5678]
    coolOffPeriod: 1
    coolOffUnit: DAYS
  ) { id slug name }
}
```

Then add/remove flows later with `updateRules(rules: [{ id, flowIds: […] , …}])`. Each flow's own `targetingLogic` still controls individual eligibility.

## Preview: "how many users match this right now?"

Yes, the API supports dry-run — **via GraphQL only** (see `graphql-schema.md` → Users).

- `Query.users(query: "targeting:<your DSL>", skip: 0, take: 50)` — returns up to 50 matching users (sampled).
- `Query.usersCount(query: "targeting:<your DSL>")` — returns an **estimated total count** (the backend samples users and extrapolates — `backend-app/src/users/users.service.ts:923-952`; `findByTargeting` returns `{ estimatedTotalCount, users }`).

Example:
```graphql
query {
  users(query: "targeting:user.property('plan') == 'pro'", skip: 0, take: 50) {
    id
    foreignId
    email
  }
  usersCount(query: "targeting:user.property('plan') == 'pro'") {
    name
    count
  }
}
```

**Caveats:**
- `usersCount` is an estimate, not exact (sampling-based p95 confidence — see the source). Treat it as "order of magnitude" for previews.
- There is **no REST endpoint** for this — GraphQL only.
- Complex expressions (many event counts, many flow state lookups) can be slow; the evaluator does one DB call per event/flow-state reference *per user in the sample*.

## Error / unknown-property behavior (important)

The DSL is designed to **silently evaluate to false** on most invalid inputs rather than erroring. Concretely:

| Situation | Behavior |
|---|---|
| Parse failure in `boolean-parser` | `checkShouldTrigger` catches the throw and `return false`. No 400/422 is surfaced. |
| Unknown `user.property('x')` (never set) | Replaced with `null`. Comparisons to `null` become `false`. Comparisons using `isSet true` / `isNotSet true` work correctly. |
| Unknown `user.flow('x')` (slug doesn't exist) | Replaced with `false` — whole subexpression false. |
| Unknown `user.flowStep('x', 'y')` | Unmatched expressions get rewritten to `false == true` → `false`. |
| Numeric/string type mismatch in `>`/`<`/`>=`/`<=` (one side numeric, one side non-numeric non-null) | `return false` (`triggers.service.ts:413-418`). |
| Expression longer than 2000 chars after rewriting | Replaced wholesale with `true == false` → flow is hidden. |
| `Maximum call stack size exceeded` during parse | Logged to `console.error` with `organizationId` and the first 100 chars; evaluator returns `false`. |
| Empty or length-≤1 `targetingLogic` | Short-circuits to "no targeting" — flow is eligible for everyone. |

**The headline implication:** there's no "syntax error" feedback loop. If your expression is malformed, every user quietly fails it. Test by pairing a write with a `users(query: "targeting:…")` preview and checking you get the count you expect.

**There is also no 400/422 response from `PUT /v1/flows/:id`** for invalid DSL — the string is stored as-is; the failure only shows up at evaluation time. Don't rely on the write endpoint to validate.

## Evaluation pipeline (debug reference)

When an expression doesn't do what you expect, the order of rewrite passes matters. Source: `TriggersService.checkShouldTrigger`, `triggers.service.ts:330-481`. The string is transformed in-place by each pass; if a pass is wrong about your input, subsequent passes see the mangled version.

1. `trimAndCleanBooleanExpressions` — `&&`/`||` → `AND`/`OR`, `===`/`!==` → `==`/`!=`, `"` → `'`, line breaks stripped.
2. `parseShorthandOperators` — `startsWith`/`endsWith` → `matches`; `isSet true` / `isNotSet true` → `!= null` / `== null`; `within Nu` → absolute timestamps.
3. `parseUserProperties` — `user.property('k')` and `user.properties.k` replaced with literal values; `user.currentUrl()` resolved against `context.url` or replaced with `false == true` if no URL context.
4. `parseIsGuest` — `user.isGuest()` → `true`/`false` based on `foreignId`.
5. `parseMemberOfGroup` — both `user.memberOfGroup() ==/!= 'a,b'` and `user.memberOfGroup('a,b')` forms resolved.
6. `parseUserTrackingEvents` — `user.eventCount(x)` → `user.event(x).count` → literal integer (1 DB call per distinct event name).
7. (If user has a group) `parseGroupProperties` + `parseUserGroupTrackingEvents` — same for group context.
8. `parseDependentFlowsStates` — `user.flow('slug')` → one of `NOT_STARTED_FLOW` / `STARTED_FLOW` / `COMPLETED_FLOW` / `SKIPPED_FLOW` / `false`.
9. `parseDependentFlowSteps` — `user.flowStep(...)` and `user.flowStepData(...)` resolved.
10. `parseDependentFlowWithTimeSinceDone` — `user.flow(x) </>` date rewritten via `daysSinceFlowDone`.
11. `replaceAlLDatesWithUnixTimestamps` — `now()`, `new Date()`, ISO strings → ms-epoch integers; numeric arithmetic folded.
12. `cleanUpUncaughtProps` — any remaining `user.property/...` leftovers → `null`; oversize strings → `true == false`.
13. `parseBooleanExpression` — ensures each side of an AND/OR has an explicit `== true` where only a bare literal remains.
14. A regex pass rejects obvious type mismatches around `==/!=/>/< /<=/>=` (returns `false` for number-vs-non-number).
15. Hand off the scrubbed string to `require('boolean-parser').parseBooleanQuery(...)` and evaluate each comparison via `booleanWithOperator` (`==`, `!=`, numeric for `<`, `<=`, `>`, `>=`).

If you're suspicious of a particular pass, add a temp log in the evaluator or narrow the expression incrementally.

## Common gotchas

- **Evaluation is server-side, at flow-fetch time.** The client can't override it; you can't pass "force show" from `@frigade/react`. Change the flow's `targetingLogic` and re-fetch.
- **No `rule:<slug>` syntax.** Rules/Collections are not DSL-addressable. Keep per-user logic in `targetingLogic`; use Rules only for orchestration. (Confirmed absent from `triggers.service.ts` — there is no rewrite pass for `rule:`.)
- **Flow state targeting forces build order.** A flow whose `targetingLogic` references `user.flow('flow_X') == 'COMPLETED_FLOW'` needs `flow_X` to exist *before* the new flow is written, or the evaluator will collapse the reference to `false` and the flow will be hidden from everyone. Build the dependency first, confirm its slug, then write the dependent flow.
- **Custom user properties must be upserted first.** `user.property('plan') == 'pro'` returns `false` until `POST /v1/public/users` has landed with `properties: { plan: 'pro' }` for that user. If you're writing targeting for a property you just introduced, verify the property exists on representative users (`GET /v1/users/:foreignId`) before relying on it.
- **Group targeting uses foreign IDs, not numeric IDs.** `user.memberOfGroup() == 'acme_inc'` matches users whose `groupIds` array contains the foreign ID `acme_inc`, set when the user was added to the group. If you don't know the foreign ID, list groups from the GraphQL schema (`graphql-schema.md` → Groups).
- **Dashboard audience-builder is strict about what it can round-trip.** Expressions containing `daysSinceFlowDone`, `user.propertyContains`, or doubly-nested parens (`((...))`) cause the dashboard to mark the flow as "legacy targeting" and push users to the v1 UI (`frigade-web/src/components/audience/audience-builder.tsx:63-78`). The evaluator *accepts* all of these — but the user will lose editability in the modern dashboard. If UI-editability matters, stick to `contains` / `within` / simple boolean grouping.
- **No `NOT` keyword.** Invert via `!=`, `!contains`, `!isIn`, `!within`, `!matches`, `!startsWith`, `!endsWith`. You can also flip the literal: `user.property('plan') == 'pro'` → negate as `user.property('plan') != 'pro'`, not `not user.property('plan') == 'pro'`.
- **Everything is string-comparison by default.** The `booleanWithOperator` function uses JS `==` for equality (loose), but only the numeric operators (`<`, `<=`, `>`, `>=`) explicitly cast with `Number(...)`. A `flowStepData` value that happens to look like a number compares fine numerically, but if you do `... == 7` (unquoted), be aware the literal `7` remains a string after the boolean-parser roundtrip. Author numeric literals consistently — either both quoted or both unquoted.
- **Relative time units.** `m` is **months** (`= 2592000000 ms` = 30d), not minutes. Minutes is `i`. This trips people up. If you need minutes, use `Ni` (e.g. `within 30i`).
- **Silent failures mean test-in-staging.** Because the DSL never returns a parse error, your only feedback loop is "did the preview count change?" Run `usersCount(query: "targeting:…")` before and after any meaningful edit.
