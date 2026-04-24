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
        // Tests may have already deleted the flow through the skill (the
        // delete-flow and prod-delete-confirm happy paths do). The Frigade
        // API returns 404 or 500 on double-delete. Swallow those silently.
        if (e instanceof Error && /-> (404|500)/.test(e.message)) continue;
        console.warn(`Teardown failed for ${f.client.env}/${f.slug}:`, e);
      }
    }
    this.tracked = [];
  }
}
