import type { CatalogEntry, DeclaredDep } from "./check/types";
import { publicDemandCoordinates } from "./check/public-coords";
import { VERSION } from "./version";

export const DEFAULT_API_BASE = "https://16kb.dev";
export const USER_AGENT = `16kb-check/${VERSION} (+https://16kb.dev)`;

const PUBLIC_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;

export function isPublicVersionString(v: string): boolean {
  return PUBLIC_VERSION.test(v.trim());
}

export type CatalogResponse = {
  ok: boolean;
  count: number;
  entries: CatalogEntry[];
};

export type DemandJob = {
  coordinate: string;
  slug?: string;
  status?: string;
  accepted?: boolean;
  reason?: string;
};

export type DemandResponse = {
  ok: boolean;
  accepted: number;
  jobs: DemandJob[];
};

export type ApiClient = {
  baseUrl: string;
  fetch: typeof fetch;
};

export function createClient(opts?: { baseUrl?: string; fetch?: typeof fetch }): ApiClient {
  return {
    baseUrl: (opts?.baseUrl || process.env.SIXTEENKB_API || DEFAULT_API_BASE).replace(/\/$/, ""),
    fetch: opts?.fetch || globalThis.fetch.bind(globalThis),
  };
}

async function readJson(res: Response, what: string): Promise<unknown> {
  if (!res.ok) {
    throw new Error(`16kb.dev ${what} failed (${res.status} ${res.statusText})`);
  }
  return res.json();
}

export async function fetchCatalog(client: ApiClient, opts: { fresh?: boolean } = {}): Promise<CatalogEntry[]> {
  // fresh skips the CDN copy (cached up to a few minutes) when the server says an entry exists
  // that the cached catalog did not have yet.
  const url = `${client.baseUrl}/api/catalog${opts.fresh ? `?fresh=${Date.now()}` : ""}`;
  const res = await client.fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
  });
  const data = (await readJson(res, "catalog")) as CatalogResponse;
  if (!data || !Array.isArray(data.entries)) {
    throw new Error("16kb.dev catalog response was not recognized.");
  }
  return data.entries.map((e) => ({
    slug: String(e.slug || ""),
    name: String(e.name || e.slug || ""),
    status: e.status,
    minVersion: String(e.minVersion || ""),
    notes: String(e.notes || ""),
    mavenCoords: Array.isArray(e.mavenCoords) ? e.mavenCoords.map((c) => String(c)) : [],
    autoChecked: !!e.autoChecked,
  }));
}

/**
 * Ask 16kb.dev to auto-check public coordinates that are not in the catalog yet.
 * Only public group:artifact names and public version strings are sent.
 * The caller must already have dropped private coordinates.
 */
export async function enqueuePublicUnknown(
  client: ApiClient,
  publicUnknown: DeclaredDep[],
  catalogGroups?: ReadonlySet<string>,
): Promise<DemandResponse> {
  const coordinates = publicDemandCoordinates(
    publicUnknown.map((d) => `${d.group}:${d.artifact}`),
    catalogGroups,
  );
  if (!coordinates.length) return { ok: true, accepted: 0, jobs: [] };
  const allowed = new Set(coordinates);
  const versions: Record<string, string> = {};
  for (const d of publicUnknown) {
    const c = `${d.group}:${d.artifact}`.toLowerCase();
    if (!allowed.has(c)) continue;
    if (d.version && isPublicVersionString(d.version)) versions[c] = d.version;
  }
  const res = await client.fetch(`${client.baseUrl}/api/check-demand`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ coordinates, versions }),
  });
  const data = (await readJson(res, "check-demand")) as DemandResponse;
  return {
    ok: !!data?.ok,
    accepted: Number(data?.accepted || 0),
    jobs: Array.isArray(data?.jobs) ? data.jobs : [],
  };
}
