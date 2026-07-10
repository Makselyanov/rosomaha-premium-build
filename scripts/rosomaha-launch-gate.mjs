import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignsToWatch = ["708505950", "705770573", "710087376"];
const catalogCampaignId = 708505950;
const outDir = path.join(rootDir, "marketing-audits", "launch-gate");
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const decoder = new TextDecoder("utf-8");

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
  if (process.env.YANDEX_OAUTH_TOKEN) return process.env.YANDEX_OAUTH_TOKEN.trim();
  const tokenEnv = parseEnvFile(tokenEnvPath);
  if (tokenEnv.YANDEX_OAUTH_TOKEN) return tokenEnv.YANDEX_OAUTH_TOKEN;
  const seoEnv = parseEnvFile(seoEnvPath);
  if (seoEnv.YANDEX_OAUTH_TOKEN) return seoEnv.YANDEX_OAUTH_TOKEN;
  if (seoEnv.YANDEX_WEBMASTER_TOKEN) return seoEnv.YANDEX_WEBMASTER_TOKEN;
  throw new Error(`Missing YANDEX_OAUTH_TOKEN in ${tokenEnvPath} or ${seoEnvPath}`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function directRequest(service, method, params, token) {
  const url = `https://api.direct.yandex.com/json/v5/${service}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Client-Login": login,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  const body = JSON.stringify({ method, params });

  try {
    const response = await fetch(url, { method: "POST", headers, body });
    const text = await response.text();
    if (!response.ok) throw new Error(`${service}.${method} HTTP ${response.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.error.error_detail || json.error.error_string || JSON.stringify(json.error));
    return json.result;
  } catch {
    const stdout = execFileSync(
      "curl.exe",
      [
        "-s",
        "-L",
        "-X",
        "POST",
        "-H",
        `Authorization: Bearer ${token}`,
        "-H",
        `Client-Login: ${login}`,
        "-H",
        "Accept-Language: ru",
        "-H",
        "Content-Type: application/json; charset=utf-8",
        "--data-binary",
        body,
        url,
      ],
      { encoding: "buffer" },
    );
    const json = JSON.parse(decoder.decode(stdout));
    if (json.error) throw new Error(json.error.error_detail || json.error.error_string || JSON.stringify(json.error));
    return json.result;
  }
}

async function directReportToday(token) {
  const date = today();
  const body = {
    params: {
      SelectionCriteria: {
        DateFrom: date,
        DateTo: date,
        Filter: [{ Field: "CampaignId", Operator: "IN", Values: campaignsToWatch }],
      },
      FieldNames: ["CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Conversions"],
      ReportName: `rosomaha-launch-gate-${Date.now()}`,
      ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "NO",
      IncludeDiscount: "NO",
    },
  };

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch("https://api.direct.yandex.com/json/v5/reports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Login": login,
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8",
        processingMode: "auto",
        returnMoneyInMicros: "false",
        skipReportHeader: "true",
        skipReportSummary: "true",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (response.status === 200) return parseTsv(text);
    if (response.status === 201 || response.status === 202) {
      const retryIn = Number(response.headers.get("retryIn") || 2);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryIn) * 1000));
      continue;
    }
    throw new Error(`Direct report HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  throw new Error("Direct report was not ready after retries");
}

function parseTsv(tsv) {
  const lines = tsv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function numberValue(value) {
  return Number(String(value || "0").replace(",", "."));
}

function latestScore() {
  const file = path.join(rootDir, "marketing-audits", `ROSOMAHA_READINESS_SCORE_${today()}.json`);
  if (!fs.existsSync(file)) return { score: 0, launchAllowed: false, missing: "Run node scripts/rosomaha-readiness-score.mjs" };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const token = readToken();
const [campaigns, todayRows] = await Promise.all([
  directRequest("campaigns", "get", {
    SelectionCriteria: { Ids: [catalogCampaignId] },
    FieldNames: ["Id", "Name", "Status", "State", "Type"],
    TextCampaignFieldNames: ["BiddingStrategy"],
  }, token),
  directReportToday(token),
]);

const score = latestScore();
const catalogCampaign = campaigns.Campaigns?.[0] || null;
const todayTotals = todayRows.reduce((acc, row) => {
  acc.impressions += numberValue(row.Impressions);
  acc.clicks += numberValue(row.Clicks);
  acc.cost += numberValue(row.Cost);
  acc.conversions += numberValue(row.Conversions);
  return acc;
}, { impressions: 0, clicks: 0, cost: 0, conversions: 0 });

const blockers = [];
if ((score.score || 0) < 9 || !score.launchAllowed) blockers.push(`readiness ${score.readiness || `${score.score || 0}/10`} is below 9/10`);
if (!catalogCampaign) blockers.push("catalog campaign 708505950 was not returned by campaigns.get");
if (catalogCampaign && catalogCampaign.State !== "SUSPENDED") blockers.push(`catalog campaign 708505950 state is ${catalogCampaign.State}, expected SUSPENDED`);
if (todayTotals.cost > 0 || todayTotals.clicks > 0) blockers.push(`watched campaigns have today's activity: ${todayTotals.clicks} clicks / ${todayTotals.cost} RUB`);

const result = {
  generatedAt: new Date().toISOString(),
  login,
  watchedCampaigns: campaignsToWatch,
  launchAllowed: blockers.length === 0,
  blockers,
  score: {
    readiness: score.readiness || `${score.score || 0}/10`,
    launchAllowed: Boolean(score.launchAllowed),
    nextGate: score.nextGate || score.missing || null,
  },
  direct: {
    catalogCampaign: catalogCampaign ? {
      id: catalogCampaign.Id,
      name: catalogCampaign.Name,
      status: catalogCampaign.Status,
      state: catalogCampaign.State,
      type: catalogCampaign.Type,
      searchStrategy: catalogCampaign.TextCampaign?.BiddingStrategy?.Search?.BiddingStrategyType || null,
      networkStrategy: catalogCampaign.TextCampaign?.BiddingStrategy?.Network?.BiddingStrategyType || null,
    } : null,
    todayTotals,
    todayRows,
  },
};

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `ROSOMAHA_LAUNCH_GATE_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ file, launchAllowed: result.launchAllowed, blockers: result.blockers, todayTotals }, null, 2));
if (!result.launchAllowed) process.exitCode = 2;
