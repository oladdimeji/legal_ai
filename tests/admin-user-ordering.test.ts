import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterAdminRequests,
  orderAdminRequests,
} from "../src/components/AdminView.js";
import type { PlatformAccessRequest } from "../src/types.js";

function request(
  userId: string,
  overrides: Partial<PlatformAccessRequest> = {}
): PlatformAccessRequest {
  return {
    userId,
    fullName: `User ${userId}`,
    email: `${userId}@example.com`,
    professionalRole: "Lawyer",
    customProfessionalRole: null,
    workspaceType: "independent",
    firmName: null,
    practiceAreas: [],
    customPracticeArea: null,
    submittedAt: "2026-08-15T10:00:00.000Z",
    status: "pending",
    trackedAiCostUsdNanos: "0",
    ...overrides,
  };
}

function ids(requests: PlatformAccessRequest[]): string[] {
  return requests.map(({ userId }) => userId);
}

test("admin defaults to newest-first ordering and exposes all ordering options", async () => {
  const adminView = await readFile("src/components/AdminView.tsx", "utf8");
  assert.match(adminView, /useState<AdminOrder>\("newest"\)/);
  assert.match(adminView, /<label htmlFor="admin-user-order"[\s\S]*Order users by/);
  assert.match(adminView, /<option value="newest">Newest first<\/option>/);
  assert.match(adminView, /<option value="cost-desc">Tracked AI Cost: High to Low<\/option>/);
  assert.match(adminView, /<option value="cost-asc">Tracked AI Cost: Low to High<\/option>/);
  assert.match(adminView, /<option value="status">Status: Pending first<\/option>/);
});

test("newest ordering is descending and preserves input order for timestamp ties", () => {
  const requests = [
    request("older", { submittedAt: "2026-08-13T10:00:00.000Z" }),
    request("tie-first"),
    request("tie-second"),
  ];
  assert.deepEqual(ids(orderAdminRequests(requests, "newest")), [
    "tie-first",
    "tie-second",
    "older",
  ]);
});

test("tracked AI cost orders exact nanos high-to-low and low-to-high", () => {
  const requests = [
    request("lower", { trackedAiCostUsdNanos: "9007199254740992" }),
    request("higher", { trackedAiCostUsdNanos: "9007199254740993" }),
    request("small", { trackedAiCostUsdNanos: "7" }),
  ];
  assert.equal(Number(requests[0].trackedAiCostUsdNanos), Number(requests[1].trackedAiCostUsdNanos));
  assert.deepEqual(ids(orderAdminRequests(requests, "cost-desc")), ["higher", "lower", "small"]);
  assert.deepEqual(ids(orderAdminRequests(requests, "cost-asc")), ["small", "lower", "higher"]);
});

test("malformed and missing tracked costs safely behave as zero", () => {
  const missing = request("missing", {
    submittedAt: "2026-08-15T11:00:00.000Z",
    trackedAiCostUsdNanos: undefined as unknown as string,
  });
  const malformed = request("malformed", {
    submittedAt: "2026-08-15T10:00:00.000Z",
    trackedAiCostUsdNanos: "not-a-bigint",
  });
  const positive = request("positive", { trackedAiCostUsdNanos: "1" });
  assert.deepEqual(ids(orderAdminRequests([positive, malformed, missing], "cost-asc")), [
    "missing",
    "malformed",
    "positive",
  ]);
});

test("status ordering uses business priority and newest-first within each status", () => {
  const requests = [
    request("denied", { status: "denied" }),
    request("approved-old", {
      status: "approved",
      submittedAt: "2026-08-13T10:00:00.000Z",
    }),
    request("pending-old", {
      submittedAt: "2026-08-14T10:00:00.000Z",
    }),
    request("approved-new", { status: "approved" }),
    request("pending-new", { submittedAt: "2026-08-16T10:00:00.000Z" }),
  ];
  assert.deepEqual(ids(orderAdminRequests(requests, "status")), [
    "pending-new",
    "pending-old",
    "approved-new",
    "approved-old",
    "denied",
  ]);
});

test("search filters before ordering and search and order state remain independent", async () => {
  const requests = [
    request("smith-low", {
      fullName: "Alex Smith",
      trackedAiCostUsdNanos: "3",
    }),
    request("other-high", {
      fullName: "Jordan Jones",
      trackedAiCostUsdNanos: "999",
    }),
    request("smith-high", {
      fullName: "Sam Smith",
      trackedAiCostUsdNanos: "8",
    }),
  ];
  const filteredRequests = filterAdminRequests(requests, "Smith");
  assert.deepEqual(ids(orderAdminRequests(filteredRequests, "cost-desc")), [
    "smith-high",
    "smith-low",
  ]);

  const adminView = await readFile("src/components/AdminView.tsx", "utf8");
  assert.match(adminView, /orderAdminRequests\(filteredRequests, orderBy\)/);
  assert.match(adminView, /onChange=\{\(event\) => setSearchTerm\(event\.target\.value\)\}/);
  assert.match(adminView, /onChange=\{\(event\) => setOrderBy\(event\.target\.value as AdminOrder\)\}/);
});

test("ordering copies the filtered array and leaves request objects and state order unchanged", () => {
  const requests = [
    request("low", { trackedAiCostUsdNanos: "1" }),
    request("high", { trackedAiCostUsdNanos: "2" }),
  ];
  const before = [...requests];
  const ordered = orderAdminRequests(requests, "cost-desc");
  assert.notEqual(ordered, requests);
  assert.deepEqual(requests, before);
  assert.deepEqual(ids(ordered), ["high", "low"]);
  assert.equal(ordered[0], requests[1]);
});

test("existing access actions and local status updates remain unchanged", async () => {
  const adminView = await readFile("src/components/AdminView.tsx", "utf8");
  assert.match(adminView, /request\.status === "pending"[\s\S]*Approve[\s\S]*Deny/);
  assert.match(adminView, /request\.status === "approved"[\s\S]*Deactivate[\s\S]*Activate/);
  assert.match(adminView, /item\.userId === request\.userId \? \{ \.\.\.item, status: decision \} : item/);
});
