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
