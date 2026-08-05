import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyModelError,
  friendlyModelErrorMessage,
  runWithTransientModelRetries,
} from "../server/model.js";

function providerError(status: number, providerStatus: string, message = "temporary") {
  return { status, error: { code: status, status: providerStatus, message } };
}

test("first-attempt success performs one operation without sleeping", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await runWithTransientModelRetries(async () => { calls += 1; return "ok"; }, { sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result, "ok");
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test("retryable HTTP and provider capacity conditions retry", async () => {
  for (const error of [
    providerError(503, "UNAVAILABLE"), providerError(429, "RESOURCE_EXHAUSTED"),
    providerError(502, "INTERNAL"), providerError(504, "DEADLINE_EXCEEDED"),
    new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."),
  ]) {
    let calls = 0;
    const value = await runWithTransientModelRetries(async () => {
      calls += 1;
      if (calls === 1) throw error;
      return "ok";
    }, { sleep: async () => {}, random: () => 0 });
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  }
});

test("temporary network failures retry", async () => {
  for (const message of ["ETIMEDOUT", "ECONNRESET", "fetch failed", "socket hang up", "UND_ERR_CONNECT_TIMEOUT"]) {
    let calls = 0;
    await runWithTransientModelRetries(async () => {
      calls += 1;
      if (calls === 1) throw new Error(message);
      return true;
    }, { sleep: async () => {} });
    assert.equal(calls, 2);
    assert.equal(classifyModelError(new Error(message)).kind, "transient_network");
  }
});

test("four total attempts succeed on the fourth and stop after the fourth failure", async () => {
  let successCalls = 0;
  const result = await runWithTransientModelRetries(async () => {
    successCalls += 1;
    if (successCalls < 4) throw providerError(503, "UNAVAILABLE");
    return "done";
  }, { sleep: async () => {} });
  assert.equal(result, "done");
  assert.equal(successCalls, 4);

  let failedCalls = 0;
  await assert.rejects(runWithTransientModelRetries(async () => {
    failedCalls += 1;
    throw providerError(503, "UNAVAILABLE");
  }, { sleep: async () => {} }));
  assert.equal(failedCalls, 4);
});

test("backoff increases and deterministic jitter is applied without real waits", async () => {
  const sleeps: number[] = [];
  await assert.rejects(runWithTransientModelRetries(async () => { throw new Error("high demand"); }, {
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5,
  }));
  assert.deepEqual(sleeps, [1750, 3750, 7250]);
});

test("Retry-After seconds and dates are respected and excessive values are clamped", () => {
  assert.equal(classifyModelError({ status: 503, response: { headers: { "Retry-After": "2" } } }).retryAfterMs, 2_000);
  assert.equal(classifyModelError({ status: 503, response: { headers: { "retry-after": "999" } } }).retryAfterMs, 15_000);
  const future = new Date(Date.now() + 5_000).toUTCString();
  const dated = classifyModelError({ status: 503, response: { headers: { "Retry-After": future } } }).retryAfterMs || 0;
  assert.ok(dated >= 3_000 && dated <= 5_000);
});

test("authentication, invalid requests, blocks, and programming errors are not retried", async () => {
  const errors = [
    new Error("invalid API key"), new Error("GEMINI_API_KEY environment variable is required"),
    providerError(400, "INVALID_ARGUMENT"), providerError(403, "PERMISSION_DENIED"),
    new Error("content-policy safety block"), new Error("No text provided for embedding generation"),
  ];
  for (const error of errors) {
    let calls = 0;
    await assert.rejects(runWithTransientModelRetries(async () => { calls += 1; throw error; }, { sleep: async () => {} }));
    assert.equal(calls, 1);
    assert.equal(classifyModelError(error).retryable, false);
  }
});

test("final user messages are friendly and conceal configuration/provider details", () => {
  assert.equal(friendlyModelErrorMessage(new Error("high demand")), "The Assistant is temporarily busy and could not complete this request. Please try again in a moment.");
  assert.equal(friendlyModelErrorMessage(new Error("ETIMEDOUT")), "The Assistant could not connect to the AI service. Please try again.");
  const auth = friendlyModelErrorMessage(new Error("GEMINI_API_KEY environment variable is required"));
  assert.equal(auth, "The Assistant is not configured correctly. Please contact the administrator.");
  assert.doesNotMatch(auth, /GEMINI_API_KEY|RESOURCE_EXHAUSTED|503/);
});

test("retry logging is concise and cannot include prompt content", async () => {
  const source = await readFile("server/model.ts", "utf8");
  const logging = source.slice(source.indexOf("onRetry: (details)"), source.indexOf("});", source.indexOf("onRetry: (details)")));
  assert.match(logging, /taskType.*modelName|modelName.*taskType/);
  assert.match(logging, /retryNumber|delayMs|kind|statusCode/);
  assert.doesNotMatch(logging, /messages|contents|prompt|response/);
});
