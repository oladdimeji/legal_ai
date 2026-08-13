import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { db } from "../server/db.js";
import { filterHistoryThreads, orderHistoryThreads } from "../src/components/HistoryView.js";
import type { Thread } from "../src/types.js";

type CapturedQuery = { sql: string; params: unknown[] };

async function captureHistoryQuery(search?: string): Promise<CapturedQuery> {
  const database = db as unknown as {
    query: (sql: string, params: unknown[]) => Promise<unknown[]>;
    getHistoryThreads: typeof db.getHistoryThreads;
  };
  const originalQuery = database.query;
  let captured: CapturedQuery | null = null;
  database.query = async (sql, params) => {
    captured = { sql, params };
    return [];
  };
  try {
    await database.getHistoryThreads({ userId: "user_current", firmId: "firm_current" }, search);
  } finally {
    database.query = originalQuery;
  }
  assert.ok(captured);
  return captured;
}

function thread(
  id: string,
  caseId: string | null,
  createdAt: string,
  lastActivityAt?: string
): Thread {
  return {
    id,
    user_id: "user_current",
    case_id: caseId,
    scope: caseId ? "case" : "wide",
    title: id,
    created_at: createdAt,
    last_activity_at: lastActivityAt,
  };
}

test("History keyword search matches titles and message content case-insensitively", async () => {
  const { sql, params } = await captureHistoryQuery("  InDeMnIfIcAtIoN  ");
  assert.match(sql, /t\.title ILIKE \$3 ESCAPE '\\'/);
  assert.match(sql, /EXISTS \([\s\S]*?FROM messages matching_message[\s\S]*?matching_message\.thread_id = t\.id[\s\S]*?matching_message\.content ILIKE \$3 ESCAPE '\\'/);
  assert.deepEqual(params, ["user_current", "firm_current", "%InDeMnIfIcAtIoN%"]);
  assert.match(sql, /AND \(\s*t\.title ILIKE[\s\S]*?OR EXISTS/);
});

test("History search keeps authenticated user, Firm, Matter-access, and non-client boundaries", async () => {
  const { sql, params } = await captureHistoryQuery("contract");
  assert.match(sql, /WHERE t\.user_id = \$1/);
  assert.match(sql, /t\.scope <> 'client'/);
  assert.match(sql, /JOIN matter_user_access access/);
  assert.match(sql, /access\.case_id = c\.id AND access\.user_id = \$1/);
  assert.match(sql, /c\.id = t\.case_id AND c\.firm_id = \$2/);
  assert.equal(params[0], "user_current");
  assert.equal(params[1], "firm_current");
});

test("History search derives latest activity from every message, not only matching messages", async () => {
  const { sql } = await captureHistoryQuery("old matching text");
  assert.match(sql, /LEFT JOIN messages m ON m\.thread_id = t\.id/);
  assert.match(sql, /COALESCE\(MAX\(m\.created_at\), t\.created_at\) AS last_activity_at/);
  assert.match(sql, /ORDER BY COALESCE\(MAX\(m\.created_at\), t\.created_at\) DESC/);
  assert.doesNotMatch(sql, /m\.content ILIKE/);
  assert.match(sql, /matching_message\.content ILIKE/);
});

test("empty History search retains the original retrieval shape and avoids a search parameter", async () => {
  for (const search of [undefined, "", "   "]) {
    const { sql, params } = await captureHistoryQuery(search);
    assert.deepEqual(params, ["user_current", "firm_current"]);
    assert.doesNotMatch(sql, /matching_message|t\.title ILIKE/);
    assert.match(sql, /ORDER BY COALESCE\(MAX\(m\.created_at\), t\.created_at\) DESC/);
  }
});

test("History keyword input treats SQL wildcard characters as literal text", async () => {
  const { params } = await captureHistoryQuery("100%_complete\\review");
  assert.deepEqual(params, ["user_current", "firm_current", "%100\\%\\_complete\\\\review%"]);
});

test("History search results retain latest-activity ordering and intersect with Show filters", () => {
  const results = [
    thread("general-old", null, "2026-01-01T00:00:00.000Z"),
    thread("matter-new", "matter-a", "2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z"),
    thread("matter-other", "matter-b", "2026-03-01T00:00:00.000Z"),
    thread("general-new", null, "2026-02-01T00:00:00.000Z"),
  ];
  const ordered = orderHistoryThreads(results);
  assert.deepEqual(ordered.map(({ id }) => id), ["matter-new", "matter-other", "general-new", "general-old"]);
  assert.deepEqual(filterHistoryThreads(ordered, "general").map(({ id }) => id), ["general-new", "general-old"]);
  assert.deepEqual(filterHistoryThreads(ordered, "matter:matter-a").map(({ id }) => id), ["matter-new"]);
  assert.deepEqual(filterHistoryThreads(ordered, "all").map(({ id }) => id), ordered.map(({ id }) => id));
});

test("History route and UI preserve normal load, Matter options, clearing, open, and delete flows", async () => {
  const [server, history, database] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/HistoryView.tsx", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('app.get("/api/threads"'),
    server.indexOf('app.post("/api/threads"')
  );
  assert.match(route, /typeof req\.query\.search === "string"/);
  assert.match(route, /getHistoryThreads\(ownership\(req\), search\)/);
  assert.match(history, /fetch\("\/api\/threads\?history=true"\)/);
  assert.match(history, /new URLSearchParams\(\{ history: "true", search: debouncedSearch \}\)/);
  assert.match(history, /window\.setTimeout\(\(\) => setDebouncedSearch\(normalizedSearch\), 300\)/);
  assert.match(history, /new AbortController\(\)/);
  assert.match(history, /controller\.abort\(\)/);
  assert.match(history, /const searchVersion = useRef\(0\)/);
  assert.match(history, /version === searchVersion\.current/);
  assert.match(history, /if \(!normalizedSearch\) \{[\s\S]*?setSearchResult\(null\)/);
  assert.match(history, /threads\.map\(\(thread\) => thread\.case_id\)/);
  assert.match(history, /onClick=\{\(\) => onSelectThread\(thread\)\}/);
  assert.match(history, /setThreads\(\(current\) => current\.filter/);
  assert.match(history, /setSearchResult\(\(current\) => current/);
  assert.match(history, /onRefreshThreads\?\.\(\)/);
  assert.match(history, /Associated Work Product will be preserved/);
  assert.match(database, /DELETE FROM threads t[\s\S]*?RETURNING t\.id/);
  assert.doesNotMatch(database.slice(database.indexOf("public async deleteThread"), database.indexOf("public async getMessages")), /DELETE FROM drafts/);
});
