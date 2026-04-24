# Collections Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three collection-related capabilities to the `frigade-engage` skill: create-collection (end-to-end w/ Next.js embed), add-flows-to-collection (API-only), promote-collection-to-prod (API-only). Plus one integration test and supporting helpers.

**Architecture:** Collections are GraphQL-only in the Frigade backend (`Rule` entity, renamed to "Collection" in product/dashboard). The skill already REST-talks to flows; this plan adds a GraphQL transport + four collection methods to `tests/helpers/frigade-client.ts`, a parallel `CollectionTracker` for test teardown, and three recipe files that mirror the shape of existing flow recipes. The integration test creates a dev collection via the helper, prompts the skill to promote it, and verifies the prod workspace has a collection at the same slug.

**Tech Stack:** Same as existing tests — vitest + TypeScript + `@anthropic-ai/claude-agent-sdk`. GraphQL calls go out via native `fetch` (no `graphql-request` or similar — keep deps minimal).

**Terminology hard rule:** User-facing language is **collection**. `Rule` only appears inside GraphQL payloads shown in code blocks. Every recipe file, confirmation prompt, log event name, and success message says "collection." When reviewing recipes, grep for the word "rule" case-insensitively and replace with "collection" unless it's inside a fenced code block.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `recipes/create-collection.md` | End-to-end: createRule mutation + mount `<Frigade.Collection>` in host Next.js app |
| `recipes/add-flows-to-collection.md` | API-only: resolve slugs, union flowIds, updateRules mutation |
| `recipes/promote-collection-to-prod.md` | API-only: syncRuleToProd, verify prod has matching slug |
| `tests/integration/promote-collection.test.ts` | One integration test covering the promote path |

**Modified files:**

| Path | Change |
|---|---|
| `tests/helpers/frigade-client.ts` | Add `gqlRequest` transport + `createCollection` / `getCollection` / `listCollections` / `updateCollections` / `deleteCollection` methods + `FrigadeCollection` type. No REST changes. |
| `tests/helpers/cleanup.ts` | Add `CollectionTracker` class mirroring `FlowTracker`'s shape (tolerant of 404/500 on teardown). |
| `reference/operations.md` | Add 5 collection rows to the ops table with safety tags. |
| `reference/graphql-schema.md` | Verify/add documentation for `createRule`, `rules` query, `updateRules`, `deleteRule`, `syncRuleToProd` mutations with argument shapes. |
| `SKILL.md` | Add 3 rows to the "Dispatch table — recipes" section. |
| `package.json` | Add `"test:promote-collection": "vitest run tests/integration/promote-collection.test.ts"` script. |

---

## Task 1: GraphQL transport + collection client methods

**Files:**
- Modify: `tests/helpers/frigade-client.ts`

- [ ] **Step 1.1: Verify the GraphQL endpoint + mutation signatures**

Run: `grep -nE "(createRule|updateRules|deleteRule|syncRuleToProd|rules\s*\()" reference/graphql-schema.md | head -30`

Expected: finds the mutation/query signatures. If any is missing, note it for Task 4 (graphql-schema.md fill-in).

Also check the endpoint path:

Run: `grep -nE "graphql|/graphql" reference/graphql-schema.md reference/rest-endpoints.md | head -10`

Expected: confirms the endpoint is `https://api3.frigade.com/graphql` (or surfaces the correct path). Use whatever the reference says. If it disagrees with `api3.frigade.com/graphql`, the reference wins — the REST base in `frigade-client.ts` is `https://api3.frigade.com`, same host.

- [ ] **Step 1.2: Read the current frigade-client.ts to understand the REST scaffolding**

Run: `wc -l tests/helpers/frigade-client.ts && head -60 tests/helpers/frigade-client.ts`

Expected: shows the existing `makeClient(env)` factory returning a `FrigadeClient` interface with REST methods. Your GraphQL methods will live on the same returned object.

- [ ] **Step 1.3: Add the GraphQL transport at module scope**

Append to the top of `tests/helpers/frigade-client.ts` (after the existing `const PROD_BASE = ...` line and before `export type Env = ...`):

```ts
const GQL_ENDPOINT = 'https://api3.frigade.com/graphql';
```

Inside `makeClient(env)`, after the existing `const headers = { ... }` line, add a GraphQL helper that closes over `secret`:

```ts
  async function gqlRequest<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GraphQL POST -> ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors && body.errors.length > 0) {
      throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('GraphQL response missing data');
    return body.data;
  }
```

- [ ] **Step 1.4: Add the `FrigadeCollection` type near the `FrigadeFlow` type**

Add directly below the `FrigadeFlow` interface:

```ts
export interface FrigadeCollection {
  id: number;
  slug: string;
  name: string;
  description: string;
  type: 'DEFAULT' | 'CUSTOM';
  coolOffPeriod: number;
  coolOffUnit: 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
  coolOffEnabled: boolean;
  enabled: boolean;
  order: number;
  color: string;
  allowedComponents: string[];
  productionRuleId?: number | null;
  flows?: Array<{ id: number; slug: string }>;
}

export interface UpdateCollectionPatch {
  id: number;
  name?: string;
  description?: string;
  coolOffPeriod?: number;
  coolOffUnit?: FrigadeCollection['coolOffUnit'];
  coolOffEnabled?: boolean;
  color?: string;
  enabled?: boolean;
  order?: number;
  flowIds?: number[];
  allowedComponents?: string[];
}
```

- [ ] **Step 1.5: Extend the `FrigadeClient` interface**

Find the `export interface FrigadeClient { ... }` block and add these signatures alongside the existing flow methods:

```ts
  createCollection(input: {
    name: string;
    description?: string;
    coolOffPeriod?: number;
    coolOffUnit?: FrigadeCollection['coolOffUnit'];
    flowIds?: number[];
  }): Promise<FrigadeCollection>;
  getCollection(slug: string): Promise<FrigadeCollection | null>;
  listCollections(): Promise<FrigadeCollection[]>;
  updateCollections(patches: UpdateCollectionPatch[]): Promise<FrigadeCollection[]>;
  deleteCollection(id: number): Promise<void>;
```

- [ ] **Step 1.6: Implement the four methods in the returned object**

Inside the `return { env, ... }` block in `makeClient`, add these methods after the existing flow method block:

```ts
    async createCollection(input) {
      const query = `
        mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Int, $coolOffUnit: CoolOffUnit, $flowIds: [Int!]) {
          createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit, flowIds: $flowIds) {
            id slug name description type coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents productionRuleId
          }
        }
      `;
      const data = await gqlRequest<{ createRule: FrigadeCollection }>(query, {
        name: input.name,
        description: input.description ?? '',
        coolOffPeriod: input.coolOffPeriod ?? null,
        coolOffUnit: input.coolOffUnit ?? null,
        flowIds: input.flowIds ?? null,
      });
      return data.createRule;
    },
    async getCollection(slug) {
      const list = await this.listCollections();
      return list.find((c) => c.slug === slug) ?? null;
    },
    async listCollections() {
      const query = `
        query ListCollections($skip: Int!, $take: Int!) {
          rules(skip: $skip, take: $take) {
            id slug name description type coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents productionRuleId
            flows { id slug }
          }
        }
      `;
      const data = await gqlRequest<{ rules: FrigadeCollection[] }>(query, { skip: 0, take: 50 });
      return data.rules;
    },
    async updateCollections(patches) {
      const query = `
        mutation UpdateCollections($rules: [UpdateRuleDTO!]!) {
          updateRules(rules: $rules) {
            id slug name description coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents
            flows { id slug }
          }
        }
      `;
      const data = await gqlRequest<{ updateRules: FrigadeCollection[] }>(query, { rules: patches });
      return data.updateRules;
    },
    async deleteCollection(id) {
      const query = `
        mutation DeleteCollection($id: Int!) {
          deleteRule(id: $id) { id }
        }
      `;
      await gqlRequest(query, { id });
    },
```

- [ ] **Step 1.7: Write a smoke test for createCollection + deleteCollection**

Create `tests/helpers/frigade-client-collections.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeClient, testTitle } from './frigade-client';

describe('frigade-client collections smoke', () => {
  it('creates, fetches, and deletes a collection', async () => {
    const c = makeClient('dev');
    const created = await c.createCollection({ name: testTitle('coll-smoke') });
    expect(created.id).toBeTypeOf('number');
    expect(created.name).toMatch(/^TEST-/);
    expect(created.type).toBe('CUSTOM');

    const fetched = await c.getCollection(created.slug);
    expect(fetched, 'listCollections should include the new one').not.toBeNull();
    expect(fetched!.name).toBe(created.name);

    await c.deleteCollection(created.id);
  });
});
```

- [ ] **Step 1.8: Temporarily widen vitest include and run the smoke test**

Edit `vitest.config.ts`, change `include: ['tests/integration/**/*.test.ts']` to `include: ['tests/**/*.test.ts']`.

Run: `npx vitest run tests/helpers/frigade-client-collections.smoke.test.ts`

Expected: PASS. If a GraphQL 400/403 appears, read the error body — the mutation arguments or argument types may differ from the sketch. Verify against `reference/graphql-schema.md` and adjust the query strings. If the schema reference itself is wrong, fix that in Task 4 after this task.

- [ ] **Step 1.9: Revert vitest include, delete the smoke test**

```sh
# Revert vitest.config.ts include back to 'tests/integration/**/*.test.ts'
rm tests/helpers/frigade-client-collections.smoke.test.ts
```

- [ ] **Step 1.10: Commit**

```sh
git add tests/helpers/frigade-client.ts vitest.config.ts
git commit -m "test(helpers): GraphQL transport + collection CRUD methods on Frigade client"
```

---

## Task 2: CollectionTracker for test teardown

**Files:**
- Modify: `tests/helpers/cleanup.ts`

- [ ] **Step 2.1: Read the existing FlowTracker for shape**

Run: `cat tests/helpers/cleanup.ts`

Expected: shows `FlowTracker` class with `track(client, flow)` and `flushAll()` — the latter already tolerant of 404/500.

- [ ] **Step 2.2: Add CollectionTracker below FlowTracker**

Append to `tests/helpers/cleanup.ts`:

```ts
interface TrackedCollection {
  client: FrigadeClient;
  id: number;
  slug: string;
}

export class CollectionTracker {
  private tracked: TrackedCollection[] = [];

  track(client: FrigadeClient, collection: { id: number; slug: string }) {
    this.tracked.push({ client, id: collection.id, slug: collection.slug });
  }

  async flushAll(): Promise<void> {
    for (const c of this.tracked) {
      try {
        await c.client.deleteCollection(c.id);
      } catch (e) {
        // Collection may have been deleted by the skill already. Swallow
        // 404/500 per the same contract as FlowTracker.
        if (e instanceof Error && /-> (404|500)/.test(e.message)) continue;
        console.warn(`Collection teardown failed for ${c.client.env}/${c.slug}:`, e);
      }
    }
    this.tracked = [];
  }
}
```

- [ ] **Step 2.3: Commit**

```sh
git add tests/helpers/cleanup.ts
git commit -m "test(helpers): CollectionTracker for collection teardown"
```

---

## Task 3: operations.md rows

**Files:**
- Modify: `reference/operations.md`

- [ ] **Step 3.1: Read the existing operations table to match format**

Run: `grep -nE "\| [a-z]+Flow " reference/operations.md | head -5`

Expected: shows rows like `| createFlow | create | flow | safe | dangerous |`. Match this column order and formatting exactly.

- [ ] **Step 3.2: Add 5 new rows in the appropriate section**

Locate the section that lists write ops (likely the main safety-tag table). Add these rows in alphabetical order relative to existing entries (or at the end of the table if unsorted — match local convention):

```
| createRule | create | collection | safe | dangerous |
| updateRules | update | collection | safe | dangerous |
| deleteRule | delete | collection | dangerous | dangerous |
| syncRuleToProd | promote | collection | n/a | dangerous |
| rules | read | collections | safe | safe |
```

Column semantics (match the existing table):
- Op name = GraphQL mutation/query name (internal)
- Verb + target = words used in the canonical confirmation prompt, customer-facing "collection"
- Safe/dangerous per env per D09

If the table has more columns (e.g. a "notes" column), leave the new rows' notes blank or add one-line pointers like "flows are associated via the `flowIds` arg; not a separate endpoint" for `updateRules`.

- [ ] **Step 3.3: If the file has a "Safety model recap" or similar prose block, grep for places that need the new rows mentioned**

Run: `grep -n "delete-flow\|createFlow\|reset-user" reference/operations.md | head -10`

Expected: surfaces inline prose that mentions existing dangerous ops. If any paragraph lists "the destructive ops" enumeratively, add `deleteRule` to that list. If it just references "ops tagged `dangerous` in this file," no edit needed.

- [ ] **Step 3.4: Terminology grep**

Run: `grep -niE "\brules?\b" reference/operations.md | grep -v "^[^:]*:.*\`.*\`" | head -20`

Expected: every hit is either a GraphQL op name (e.g., `createRule`, `updateRules`, `rules`) or inside a code block. Free-prose references to "rules" in operations.md should be rephrased to "collection(s)." If you see any such prose, fix it.

- [ ] **Step 3.5: Commit**

```sh
git add reference/operations.md
git commit -m "reference(operations): add collection ops (createRule/updateRules/deleteRule/syncRuleToProd/rules) with safety tags"
```

---

## Task 4: graphql-schema.md verification

**Files:**
- Modify: `reference/graphql-schema.md` (only if missing mutations)

- [ ] **Step 4.1: Verify each mutation is documented**

Run: `grep -nE "createRule|updateRules|deleteRule|syncRuleToProd|rules\(" reference/graphql-schema.md`

Expected: shows all five. If any is missing or documented with wrong arguments (compared to what you confirmed in Task 1 against the live API), add/fix the entry.

- [ ] **Step 4.2: Fill in any missing mutation**

For each missing mutation, add a section following the file's existing format. Minimum entries:

```
### createRule

mutation CreateRule($name: String!, $description: String!, $coolOffPeriod: Int, $coolOffUnit: CoolOffUnit, $flowIds: [Int!]) {
  createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit, flowIds: $flowIds) {
    id slug name description type coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents productionRuleId
  }
}
```

And one each for `updateRules`, `deleteRule`, `syncRuleToProd`, and the `rules` query. Copy the exact argument lists from Task 1's implementations, so the schema doc matches the code.

- [ ] **Step 4.3: Add a terminology note at the top of any new section (if the file is grouped)**

If the file has a natural "Collections" subsection, add a one-line lead:

> Collections in the product are called `Rule` entities in the GraphQL schema for historical reasons (see `decisions.md` D31). All customer-facing language is "collection"; recipes reference these mutations but always narrate in collection terms.

- [ ] **Step 4.4: Commit (skip if no changes)**

```sh
git status reference/graphql-schema.md
# If clean, skip. Otherwise:
git add reference/graphql-schema.md
git commit -m "reference(graphql): document collection mutations + Rule/Collection terminology note"
```

---

## Task 5: create-collection.md recipe

**Files:**
- Create: `recipes/create-collection.md`

- [ ] **Step 5.1: Read the existing create-announcement recipe as the structural template**

Run: `wc -l recipes/create-announcement.md && head -80 recipes/create-announcement.md`

Expected: the structure is "Purpose → Referenced decisions → Dispatch table linkages → Step 1 resolve → Step 2 ... Step N success message → Partial-failure handling → Example."

Your new recipe mirrors this shape but for collections. DO NOT copy wholesale; reproduce the skeleton, swap flow-specific content for collection-specific content.

- [ ] **Step 5.2: Write the recipe**

Create `recipes/create-collection.md` with these sections:

```markdown
# create-collection

**End-to-end create-a-collection recipe.** Takes the user's intent ("create a product-update collection and embed it in the app"), creates the collection in Frigade via the `createRule` GraphQL mutation, then installs `@frigade/react` if needed, wires the `<Frigade.Provider>`, and mounts `<Frigade.Collection>` in the host codebase. On partial failure (per **D16**), Frigade-side state is preserved and code-edit batches are rolled back atomically.

Referenced decisions: **D02** (full dashboard parity — collections are part of it), **D04** (end-to-end wiring), **D07** (public key only in client code), **D09/D23** (per-env safety tags per `operations.md`), **D14** (ask before starting dev server), **D16** (atomic code edits, preserved upstream state on partial failure), **D17** (log to `.frigade/skill.log`), **D21** (`.gitignore` hygiene), **D31** (collections are called `Rule` in GraphQL; customer-facing language is "collection").

Companion references: `reference/graphql-schema.md` §`createRule`, `reference/operations.md` `createRule` row (`safe` in dev, `dangerous` in prod), `reference/sdk-react.md` §`<Frigade.Collection>`.

## Step 1 — Resolve parameters

From the user's prompt, extract:

- `name` (required) — human-readable title for the collection, e.g., "Product Updates".
- `description` (optional) — short summary; default to empty string.
- `coolOffPeriod` + `coolOffUnit` (optional) — frequency cap; if omitted, omit from the mutation and the server defaults apply (currently 2 DAYS, `coolOffEnabled: true`).

If `name` is missing, ask the user for it once; don't guess.

## Step 2 — Environment + confirmation gate (D09)

Determine environment from the user's prompt ("in prod", "for production" → prod; else dev).

- `dev`: `createRule` is `safe` per `operations.md`; proceed without a confirmation prompt.
- `prod`: emit the canonical prompt verbatim:

  > About to create collection '<name>' in prod. Confirm? (y/n)

  Wait for explicit `y`/`yes`; anything else aborts cleanly (no API call issued).

## Step 3 — Create the collection via GraphQL

Pick the private key: `FRIGADE_API_KEY_SECRET` for dev, `FRIGADE_API_KEY_SECRET_PROD` for prod (both sourced from `.env.local`).

Emit the mutation:

\`\`\`bash
curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Int, $coolOffUnit: CoolOffUnit) { createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit) { id slug name type } }",
    "variables": { "name": "<NAME>", "description": "<DESC or empty string>", "coolOffPeriod": null, "coolOffUnit": null }
  }'
\`\`\`

On success, extract `data.createRule.{ id, slug, name }`. Log `create-collection:server-created` to `.frigade/skill.log` (per **D17**) with slug + id + environment; redact `Authorization`.

On error:
- `401` → halt per **D28** ("ownership/cross-env mismatch").
- `403` → halt per **D28** ("bad/revoked key"); route user to `first-run-setup.md` §2.7.
- `errors[]` in GraphQL body → surface the error messages verbatim and halt.

## Step 4 — Framework detection

Per `recipes/first-run-setup.md` §"framework detection":

- If React / Next App Router / Next Pages Router → proceed to Step 5.
- Otherwise → report "Collection is live in Frigade but I can't auto-wire this framework — manual setup: https://docs.frigade.com/quickstart" and stop. Upstream state is preserved.

## Step 5 — Install `@frigade/react` (if not already present)

Per `recipes/create-announcement.md` §"install the package" — reuse that recipe's install step verbatim. If the package is already present in `package.json` dependencies, skip `npm install`.

## Step 6 — Wire the provider (if not already mounted)

Per `recipes/create-announcement.md` §"wire the provider" — reuse that pattern. If `<Frigade.Provider>` is already mounted (e.g., by a prior `create-announcement` run), skip this step.

## Step 7 — Mount `<Frigade.Collection>` in the host codebase

Reuse the same wiring pattern that `create-announcement` uses for `<Frigade.Announcement>`:

- If `app/app-flows.tsx` (or equivalent companion file containing mounted flow components) exists, add `<Frigade.Collection collectionId="<slug>" />` alongside the existing mounts.
- If no such file exists, create one and wire it into `app/layout.tsx` via `<AppFlows />`.
- Honor any user-specified location in their prompt (e.g., "in the header" → mount inside the header component file).

Snapshot every file before editing. If any edit fails, revert the entire batch (per **D16**). Do NOT delete the upstream collection to "recover."

## Step 8 — Grep guard (D07)

After code emission, run:

\`\`\`bash
grep -r FRIGADE_API_KEY_SECRET src/ app/ pages/ components/ 2>/dev/null
\`\`\`

Expected: zero hits. If anything is returned, revert the last code batch and halt with a D07 violation report.

## Step 9 — Success message

Report to the user:

> Collection '<name>' created (id: <id>, slug: <slug>) in <env>.
> Mounted `<Frigade.Collection collectionId="<slug>" />` in `<file path>`.
> Dashboard: https://app.frigade.com/collections/<slug>
> Next: `recipes/add-flows-to-collection.md` to add flows, or `recipes/promote-collection-to-prod.md` to sync to prod.

## Step 10 — Log success

Append `create-collection:success` to `.frigade/skill.log` with: operation, slug, id, env, files touched. Redact Authorization.

## Partial-failure handling (D16)

Use the partial-failure template **verbatim** from `recipes/create-announcement.md` §"Partial-failure handling (D16)". Collection-specific failure points:

- Step 3 succeeded (collection exists upstream), any of Steps 5–7 failed → report what succeeded + what failed + 3-option recovery (retry wiring / delete collection + restart / leave as-is with manual wiring). Do NOT auto-delete upstream.
- Step 5 fails (npm install) → upstream exists, no code edits applied; user can rerun or skip wiring.
- Step 7 fails mid-batch → revert every file in the batch using the snapshot, report upstream-exists + wiring-rolled-back.

## Example

User: "Create a new collection called 'Product Updates' and embed it in the app."

1. `name="Product Updates"`, `description=""`, cool-off defaults.
2. Environment = dev; no confirm needed.
3. `createRule` → `{ id: 12345, slug: "collection_AbCdEf12", name: "Product Updates", type: "CUSTOM" }`.
4. Framework = Next App Router.
5. `@frigade/react` already installed (skip).
6. `<Frigade.Provider>` already mounted (skip).
7. Add `<Frigade.Collection collectionId="collection_AbCdEf12" />` to `app/app-flows.tsx` inside the `<Providers>` block.
8. Grep guard passes.
9. Report success + dashboard link.
10. Log success.
```

Note: the `\`\`\`` in the file's bash blocks above should be literal triple-backticks in the actual recipe. When writing this step verbatim into a markdown file, escape appropriately or use four backticks around the whole code block to include three-backtick blocks inside.

- [ ] **Step 5.3: Verify terminology**

Run: `grep -niE "\brules?\b" recipes/create-collection.md | grep -viE "\`(create|update|delete|sync)?[rR]ule" | head`

Expected: every remaining hit is either inside a code block, or refers to something other than the collection entity (unlikely). If free-prose "rule(s)" appears, replace with "collection(s)."

- [ ] **Step 5.4: Commit**

```sh
git add recipes/create-collection.md
git commit -m "recipe: create-collection — end-to-end createRule + embed <Frigade.Collection>"
```

---

## Task 6: add-flows-to-collection.md recipe

**Files:**
- Create: `recipes/add-flows-to-collection.md`

- [ ] **Step 6.1: Write the recipe**

Create `recipes/add-flows-to-collection.md`:

```markdown
# add-flows-to-collection

**Add one or more flows to an existing collection.** API-only (no code emission). Fetches the collection's current `flowIds`, unions with the new IDs (no duplicates), and issues a single `updateRules` bulk mutation with the resulting membership. Atomic on the server side.

Referenced decisions: **D02** (dashboard parity), **D09/D23** (per-env safety tags), **D16** (atomic server-side transaction), **D17** (log to `.frigade/skill.log`), **D28** (403 = bad key, 401 = ownership), **D31** (GraphQL `Rule` = product `Collection`; customer-facing language is "collection").

Companion references: `reference/graphql-schema.md` §`updateRules` and §`rules`, `reference/operations.md` `updateRules` row (`safe` in dev, `dangerous` in prod).

## Step 1 — Resolve parameters

From the user's prompt, extract:

- `collectionSlug` (required) — the slug of the target collection, e.g., `collection_AbCdEf12`.
- `flowSlugs[]` (required) — one or more flow slugs to add.

If either is missing, ask the user once.

## Step 2 — Fetch the collection

GraphQL `rules(skip: 0, take: 50)` query, filter client-side for `slug == <collectionSlug>`. Capture `{ id, flowIds: flows.map(f => f.id) }`.

If the collection is not found: halt with `"Collection '<slug>' not found. Create it with recipes/create-collection.md first."`

## Step 3 — Resolve each flow slug to its numeric id

For each `flowSlug`:

\`\`\`bash
curl -sS "https://api3.frigade.com/v1/flows/<slug>" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET"
\`\`\`

Capture `data.id` (numeric). If any flow returns 404, halt and list every missing slug — don't partially add.

## Step 4 — Union the IDs

`newFlowIds = uniq([...existingFlowIds, ...resolvedNewIds])`. If every incoming id is already in `existingFlowIds`, report "no change — all requested flows are already in this collection" and exit without an API call.

## Step 5 — Environment + confirmation (D09)

- `dev`: `updateRules` is `safe`; proceed.
- `prod`: canonical prompt:

  > About to update collection '<collectionSlug>' in prod (adding <N> flows). Confirm? (y/n)

## Step 6 — Bulk-update via GraphQL

\`\`\`bash
curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation UpdateCollections($rules: [UpdateRuleDTO!]!) { updateRules(rules: $rules) { id slug flows { id slug } } }",
    "variables": { "rules": [{ "id": <collectionId>, "flowIds": <newFlowIds> }] }
  }'
\`\`\`

The mutation is atomic — either the whole update lands or none does. Standard error handling per `reference/errors.md`.

## Step 7 — Verify

Re-fetch the collection (Step 2 pattern). Confirm `flowIds` matches `newFlowIds` (set equality). If mismatch: report the discrepancy; do not retry automatically.

## Step 8 — Log + report

Append `add-flows-to-collection:success` to `.frigade/skill.log` with: collection slug, flow slugs added, final membership size, env.

Report to user:

> Added <N> flow(s) to collection '<slug>'. New membership: <K> total.

## Partial-failure handling

`updateRules` is single-transaction on the server — no partial state. If Step 6 fails, no change was committed; user may retry after addressing the error.
```

- [ ] **Step 6.2: Verify terminology**

Run: `grep -niE "\brules?\b" recipes/add-flows-to-collection.md | grep -viE "\`(create|update|delete|sync)?[rR]ule|UpdateRuleDTO" | head`

Expected: no free-prose "rules" hits.

- [ ] **Step 6.3: Commit**

```sh
git add recipes/add-flows-to-collection.md
git commit -m "recipe: add-flows-to-collection — fetch + union flowIds + updateRules"
```

---

## Task 7: promote-collection-to-prod.md recipe

**Files:**
- Create: `recipes/promote-collection-to-prod.md`

- [ ] **Step 7.1: Write the recipe**

Create `recipes/promote-collection-to-prod.md`:

```markdown
# promote-collection-to-prod

**Promote a collection from dev to prod.** API-only. Calls the `syncRuleToProd` GraphQL mutation, which upserts the collection's metadata (name, description, cool-off, priority order, allowed component types) into the prod workspace, matching by slug. Flow associations are **not** transferred by this mutation — see "After promotion" below.

Referenced decisions: **D02** (dashboard parity — this mirrors the dashboard's "Promote to production" action), **D09** (prod writes require confirmation), **D17** (log to `.frigade/skill.log`), **D23** (each private key is environment-bound), **D26 spirit** (cross-env op is client-initiated, but for collections the backend exposes a single `syncRuleToProd` mutation, unlike flow promotion which requires multi-call orchestration), **D28** (403 = bad key, 401 = ownership), **D31** (Collection = Rule in GraphQL).

Companion references: `reference/graphql-schema.md` §`syncRuleToProd`, `reference/operations.md` `syncRuleToProd` row (`n/a` in dev, `dangerous` in prod).

## Step 1 — Preflight

- Verify `FRIGADE_API_KEY_SECRET_PROD` is set in `.env.local` (not just dev keys). If missing, halt with: "Prod key required — see `recipes/first-run-setup.md` §'configuring prod keys'."
- first-run-setup binding check already ran; workspace IDs are on file.

## Step 2 — Resolve the dev collection

GraphQL `rules(skip: 0, take: 50)` against the dev workspace (`FRIGADE_API_KEY_SECRET`), filter by slug. Capture `{ id, name }`.

If not found: halt with `"Collection '<slug>' not found in dev. Create it first with recipes/create-collection.md."`

## Step 3 — Confirmation (D09)

Emit the canonical prompt:

> About to promote collection '<slug>' to prod. Confirm? (y/n)

Wait for `y`/`yes`; anything else aborts without issuing the mutation.

## Step 4 — Call syncRuleToProd

The mutation uses the **dev** private key (it's the dev-side service that knows to write into the sibling prod org):

\`\`\`bash
curl -sS -X POST "https://api3.frigade.com/graphql" \
  -H "Authorization: Bearer $FRIGADE_API_KEY_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation PromoteCollection($ruleId: Int!) { syncRuleToProd(ruleId: $ruleId) { id slug name type coolOffPeriod coolOffUnit enabled order } }",
    "variables": { "ruleId": <devCollectionId> }
  }'
\`\`\`

On success, capture `data.syncRuleToProd` — this is the prod-side collection. The slug matches the dev side.

Error handling:
- `401` → halt per **D28** (ownership mismatch; user may be using a cross-org key).
- `403` → halt per **D28** (bad dev key); route to `first-run-setup.md` §2.7.
- `errors[]` in body → surface verbatim and halt; do not retry (the backend is responsible for idempotency).

## Step 5 — Verify prod has the collection

Switch to the prod key and fetch the prod-side collection by slug:

GraphQL `rules(skip: 0, take: 50)` with `FRIGADE_API_KEY_SECRET_PROD`, filter by slug.

Expected: the collection exists with matching `name`. If 404 or name mismatch: report the discrepancy; do not retry (it's a backend issue).

## Step 6 — Log + report

Append `promote-collection-to-prod:success` to `.frigade/skill.log` with: dev id, prod id, slug, name.

Report to user verbatim:

> Collection '<slug>' promoted to prod (dev id <devId> → prod id <prodId>).
> Flow associations are not promoted with the collection. To link flows in prod:
>   1. Promote each flow to prod via `recipes/promote-to-prod.md`.
>   2. Run `recipes/add-flows-to-collection.md` with the prod collection slug and prod flow slugs.

## Partial-failure handling

`syncRuleToProd` is atomic on the server. On failure (network/5xx/validation), no state was changed; surface the error and halt. User may retry after addressing the underlying issue.
```

- [ ] **Step 7.2: Verify terminology**

Run: `grep -niE "\brules?\b" recipes/promote-collection-to-prod.md | grep -viE "\`?(create|update|delete|sync)?[rR]ule|ruleId|\\\$ruleId" | head`

Expected: no free-prose "rules" hits.

- [ ] **Step 7.3: Commit**

```sh
git add recipes/promote-collection-to-prod.md
git commit -m "recipe: promote-collection-to-prod — syncRuleToProd + verify"
```

---

## Task 8: SKILL.md dispatch table

**Files:**
- Modify: `SKILL.md`

- [ ] **Step 8.1: Locate the dispatch table**

Run: `grep -n "Dispatch table — recipes" SKILL.md`

Expected: one match. Note the line number.

- [ ] **Step 8.2: Add 3 rows to the recipes dispatch table**

Insert (choose a sensible alphabetical/topical position — e.g., after the "Create a tour" row or at the end of the create-type rows):

```
| Create a collection (and embed it in your app) | `recipes/create-collection.md` |
| Add one or more flows to a collection | `recipes/add-flows-to-collection.md` |
| Promote a collection dev → prod | `recipes/promote-collection-to-prod.md` |
```

- [ ] **Step 8.3: Verify SKILL.md still renders clean**

Run: `grep -c "^| " SKILL.md`

Expected: the row count increased by 3 relative to before.

- [ ] **Step 8.4: Commit**

```sh
git add SKILL.md
git commit -m "skill: dispatch-table rows for create-collection / add-flows / promote-collection"
```

---

## Task 9: Integration test

**Files:**
- Create: `tests/integration/promote-collection.test.ts`
- Modify: `package.json`

- [ ] **Step 9.1: Write the test**

Create `tests/integration/promote-collection.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { CollectionTracker } from '../helpers/cleanup';

describe('promote-collection', () => {
  const tracker = new CollectionTracker();
  afterEach(async () => tracker.flushAll());

  it('promotes a dev collection to prod after confirmation', async () => {
    const fx = setupFixture();
    try {
      const dev = makeClient('dev');
      const prod = makeClient('prod');
      const title = testTitle('promote-coll');

      const devColl = await dev.createCollection({ name: title });
      tracker.track(dev, { id: devColl.id, slug: devColl.slug });

      seedFixture(fx.cwd);

      let sawProdPrompt = false;
      await runSkill({
        cwd: fx.cwd,
        prompt: `Promote collection "${devColl.slug}" to prod.`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'prod') sawProdPrompt = true;
          return 'y';
        },
      });

      expect(sawProdPrompt, 'canonical confirmation with env=prod must appear').toBe(true);

      const prodColl = await prod.getCollection(devColl.slug);
      expect(prodColl, 'prod collection should exist at same slug').not.toBeNull();
      expect(prodColl!.name).toBe(title);
      tracker.track(prod, { id: prodColl!.id, slug: prodColl!.slug });
    } finally {
      fx.cleanup();
    }
  });
});

function seedFixture(cwd: string) {
  writeFileSync(
    join(cwd, '.env.local'),
    [
      `NEXT_PUBLIC_FRIGADE_API_KEY=${process.env.FRIGADE_TEST_API_KEY_PUBLIC}`,
      `FRIGADE_API_KEY_SECRET=${process.env.FRIGADE_TEST_API_KEY_SECRET}`,
      `NEXT_PUBLIC_FRIGADE_API_KEY_PROD=${process.env.FRIGADE_TEST_API_KEY_PUBLIC_PROD}`,
      `FRIGADE_API_KEY_SECRET_PROD=${process.env.FRIGADE_TEST_API_KEY_SECRET_PROD}`,
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify(
      { workspaceId: '208', prodWorkspaceId: '209', boundAt: new Date().toISOString() },
      null,
      2
    )
  );
}
```

- [ ] **Step 9.2: Add the package.json script**

Edit `package.json`, in the `"scripts"` object, add (alphabetical with existing test:* scripts):

```json
    "test:promote-collection": "vitest run tests/integration/promote-collection.test.ts",
```

- [ ] **Step 9.3: Run the test**

Run: `npm run test:promote-collection`

Expected: PASS in ~60–120s. If it fails:

- Canonical prompt not seen → check `recipes/promote-collection-to-prod.md` Step 3 emits the exact `About to promote collection '<slug>' to prod. Confirm? (y/n)` wording. Also check the harness regexes in `tests/helpers/harness.ts` — if the skill wrapped the prompt in a blockquote or other markdown, the existing tolerance should handle it, but verify with `FRIGADE_ENGAGE_TEST_DEBUG=/tmp/promote-coll.jsonl npm run test:promote-collection`.
- Prod collection not found → check `syncRuleToProd` actually ran (search tool-use events for the mutation). If the skill refused to call it (e.g., prod key missing), the recipe's preflight caught a real setup issue — fix seedFixture to include prod keys (they already should per the code above).
- Name mismatch → surface and investigate; could indicate the sync didn't copy name, which would be a real backend issue.

- [ ] **Step 9.4: Commit**

```sh
git add tests/integration/promote-collection.test.ts package.json
git commit -m "test(integration): promote-collection — syncRuleToProd round-trip"
```

---

## Task 10: Full-suite verification

- [ ] **Step 10.1: Run the full suite serially**

Run: `npm test`

Expected: 6 test files (the 5 existing + 1 new), 7 tests total, all PASS. Elapsed time ~11–12 min serially (current suite is ~10 min, promote-collection adds ~60–120s).

- [ ] **Step 10.2: Sweep**

Run: `npm run test:sweep`

Expected: `(none)` in both envs, OR any leaked test collections/flows are deleted. Note: the current `scripts/sweep.ts` only handles FLOWS. If leaked test collections appear in the dashboard after this suite, extend the sweep script in a follow-up commit to also list + delete `TEST-`-prefixed collections via `listCollections()` + `deleteCollection()`.

- [ ] **Step 10.3: Working tree clean check**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 10.4: Do NOT push**

User pushes manually after review.

---

## Self-review checklist

- [x] **Spec coverage.**
  - "create-collection end-to-end" → Task 5.
  - "add-flows-to-collection" → Task 6.
  - "promote-collection-to-prod" → Task 7.
  - Helper updates (GraphQL transport + collection methods) → Task 1.
  - `CollectionTracker` → Task 2.
  - operations.md rows → Task 3.
  - graphql-schema.md verification → Task 4.
  - SKILL.md dispatch table → Task 8.
  - Integration test → Task 9.
  - Full-suite verification → Task 10.
- [x] **No placeholders.** Every step has concrete commands or code. Two places reference implementer-time verification (Task 1 Step 1.1 GraphQL endpoint; Task 4 missing-mutation backfill) — both are gated by explicit grep commands, not TBDs.
- [x] **Type consistency.** `FrigadeCollection` is defined once in Task 1 and reused in Task 2 (`CollectionTracker`) and Task 9 (test). `UpdateCollectionPatch` is defined once. Method names on `FrigadeClient` (`createCollection`, `getCollection`, `listCollections`, `updateCollections`, `deleteCollection`) are used verbatim in Task 2 and Task 9.
- [x] **Terminology rule.** Each recipe task has an explicit `grep` step to catch free-prose "rule(s)" leaks.
- [x] **File paths exact.** Every reference is relative from repo root.
