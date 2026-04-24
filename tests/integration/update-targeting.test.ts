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

      // Canonical DSL forms documented in reference/targeting-and-rules.md:
      //   1. user.property('plan') == 'pro'          (primary; single quotes)
      //   2. user.properties.plan == 'pro'           (dotted shorthand)
      // The evaluator also normalizes `===` → `==` and `"` → `'` pre-parse, so
      // the skill MAY emit double quotes or `===` in the write that still
      // round-trips as valid. We accept any of those variants. The LHS key
      // must be `plan`; the RHS literal must be `pro`.
      const TARGETING_REGEX =
        /(user\.property\s*\(\s*["']plan["']\s*\)|user\.properties\.plan|user\[["']plan["']\])\s*(==|===|equals)\s*["']pro["']/i;
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
  // Real dev workspace id (matches what previous tests use; placeholder
  // 'test-workspace' is rejected by the skill's binding check).
  writeFileSync(
    join(cwd, '.frigade', 'project.json'),
    JSON.stringify(
      {
        workspaceId: '208',
        boundAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
