import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import test from "node:test";
import express from "express";
import { matchRoutes } from "react-router-dom";
import { registerProductionFrontend } from "../server/frontend.js";
import { APP_ROUTES } from "../src/lib/appRoutes.js";

const routeTree = [
  { path: "/", children: [{ index: true }, { path: "login" }, { path: "signup" }] },
  { path: "/app", children: [{ index: true }, { path: "assistant" }, { path: "matters" }, { path: "matters/:matterId" }, { path: "library" }, { path: "history" }, { path: "settings" }] },
  { path: "/client", children: [{ path: "login" }, { path: "dashboard" }, { path: "invitations/:token" }, { path: "verify/:token" }, { path: "reset-password/:token" }, { path: ":token" }] },
];

test("public, lawyer, client-account, invitation, and legacy portal paths match distinct routes", () => {
  for (const pathname of Object.values(APP_ROUTES).map((route) => route.replace(":matterId", "matter-1").replace(":token", "invite-1"))) {
    assert.ok(matchRoutes(routeTree, pathname), `${pathname} should match`);
  }
  assert.equal(matchRoutes(routeTree, "/client/invitations/invite-1")?.at(-1)?.route.path, "invitations/:token");
  assert.equal(matchRoutes(routeTree, "/client/legacy-token")?.at(-1)?.route.path, ":token");
});

test("production frontend serves index.html for nested route refreshes", async () => {
  const distPath = await mkdtemp(path.join(os.tmpdir(), "exepts-routing-"));
  const marker = "<!doctype html><title>Exepts route fallback</title>";
  await writeFile(path.join(distPath, "index.html"), marker, "utf8");
  const app = express();
  registerProductionFrontend(app, distPath);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    for (const route of ["/app/matters/matter-1", "/client/invitations/invite-1", "/client/verify/verify-1", "/client/reset-password/reset-1", "/client/dashboard", "/client/legacy-token"]) {
      const body = await new Promise<string>((resolve, reject) => {
        http.get({ hostname: "127.0.0.1", port: address.port, path: route }, (response) => {
          let value = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => { value += chunk; });
          response.on("end", () => response.statusCode === 200 ? resolve(value) : reject(new Error(`HTTP ${response.statusCode}`)));
        }).on("error", reject);
      });
      assert.equal(body, marker);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("shared shells expose landmarks, named navigation, and keyboard skip links", async () => {
  const [{ default: PublicLayout }, { default: ClientLayout }, { renderToStaticMarkup }, router] = await Promise.all([
    import("../src/components/layouts/PublicLayout.js"),
    import("../src/components/layouts/ClientLayout.js"),
    import("react-dom/server"),
    import("react-router-dom"),
  ]);
  for (const Layout of [PublicLayout, ClientLayout]) {
    const tree = createElement(router.MemoryRouter, {}, createElement(router.Routes, {}, createElement(router.Route, { element: createElement(Layout) }, createElement(router.Route, { index: true, element: createElement("h1", {}, "Content") }))));
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Skip to content/);
    assert.match(html, /<header/);
    assert.match(html, /<main/);
  }
});
