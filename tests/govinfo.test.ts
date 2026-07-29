import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { LiveGovInfoAdapter } from "../server/connectors/govinfo.js";
import { loadServerConfig } from "../server/config.js";

test("live GovInfo adapter normalizes filters, retrieves official material, and exposes trace metadata", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/search?")) {
      return new Response(JSON.stringify({
        results: [{ packageId: "BILLS-119hr1ih", title: "Test Bill", collectionCode: "BILLS" }],
        nextPage: "https://api.govinfo.gov/search?offsetMark=next-token",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/summary?")) {
      return new Response(JSON.stringify({
        title: "Test Bill",
        dateIssued: "2026-01-03",
        collectionCode: "BILLS",
        detailsLink: "https://www.govinfo.gov/app/details/BILLS-119hr1ih",
        download: { txtLink: "https://api.govinfo.gov/packages/BILLS-119hr1ih/htm" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("<p>The agency shall provide a hearing before imposing the penalty.</p>", { status: 200 });
  };
  const adapter = new LiveGovInfoAdapter({ apiKey: "test-key", fetchImpl: mockFetch, retries: 0 });
  const result = await adapter.search({
    query: "  agency   hearing ",
    dateFrom: "2026-01-01",
    dateTo: "2026-02-01",
    documentTypes: ["bills", "BILLS", "bad value!"],
    pageSize: 500,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.nextOffsetMark, "next-token");
  assert.equal(result.citations.length, 1);
  assert.match(result.citations[0].textSnippet, /provide a hearing/);
  assert.equal(result.citations[0].providerSourceId, "BILLS-119hr1ih");
  assert.equal(result.citations[0].publicationDate, "2026-01-03");
  assert.ok(result.citations[0].retrievalDate);
  const searchBody = JSON.parse(String(requests[0].init?.body));
  assert.equal(searchBody.pageSize, 20);
  assert.match(searchBody.query, /^agency hearing AND collection:\(BILLS\)/);
  assert.match(searchBody.query, /publishdate:range\(2026-01-01,2026-02-01\)/);
  assert.ok(requests.every(({ url }) => new URL(url).searchParams.get("api_key") === "test-key"));
});

test("GovInfo retries 429 responses and returns honest empty/outage results", async () => {
  let calls = 0;
  const retrying = new LiveGovInfoAdapter({
    apiKey: "test-key",
    retries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    },
  });
  assert.deepEqual(await retrying.search({ query: "nothing" }), {
    citations: [],
    nextOffsetMark: undefined,
    status: "empty",
  });
  assert.equal(calls, 2);

  const unavailable = new LiveGovInfoAdapter({
    apiKey: "test-key",
    retries: 0,
    timeoutMs: 10,
    fetchImpl: async () => {
      throw new Error("provider offline");
    },
  });
  assert.deepEqual(await unavailable.search({ query: "authority" }), {
    citations: [],
    status: "unavailable",
  });
});

test("GovInfo activates from its credential while unavailable legal sources remain absent", async () => {
  assert.equal(loadServerConfig({
    NODE_ENV: "test",
    GOVINFO_API_KEY: "test-key",
  }).integrations.govInfo.status, "configured");
  const assistant = await readFile("src/components/AssistantView.tsx", "utf8");
  assert.doesNotMatch(assistant, /<span>CourtListener Case Law<\/span>/);
  assert.doesNotMatch(assistant, /<span>CourtListener<\/span>/);
  assert.match(assistant, /providerStatuses.*govInfo/);
});

test("migration 015 adds immutable scoped research traces and exact supporting passages", async () => {
  const migration = await readFile("server/migrations.ts", "utf8");
  const db = await readFile("server/db.ts", "utf8");
  assert.match(migration, /version:\s*15/);
  assert.match(migration, /research_runs[\s\S]*firm_id TEXT NOT NULL[\s\S]*user_id TEXT NOT NULL[\s\S]*thread_id TEXT NOT NULL/);
  assert.match(migration, /reject_research_trace_mutation/);
  assert.match(migration, /supporting_passage TEXT NOT NULL/);
  assert.match(db, /WHERE t\.id = \$7 AND t\.user_id = \$3/);
  assert.match(db, /c\.firm_id = \$2/);
  assert.match(db, /source\.textSnippet\.trim\(\)/);
});

test("environment-gated live GovInfo staging smoke", { skip: process.env.GOVINFO_LIVE_SMOKE !== "true" }, async () => {
  assert.ok(process.env.GOVINFO_API_KEY, "GOVINFO_API_KEY is required for the live smoke test");
  const adapter = new LiveGovInfoAdapter();
  const result = await adapter.search({ query: "Administrative Procedure Act", pageSize: 1 });
  assert.notEqual(result.status, "unavailable");
  assert.ok(result.citations.length > 0);
  assert.ok(result.citations[0].url);
  assert.ok(result.citations[0].textSnippet.length > 20);
});
