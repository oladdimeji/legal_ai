import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function compose(args) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "docker compose failed").trim());
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

const webOnly = compose(["config", "--services"]);
assert.deepEqual(webOnly, ["web"], "default Compose topology must contain only web");

const ingestion = compose(["--profile", "ingestion", "config", "--services"]);
assert.deepEqual(
  [...ingestion].sort(),
  ["clamav", "web", "worker"],
  "ingestion profile must retain web, worker, and ClamAV",
);
console.log("Compose web-only validation passed: default=web; ingestion profile=web,worker,clamav.");
