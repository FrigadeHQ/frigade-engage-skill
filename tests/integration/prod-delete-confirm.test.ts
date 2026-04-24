import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setupFixture } from '../helpers/fixture';
import { runSkill, matchConfirmation, type ToolUse } from '../helpers/harness';
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

      const sawDelete = result.toolUses.some((u) => isDeleteFlowCall(u, flow.id));
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

/**
 * Detect a DELETE call against the flow under test. The skill's recipes drive
 * the Frigade REST API via `curl` invoked through the Bash tool, so the
 * request verb + path land inside the `command` string, not in a structured
 * `url`/`path` field. We accept every plausible shape:
 *   - Bash:  `curl -X DELETE .../v1/flows/<id>`
 *   - Named HTTP tool (hypothetical): input.url / input.path with a flow-id
 *     suffix and either a DELETE method hint or a DELETE-style tool name.
 *
 * Passing in the numeric `flowId` lets us match the specific flow even if the
 * skill also hits other DELETE endpoints in the same session.
 */
function isDeleteFlowCall(u: ToolUse, flowId: number): boolean {
  const input = u.input as { url?: string; path?: string; method?: string; command?: string };
  const command = String(input.command ?? '');
  const url = String(input.url ?? input.path ?? '');
  const flowIdPat = new RegExp(`/v1/flows/${flowId}(?:\\b|/|$|["' ])`);

  // Bash curl: look for both a DELETE verb AND the flow-id path in the same command.
  if (command) {
    const deleteVerb = /(?:-X\s*|--request\s*|^\s*|["' ])DELETE\b/i.test(command);
    const hitsFlow = flowIdPat.test(command);
    // Also match generic /v1/flows/<numeric> path in case we can't key on id.
    const hitsAnyFlow = /\/v1\/flows\/\d+(?:\b|\/|$|["' ])/.test(command);
    if (deleteVerb && (hitsFlow || hitsAnyFlow)) return true;
  }

  // Structured HTTP tool shape (belt-and-suspenders — not currently emitted by
  // the skill, but cheap to cover in case tool shapes evolve).
  if (url) {
    const methodIsDelete = /DELETE/i.test(String(input.method ?? '')) || /DELETE/i.test(u.name);
    const hitsFlow = flowIdPat.test(url) || /\/v1\/flows\/\d+(?:\b|\/|$)/.test(url);
    if (methodIsDelete && hitsFlow) return true;
  }

  return false;
}

function seedFixture(cwd: string) {
  writeFileSync(
    join(cwd, '.env.local'),
    [
      `NEXT_PUBLIC_FRIGADE_API_KEY=${process.env.FRIGADE_TEST_API_KEY_PUBLIC}`,
      `FRIGADE_API_KEY_SECRET=${process.env.FRIGADE_TEST_API_KEY_SECRET}`,
      `NEXT_PUBLIC_FRIGADE_API_KEY_PROD=${process.env.FRIGADE_TEST_API_KEY_PUBLIC_PROD ?? ''}`,
      `FRIGADE_API_KEY_SECRET_PROD=${process.env.FRIGADE_TEST_API_KEY_SECRET_PROD}`,
      '',
    ].join('\n'),
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  // Real workspace IDs from Tasks 7/8: dev=208, prod=209. The skill validates
  // the marker against the workspace the API key resolves to, so placeholder
  // IDs like 'test-workspace' get rejected and force first-run-setup.
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify(
      {
        workspaceId: '208',
        prodWorkspaceId: '209',
        boundAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
