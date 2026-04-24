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
      `NEXT_PUBLIC_FRIGADE_API_KEY_PROD=${process.env.FRIGADE_TEST_API_KEY_PUBLIC_PROD ?? ''}`,
      `FRIGADE_API_KEY_SECRET_PROD=${process.env.FRIGADE_TEST_API_KEY_SECRET_PROD}`,
      '',
    ].join('\n')
  );
  mkdirSync(join(cwd, '.frigade'), { recursive: true });
  // Task 7's run recorded workspaceId "208" / prodWorkspaceId "209" against
  // the real Frigade test workspace — the skill validates marker-vs-key
  // binding so we must use the matching numeric IDs, not placeholders.
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
