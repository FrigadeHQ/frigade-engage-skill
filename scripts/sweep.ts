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
