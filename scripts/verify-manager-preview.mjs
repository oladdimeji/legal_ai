import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, executable, args) {
  console.log(`\n[manager-preview] ${label}`);
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

run("TypeScript/lint", command, ["run", "lint"]);
run("Behavioral tests, migration safety, authorization matrix, and log redaction", command, ["test"]);
run("Production build", command, ["run", "build"]);
run("Production-serving nested-route smoke", command, ["run", "smoke:production-routes"]);
run("Browser runtime availability", "npx", ["playwright", "install", "chromium"]);
run("Complete mocked browser journey", command, ["run", "test:browser"]);
run("Compose web-only topology", command, ["run", "verify:compose-web"]);

if (process.env.GOOGLE_DRIVE_LIVE_SMOKE === "true") {
  console.log("[manager-preview] Google staging smoke ran as part of the behavioral suite.");
} else {
  console.log("[manager-preview] SKIPPED: live Google staging smoke (GOOGLE_DRIVE_LIVE_SMOKE is not true).");
}
if (process.env.BREVO_LIVE_SMOKE === "true") {
  console.log("[manager-preview] Brevo staging smoke ran as part of the behavioral suite.");
} else {
  console.log("[manager-preview] SKIPPED: real Brevo staging smoke (BREVO_LIVE_SMOKE is not true).");
}
console.log("\n[manager-preview] Verification passed.");
