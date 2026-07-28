import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import express from "express";
import { registerProductionFrontend } from "../server/frontend.js";

await access("dist/index.html");
const app = express();
registerProductionFrontend(app, path.resolve("dist"));
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  for (const pathname of [
    "/",
    "/app/matters/matter_smoke",
    "/client/login",
    "/client/dashboard",
    "/client/invitations/invitation_smoke",
    "/client/legacy_smoke",
  ]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`);
    assert.equal(response.status, 200, `${pathname} did not serve the production application shell`);
    assert.match(await response.text(), /<div id="root">/);
  }
  console.log("Production-serving route smoke passed for public, lawyer, client-account, and legacy paths.");
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}
