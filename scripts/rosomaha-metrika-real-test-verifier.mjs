import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const counterId = process.env.ROSOMAHA_METRIKA_COUNTER_ID || process.env.YANDEX_METRIKA_COUNTER_ID || "107139619";
const hardGoalId = process.env.ROSOMAHA_METRIKA_HARD_GOAL_ID || "517600157";
const leadChainDir = path.join(rootDir, "marketing-audits", "lead-chain");
const outDir = path.join(rootDir, "marketing-audits", "metrika-verification");
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function readToken() {
  if (process.env.YANDEX_METRIKA_TOKEN) return process.env.YANDEX_METRIKA_TOKEN.trim();
  if (process.env.YANDEX_OAUTH_TOKEN) return process.env.YANDEX_OAUTH_TOKEN.trim();
  const tokenEnv = parseEnvFile(tokenEnvPath);
  if (tokenEnv.YANDEX_METRIKA_TOKEN) return tokenEnv.YANDEX_METRIKA_TOKEN;
  if (tokenEnv.YANDEX_OAUTH_TOKEN) return tokenEnv.YANDEX_OAUTH_TOKEN;
  const seoEnv = parseEnvFile(seoEnvPath);
  if (seoEnv.YANDEX_METRIKA_TOKEN) return seoEnv.YANDEX_METRIKA_TOKEN;
  if (seoEnv.YANDEX_OAUTH_TOKEN) return seoEnv.YANDEX_OAUTH_TOKEN;
  if (seoEnv.YANDEX_WEBMASTER_TOKEN) return seoEnv.YANDEX_WEBMASTER_TOKEN;
  throw new Error(`Missing Yandex OAuth token in env, ${tokenEnvPath}, or ${seoEnvPath}`);
}

function latestRealLeadArtifact() {
  if (!fs.existsSync(leadChainDir)) return null;
  const files = fs.readdirSync(leadChainDir)
    .filter((name) => name.startsWith("ROSOMAHA_LEAD_CHAIN_REAL_") && name.endsWith(".json"))
    .map((name) => path.join(leadChainDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  const file = files[0];
  return { file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
}

function dateFromArtifact(file) {
  const match = path.basename(file).match(/REAL_(\d{4})-(\d{2})-(\d{2})T/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10);
}

async function metrikaGet(endpoint, params, token) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${token}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Metrika API HTTP ${response.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

async function fetchGoalMetadata(token) {
  return metrikaGet(
    `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}/goals`,
    {},
    token,
  );
}

async function fetchByUtmCampaign(token, date, utmCampaign) {
  return metrikaGet("https://api-metrika.yandex.net/stat/v1/data", {
    ids: counterId,
    date1: date,
    date2: date,
    metrics: `ym:s:visits,ym:s:goal${hardGoalId}reaches`,
    dimensions: "ym:s:lastsignUTMCampaign",
    filters: `ym:s:lastsignUTMCampaign=='${String(utmCampaign).replaceAll("'", "\\'")}'`,
    accuracy: "full",
    limit: 100,
  }, token);
}

async function fetchByStartUrl(token, date, leadSubmissionId) {
  return metrikaGet("https://api-metrika.yandex.net/stat/v1/data", {
    ids: counterId,
    date1: date,
    date2: date,
    metrics: `ym:s:visits,ym:s:goal${hardGoalId}reaches`,
    dimensions: "ym:s:startURL",
    filters: `ym:s:startURL=*'${String(leadSubmissionId).replaceAll("'", "\\'")}'`,
    accuracy: "full",
    limit: 100,
  }, token);
}

function metricTotal(report, index) {
  if (!report?.data?.length) return 0;
  return report.data.reduce((sum, row) => sum + Number(row.metrics?.[index] || 0), 0);
}

function writeArtifact(result) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `ROSOMAHA_METRIKA_REAL_TEST_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return file;
}

const real = latestRealLeadArtifact();
if (!real) {
  const result = {
    ok: false,
    status: "blocked",
    reason: "No REAL lead-chain artifact exists. Do not verify Metrika until an approved real CRM POST test is completed.",
    requiredCommandAfterApproval: "node scripts/dry-run-lead-chain.mjs --real",
  };
  result.artifact = writeArtifact(result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(2);
}

const lead = real.data;
const utmCampaign = lead.payload?.utm_campaign;
const leadSubmissionId = lead.lead_submission_id;
const date = dateFromArtifact(real.file);
const blockers = [];

if (!lead.ok || lead.mode !== "real") blockers.push("latest lead-chain artifact is not a successful real-mode artifact");
if (!leadSubmissionId) blockers.push("real lead artifact has no lead_submission_id");
if (!utmCampaign) blockers.push("real lead artifact has no utm_campaign");
if (!lead.crm_response_id) blockers.push("real lead artifact has no CRM response id");

const token = readToken();
const goalMetadata = await fetchGoalMetadata(token);
const hardGoal = goalMetadata.goals?.find((goal) => String(goal.id) === String(hardGoalId));
if (!hardGoal) blockers.push(`Metrika goal ${hardGoalId} was not found on counter ${counterId}`);

let byUtmCampaign = null;
let byStartUrl = null;
if (!blockers.length) {
  byUtmCampaign = await fetchByUtmCampaign(token, date, utmCampaign);
  byStartUrl = await fetchByStartUrl(token, date, leadSubmissionId);
  const hardGoalReachesByCampaign = metricTotal(byUtmCampaign, 1);
  const hardGoalReachesByStartUrl = metricTotal(byStartUrl, 1);
  if (hardGoalReachesByCampaign < 1 && hardGoalReachesByStartUrl < 1) {
    blockers.push(`Metrika hard goal ${hardGoalId} not found for real test campaign ${utmCampaign} on ${date}`);
  }
}

const result = {
  ok: blockers.length === 0,
  status: blockers.length === 0 ? "confirmed" : "blocked",
  generatedAt: new Date().toISOString(),
  counterId,
  hardGoalId,
  sourceLeadArtifact: real.file,
  date,
  lead_submission_id: leadSubmissionId || null,
  utm_campaign: utmCampaign || null,
  crm_response_id: lead.crm_response_id || null,
  blockers,
  goal: hardGoal ? { id: hardGoal.id, name: hardGoal.name, type: hardGoal.type } : null,
  totals: {
    visitsByUtmCampaign: metricTotal(byUtmCampaign, 0),
    hardGoalReachesByUtmCampaign: metricTotal(byUtmCampaign, 1),
    visitsByStartUrl: metricTotal(byStartUrl, 0),
    hardGoalReachesByStartUrl: metricTotal(byStartUrl, 1),
  },
  raw: {
    byUtmCampaign,
    byStartUrl,
  },
};

result.artifact = writeArtifact(result);
console.log(JSON.stringify({
  artifact: result.artifact,
  ok: result.ok,
  status: result.status,
  blockers: result.blockers,
  totals: result.totals,
}, null, 2));
if (!result.ok) process.exitCode = 2;
