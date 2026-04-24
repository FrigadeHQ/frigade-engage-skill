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
