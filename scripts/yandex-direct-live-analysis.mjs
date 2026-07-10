import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || 708505950);
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");
const tmpDir = path.join(rootDir, ".codex_tmp");
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      env[key] = line.slice(separatorIndex + 1).trim();
    }
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

function preflightDirectApi() {
  try {
    execFileSync(
      "curl.exe",
      ["-s", "-I", "-L", "--connect-timeout", "5", "https://api.direct.yandex.com/json/v5/campaigns"],
      { stdio: "ignore" },
    );
  } catch (curlError) {
    const exitCode = curlError && typeof curlError === "object" && "status" in curlError ? curlError.status : "unknown";
    throw new Error(`Direct API network preflight failed (curl exit ${exitCode})`);
  }
}

async function directRequest(service, method, params, token) {
  const response = await fetch(`https://api.direct.yandex.com/json/v5/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "ru",
      "Client-Login": login,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${service}.${method} HTTP ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  if (json.error) throw new Error(json.error.error_detail || json.error.error_string || JSON.stringify(json.error));
  return json.result;
}

async function directReport({ reportName, reportType, fieldNames, dateFrom, dateTo, token }) {
  const body = {
    params: {
      SelectionCriteria: {
        DateFrom: dateFrom,
        DateTo: dateTo,
        Filter: [{ Field: "CampaignId", Operator: "IN", Values: [String(campaignId)] }],
      },
      FieldNames: fieldNames,
      ReportName: reportName,
      ReportType: reportType,
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "NO",
      IncludeDiscount: "NO",
    },
  };

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const response = await fetch("https://api.direct.yandex.com/json/v5/reports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Language": "ru",
        "Client-Login": login,
        "Content-Type": "application/json; charset=utf-8",
        processingMode: "auto",
        returnMoneyInMicros: "false",
        skipReportHeader: "true",
        skipReportSummary: "true",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (response.status === 200) return text;
    if (response.status === 201 || response.status === 202) {
      const retryInSeconds = Number(response.headers.get("retryIn") || 2);
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryInSeconds) * 1000));
      continue;
    }
    throw new Error(`${reportType} HTTP ${response.status}: ${text.slice(0, 1000)}`);
  }

  throw new Error(`${reportType} was not ready after retries`);
}

function parseTsv(tsv) {
  const rows = tsv.trim().split(/\r?\n/).filter(Boolean);
  if (!rows.length) return [];
  const headers = rows[0].split("\t");
  return rows.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function money(value) {
  return Number(String(value || "0").replace(",", "."));
}

function numeric(value) {
  return Number(String(value || "0").replace(",", "."));
}

function summarize({ campaign, adGroups, ads, keywords, criteriaRows, queryRows }) {
  const groupById = new Map(adGroups.map((group) => [String(group.Id), group]));
  const keywordById = new Map(keywords.map((keyword) => [String(keyword.Id), keyword]));
  const activeAds = ads.filter((ad) => ad.State === "ON" && ad.Status === "ACCEPTED");
  const activeKeywords = keywords.filter((keyword) => keyword.State === "ON" && keyword.Status === "ACCEPTED");
  const activeNonAuto = activeKeywords.filter((keyword) => keyword.Keyword !== "---autotargeting");
  const activeAuto = activeKeywords.filter((keyword) => keyword.Keyword === "---autotargeting");
  const broadAuto = activeAuto.filter((keyword) => {
    const items = keyword.AutotargetingCategories?.Items || [];
    return items.some((item) => item.Category !== "EXACT" && item.Value === "YES");
  });

  const costlyZeroConversionCriteria = criteriaRows
    .map((row) => {
      const keyword = keywordById.get(String(row.CriteriaId));
      return {
        ...row,
        CostNumber: money(row.Cost),
        ClicksNumber: numeric(row.Clicks),
        ConversionsNumber: numeric(row.Conversions),
        CurrentState: keyword?.State || "UNKNOWN",
        CurrentStatus: keyword?.Status || "UNKNOWN",
      };
    })
    .filter((row) => row.CostNumber >= 250 && row.ClicksNumber >= 10 && row.ConversionsNumber === 0)
    .sort((left, right) => right.CostNumber - left.CostNumber);

  const costlyActiveZeroConversionCriteria = costlyZeroConversionCriteria
    .filter((row) => row.CurrentState === "ON" && row.CurrentStatus === "ACCEPTED");

  const costlyQueries = queryRows
    .map((row) => ({
      ...row,
      CostNumber: money(row.Cost),
      ClicksNumber: numeric(row.Clicks),
      ConversionsNumber: numeric(row.Conversions),
    }))
    .filter((row) => row.CostNumber >= 150 || row.ClicksNumber >= 5)
    .sort((left, right) => right.CostNumber - left.CostNumber);

  return {
    campaign: {
      id: campaign.Id,
      name: campaign.Name,
      status: campaign.Status,
      state: campaign.State,
      searchStrategy: campaign.TextCampaign?.BiddingStrategy?.Search?.BiddingStrategyType || null,
      weeklySpendLimitRub: (campaign.TextCampaign?.BiddingStrategy?.Search?.WbMaximumClicks?.WeeklySpendLimit || 0) / 1_000_000,
      bidCeilingRub: (campaign.TextCampaign?.BiddingStrategy?.Search?.WbMaximumClicks?.BidCeiling || 0) / 1_000_000,
      networkStrategy: campaign.TextCampaign?.BiddingStrategy?.Network?.BiddingStrategyType || null,
    },
    counts: {
      groups: adGroups.length,
      activeAds: activeAds.length,
      activeKeywords: activeKeywords.length,
      activeNonAuto: activeNonAuto.length,
      activeAuto: activeAuto.length,
      broadAuto: broadAuto.length,
    },
    groups: adGroups.map((group) => ({
      id: group.Id,
      name: group.Name,
      servingStatus: group.ServingStatus,
      negativeKeywords: group.NegativeKeywords?.Items || [],
      activeAds: activeAds.filter((ad) => ad.AdGroupId === group.Id).length,
      activeKeywords: activeNonAuto.filter((keyword) => keyword.AdGroupId === group.Id).length,
      activeAutotargeting: activeAuto.filter((keyword) => keyword.AdGroupId === group.Id).length,
    })),
    costlyZeroConversionCriteria,
    costlyActiveZeroConversionCriteria,
    costlyQueries,
    notes: [
      costlyActiveZeroConversionCriteria.length
        ? "There are still active criteria with material historical spend and zero conversions."
        : "Material historical zero-conversion criteria are already inactive or not visible as active keywords.",
      broadAuto.length
        ? "Broad autotargeting is active and should be restricted."
        : "Broad autotargeting is not active; only exact/autobrand variants remain where present.",
    ],
  };
}

function mdTable(rows, columns) {
  if (!rows.length) return "_Нет строк._";
  const header = `| ${columns.map((column) => column.title).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(column.value(row)).replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function buildMarkdown({ summary, snapshotPath, criteriaPath, queryPath, dateFrom, dateTo }) {
  const criteriaColumns = [
    { title: "Группа", value: (row) => row.AdGroupName },
    { title: "Критерий", value: (row) => row.Criteria },
    { title: "Текущее состояние", value: (row) => row.CurrentState },
    { title: "Клики", value: (row) => row.Clicks },
    { title: "Расход", value: (row) => `${row.Cost} ₽` },
    { title: "Конверсии", value: (row) => row.Conversions },
  ];
  const queryColumns = [
    { title: "Запрос", value: (row) => row.Query || row.SearchQuery || "" },
    { title: "Группа", value: (row) => row.AdGroupName || "" },
    { title: "Клики", value: (row) => row.Clicks },
    { title: "Расход", value: (row) => `${row.Cost} ₽` },
    { title: "Конверсии", value: (row) => row.Conversions },
  ];

  return `# Rosomaha Direct live analysis — ${new Date().toISOString()}

Аккаунт: \`${login}\`
Кампания: \`${campaignId}\`
Период отчетов: \`${dateFrom}\` - \`${dateTo}\`

## Файлы

- Snapshot: \`${path.relative(rootDir, snapshotPath)}\`
- Criteria report: \`${path.relative(rootDir, criteriaPath)}\`
- Search query report: \`${path.relative(rootDir, queryPath)}\`

## Текущая рамка безопасности

- State: \`${summary.campaign.state}\`
- Status: \`${summary.campaign.status}\`
- Search strategy: \`${summary.campaign.searchStrategy}\`
- Weekly limit: \`${summary.campaign.weeklySpendLimitRub} ₽\`
- Bid ceiling: \`${summary.campaign.bidCeilingRub} ₽\`
- Network / RSYA: \`${summary.campaign.networkStrategy}\`

## Структура

- Groups: \`${summary.counts.groups}\`
- Active ads: \`${summary.counts.activeAds}\`
- Active keywords total: \`${summary.counts.activeKeywords}\`
- Active non-autotargeting keywords: \`${summary.counts.activeNonAuto}\`
- Active autotargeting objects: \`${summary.counts.activeAuto}\`
- Broad autotargeting objects: \`${summary.counts.broadAuto}\`

## Группы

${mdTable(summary.groups, [
    { title: "Группа", value: (row) => row.name },
    { title: "Активные объявления", value: (row) => row.activeAds },
    { title: "Активные ключи", value: (row) => row.activeKeywords },
    { title: "Авто", value: (row) => row.activeAutotargeting },
    { title: "Минус-слова", value: (row) => row.negativeKeywords.join(", ") },
  ])}

## Исторически дорогие критерии без конверсий

${mdTable(summary.costlyZeroConversionCriteria, criteriaColumns)}

## Из них все еще активны

${mdTable(summary.costlyActiveZeroConversionCriteria, criteriaColumns)}

## Дорогие/кликабельные поисковые запросы

${mdTable(summary.costlyQueries.slice(0, 30), queryColumns)}

## Вывод

${summary.notes.map((note) => `- ${note}`).join("\n")}
`;
}

preflightDirectApi();
const token = readToken();
const now = new Date();
const dateTo = now.toISOString().slice(0, 10);
const dateFromDate = new Date(now);
dateFromDate.setUTCDate(dateFromDate.getUTCDate() - 29);
const dateFrom = dateFromDate.toISOString().slice(0, 10);
const stamp = now.toISOString().replace(/[:.]/g, "-");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const [campaigns, adGroups, ads, keywords] = await Promise.all([
  directRequest("campaigns", "get", {
    SelectionCriteria: { Ids: [campaignId] },
    FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate"],
    TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
  }, token),
  directRequest("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type", "NegativeKeywords"],
    Page: { Limit: 10000 },
  }, token),
  directRequest("ads", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State", "Type"],
    TextAdFieldNames: ["Title", "Title2", "Text", "Href", "Mobile", "DisplayUrlPath"],
    Page: { Limit: 10000 },
  }, token),
  directRequest("keywords", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: [
      "Id",
      "Keyword",
      "AdGroupId",
      "CampaignId",
      "State",
      "Status",
      "ServingStatus",
      "StatisticsSearch",
      "StatisticsNetwork",
      "AutotargetingCategories",
      "AutotargetingBrandOptions",
    ],
    Page: { Limit: 10000 },
  }, token),
]);

const criteriaTsv = await directReport({
  reportName: `codex_criteria_${campaignId}_${stamp}`,
  reportType: "CRITERIA_PERFORMANCE_REPORT",
  fieldNames: ["CampaignId", "CampaignName", "AdGroupId", "AdGroupName", "CriteriaId", "Criteria", "Impressions", "Clicks", "Cost", "Conversions"],
  dateFrom,
  dateTo,
  token,
});

let queryTsv = "";
try {
  queryTsv = await directReport({
    reportName: `codex_queries_${campaignId}_${stamp}`,
    reportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
    fieldNames: ["CampaignId", "CampaignName", "AdGroupId", "AdGroupName", "Query", "Criteria", "Impressions", "Clicks", "Cost", "Conversions"],
    dateFrom,
    dateTo,
    token,
  });
} catch (error) {
  queryTsv = `error\n${String(error.message).replace(/\r?\n/g, " ")}\n`;
}

const snapshotPath = path.join(outDir, `YANDEX_DIRECT_LIVE_SNAPSHOT_${campaignId}_${stamp}.json`);
const criteriaPath = path.join(outDir, `YANDEX_DIRECT_CRITERIA_REPORT_${campaignId}_${stamp}.tsv`);
const queryPath = path.join(outDir, `YANDEX_DIRECT_QUERY_REPORT_${campaignId}_${stamp}.tsv`);
fs.writeFileSync(snapshotPath, `${JSON.stringify({ generatedAt: now.toISOString(), login, campaignId, campaigns, adGroups, ads, keywords }, null, 2)}\n`, "utf8");
fs.writeFileSync(criteriaPath, criteriaTsv, "utf8");
fs.writeFileSync(queryPath, queryTsv, "utf8");

const summary = summarize({
  campaign: campaigns.Campaigns[0],
  adGroups: adGroups.AdGroups,
  ads: ads.Ads,
  keywords: keywords.Keywords,
  criteriaRows: parseTsv(criteriaTsv),
  queryRows: queryTsv.startsWith("error\n") ? [] : parseTsv(queryTsv),
});

const summaryPath = path.join(outDir, `YANDEX_DIRECT_LIVE_ANALYSIS_${campaignId}_${stamp}.json`);
const markdownPath = path.join(outDir, `YANDEX_DIRECT_LIVE_ANALYSIS_${campaignId}_${stamp}.md`);
fs.writeFileSync(summaryPath, `${JSON.stringify({ generatedAt: now.toISOString(), login, campaignId, dateFrom, dateTo, summary }, null, 2)}\n`, "utf8");
fs.writeFileSync(markdownPath, buildMarkdown({ summary, snapshotPath, criteriaPath, queryPath, dateFrom, dateTo }), "utf8");

process.stdout.write(`${markdownPath}\n${summaryPath}\n`);
