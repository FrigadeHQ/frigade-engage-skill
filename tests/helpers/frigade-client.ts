const DEV_BASE = 'https://api3.frigade.com';
const PROD_BASE = 'https://api3.frigade.com';
const GQL_ENDPOINT = 'https://api3.frigade.com/graphql';

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

export interface FrigadeCollection {
  id: number;
  slug: string;
  name: string;
  description: string;
  type: 'DEFAULT' | 'CUSTOM';
  coolOffPeriod: number;
  coolOffUnit: 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
  coolOffEnabled: boolean;
  enabled: boolean;
  order: number;
  color: string;
  allowedComponents: string[];
  productionRuleId?: number | null;
  flows?: Array<{ id: number; slug: string }>;
}

export interface UpdateCollectionPatch {
  id: number;
  name?: string;
  description?: string;
  coolOffPeriod?: number;
  coolOffUnit?: FrigadeCollection['coolOffUnit'];
  coolOffEnabled?: boolean;
  color?: string;
  enabled?: boolean;
  order?: number;
  flowIds?: number[];
  allowedComponents?: string[];
}

export interface FrigadeClient {
  env: Env;
  createFlow(input: { name: string; type: string; data?: string; targetingLogic?: string }): Promise<FrigadeFlow>;
  getFlow(slug: string): Promise<FrigadeFlow | null>;
  listFlows(): Promise<FrigadeFlow[]>;
  updateFlow(id: number, patch: Partial<Pick<FrigadeFlow, 'name' | 'data' | 'targetingLogic' | 'active'>>): Promise<FrigadeFlow>;
  deleteFlow(id: number): Promise<void>;
  createCollection(input: {
    name: string;
    description?: string;
    coolOffPeriod?: number;
    coolOffUnit?: FrigadeCollection['coolOffUnit'];
    flowIds?: number[];
  }): Promise<FrigadeCollection>;
  getCollection(slug: string): Promise<FrigadeCollection | null>;
  listCollections(): Promise<FrigadeCollection[]>;
  updateCollections(patches: UpdateCollectionPatch[]): Promise<FrigadeCollection[]>;
  deleteCollection(id: number): Promise<void>;
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

  async function gqlRequest<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GraphQL POST -> ${res.status}: ${text}`);
    }
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors && body.errors.length > 0) {
      throw new Error(`GraphQL error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (!body.data) throw new Error('GraphQL response missing data');
    return body.data;
  }

  // GraphQL `ID` scalars arrive as strings over the wire. Coerce Rule ids (and
  // nested flow ids) back to numbers so the customer-facing type stays `number`.
  function normalizeCollection(raw: FrigadeCollection): FrigadeCollection {
    return {
      ...raw,
      id: Number(raw.id),
      flows: raw.flows?.map((f) => ({ ...f, id: Number(f.id) })),
    };
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
    async createCollection(input) {
      const query = `
        mutation CreateCollection($name: String!, $description: String!, $coolOffPeriod: Float, $coolOffUnit: String, $flowIds: [Float!]) {
          createRule(name: $name, description: $description, coolOffPeriod: $coolOffPeriod, coolOffUnit: $coolOffUnit, flowIds: $flowIds) {
            id slug name description type coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents productionRuleId
          }
        }
      `;
      const data = await gqlRequest<{ createRule: FrigadeCollection }>(query, {
        name: input.name,
        description: input.description ?? '',
        coolOffPeriod: input.coolOffPeriod ?? null,
        coolOffUnit: input.coolOffUnit ?? null,
        flowIds: input.flowIds ?? null,
      });
      return normalizeCollection(data.createRule);
    },
    async getCollection(slug) {
      const list = await this.listCollections();
      return list.find((c) => c.slug === slug) ?? null;
    },
    async listCollections() {
      const query = `
        query ListCollections($skip: Int!, $take: Int!) {
          rules(skip: $skip, take: $take) {
            id slug name description type coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents productionRuleId
            flows { id slug }
          }
        }
      `;
      const data = await gqlRequest<{ rules: FrigadeCollection[] }>(query, { skip: 0, take: 50 });
      return data.rules.map(normalizeCollection);
    },
    async updateCollections(patches) {
      const query = `
        mutation UpdateCollections($rules: [UpdateRuleDTO!]!) {
          updateRules(rules: $rules) {
            id slug name description coolOffPeriod coolOffUnit coolOffEnabled enabled order color allowedComponents
            flows { id slug }
          }
        }
      `;
      const data = await gqlRequest<{ updateRules: FrigadeCollection[] }>(query, { rules: patches });
      return data.updateRules.map(normalizeCollection);
    },
    async deleteCollection(id) {
      const query = `
        mutation DeleteCollection($id: Float!) {
          deleteRule(id: $id) { id }
        }
      `;
      await gqlRequest(query, { id });
    },
  };
}

export function testTitle(kind: string): string {
  const stamp = new Date().toISOString().replace(/[:.TZ-]/g, '').slice(0, 12);
  const shortid = Math.random().toString(36).slice(2, 8);
  return `TEST-${stamp}-${shortid}-${kind}`;
}
