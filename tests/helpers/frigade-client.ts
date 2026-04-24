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
  const authHeader = { Authorization: `Bearer ${secret}` };

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const hasBody = init.body != null;
    const mergedHeaders: Record<string, string> = {
      ...authHeader,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    const res = await fetch(`${base}${path}`, { ...init, headers: mergedHeaders });
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
      return request<FrigadeFlow>(`/v1/flows`, {
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
      const res = await request<{ data: FrigadeFlow[] } | FrigadeFlow[]>(`/v1/flows`);
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
