# Collections capability for frigade-engage — design

**Date:** 2026-04-24
**Status:** Spec — awaiting implementation plan

## Goal

Extend the `frigade-engage` skill with three collection-related capabilities:

1. **Create a collection and embed it in a Next.js app** — end-to-end, paralleling `create-announcement`.
2. **Add flows to an existing collection** — API-only.
3. **Promote a collection from dev to prod** — API-only, plus one integration test.

## Terminology (hard rule)

Frigade's backend and GraphQL schema call these entities `Rule` (see `reference/decisions.md` D31 and `reference/graphql-schema.md`). The product, dashboard, and customer docs call them **Collections**.

**User-facing language in this skill is always "collection."** The word `Rule` only appears inside GraphQL mutation payloads shown as code blocks. All recipe file names, recipe prose, SKILL.md dispatch table rows, confirmation-prompt verbs/targets, success messages, `.frigade/skill.log` event names, and `reference/operations.md` verb/target columns say `collection`, never `rule`.

This rule is explicit because the natural impulse when writing recipes against `createRule`/`updateRules`/`deleteRule`/`syncRuleToProd` is to carry the backend name through. Don't.

## Non-goals (v1)

- Listing collections, deleting collections, removing flows from a collection — deferred; add if/when explicit user need surfaces.
- Configuring cool-off periods and priorities via the skill — collections created via v1 use server defaults (2 days cool-off, `coolOffEnabled: true`). Customers can tune via dashboard; skill support can come later.
- Auto-promoting member flows when promoting a collection. `syncRuleToProd` does not move flow associations; the skill promotes the collection metadata only and tells the user how to re-link flows in prod. This matches backend semantics and avoids blast-radius surprises.
- Collection targeting rules. Collections don't carry DSL targeting — that lives on individual flows (per D31). Out of scope here.
- Pages Router, React-only, or non-Next frameworks for the embed. Same framework support as existing wiring recipes.

## Architecture

```
recipes/
├── create-collection.md               NEW — full e2e: createRule + mount <Frigade.Collection> in Next App Router
├── add-flows-to-collection.md         NEW — API-only: fetch flowIds, union, updateRules
├── promote-collection-to-prod.md      NEW — API-only: syncRuleToProd, verify prod has matching slug

SKILL.md                               MODIFY — 3 new rows in "Dispatch table — recipes"

reference/operations.md                MODIFY — 5 new rows with safety tags (createRule, updateRules, deleteRule, syncRuleToProd, rules-query)

tests/integration/
└── promote-collection.test.ts         NEW — create dev collection via REST helper, skill promotes, verify prod has the slug

tests/helpers/
├── frigade-client.ts                  MODIFY — GraphQL methods: createCollection, getCollection, updateCollections, deleteCollection
└── cleanup.ts                         MODIFY — add CollectionTracker class (mirrors FlowTracker)

package.json                           MODIFY — add test:promote-collection script
```

## Recipe specifications

### `recipes/create-collection.md` — full end-to-end

Parallels `recipes/create-announcement.md`. Phases:

1. **Preflight.** Run first-run-setup gate. Framework detection per `recipes/first-run-setup.md` — fail early with the standard "can't auto-wire this framework" message if not React/Next.
2. **Resolve parameters.** Collection `name` (required, prompt user if missing). Optional `description`. Optional `coolOffPeriod` + `coolOffUnit`. Defer anything else to server defaults.
3. **Confirmation (prod only).** Per D09 and `reference/operations.md`: `createRule` is `safe` in dev, `dangerous` in prod. Emit canonical prompt when targeting prod.
4. **API call.** POST to GraphQL `createRule(name, description, coolOffPeriod?, coolOffUnit?)`. Capture returned `{ id, slug }` from the `ExternalizedRule` response.
5. **Code emission batch (atomic per D16).**
   - Ensure `@frigade/react` is installed (reuse the pattern in `create-announcement.md` §"install the package"); if the provider isn't already mounted in `app/layout.tsx` / `app/providers.tsx`, install it the same way announcements do.
   - Mount `<Frigade.Collection collectionId="<slug>" />` using the same wiring pattern that `recipes/create-announcement.md` uses for `<Frigade.Announcement>`: add it to the existing `app/app-flows.tsx` (or equivalent companion file) alongside any announcements/tours already mounted, or create that file if it doesn't yet exist and wire it into `app/layout.tsx`. If the user's prompt names a specific file or location (e.g., "in the header"), honor that instead.
   - Snapshot every file before editing; revert the batch on any Edit failure.
6. **Grep guard (D07).** Verify no `FRIGADE_API_KEY_SECRET` landed in a client-side file.
7. **Log + report.** Append `create-collection:success` to `.frigade/skill.log` with the slug, numeric id, and files touched. Redact Authorization header.
8. **Partial-failure handling (D16).** If the GraphQL call succeeds but code emission fails, the collection exists server-side. Do NOT auto-delete it. Report what succeeded, offer the 3-option recovery (retry wiring / delete + restart / leave as-is).

**Does NOT cover:** supplying initial `flowIds` at creation. V1 creates empty collections; use `add-flows-to-collection` after.

### `recipes/add-flows-to-collection.md` — API-only

1. **Preflight.** first-run-setup gate. No framework check (no code emission).
2. **Resolve parameters.** Collection slug (required). One or more flow slugs (required).
3. **Resolve to numeric IDs.**
   - Collection: fetch via GraphQL `rules(skip: 0, take: 50)` client-side filter by slug, capture numeric id + current `flowIds`. If not found: halt with pointer at `create-collection.md`.
   - Each flow: REST `GET /v1/flows/<slug>` → numeric id. If any flow is 404: halt and list the missing slugs; don't partially add.
4. **Union.** `newFlowIds = unique([...existing, ...addedIds])`. If this is a no-op (every added id was already present), report that and exit without an API call.
5. **Confirmation (prod only).** `updateRules` is `safe` in dev, `dangerous` in prod.
6. **API call.** GraphQL `updateRules([{ id: <collectionId>, flowIds: <newFlowIds> }])`. Note: `updateRules` takes the full flow-id list, not a delta — pass the unioned list.
7. **Verify.** Re-fetch the collection; confirm `flowIds` matches expectation.
8. **Log + report.** Event `add-flows-to-collection:success` with collection slug, flow slugs added, final membership.
9. **Partial-failure.** `updateRules` is a single transaction server-side; either the whole membership update lands or none of it does. If it fails, report and exit.

### `recipes/promote-collection-to-prod.md` — API-only

1. **Preflight.** first-run-setup gate. Prod keys required; halt early if missing.
2. **Resolve dev collection.** By slug → numeric id + name.
3. **Confirmation.** Canonical prod prompt: `About to promote collection <slug> to prod. Confirm? (y/n)`.
4. **API call.** GraphQL `syncRuleToProd(ruleId: <devNumericId>)`. Returns the prod-side `ExternalizedRule`.
5. **Verify.** Fetch prod collection by slug, confirm `name` matches dev. If mismatch or 404: report the discrepancy and halt (no rollback — prod state is the backend's to own).
6. **Log + report.** `promote-collection-to-prod:success` with dev id, prod id, slug. Include in the success message a verbatim advisory:

   > Flow associations are not promoted with the collection. To link flows in prod, first promote the flows (`recipes/promote-to-prod.md`), then run `recipes/add-flows-to-collection.md` with the prod collection slug and the prod flow slugs.

7. **Partial-failure.** `syncRuleToProd` is atomic server-side. On failure: surface the error, halt; do not retry automatically.

## SKILL.md dispatch table additions

Add to "Dispatch table — recipes":

```
| Create a collection (and embed it in your app) | `recipes/create-collection.md` |
| Add one or more flows to a collection | `recipes/add-flows-to-collection.md` |
| Promote a collection dev → prod | `recipes/promote-collection-to-prod.md` |
```

## reference/operations.md additions

Add 5 rows:

| Op name | verb | target | safe (dev) | safe (prod) |
|---|---|---|---|---|
| `createRule` | create | collection | safe | dangerous |
| `updateRules` | update | collection | safe | dangerous |
| `deleteRule` | delete | collection | dangerous | dangerous |
| `syncRuleToProd` | promote | collection | n/a | dangerous |
| `rules` (query) | read | collections | safe | safe |

Operation names (`createRule` etc.) match the GraphQL mutations verbatim — these are internal keys that the skill greps by when matching intents to operations, so they must track backend reality. Verb/target columns drive the canonical confirmation prompt wording and therefore say "collection."

## Integration test

**`tests/integration/promote-collection.test.ts`** — one test case:

- **Setup.** mkdtemp + seed `.env.local` (dev + prod keys) + `.frigade/project.json` with real workspace IDs. Direct REST/GraphQL helper creates a dev collection with title `TEST-<stamp>-promote-coll`; capture `{ id, slug, name }`.
- **Prompt.** *"Promote collection `<slug>` to prod."*
- **Harness.** Respond `y` to the canonical confirmation when it appears (env=prod expected).
- **Assertions.**
  - Canonical prompt appeared with env=prod.
  - Prod collection exists via `getCollection(slug)`; `name` matches dev.
  - Capture the prod numeric id and track it for cleanup.
- **Teardown.** Delete both dev and prod collections via the client helper (best-effort).

The user's explicit instruction: this test does not verify flow associations transfer — they don't, and the skill doesn't pretend they do.

## Helper additions

**`tests/helpers/frigade-client.ts`** — collections are GraphQL-only. Add a thin GraphQL transport (`post '/graphql'` with `{ query, variables }` body, same Bearer auth) and four methods:

- `createCollection({ name, description?, coolOffPeriod?, coolOffUnit? }): Promise<Collection>` — wraps `createRule` mutation.
- `getCollection(slug: string): Promise<Collection | null>` — calls `rules(skip: 0, take: 50)` and filters client-side. Pagination handling: assume < 50 test collections exist (sweep-enforced). If we need more, iterate with `skip += 50`.
- `updateCollections(patches: UpdateCollectionDTO[]): Promise<Collection[]>` — wraps `updateRules` bulk mutation.
- `deleteCollection(id: number): Promise<void>` — wraps `deleteRule` mutation.

`Collection` type mirrors `ExternalizedRule`: `{ id, slug, name, description, coolOffPeriod, coolOffUnit, enabled, type, flows: {id,slug}[] }`. Only the fields the tests actually touch are typed; extra fields are preserved at runtime.

GraphQL endpoint: `https://api3.frigade.com/graphql` — verify against `reference/graphql-schema.md` at implementation time. If the endpoint differs, adjust.

**`tests/helpers/cleanup.ts`** — add a `CollectionTracker` class that mirrors `FlowTracker`:

```
class CollectionTracker {
  track(client, collection) { ... }
  async flushAll() { ... }   // 404/500 tolerant, same as FlowTracker
}
```

Tests own both a `FlowTracker` and a `CollectionTracker`; `afterEach` flushes both.

## Package script

Add to `package.json`:

```
"test:promote-collection": "vitest run tests/integration/promote-collection.test.ts"
```

## Error handling & safety

- Safety tags per D09 flow: writes safe in dev, dangerous in prod; `deleteRule` dangerous in both (follows the `deleteFlow` precedent).
- Canonical confirmation prompts per D09 — verb/target from operations.md.
- D16 applies: `create-collection`'s code-emission batch is atomic; server-side collection preserved on wiring failure.
- D17 applies: every write op appends to `.frigade/skill.log` with Authorization redacted.
- Auth errors: 403 → halt with "bad key" message; 401 → halt with "ownership mismatch" message (per D28).
- GraphQL error body wrapping (D25): `"An unexpected error occurred in graphql"` is the skill's signal to re-fetch the collection and diff against expected state to diagnose.

## Open questions resolved during brainstorm

- Q1 — what does "add custom collections to an app" mean: **full end-to-end** (create + embed in one recipe), starting empty. User adds flows later via `add-flows-to-collection`.
- Q2 — flow-association semantics on promote: **metadata only**, no cascade. Recipe's success message explicitly points at how to re-associate in prod if desired. Not tested (flows aren't synced and we don't pretend they are).
- Terminology — user-facing "collection" only. Backend `Rule` vocabulary confined to GraphQL payloads shown in code blocks.

## Dependencies

No new runtime or dev deps. Uses existing `@anthropic-ai/claude-agent-sdk`, `vitest`, `tsx`, `dotenv`. GraphQL calls go out via `fetch` (same pattern as REST in the current client helper).

## Risks

- **GraphQL endpoint path.** Current client is REST-only. The new GraphQL transport is a small addition but needs the right endpoint (`/graphql` on `api3.frigade.com` — verify).
- **Authentication semantics.** GraphQL endpoint uses the same `Authorization: Bearer <private key>` header. If it doesn't, that's a discovery during Task 1 implementation; fix the transport before wiring methods.
- **Pagination.** `rules(skip, take)` caps `take` at 50. Tests use the title-prefix discipline + sweep to keep the test workspace under 50 collections; if the workspace drifts, `getCollection` may miss entries. Mitigation: the sweep for collections also filters by `TEST-` prefix.
- **Recipe naming temptation.** Implementer may forget the terminology rule and write "rule" in prose. Self-review step: grep all new recipes for the word "rule" (case-insensitive, excluding code blocks) before committing.

## Next step

Hand off to `writing-plans` for a task-by-task implementation plan.
