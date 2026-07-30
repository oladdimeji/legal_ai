import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migrationManifest } from "../server/migrations.js";

test("Firm role migration is additive, repeatable, and backfills existing onboarding meanings", async () => {
  const migrations = await readFile("server/migrations.ts", "utf8");
  const phase = migrations.slice(migrations.indexOf('name: "firm_admin_and_member_roles"'));
  assert.ok(
    migrationManifest.some(
      (migration) => migration.version === 21 && migration.name === "firm_admin_and_member_roles"
    )
  );
  assert.match(phase, /ADD COLUMN IF NOT EXISTS firm_role TEXT/);
  assert.match(phase, /workspace_type = 'independent' THEN 'admin'/);
  assert.match(phase, /workspace_type = 'firm' THEN 'member'/);
  assert.match(phase, /WHERE firm_role IS NULL/);
  assert.match(phase, /firm_role IN \('admin', 'member'\)/);
  assert.doesNotMatch(phase, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
});

test("onboarding assigns Firm roles from workspace choice and never accepts a role selection", async () => {
  const [database, server, onboarding] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("server.ts", "utf8"),
    readFile("src/components/OnboardingView.tsx", "utf8"),
  ]);
  const completion = database.slice(
    database.indexOf("public async completeOnboarding"),
    database.indexOf("public async deleteSession")
  );
  const route = server.slice(
    server.indexOf('app.post("/api/onboarding/complete"'),
    server.indexOf("const portalTokenHash")
  );
  assert.match(completion, /firm_role = \$9/);
  assert.match(completion, /input\.workspaceType === "independent" \? "admin" : "member"/);
  assert.doesNotMatch(route, /req\.body\.firmRole|req\.body\.firm_role/);
  assert.doesNotMatch(onboarding, /firmRole|firm_role|Admin\/Member|Firm role/);
});

test("authenticated Account shaping includes the stored Firm role", async () => {
  const [types, database] = await Promise.all([
    readFile("src/types.ts", "utf8"),
    readFile("server/db.ts", "utf8"),
  ]);
  assert.match(types, /export type FirmRole = "admin" \| "member"/);
  assert.match(types, /firm_role: FirmRole \| null/);
  const accountShape = database.slice(
    database.indexOf("function accountFromRow"),
    database.indexOf("// Lazy initialization")
  );
  assert.match(accountShape, /firm_role: \(row\.firm_role \|\| null\) as FirmRole \| null/);
});

test("Firm Admin guard and endpoints enforce authentication and Admin authorization", async () => {
  const server = await readFile("server.ts", "utf8");
  const settingsRoutes = server.slice(
    server.indexOf("const requireFirmAdmin"),
    server.indexOf("// Enhance/Improve Raw Prompt")
  );
  assert.match(settingsRoutes, /if \(!req\.auth\)[\s\S]*status\(401\)/);
  assert.match(settingsRoutes, /req\.auth\.user\.firm_role !== "admin"/);
  assert.match(settingsRoutes, /status\(403\).*Firm Admin access is required/s);
  assert.match(settingsRoutes, /app\.get\(\s*"\/api\/settings\/firm-admin",\s*requireFirmAdmin/s);
  assert.match(settingsRoutes, /app\.patch\(\s*"\/api\/settings\/firm",\s*requireFirmAdmin/s);
  assert.match(
    settingsRoutes,
    /app\.post\(\s*"\/api\/settings\/firm\/invitation-code",\s*requireFirmAdmin/s
  );
});

test("Firm administration database methods prove actor role and scope every Firm operation", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const settings = database.slice(
    database.indexOf("public async getFirmAdminSettings"),
    database.indexOf("public async getCases")
  );
  assert.match(settings, /administrator\.id = \$1/);
  assert.match(settings, /administrator\.firm_id = f\.id/);
  assert.match(settings, /administrator\.firm_role = 'admin'/);
  assert.match(settings, /WHERE f\.id = \$2/);
  assert.match(settings, /FROM users\s+WHERE firm_id = \$1/);
  assert.doesNotMatch(settings, /firmId:|req\.body\.firm|SELECT \*/);
});

test("Firm name update validates input and updates the current Account state", async () => {
  const [server, settings, app] = await Promise.all([
    readFile("server.ts", "utf8"),
    readFile("src/components/SettingsView.tsx", "utf8"),
    readFile("src/App.tsx", "utf8"),
  ]);
  const route = server.slice(
    server.indexOf('"/api/settings/firm",'),
    server.indexOf('"/api/settings/firm/invitation-code",')
  );
  assert.match(route, /req\.body\.name[\s\S]*\.trim\(\)/);
  assert.match(route, /if \(!name\).*status\(400\)/s);
  assert.match(route, /name\.length > 120/);
  assert.match(settings, /method: "PATCH"/);
  assert.match(settings, /setFirmName\(previousName\)/);
  assert.match(settings, /onAccountUpdated\(\{[\s\S]*firm: .*name: firm\.name/s);
  assert.match(app, /account=\{account\}[\s\S]*onAccountUpdated=\{setAccount\}/);
});

test("invitation-code management uses crypto, collision retry, normalization, and confirmation", async () => {
  const [database, settings] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("src/components/SettingsView.tsx", "utf8"),
  ]);
  const generation = database.slice(
    database.indexOf("public async regenerateFirmInvitationCode"),
    database.indexOf("public async getCases")
  );
  assert.match(generation, /randomBytes\(8\)\.toString\("hex"\)\.toUpperCase\(\)/);
  assert.match(generation, /for \(let attempt = 0; attempt < 5/);
  assert.match(generation, /\.code !== "23505"/);
  assert.doesNotMatch(generation, /Math\.random/);
  assert.match(settings, /navigator\.clipboard\.writeText\(invitationCode\)/);
  assert.match(settings, /Regenerating the invitation code will prevent new users from joining with the previous code\. Continue\?/);
  assert.match(settings, /invitationCode\s*\?\s*"Regenerate code"\s*:\s*"Generate code"/);
});

test("Firm member response is read-only, ordered, scoped, and excludes auth internals", async () => {
  const [database, settings] = await Promise.all([
    readFile("server/db.ts", "utf8"),
    readFile("src/components/SettingsView.tsx", "utf8"),
  ]);
  const administration = database.slice(
    database.indexOf("public async getFirmAdminSettings"),
    database.indexOf("public async updateFirmName")
  );
  assert.match(
    administration,
    /SELECT id, name, email, professional_role, custom_professional_role, firm_role/
  );
  assert.match(administration, /WHERE firm_id = \$1/);
  assert.match(administration, /CASE firm_role WHEN 'admin' THEN 0 ELSE 1 END/);
  assert.doesNotMatch(
    administration,
    /google_sub|password_hash|token|otp|session|email_verified_at/
  );
  assert.match(settings, /Name[\s\S]*Email[\s\S]*Professional role[\s\S]*Firm role/);
  assert.doesNotMatch(settings, /Promote|Demote|Remove user|Suspend|Transfer admin|Change role/);
});

test("Members see Firm details without issuing or rendering Admin requests and controls", async () => {
  const settings = await readFile("src/components/SettingsView.tsx", "utf8");
  assert.match(settings, /const isAdmin = account\.user\.firm_role === "admin"/);
  assert.match(settings, /if \(!isAdmin\) return/);
  assert.match(settings, /\{isAdmin && \(\s*<>/);
  assert.match(settings, /isAdmin \? \([\s\S]*<form onSubmit=\{saveFirmName\}/);
  assert.match(settings, /Workspace \/ Firm name/);
});

test("Firm Library remains shared by authenticated Firm and isolated from other Firms", async () => {
  const database = await readFile("server/db.ts", "utf8");
  const library = database.slice(
    database.indexOf("public async getDocuments"),
    database.indexOf("public async vectorSearch")
  );
  assert.match(
    library,
    /WHERE firm_id = \$1 AND case_id IS NULL AND is_generated_draft_duplicate = FALSE/
  );
  assert.match(library, /WHERE id = \$1 AND firm_id = \$2 AND case_id IS NULL/);
  assert.match(library, /this\.addDocumentInternal\([\s\S]*context\.firmId/s);
  assert.match(library, /DELETE FROM documents[\s\S]*firm_id = \$2 AND case_id IS NULL/);
  assert.doesNotMatch(library, /user_id|uploaded_by|owner_id/);
});

test("Firm Settings foundation does not add Matter ownership or assignment", async () => {
  const [migration, settings, server] = await Promise.all([
    readFile("server/migrations.ts", "utf8"),
    readFile("src/components/SettingsView.tsx", "utf8"),
    readFile("server.ts", "utf8"),
  ]);
  const phase = migration.slice(migration.indexOf('name: "firm_admin_and_member_roles"'));
  const settingsRoutes = server.slice(
    server.indexOf("const requireFirmAdmin"),
    server.indexOf("// Enhance/Improve Raw Prompt")
  );
  assert.doesNotMatch(phase, /ALTER TABLE cases|owner_id|assigned_user_id/);
  assert.doesNotMatch(settingsRoutes, /\/api\/cases|assignment|owner_id|assigned_user_id/);
  assert.doesNotMatch(settings, /Matter assignment|Assign Matter|Coming soon|assigned_user_id/);
});
