/**
 * Test helpers for the fetch-based analytics sinks: a recording mock `fetch`
 * and a tiny client for a live ClickHouse (`CLICKHOUSE_URL`), used to run the
 * Tinybird and Analytics Engine SQL against a real engine.
 *
 * @module
 */

/** One captured request. */
export interface Captured {
  url: URL;
  init: RequestInit;
  body: string;
}

/** A recording `fetch`; `respond` returns a JSON-able body, a `Response`, or `undefined` (empty 200). */
export function mockFetch(respond: (req: Captured) => unknown = () => ({ data: [] })) {
  const calls: Captured[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req = { url: new URL(String(input)), init, body: String(init.body ?? "") };
    calls.push(req);
    const out = respond(req);
    if (out instanceof Response) return out;
    return new Response(out === undefined ? "" : JSON.stringify(out), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A live ClickHouse from the environment, or `undefined`. */
export function liveClickHouse() {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return undefined;
  const headers: Record<string, string> = {
    "X-ClickHouse-User": process.env.CLICKHOUSE_USER ?? "default",
  };
  if (process.env.CLICKHOUSE_PASSWORD)
    headers["X-ClickHouse-Key"] = process.env.CLICKHOUSE_PASSWORD;
  const database = process.env.CLICKHOUSE_DATABASE ?? "default";
  /** Run one statement; `data` (when given) is the request body and the statement goes in `query=`. */
  async function run(statement: string, data?: string): Promise<Response> {
    const target = new URL(url!);
    target.searchParams.set("database", database);
    if (data !== undefined) target.searchParams.set("query", statement);
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: data ?? statement,
    });
    if (!response.ok) {
      return new Response(await response.text(), { status: response.status });
    }
    return response;
  }
  const uniqueName = (prefix: string) =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { url, headers, database, run, uniqueName };
}
