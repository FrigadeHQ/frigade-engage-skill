# Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five end-to-end integration tests that exercise the `frigade-engage` skill against a real Frigade test workspace, locally runnable via `npm test`.

**Architecture:** Vitest + TypeScript test harness built on the Claude Agent SDK. Each test spawns a headless Claude session with the skill loaded, sends a prompt, and asserts on tool-use events, assistant text, file contents in a Next.js fixture tmpdir, and real Frigade state. Flows are identified by title prefix (`TEST-<stamp>-...`) for cleanup.

**Tech Stack:** Node 20+, TypeScript, vitest, `@anthropic-ai/claude-agent-sdk`, tsx, dotenv. Real Frigade dev + prod test workspaces; creds via `.env.test.local` (gitignored).

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `package.json` | Node package manifest; dev deps; npm scripts. |
| `tsconfig.json` | TypeScript config for tests (node target, strict mode). |
| `vitest.config.ts` | Vitest config; points `globalSetup` at `tests/setup.ts`; testTimeout 120s. |
| `.env.test.local.example` | Documents the five required env vars (Anthropic + Frigade dev/prod). |
| `tests/setup.ts` | Vitest `globalSetup`: loads `.env.test.local`, fails fast on missing vars, ensures `~/.claude/skills/frigade-engage` symlinks to the repo, pre-populates the fixture `node_modules` cache. |
| `tests/helpers/frigade-client.ts` | Thin REST wrapper for setup/teardown: `createFlow`, `getFlow`, `deleteFlow`, `listFlows`, `updateFlow`. Exports a typed client factory keyed by env (`dev`/`prod`). |
| `tests/helpers/fixture.ts` | `setupFixture()`: mkdtemp, copy `tests/fixtures/next-app-template/` in, symlink `node_modules` from `tests/.cache/node_modules/`, return `{ cwd, cleanup }`. |
| `tests/helpers/harness.ts` | `runSkill({ cwd, prompt, onPrompt })`: wraps the Agent SDK session; streams tool-use events + assistant text; routes assistant prompts through `onPrompt` for configured responses. Returns `{ toolUses, assistantText, finalResponse }`. |
| `tests/helpers/cleanup.ts` | Per-test flow tracker: `track(client, slug)` / `flushAll()`; best-effort DELETE each; called from `afterEach`. |
| `tests/fixtures/next-app-template/package.json` | Minimal Next.js 15 + React 19 app; no `@frigade/react` pre-installed. |
| `tests/fixtures/next-app-template/tsconfig.json` | Standard Next tsconfig. |
| `tests/fixtures/next-app-template/next.config.js` | Empty next config. |
| `tests/fixtures/next-app-template/app/layout.tsx` | Trivial `<html><body>{children}</body></html>`. |
| `tests/fixtures/next-app-template/app/page.tsx` | Trivial `<h1>Test app</h1>`. |
| `tests/integration/create-flow.test.ts` | Test case 1. |
| `tests/integration/promote-flow.test.ts` | Test case 2. |
| `tests/integration/delete-flow.test.ts` | Test case 3. |
| `tests/integration/prod-delete-confirm.test.ts` | Test case 4 (two tests inside). |
| `tests/integration/update-targeting.test.ts` | Test case 5. |
| `scripts/sweep.ts` | Lists all `TEST-`-prefixed flows in dev + prod and deletes them. |

**Modified files:**

| Path | Change |
|---|---|
| `.gitignore` | Add `node_modules/`, `.env.test.local`, `tests/.cache/`, `coverage/`. |
| `README.md` | New "Running the integration tests" section near the end. |

---

## Task 1: Scaffold Node project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.test.local.example`
- Modify: `.gitignore`

- [ ] **Step 1.1: Add .gitignore entries**

Append to `.gitignore`:

```
node_modules/
.env.test.local
tests/.cache/
coverage/
```

- [ ] **Step 1.2: Create `package.json`**

```json
{
  "name": "frigade-engage-skill",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "description": "Integration tests for the frigade-engage Claude Code skill.",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:create": "vitest run tests/integration/create-flow.test.ts",
    "test:promote": "vitest run tests/integration/promote-flow.test.ts",
    "test:delete": "vitest run tests/integration/delete-flow.test.ts",
    "test:prod-confirm": "vitest run tests/integration/prod-delete-confirm.test.ts",
    "test:targeting": "vitest run tests/integration/update-targeting.test.ts",
    "test:sweep": "tsx scripts/sweep.ts"
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@types/node": "^20.11.0",
    "dotenv": "^16.4.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 1.3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["tests/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "tests/.cache", "tests/fixtures/next-app-template"]
}
```

- [ ] **Step 1.4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
    sequence: { concurrent: false },
  },
});
```

- [ ] **Step 1.5: Create `.env.test.local.example`**

```
# Anthropic key the test harness uses to drive Claude headlessly.
ANTHROPIC_API_KEY=

# Frigade test-workspace keys. Use a dedicated test org, not a shared one.
FRIGADE_TEST_API_KEY_PUBLIC=
FRIGADE_TEST_API_KEY_SECRET=
FRIGADE_TEST_API_KEY_PUBLIC_PROD=
FRIGADE_TEST_API_KEY_SECRET_PROD=
```

- [ ] **Step 1.6: Install + verify**

Run: `npm install`
Expected: installs cleanly; `node_modules/` populated.

Run: `npx vitest run`
Expected: prints `No test files found, exiting with code 1` — this is fine; we have no tests yet. Verifies vitest is wired up.

- [ ] **Step 1.7: Commit**

```sh
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.test.local.example .gitignore
git commit -m "chore(tests): scaffold Node + vitest + Agent SDK toolchain"
```

---

## Task 2: `globalSetup` (env-var validation + skill symlink + node_modules cache)

**Files:**
- Create: `tests/setup.ts`

- [ ] **Step 2.1: Write `tests/setup.ts`**

```ts
import { existsSync, symlinkSync, readlinkSync, lstatSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'FRIGADE_TEST_API_KEY_PUBLIC',
  'FRIGADE_TEST_API_KEY_SECRET',
  'FRIGADE_TEST_API_KEY_PUBLIC_PROD',
  'FRIGADE_TEST_API_KEY_SECRET_PROD',
] as const;

export default async function globalSetup() {
  const repoRoot = resolve(import.meta.dirname, '..');

  loadDotenv({ path: join(repoRoot, '.env.test.local') });

  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars for integration tests: ${missing.join(', ')}.\n` +
      `Copy .env.test.local.example to .env.test.local and fill in the values.`
    );
  }

  const skillLink = join(homedir(), '.claude', 'skills', 'frigade-engage');
  const skillDir = join(homedir(), '.claude', 'skills');
  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

  if (!existsSync(skillLink)) {
    symlinkSync(repoRoot, skillLink, 'dir');
    console.log(`Linked ${skillLink} -> ${repoRoot}`);
  } else {
    const stat = lstatSync(skillLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(
        `${skillLink} exists and is not a symlink. Remove it or rename it — ` +
        `the test harness requires the skill to be linked to this repo.`
      );
    }
    const target = readlinkSync(skillLink);
    if (resolve(target) !== repoRoot) {
      throw new Error(
        `${skillLink} points to ${target}, not this repo (${repoRoot}). ` +
        `Remove it or re-link before running tests.`
      );
    }
  }

  const cacheDir = join(repoRoot, 'tests', '.cache', 'node_modules');
  const templateDir = join(repoRoot, 'tests', 'fixtures', 'next-app-template');
  if (!existsSync(cacheDir)) {
    console.log('Pre-populating fixture node_modules cache (one-time, ~30s)...');
    execSync('npm install --no-audit --no-fund --ignore-scripts', {
      cwd: templateDir,
      stdio: 'inherit',
    });
    mkdirSync(join(repoRoot, 'tests', '.cache'), { recursive: true });
    execSync(`mv "${join(templateDir, 'node_modules')}" "${cacheDir}"`);
  }
}
```

- [ ] **Step 2.2: Run vitest to verify setup works when vars are missing**

Run: `rm -f .env.test.local && npx vitest run` (temporary — only if you have no `.env.test.local` yet)
Expected: fails with "Missing required env vars for integration tests: ANTHROPIC_API_KEY, ..."

Copy `.env.test.local.example` to `.env.test.local` and ask the user to fill in values before continuing.

- [ ] **Step 2.3: Run vitest with vars set**

Run: `npx vitest run`
Expected: prints `No test files found` (still no tests), but globalSetup runs silently — the symlink gets created at `~/.claude/skills/frigade-engage` and the node_modules cache gets populated. Verify by:

```sh
ls -l ~/.claude/skills/frigade-engage
ls tests/.cache/node_modules | head
```

Both should succeed and show content.

- [ ] **Step 2.4: Commit**

```sh
git add tests/setup.ts
git commit -m "test: globalSetup validates env, links skill, warms fixture cache"
```

---

## Task 3: Frigade REST client helper

**Files:**
- Create: `tests/helpers/frigade-client.ts`

- [ ] **Step 3.1: Write the client**

```ts
const DEV_BASE = 'https://api3.frigade.com';
const PROD_BASE = 'https://api3.frigade.com';

export type Env = 'dev' | 'prod';

export interface FrigadeFlow {
  id: number;
  slug: string;
  name: string;
  type: string;
  data: string;
  targetingLogic: string;
  active: boolean;
  internalData?: {
    productionDraftFlowId?: number;
    productionActiveFlowId?: number;
    [k: string]: unknown;
  };
}

export interface FrigadeClient {
  env: Env;
  createFlow(input: { name: string; type: string; data?: string; targetingLogic?: string }): Promise<FrigadeFlow>;
  getFlow(slug: string): Promise<FrigadeFlow | null>;
  listFlows(): Promise<FrigadeFlow[]>;
  updateFlow(id: number, patch: Partial<Pick<FrigadeFlow, 'name' | 'data' | 'targetingLogic' | 'active'>>): Promise<FrigadeFlow>;
  deleteFlow(id: number): Promise<void>;
}

export function makeClient(env: Env): FrigadeClient {
  const base = env === 'prod' ? PROD_BASE : DEV_BASE;
  const secret = env === 'prod'
    ? process.env.FRIGADE_TEST_API_KEY_SECRET_PROD!
    : process.env.FRIGADE_TEST_API_KEY_SECRET!;
  if (!secret) throw new Error(`Missing secret for env=${env}`);
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${text}`);
    }
    return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
  }

  return {
    env,
    async createFlow(input) {
      const payload = {
        name: input.name,
        type: input.type,
        data: input.data ?? '',
        targetingLogic: input.targetingLogic ?? '',
      };
      return request<FrigadeFlow>(`/v1/flows/`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    async getFlow(slug) {
      try {
        return await request<FrigadeFlow>(`/v1/flows/${slug}`);
      } catch (e) {
        if (e instanceof Error && e.message.includes('-> 404')) return null;
        throw e;
      }
    },
    async listFlows() {
      const res = await request<{ data: FrigadeFlow[] } | FrigadeFlow[]>(`/v1/flows/`);
      return Array.isArray(res) ? res : res.data;
    },
    async updateFlow(id, patch) {
      return request<FrigadeFlow>(`/v1/flows/${id}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    },
    async deleteFlow(id) {
      await request<void>(`/v1/flows/${id}`, { method: 'DELETE' });
    },
  };
}

export function testTitle(kind: string): string {
  const stamp = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 12);
  const shortid = Math.random().toString(36).slice(2, 8);
  return `TEST-${stamp}-${shortid}-${kind}`;
}
```

- [ ] **Step 3.2: Write a smoke test for the client**

Create `tests/helpers/frigade-client.smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeClient, testTitle } from './frigade-client';

describe('frigade-client smoke', () => {
  it('creates and deletes a flow', async () => {
    const c = makeClient('dev');
    const created = await c.createFlow({ name: testTitle('client-smoke'), type: 'ANNOUNCEMENT' });
    expect(created.id).toBeTypeOf('number');
    expect(created.name).toMatch(/^TEST-/);
    await c.deleteFlow(created.id);
    expect(await c.getFlow(created.slug)).toBeNull();
  });
});
```

- [ ] **Step 3.3: Temporarily include smoke tests in vitest config, then run**

Edit `vitest.config.ts` `include`:
```ts
include: ['tests/**/*.test.ts'],
```

Run: `npx vitest run tests/helpers/frigade-client.smoke.test.ts`
Expected: PASS (creates + deletes a real flow in the dev test workspace).

- [ ] **Step 3.4: Revert `include` to integration-only**

Edit `vitest.config.ts` back to `include: ['tests/integration/**/*.test.ts']`. Delete `tests/helpers/frigade-client.smoke.test.ts`.

- [ ] **Step 3.5: Commit**

```sh
git add tests/helpers/frigade-client.ts vitest.config.ts
git commit -m "test(helpers): frigade-client REST wrapper for setup/teardown"
```

---

## Task 4: Fixture helper (Next.js template + tmpdir)

**Files:**
- Create: `tests/fixtures/next-app-template/{package.json,tsconfig.json,next.config.js}`
- Create: `tests/fixtures/next-app-template/app/{layout.tsx,page.tsx}`
- Create: `tests/helpers/fixture.ts`

- [ ] **Step 4.1: Create fixture `package.json`**

`tests/fixtures/next-app-template/package.json`:

```json
{
  "name": "frigade-engage-test-fixture",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 4.2: Create fixture `tsconfig.json`**

`tests/fixtures/next-app-template/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4.3: Create fixture `next.config.js`**

`tests/fixtures/next-app-template/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
module.exports = nextConfig;
```

- [ ] **Step 4.4: Create fixture `app/layout.tsx`**

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4.5: Create fixture `app/page.tsx`**

```tsx
export default function Page() {
  return <h1>Test app</h1>;
}
```

- [ ] **Step 4.6: Write `tests/helpers/fixture.ts`**

```ts
import { mkdtempSync, cpSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Fixture {
  cwd: string;
  cleanup: () => void;
}

export function setupFixture(): Fixture {
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const template = join(repoRoot, 'tests', 'fixtures', 'next-app-template');
  const cache = join(repoRoot, 'tests', '.cache', 'node_modules');

  if (!existsSync(cache)) {
    throw new Error(`Fixture cache missing: ${cache}. globalSetup should have created it.`);
  }

  const cwd = mkdtempSync(join(tmpdir(), 'frigade-engage-test-'));
  cpSync(template, cwd, { recursive: true });
  symlinkSync(cache, join(cwd, 'node_modules'), 'dir');

  return {
    cwd,
    cleanup: () => {
      try {
        rmSync(cwd, { recursive: true, force: true });
      } catch (e) {
        console.warn(`Cleanup failed for ${cwd}:`, e);
      }
    },
  };
}
```

- [ ] **Step 4.7: Write unit test for fixture helper**

Create `tests/helpers/fixture.smoke.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from './fixture';

describe('fixture helper', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it('copies the template and symlinks node_modules', () => {
    const fx = setupFixture();
    cleanup = fx.cleanup;

    expect(existsSync(join(fx.cwd, 'package.json'))).toBe(true);
    expect(existsSync(join(fx.cwd, 'app', 'layout.tsx'))).toBe(true);
    expect(existsSync(join(fx.cwd, 'node_modules', 'next'))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(fx.cwd, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('frigade-engage-test-fixture');
  });
});
```

Temporarily widen `vitest.config.ts` `include` to `tests/**/*.test.ts` again, then:

Run: `npx vitest run tests/helpers/fixture.smoke.test.ts`
Expected: PASS.

Revert `include` afterward. Delete the smoke test file.

- [ ] **Step 4.8: Commit**

```sh
git add tests/fixtures/next-app-template tests/helpers/fixture.ts vitest.config.ts
git commit -m "test(helpers): Next.js fixture template and tmpdir setup"
```

---

## Task 5: Agent SDK harness

**Files:**
- Create: `tests/helpers/harness.ts`

> **Implementation note.** The exact Agent SDK API (import path, function names, message-type shape) should be verified against the currently-installed SDK before writing this module. The sketch below matches the SDK's documented shape at time of planning. If a name doesn't match, adapt — the boundaries of this module (inputs: prompt + onPrompt; outputs: toolUses + assistantText) are what matter.

- [ ] **Step 5.1: Read SDK docs to confirm API shape**

In the repo, check `node_modules/@anthropic-ai/claude-agent-sdk/README.md` and `dist/` types. Confirm:

- The entry-point for a headless session (likely `query()` that returns an async iterator of messages).
- How to pass a system-prompt source / skill location (likely `settingSources: ['user']` since the skill lives at `~/.claude/skills/frigade-engage`).
- How to pass cwd.
- How to send a user message mid-session (for responding to assistant prompts).

Update the code below if the SDK shape differs. If the SDK's naming has drifted, correct the import + call signatures only; the module's interface stays the same.

- [ ] **Step 5.2: Write `tests/helpers/harness.ts`**

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

export type PromptResponder = (assistantText: string) => string | null;

export interface RunSkillOptions {
  cwd: string;
  prompt: string;
  onPrompt: PromptResponder;
  maxTurns?: number;
}

export interface RunSkillResult {
  toolUses: ToolUse[];
  assistantText: string[];
  finalResponse: string;
}

export async function runSkill(opts: RunSkillOptions): Promise<RunSkillResult> {
  const toolUses: ToolUse[] = [];
  const assistantText: string[] = [];
  let finalResponse = '';

  const session = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      settingSources: ['user'],
      maxTurns: opts.maxTurns ?? 40,
      permissionMode: 'bypassPermissions',
    },
  });

  for await (const message of session) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          assistantText.push(block.text);
          finalResponse = block.text;
          const response = opts.onPrompt(block.text);
          if (response !== null) {
            await session.input(response);
          }
        } else if (block.type === 'tool_use') {
          toolUses.push({ name: block.name, input: block.input as Record<string, unknown> });
        }
      }
    }
  }

  return { toolUses, assistantText, finalResponse };
}

// ---- helpers used by tests ----

export const CANONICAL_PROMPT = /^About to (.+?) in (dev|prod)\. Confirm\? \(y\/n\)$/m;

export function matchConfirmation(text: string): { verb: string; env: 'dev' | 'prod' } | null {
  const m = text.match(CANONICAL_PROMPT);
  if (!m) return null;
  return { verb: m[1], env: m[2] as 'dev' | 'prod' };
}

export const KEY_PROMPT_PATTERNS: Array<{ label: string; regex: RegExp; envKey: string }> = [
  { label: 'dev public',  regex: /dev.*public.*key/i,  envKey: 'FRIGADE_TEST_API_KEY_PUBLIC' },
  { label: 'dev secret',  regex: /dev.*(secret|private).*key/i, envKey: 'FRIGADE_TEST_API_KEY_SECRET' },
  { label: 'prod public', regex: /prod.*public.*key/i, envKey: 'FRIGADE_TEST_API_KEY_PUBLIC_PROD' },
  { label: 'prod secret', regex: /prod.*(secret|private).*key/i, envKey: 'FRIGADE_TEST_API_KEY_SECRET_PROD' },
];

export function answerKeyPrompt(text: string): string | null {
  for (const p of KEY_PROMPT_PATTERNS) {
    if (p.regex.test(text)) {
      const v = process.env[p.envKey];
      if (!v) throw new Error(`Env var ${p.envKey} is required to answer key prompt "${p.label}"`);
      return v;
    }
  }
  return null;
}
```

- [ ] **Step 5.3: Smoke test the harness with a trivial prompt**

Create `tests/helpers/harness.smoke.test.ts` (temporary):

```ts
import { describe, it, expect } from 'vitest';
import { setupFixture } from './fixture';
import { runSkill } from './harness';

describe('harness smoke', () => {
  it('captures assistant text from a trivial prompt', async () => {
    const fx = setupFixture();
    try {
      const result = await runSkill({
        cwd: fx.cwd,
        prompt: 'Reply with exactly the word PONG and stop.',
        onPrompt: () => null,
        maxTurns: 2,
      });
      expect(result.assistantText.join(' ')).toMatch(/PONG/);
    } finally {
      fx.cleanup();
    }
  }, 60_000);
});
```

Temporarily set `include: ['tests/**/*.test.ts']` in `vitest.config.ts`.

Run: `npx vitest run tests/helpers/harness.smoke.test.ts`
Expected: PASS. If it fails, the SDK API is likely different from the sketch — fix the harness and re-run.

Revert `include`, delete smoke test file.

- [ ] **Step 5.4: Commit**

```sh
git add tests/helpers/harness.ts vitest.config.ts
git commit -m "test(helpers): Agent SDK harness + canonical-prompt matcher"
```

---

## Task 6: Cleanup tracker

**Files:**
- Create: `tests/helpers/cleanup.ts`

- [ ] **Step 6.1: Write `tests/helpers/cleanup.ts`**

```ts
import type { FrigadeClient } from './frigade-client';

interface TrackedFlow {
  client: FrigadeClient;
  id: number;
  slug: string;
}

export class FlowTracker {
  private tracked: TrackedFlow[] = [];

  track(client: FrigadeClient, flow: { id: number; slug: string }) {
    this.tracked.push({ client, id: flow.id, slug: flow.slug });
  }

  async flushAll(): Promise<void> {
    for (const f of this.tracked) {
      try {
        await f.client.deleteFlow(f.id);
      } catch (e) {
        console.warn(`Teardown failed for ${f.client.env}/${f.slug}:`, e);
      }
    }
    this.tracked = [];
  }
}
```

- [ ] **Step 6.2: Commit (no smoke test; this is trivial state-holder)**

```sh
git add tests/helpers/cleanup.ts
git commit -m "test(helpers): per-test flow tracker for teardown"
```

---

## Task 7: `create-flow.test.ts`

**Files:**
- Create: `tests/integration/create-flow.test.ts`

- [ ] **Step 7.1: Write the test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, answerKeyPrompt, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('create-flow', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('creates an announcement and wires it into Next.js', async () => {
    const fx = setupFixture();
    try {
      const title = testTitle('welcome');
      const prompt =
        `Create a welcome announcement titled "${title}" with the message ` +
        `"Hi from tests" and a "Get started" button.`;

      const result = await runSkill({
        cwd: fx.cwd,
        prompt,
        onPrompt: (text) => answerKeyPrompt(text) ?? (matchConfirmation(text) ? 'y' : null),
      });

      // Verify Frigade state.
      const dev = makeClient('dev');
      const flows = await dev.listFlows();
      const created = flows.find((f) => f.name === title);
      expect(created, `flow with name ${title} should exist`).toBeDefined();
      expect(created!.type).toBe('ANNOUNCEMENT');
      tracker.track(dev, { id: created!.id, slug: created!.slug });

      // Verify tmpdir env + binding.
      const envLocal = readFileSync(join(fx.cwd, '.env.local'), 'utf8');
      expect(envLocal).toMatch(/NEXT_PUBLIC_FRIGADE_API_KEY=.+/);
      expect(envLocal).toMatch(/FRIGADE_API_KEY_SECRET=.+/);

      expect(existsSync(join(fx.cwd, '.frigade', 'project.json'))).toBe(true);
      const projJson = JSON.parse(readFileSync(join(fx.cwd, '.frigade', 'project.json'), 'utf8'));
      expect(projJson).toHaveProperty('workspaceId');

      const gitignore = readFileSync(join(fx.cwd, '.gitignore'), 'utf8');
      expect(gitignore).toMatch(/\.env\.local/);
      expect(gitignore).toMatch(/\.frigade\/skill\.log/);

      // Verify provider is wrapping children in layout.
      const layoutSrc = readFileSync(join(fx.cwd, 'app', 'layout.tsx'), 'utf8');
      expect(layoutSrc).toMatch(/Frigade/);
      expect(layoutSrc).toMatch(/\{children\}/);

      // Verify Announcement component is mounted somewhere under app/ with the correct flowId.
      const found = findInTree(join(fx.cwd, 'app'), (src) =>
        new RegExp(`<Frigade\\.Announcement[^>]*flowId\\s*=\\s*["']${created!.slug}["']`).test(src)
      );
      expect(found, `<Frigade.Announcement flowId="${created!.slug}" /> should appear in app/`).not.toBeNull();

      // Verify @frigade/react installed.
      const pkg = JSON.parse(readFileSync(join(fx.cwd, 'package.json'), 'utf8'));
      expect(pkg.dependencies['@frigade/react']).toBeTruthy();

      // Grep guard (D07): no FRIGADE_API_KEY_SECRET anywhere in app/ / src/ / pages/ / components/.
      const leaked = grepInTree(
        [join(fx.cwd, 'app'), join(fx.cwd, 'src'), join(fx.cwd, 'pages'), join(fx.cwd, 'components')],
        /FRIGADE_API_KEY_SECRET/
      );
      expect(leaked, `FRIGADE_API_KEY_SECRET leaked into: ${leaked?.join(', ')}`).toBeNull();

      // Sanity on the skill's completion message.
      expect(result.finalResponse.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

function findInTree(root: string, predicate: (contents: string) => boolean): string | null {
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) {
      const r = findInTree(p, predicate);
      if (r) return r;
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      const src = readFileSync(p, 'utf8');
      if (predicate(src)) return p;
    }
  }
  return null;
}

function grepInTree(roots: string[], regex: RegExp): string[] | null {
  const hits: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|jsx?|env.*)$/.test(name)) {
          if (regex.test(readFileSync(p, 'utf8'))) hits.push(p);
        }
      }
    };
    walk(root);
  }
  return hits.length ? hits : null;
}
```

- [ ] **Step 7.2: Run the test**

Run: `npm run test:create`
Expected: PASS. If it fails:
- **Assertion failure** → a real regression in the skill. Read the error, check the relevant recipe, and fix the skill (separate commit). The test stands.
- **Timeout or harness error** → harness issue; revisit Task 5.
- **Wrong API calls** → operations.md / recipes out of sync; fix the recipe.

- [ ] **Step 7.3: Commit**

```sh
git add tests/integration/create-flow.test.ts
git commit -m "test(integration): create-flow — announcement + Next.js wiring"
```

---

## Task 8: `promote-flow.test.ts`

**Files:**
- Create: `tests/integration/promote-flow.test.ts`

- [ ] **Step 8.1: Write the test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('promote-flow', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('promotes a dev flow to prod after confirmation', async () => {
    const fx = setupFixture();
    try {
      const dev = makeClient('dev');
      const prod = makeClient('prod');
      const title = testTitle('promote');

      // Setup: create a dev flow directly.
      const devFlow = await dev.createFlow({ name: title, type: 'ANNOUNCEMENT' });
      tracker.track(dev, { id: devFlow.id, slug: devFlow.slug });

      // Pre-seed creds + binding so the skill skips first-run-setup.
      seedFixture(fx.cwd);

      let sawPromptWithProdEnv = false;
      const result = await runSkill({
        cwd: fx.cwd,
        prompt: `Promote flow "${devFlow.slug}" from dev to prod.`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'prod') sawPromptWithProdEnv = true;
          return 'y';
        },
      });

      expect(sawPromptWithProdEnv, 'canonical confirmation prompt with env=prod must appear').toBe(true);

      const prodFlow = await prod.getFlow(devFlow.slug);
      expect(prodFlow, 'prod flow should exist at same slug').not.toBeNull();
      expect(prodFlow!.name).toBe(title);
      tracker.track(prod, { id: prodFlow!.id, slug: prodFlow!.slug });

      const devAfter = await dev.getFlow(devFlow.slug);
      const prodIdInternal =
        devAfter?.internalData?.productionActiveFlowId ??
        devAfter?.internalData?.productionDraftFlowId;
      expect(prodIdInternal, 'dev flow should know its prod counterpart (D33)').toBeTruthy();

      expect(result.finalResponse.length).toBeGreaterThan(0);
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
      `FRIGADE_API_KEY_SECRET_PROD=${process.env.FRIGADE_TEST_API_KEY_SECRET_PROD}`,
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify({ workspaceId: 'test-workspace', boundAt: new Date().toISOString() }, null, 2)
  );
}
```

- [ ] **Step 8.2: Run**

Run: `npm run test:promote`
Expected: PASS.

- [ ] **Step 8.3: Commit**

```sh
git add tests/integration/promote-flow.test.ts
git commit -m "test(integration): promote-flow — dev→prod with canonical confirm"
```

---

## Task 9: `delete-flow.test.ts`

**Files:**
- Create: `tests/integration/delete-flow.test.ts`

- [ ] **Step 9.1: Write the test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('delete-flow', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('deletes a dev flow after the canonical confirmation (dangerous in both envs, D09)', async () => {
    const fx = setupFixture();
    try {
      const dev = makeClient('dev');
      const title = testTitle('delete-me');
      const flow = await dev.createFlow({ name: title, type: 'ANNOUNCEMENT' });
      tracker.track(dev, { id: flow.id, slug: flow.slug });

      seedFixture(fx.cwd);

      let sawDevPrompt = false;
      await runSkill({
        cwd: fx.cwd,
        prompt: `Delete flow "${flow.slug}".`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'dev') sawDevPrompt = true;
          return 'y';
        },
      });

      expect(sawDevPrompt, 'canonical confirmation with env=dev must appear (D09)').toBe(true);

      const after = await dev.getFlow(flow.slug);
      expect(after, 'flow should be deleted').toBeNull();
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
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify({ workspaceId: 'test-workspace', boundAt: new Date().toISOString() }, null, 2)
  );
}
```

- [ ] **Step 9.2: Run**

Run: `npm run test:delete`
Expected: PASS.

- [ ] **Step 9.3: Commit**

```sh
git add tests/integration/delete-flow.test.ts
git commit -m "test(integration): delete-flow — confirmation required even in dev"
```

---

## Task 10: `prod-delete-confirm.test.ts`

**Files:**
- Create: `tests/integration/prod-delete-confirm.test.ts`

- [ ] **Step 10.1: Write the test file**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('prod-delete-confirm', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('aborts the prod delete when the user declines', async () => {
    const fx = setupFixture();
    try {
      const prod = makeClient('prod');
      const flow = await prod.createFlow({ name: testTitle('prod-decline'), type: 'ANNOUNCEMENT' });
      tracker.track(prod, { id: flow.id, slug: flow.slug });

      seedFixture(fx.cwd);

      let sawProdPrompt = false;
      const result = await runSkill({
        cwd: fx.cwd,
        prompt: `Delete flow "${flow.slug}" in prod.`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'prod') sawProdPrompt = true;
          return 'n';
        },
      });

      expect(sawProdPrompt, 'canonical confirmation with env=prod must appear').toBe(true);

      const sawDelete = result.toolUses.some((u) => {
        const url = String((u.input as { url?: string }).url ?? (u.input as { path?: string }).path ?? '');
        return /DELETE/.test(u.name) || /\/v1\/flows\/[^\/]+$/.test(url);
      });
      expect(sawDelete, 'no DELETE call should have been issued after decline').toBe(false);

      const still = await prod.getFlow(flow.slug);
      expect(still, 'flow should still exist in prod after decline').not.toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  it('deletes the prod flow when the user confirms', async () => {
    const fx = setupFixture();
    try {
      const prod = makeClient('prod');
      const flow = await prod.createFlow({ name: testTitle('prod-accept'), type: 'ANNOUNCEMENT' });
      tracker.track(prod, { id: flow.id, slug: flow.slug });

      seedFixture(fx.cwd);

      let sawProdPrompt = false;
      await runSkill({
        cwd: fx.cwd,
        prompt: `Delete flow "${flow.slug}" in prod.`,
        onPrompt: (text) => {
          const m = matchConfirmation(text);
          if (!m) return null;
          if (m.env === 'prod') sawProdPrompt = true;
          return 'y';
        },
      });

      expect(sawProdPrompt, 'canonical confirmation with env=prod must appear').toBe(true);

      const after = await prod.getFlow(flow.slug);
      expect(after, 'flow should be deleted from prod').toBeNull();
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
    JSON.stringify({ workspaceId: 'test-workspace', boundAt: new Date().toISOString() }, null, 2)
  );
}
```

- [ ] **Step 10.2: Run**

Run: `npm run test:prod-confirm`
Expected: both tests PASS.

- [ ] **Step 10.3: Commit**

```sh
git add tests/integration/prod-delete-confirm.test.ts
git commit -m "test(integration): prod-delete-confirm — prompt + decline + accept paths"
```

---

## Task 11: `update-targeting.test.ts`

**Files:**
- Create: `tests/integration/update-targeting.test.ts`

> **Implementation note.** The exact DSL for `userProperty "plan" == "pro"` is defined in `reference/targeting-and-rules.md`. Before writing the assertion regex, read that file and enumerate the valid syntactic variants the skill might emit. The regex below accepts multiple common shapes; tighten it based on what the reference actually specifies.

- [ ] **Step 11.1: Confirm DSL shape**

Run: `grep -nE "userProperty|plan" reference/targeting-and-rules.md | head -30`

Expected: shows one or more targeting-DSL examples. Note the exact syntax used (e.g., `userProperty("plan") == "pro"` vs `user.plan == "pro"` vs `user["plan"] == "pro"`). Update the regex in Step 11.2 to match.

- [ ] **Step 11.2: Write the test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation } from '../helpers/harness';
import { makeClient, testTitle } from '../helpers/frigade-client';
import { FlowTracker } from '../helpers/cleanup';

describe('update-targeting', () => {
  const tracker = new FlowTracker();
  afterEach(async () => tracker.flushAll());

  it('adds user-property targeting to a dev flow (safe in dev, no confirm expected)', async () => {
    const fx = setupFixture();
    try {
      const dev = makeClient('dev');
      const flow = await dev.createFlow({ name: testTitle('targeted'), type: 'ANNOUNCEMENT' });
      tracker.track(dev, { id: flow.id, slug: flow.slug });
      expect(flow.targetingLogic, 'pre-condition: flow starts with empty targeting').toBeFalsy();

      const before = flow;
      seedFixture(fx.cwd);

      let unexpectedConfirm = false;
      await runSkill({
        cwd: fx.cwd,
        prompt: `Update targeting on flow "${flow.slug}" so it only shows to users whose "plan" property equals "pro".`,
        onPrompt: (text) => {
          if (matchConfirmation(text)) {
            unexpectedConfirm = true;
            return 'n'; // abort just in case
          }
          return null;
        },
      });

      expect(unexpectedConfirm, 'update-targeting is safe in dev — no prompt should appear (D09)').toBe(false);

      const after = await dev.getFlow(flow.slug);
      expect(after, 'flow should still exist').not.toBeNull();

      // Adjust based on the DSL shape documented in reference/targeting-and-rules.md (Step 11.1).
      const TARGETING_REGEX = /(userProperty\s*\(?\s*["']plan["']\s*\)?|user\.plan|user\[["']plan["']\])\s*(==|===|equals)\s*["']pro["']/i;
      expect(after!.targetingLogic, 'targetingLogic should encode plan == pro').toMatch(TARGETING_REGEX);

      expect(after!.name).toBe(before.name);
      expect(after!.type).toBe(before.type);
      expect(after!.data).toBe(before.data);
      expect(after!.active).toBe(before.active);
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
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify({ workspaceId: 'test-workspace', boundAt: new Date().toISOString() }, null, 2)
  );
}
```

- [ ] **Step 11.3: Run**

Run: `npm run test:targeting`
Expected: PASS.

- [ ] **Step 11.4: Commit**

```sh
git add tests/integration/update-targeting.test.ts
git commit -m "test(integration): update-targeting — user-property DSL, no confirm in dev"
```

---

## Task 12: Sweep script

**Files:**
- Create: `scripts/sweep.ts`

- [ ] **Step 12.1: Write `scripts/sweep.ts`**

```ts
import { config as loadDotenv } from 'dotenv';
import { resolve, join } from 'node:path';
import { makeClient, type Env } from '../tests/helpers/frigade-client.js';

async function main() {
  loadDotenv({ path: join(resolve(import.meta.dirname, '..'), '.env.test.local') });

  for (const env of ['dev', 'prod'] as Env[]) {
    const client = makeClient(env);
    console.log(`\n== Sweeping ${env} ==`);
    const flows = await client.listFlows();
    const targets = flows.filter((f) => f.name.startsWith('TEST-'));

    if (targets.length === 0) {
      console.log(`  (none)`);
      continue;
    }

    for (const f of targets) {
      try {
        await client.deleteFlow(f.id);
        console.log(`  deleted ${f.slug} (${f.name})`);
      } catch (e) {
        console.warn(`  FAILED ${f.slug}:`, e);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 12.2: Run**

Run: `npm run test:sweep`
Expected: prints `== Sweeping dev ==` / `== Sweeping prod ==`, and either `(none)` or a list of deletions. Safe to re-run idempotently.

- [ ] **Step 12.3: Commit**

```sh
git add scripts/sweep.ts
git commit -m "test(scripts): sweep — delete all TEST-prefixed flows in dev + prod"
```

---

## Task 13: README — add testing section

**Files:**
- Modify: `README.md`

- [ ] **Step 13.1: Append a new section before `## License`**

Find the line:

```
See [`reference/decisions.md`](reference/decisions.md) for the full locked decisions log (D01–D35) covering scope, framework support, key storage, safety tiers, binding model, error semantics, and more.
```

Append the following after it:

```markdown

## Running the integration tests

The repo ships with end-to-end integration tests (`tests/integration/`) that exercise the skill against a real Frigade test workspace. They're local-only — no CI.

**Setup (one time):**

1. Create a dedicated Frigade test workspace with both a dev and a prod organization.
2. `cp .env.test.local.example .env.test.local`, then paste your `ANTHROPIC_API_KEY` and the four Frigade test keys.
3. `npm install`

**Run:**

```sh
npm test                     # all five test files
npm run test:create          # create announcement + wire into Next.js
npm run test:promote         # dev→prod promotion
npm run test:delete          # delete dev flow (confirm required)
npm run test:prod-confirm    # prod delete: decline + accept paths
npm run test:targeting       # update targeting by user property
npm run test:sweep           # delete all TEST-prefixed flows in both envs
```

Tests use title-prefixed flows (`TEST-<stamp>-...`) so leaked flows are identifiable. Each test's `afterEach` deletes flows it created; `npm run test:sweep` is a safety net for crashed runs.
```

- [ ] **Step 13.2: Commit**

```sh
git add README.md
git commit -m "docs(readme): document running the integration tests"
```

---

## Task 14: End-to-end verification

- [ ] **Step 14.1: Wipe fixture cache and re-run the full suite from a cold start**

```sh
rm -rf tests/.cache node_modules
npm install
npm test
```

Expected: five test files, seven tests total, all PASS. `tests/.cache/node_modules` repopulates once in globalSetup (~30s), then each test runs in ~30–90s.

- [ ] **Step 14.2: Sweep to confirm clean state**

Run: `npm run test:sweep`
Expected: `(none)` in both dev and prod (every test cleaned up after itself).

- [ ] **Step 14.3: Commit anything lingering, push**

```sh
git status                   # should be clean
git push origin main
```

---

## Self-review checklist (before handoff)

- [x] **Spec coverage.** All five test cases from the spec have their own task (7–11). Secrets / cleanup / fixture / harness each map to a task (1–6). Sweep + README covered (12–13).
- [x] **No placeholders.** Every step contains the full command or code. The two implementation notes (SDK API shape in Task 5, DSL syntax in Task 11) are gated by explicit investigation steps, not deferred with "TBD".
- [x] **Type consistency.** `FrigadeClient`, `FrigadeFlow`, `RunSkillOptions`, `RunSkillResult`, `Fixture`, `FlowTracker` are defined once and reused.
- [x] **File paths exact.** Every file path includes full relative path from repo root.
