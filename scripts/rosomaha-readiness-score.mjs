import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const leadChainDir = path.join(rootDir, "marketing-audits", "lead-chain");
const outDir = path.join(rootDir, "marketing-audits");

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function latestArtifact(kind) {
  if (!fs.existsSync(leadChainDir)) return null;
  const prefix = `ROSOMAHA_LEAD_CHAIN_${kind}_`;
  const files = fs.readdirSync(leadChainDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => path.join(leadChainDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(files[0], "utf8"));
}

function latestLaunchGate() {
  const launchGateDir = path.join(rootDir, "marketing-audits", "launch-gate");
  if (!fs.existsSync(launchGateDir)) return null;
  const files = fs.readdirSync(launchGateDir)
    .filter((name) => name.startsWith("ROSOMAHA_LAUNCH_GATE_") && name.endsWith(".json"))
    .map((name) => path.join(launchGateDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(files[0], "utf8"));
}

function latestMetrikaVerification() {
  const verificationDir = path.join(rootDir, "marketing-audits", "metrika-verification");
  if (!fs.existsSync(verificationDir)) return null;
  const files = fs.readdirSync(verificationDir)
    .filter((name) => name.startsWith("ROSOMAHA_METRIKA_REAL_TEST_") && name.endsWith(".json"))
    .map((name) => path.join(verificationDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(files[0], "utf8"));
}

function latestDirectRelaunchScope() {
  const scopeDir = path.join(rootDir, "marketing-audits", "direct-relaunch-scope");
  if (!fs.existsSync(scopeDir)) return null;
  const files = fs.readdirSync(scopeDir)
    .filter((name) => name.startsWith("ROSOMAHA_DIRECT_RELAUNCH_SCOPE_") && name.endsWith(".json"))
    .map((name) => path.join(scopeDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(files[0], "utf8"));
}

function ok(condition, label, evidence, missing) {
  return { ok: Boolean(condition), label, evidence: condition ? evidence : undefined, missing: condition ? undefined : missing };
}

const orderPage = read(path.join(rootDir, "src", "pages", "OrderPage.tsx"));
const metrika = read(path.join(rootDir, "src", "lib", "metrika.ts"));
const dryRunScript = read(path.join(rootDir, "scripts", "dry-run-lead-chain.mjs"));
const launchGateScript = read(path.join(rootDir, "scripts", "rosomaha-launch-gate.mjs"));
const dryRun = latestArtifact("DRY-RUN");
const realRun = latestArtifact("REAL");
const launchGate = latestLaunchGate();
const metrikaVerification = latestMetrikaVerification();
const directRelaunchScope = latestDirectRelaunchScope();

const gates = [
  ok(
    orderPage.includes("isValidRussianPhone") && orderPage.includes("phone_normalized"),
    "catalog form validates and normalizes phone",
    "OrderPage.tsx has isValidRussianPhone and phone_normalized",
    "Add contact validation before CRM POST",
  ),
  ok(
    orderPage.includes("lead_submission_id") && orderPage.includes("rosomaha_last_lead_receipt"),
    "catalog form emits lead id and receipt",
    "OrderPage.tsx has lead_submission_id and rosomaha_last_lead_receipt",
    "Add lead id and receipt to CRM success path",
  ),
  ok(
    metrika.includes('leadSubmit: "lead_submit"') && metrika.includes('crmConversion: "crm_conversion"'),
    "client keeps soft goal and namespaced hard-goal identifier",
    "metrika.ts defines lead_submit while reserving crm_conversion for confirmed CRM events",
    "Keep lead_submit in client layer and crm_conversion reserved for post-CRM confirmation",
  ),
  ok(
    dryRunScript.includes("Fetch.fulfillRequest") && dryRunScript.includes("ROSOMAHA_REAL_CRM_POST"),
    "runner has dry-run intercept and real-post safety lock",
    "dry-run-lead-chain.mjs intercepts CRM and blocks --real without unlock",
    "Add guarded test runner",
  ),
  ok(
    dryRun?.ok
      && dryRun?.mode === "dry-run"
      && dryRun?.reachedGoals?.includes("lead_submit")
      && !dryRun?.reachedGoals?.includes("crm_conversion"),
    "runtime dry-run proves site-side lead chain",
    dryRun ? `dry-run artifact ${dryRun.artifact || "latest"} reached lead_submit without synthetic crm_conversion` : undefined,
    "Run node scripts/dry-run-lead-chain.mjs",
  ),
  ok(
    launchGateScript.includes("directReportToday") && launchGate?.launchAllowed === false && launchGate?.direct?.todayTotals?.cost === 0,
    "launch gate fails closed while ads are not ready",
    launchGate ? `launch gate artifact blocks launch; today cost ${launchGate.direct?.todayTotals?.cost || 0} RUB` : undefined,
    "Run node scripts/rosomaha-launch-gate.mjs and keep launch blocked until score is 9/10",
  ),
  ok(
    realRun?.ok && realRun?.mode === "real" && realRun?.lead_submission_id && realRun?.crm_response_id,
    "real CRM test lead artifact exists",
    realRun ? `real artifact ${realRun.artifact || "latest"} has lead and CRM response id` : undefined,
    "Run one approved real CRM POST test and save artifact",
  ),
  ok(
    metrikaVerification?.ok && metrikaVerification?.hardGoalId === "517600157" && metrikaVerification?.totals?.hardGoalReachesByUtmCampaign >= 1,
    "Metrika API confirms hard goal for real test",
    metrikaVerification?.totals ? `Metrika verification artifact confirms ${metrikaVerification.totals.hardGoalReachesByUtmCampaign} hard goal reach(es)` : undefined,
    "Run scripts/rosomaha-metrika-real-test-verifier.mjs after approved real CRM POST test",
  ),
  ok(
    false,
    "CRM confirms unique lead with matching id/phone/UTM/yclid",
    undefined,
    "Read CRM/export/API after approved real test",
  ),
  ok(
    directRelaunchScope?.relaunchScopeClean && directRelaunchScope?.summary?.campaign?.state === "SUSPENDED",
    "Direct relaunch scope is cleaned and still paused",
    directRelaunchScope ? `Direct relaunch scope artifact is clean; campaign state ${directRelaunchScope.summary?.campaign?.state}` : undefined,
    directRelaunchScope?.blockers?.length
      ? `Fix Direct relaunch blockers: ${directRelaunchScope.blockers.join("; ")}`
      : "Run scripts/rosomaha-direct-relaunch-scope-audit.mjs and clean 708505950 before launch",
  ),
  ok(
    false,
    "limited paid micro-test launched and reconciled",
    undefined,
    "Only after all previous gates, run limited test and reconcile spend -> hard goal -> CRM",
  ),
];

const passed = gates.filter((gate) => gate.ok).length;
const score = Math.min(10, Math.max(2, passed));
const result = {
  generatedAt: new Date().toISOString(),
  score,
  maxScore: 10,
  readiness: `${score}/10`,
  launchAllowed: score >= 9,
  gates,
  nextGate: gates.find((gate) => !gate.ok)?.missing || null,
};

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const jsonPath = path.join(outDir, `ROSOMAHA_READINESS_SCORE_${stamp}.json`);
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ jsonPath, readiness: result.readiness, launchAllowed: result.launchAllowed, nextGate: result.nextGate }, null, 2));
