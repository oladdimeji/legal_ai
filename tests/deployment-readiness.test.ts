import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Exepts branding is text-only in the authentication and lawyer shell brand areas", async () => {
  const [auth, shell, assistant, html, metadata] = await Promise.all([
    readFile("src/components/AuthView.tsx", "utf8"),
    readFile("src/components/LawyerWorkspaceShell.tsx", "utf8"),
    readFile("src/components/AssistantView.tsx", "utf8"),
    readFile("index.html", "utf8"),
    readFile("metadata.json", "utf8"),
  ]);

  for (const source of [auth, shell]) {
    assert.match(source, /Exepts/);
    assert.doesNotMatch(source, /\bScale\b|<Scale/);
  }
  assert.match(shell, /Exepts assistant panel/);
  assert.match(shell, /account\.firm\?\.name/);
  assert.match(assistant, /Failed to contact Exepts model service/);
  assert.match(html, /<title>Exepts<\/title>/);
  assert.equal(JSON.parse(metadata).name, "Exepts");
});

test("production scripts and runtime metadata are pinned without changing internal persistence identifiers", async () => {
  const [packageText, launcher, auth, migrations] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("scripts/start-production.mjs", "utf8"),
    readFile("server/auth.ts", "utf8"),
    readFile("server/migrations.ts", "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.name, "exepts");
  assert.equal(packageJson.engines.node, "22.x");
  assert.match(packageJson.packageManager, /^npm@10\./);
  assert.equal(packageJson.scripts.start, "node scripts/start-production.mjs");
  assert.equal(packageJson.scripts.verify, "npm run lint && npm test && npm run build");
  assert.match(launcher, /process\.env\.NODE_ENV = "production"/);
  assert.match(auth, /SESSION_COOKIE_NAME = "legal_ai_session"/);
  assert.match(migrations, /lockKey = "legal_ai_schema_migrations"/);
});

test("Docker deployment is production-only and checks the existing health route", async () => {
  const [dockerfile, compose, dockerignore] = await Promise.all([
    readFile("Dockerfile", "utf8"),
    readFile("compose.yaml", "utf8"),
    readFile(".dockerignore", "utf8"),
  ]);

  assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /COPY shared \.\/shared/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /COPY --from=build --chown=node:node \/app\/node_modules \.\/node_modules/);
  assert.match(dockerfile, /USER node/);
  assert.match(compose, /env_file:\s*\n\s*- \.env/);
  assert.match(compose, /NODE_ENV: production/);
  assert.match(compose, /\/api\/health/);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^tests$/m);
});
