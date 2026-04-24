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
  // Task 7/8 learned that the skill validates workspace binding against the
  // real workspace returned by the API key. Placeholder IDs like
  // 'test-workspace' get rejected. The test workspace has id "208" for dev.
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
