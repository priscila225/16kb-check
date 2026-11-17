import { VERSION } from "../version";

export const DEFAULT_API_BASE = "https://devbooth.dev";
export const USER_AGENT = `roku-preflight/${VERSION} (+https://devbooth.dev)`;

export type ApiClient = {
  baseUrl: string;
  fetch: typeof fetch;
};

export function createClient(opts?: { baseUrl?: string; fetch?: typeof fetch }): ApiClient {
  return {
    baseUrl: (opts?.baseUrl || process.env.ROKU_PREFLIGHT_API || process.env.DEVBOOTH_API || DEFAULT_API_BASE).replace(/\/$/, ""),
    fetch: opts?.fetch || globalThis.fetch.bind(globalThis),
  };
}
