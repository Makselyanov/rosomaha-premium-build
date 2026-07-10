import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || 708505950);
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "direct-relaunch-scope");
const decoder = new TextDecoder("utf-8");
const wastePatterns = [
  "техноволк",
  "медведь",
  "тайфун",
  "трэкол",
  "трекол",
  "шерп",
  "снегокат",
  "квадроцикл",
  "ремонт",
  "запчаст",
  "б/у",
  "бу ",
  "своими руками",
  "чертеж",
  "ваканси",
  "работа",
];

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

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
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

async function directReport(token, reportType, fieldNames, dateFrom, dateTo) {
  const body = {
    params: {
      SelectionCriteria: {
        DateFrom: dateFrom,
        DateTo: dateTo,
        Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(campaignId)] }],
      },
      FieldNames: fieldNames,
      ReportName: `rosomaha-relaunch-scope-${reportType}-${Date.now()}`,
      ReportType: reportType,
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
    throw new Error(`${reportType} HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  throw new Error(`${reportType} was not ready after retries`);
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

function includesWaste(text) {
  const normalized = String(text || "").toLowerCase().replace(/ё/g, "е");
  return wastePatterns.filter((pattern) => normalized.includes(pattern));
}

function numberValue(value) {
  return Number(String(value || "0").replace(",", "."));
}

function classifyKeyword(row) {
  const keyword = row.Keyword;
  const text = String(keyword || "").toLowerCase().replace(/ё/g, "е");
  const waste = includesWaste(text);
  const broadSignals = [];
  if (!text.includes("купить") && !text.includes("цена") && !text.includes("производитель") && !text.includes("росомаха")) {
    broadSignals.push("no purchase/price/brand/manufacturer intent");
  }
  if (text.includes(" или ")) broadSignals.push("comparison intent");
  if (text.includes("аналог")) broadSignals.push("competitor/analog intent");
  return {
    id: row.Id,
    adGroupId: row.AdGroupId,
    campaignId: row.CampaignId,
    keyword,
    state: row.State,
    status: row.Status,
    servingStatus: row.ServingStatus,
    waste,
    broadSignals,
    risky: waste.length > 0 || broadSignals.length > 0,
  };
}

const token = readToken();
const dateFrom = daysAgo(30);
const dateTo = daysAgo(1);
const errors = [];

const [campaigns, adGroups, ads, keywords] = await Promise.all([
  directRequest("campaigns", "get", {
    SelectionCriteria: { Ids: [campaignId] },
    FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate"],
    TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
  }, token).catch((error) => {
    errors.push({ source: "campaigns.get", message: error.message });
    return null;
  }),
  directRequest("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type", "NegativeKeywords"],
    Page: { Limit: 10000 },
  }, token).catch((error) => {
    errors.push({ source: "adgroups.get", message: error.message });
    return null;
  }),
  directRequest("ads", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "AdGroupId", "Status", "State", "StatusClarification", "Type", "Subtype"],
    TextAdFieldNames: ["Title", "Title2", "Text", "Href", "DisplayUrlPath"],
    Page: { Limit: 10000 },
  }, token).catch((error) => {
    errors.push({ source: "ads.get", message: error.message });
    return null;
  }),
  directRequest("keywords", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "AdGroupId", "CampaignId", "Keyword", "State", "Status", "ServingStatus"],
    Page: { Limit: 10000 },
  }, token).catch((error) => {
    errors.push({ source: "keywords.get", message: error.message });
    return null;
  }),
]);

let searchQueries = [];
try {
  searchQueries = await directReport(token, "SEARCH_QUERY_PERFORMANCE_REPORT", [
    "CampaignId",
    "AdGroupId",
    "Query",
    "Criterion",
    "Impressions",
    "Clicks",
    "Cost",
    "Conversions",
  ], dateFrom, dateTo);
} catch (error) {
  errors.push({ source: "SEARCH_QUERY_PERFORMANCE_REPORT", message: error.message });
}

const campaign = campaigns?.Campaigns?.[0] || null;
const keywordRows = keywords?.Keywords || [];
const adGroupRows = adGroups?.AdGroups || [];
const adRows = ads?.Ads || [];
const riskyKeywords = keywordRows.map((row) => classifyKeyword(row)).filter((row) => row.risky);
const riskyQueries = searchQueries
  .map((row) => ({ ...row, waste: includesWaste(row.Query), cost: numberValue(row.Cost), clicks: numberValue(row.Clicks) }))
  .filter((row) => row.waste.length || row.clicks > 0 || row.cost > 0)
  .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks)
  .slice(0, 100);
const suggestedNegativeKeywords = [...new Set(
  riskyQueries
    .filter((row) => row.waste.length && (row.clicks > 0 || row.cost > 0))
    .flatMap((row) => row.waste)
)].sort((a, b) => a.localeCompare(b, "ru"));
const candidateKeywordsToReview = riskyKeywords.map((row) => ({
  id: row.id,
  adGroupId: row.adGroupId,
  keyword: row.keyword,
  reasons: [...row.waste.map((item) => `waste:${item}`), ...row.broadSignals],
}));

const blockers = [];
if (!campaign) blockers.push(`campaign ${campaignId} was not returned by campaigns.get`);
if (campaign && campaign.State !== "SUSPENDED") blockers.push(`campaign state is ${campaign.State}, expected SUSPENDED before relaunch planning`);
if (riskyKeywords.length > 0) blockers.push(`${riskyKeywords.length} keyword(s) need human cleanup review before relaunch`);
if (riskyQueries.some((row) => row.waste.length && (row.clicks > 0 || row.cost > 0))) {
  blockers.push("paid search query history contains waste/competitor patterns with spend or clicks");
}

const result = {
  generatedAt: new Date().toISOString(),
  mode: "read-only",
  login,
  campaignId,
  dateRange: { dateFrom, dateTo },
  relaunchScopeClean: blockers.length === 0,
  blockers,
  errors,
  summary: {
    campaign: campaign ? {
      id: campaign.Id,
      name: campaign.Name,
      status: campaign.Status,
      state: campaign.State,
      type: campaign.Type,
      searchStrategy: campaign.TextCampaign?.BiddingStrategy?.Search?.BiddingStrategyType || null,
      networkStrategy: campaign.TextCampaign?.BiddingStrategy?.Network?.BiddingStrategyType || null,
    } : null,
    adGroups: adGroupRows.length,
    ads: adRows.length,
    keywords: keywordRows.length,
    riskyKeywords: riskyKeywords.length,
    searchQueries: searchQueries.length,
    riskyQueries: riskyQueries.length,
    suggestedNegativeKeywords: suggestedNegativeKeywords.length,
  },
  cleanupPlan: {
    applyAutomatically: false,
    reason: "Direct mutations require explicit owner approval; this audit only prepares a cleanup plan.",
    suggestedNegativeKeywords,
    candidateKeywordsToReview,
  },
  riskyKeywords,
  riskyQueries,
  raw: {
    campaigns,
    adGroups,
    ads,
    keywords,
    searchQueries,
  },
};

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = path.join(outDir, `ROSOMAHA_DIRECT_RELAUNCH_SCOPE_${stamp}.json`);
const mdPath = path.join(outDir, `ROSOMAHA_DIRECT_RELAUNCH_SCOPE_${stamp}.md`);
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const md = [
  `# Rosomaha Direct relaunch scope audit - ${new Date().toISOString().slice(0, 10)}`,
  "",
  `Mode: ${result.mode}`,
  `Login: ${login}`,
  `Campaign: ${campaignId}`,
  `Date range for search queries: ${dateFrom}..${dateTo}`,
  "",
  "## Summary",
  "",
  `- Relaunch scope clean: ${result.relaunchScopeClean ? "yes" : "no"}`,
  `- Campaign state: ${result.summary.campaign?.state || "missing"}`,
  `- Ad groups: ${result.summary.adGroups}`,
  `- Ads: ${result.summary.ads}`,
  `- Keywords: ${result.summary.keywords}`,
  `- Risky keywords: ${result.summary.riskyKeywords}`,
  `- Search query rows: ${result.summary.searchQueries}`,
  `- Risky query rows: ${result.summary.riskyQueries}`,
  `- Suggested negative keywords: ${result.summary.suggestedNegativeKeywords}`,
  "",
  "## Blockers",
  "",
  ...(blockers.length ? blockers.map((item) => `- ${item}`) : ["- None"]),
  "",
  "## Top risky keywords",
  "",
  ...(riskyKeywords.slice(0, 30).map((row) => `- id=${row.id} adGroup=${row.adGroupId} | ${row.keyword} | waste=${row.waste.join(",") || "-"} | broad=${row.broadSignals.join(",") || "-"}`)),
  ...(riskyKeywords.length ? [] : ["- None"]),
  "",
  "## Suggested campaign negative keywords",
  "",
  ...(suggestedNegativeKeywords.length ? suggestedNegativeKeywords.map((word) => `- ${word}`) : ["- None"]),
  "",
  "## Top risky/search-query rows",
  "",
  ...(riskyQueries.slice(0, 30).map((row) => `- ${row.Query || "(empty)"} | criterion=${row.Criterion || "-"} | clicks=${row.Clicks || 0} | cost=${row.Cost || 0} | waste=${row.waste.join(",") || "-"}`)),
  ...(riskyQueries.length ? [] : ["- None"]),
  "",
  "## Errors",
  "",
  ...(errors.length ? errors.map((entry) => `- ${entry.source}: ${entry.message}`) : ["- None"]),
  "",
].join("\n");
fs.writeFileSync(mdPath, `${md}\n`, "utf8");

console.log(JSON.stringify({
  jsonPath,
  mdPath,
  relaunchScopeClean: result.relaunchScopeClean,
  blockers: result.blockers,
  summary: result.summary,
}, null, 2));

if (!result.relaunchScopeClean) process.exitCode = 2;
