import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits");
const jsonDir = path.join(outDir, "api-only-snapshots");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directLoginDefault = "rosomaha-rus999";
const campaigns = ["708505950", "708506873", "705770573", "710087376"];
const counters = [
  { name: "catalog", id: "107139619", hardGoalId: "517600157", site: "xn--80aa8ahaki9a.site" },
  { name: "quiz", id: "105918356", hardGoalId: "496461698", site: "rosomaha.site" },
];

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = line.slice(eq + 1).trim();
  }
  return env;
}

function curl(args, options = {}) {
  try {
    return { ok: true, stdout: execFileSync("curl.exe", args, { encoding: "utf8", timeout: options.timeout || 45000 }).trim() };
  } catch (error) {
    return {
      ok: false,
      status: typeof error.status === "number" ? error.status : 1,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || "").trim(),
    };
  }
}

function jsonCurl(args, options = {}) {
  const result = curl(args, options);
  if (!result.ok) return { ok: false, error: `curl exit ${result.status}`, raw: result.stdout || result.stderr };
  try {
    return { ok: true, data: result.stdout ? JSON.parse(result.stdout) : null };
  } catch (error) {
    return { ok: false, error: error.message, raw: result.stdout.slice(0, 1000) };
  }
}

function isoDate(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function rangeForDays(days) {
  return { days, date1: isoDate(days - 1), date2: isoDate(0) };
}

function money(value) {
  return Number(String(value || "0").replace(",", "."));
}

function numberValue(value) {
  return Number(String(value || "0").replace(",", "."));
}

function hostFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "--") return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseTsv(tsv) {
  const lines = tsv.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function directJsonRequest(env, service, method, params) {
  const token = env.YANDEX_OAUTH_TOKEN;
  const login = env.YANDEX_DIRECT_LOGIN || directLoginDefault;
  if (!token) return { ok: false, error: "missing YANDEX_OAUTH_TOKEN" };
  const body = JSON.stringify({ method, params });
  const result = jsonCurl([
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
    `https://api.direct.yandex.com/json/v501/${service}`,
  ]);
  if (!result.ok) return result;
  if (result.data?.error) return { ok: false, error: result.data.error };
  return { ok: true, data: result.data.result };
}

function directReport(env, reportType, fields, date1, date2, extraFilter = [], options = {}) {
  const token = env.YANDEX_OAUTH_TOKEN;
  const login = env.YANDEX_DIRECT_LOGIN || directLoginDefault;
  if (!token) return { ok: false, error: "missing YANDEX_OAUTH_TOKEN" };
  const dateRangeType = options.dateRangeType || "CUSTOM_DATE";
  const selectedCampaigns = Object.hasOwn(options, "campaigns") ? options.campaigns : campaigns;
  const filters = [];
  if (selectedCampaigns?.length) {
    filters.push({ Field: "CampaignId", Operator: "IN", Values: selectedCampaigns });
  }
  filters.push(...extraFilter);
  const selectionCriteria = {};
  if (dateRangeType === "CUSTOM_DATE") {
    selectionCriteria.DateFrom = date1;
    selectionCriteria.DateTo = date2;
  }
  if (filters.length) selectionCriteria.Filter = filters;
  const body = JSON.stringify({
    params: {
      SelectionCriteria: selectionCriteria,
      FieldNames: fields,
      ReportName: `codex_rosomaha_${reportType}_${Date.now()}`,
      ReportType: reportType,
      DateRangeType: dateRangeType,
      Format: "TSV",
      IncludeVAT: "NO",
      IncludeDiscount: "NO",
    },
  });

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = curl([
      "-s",
      "-L",
      "-X",
      "POST",
      "-D",
      "-",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      `Client-Login: ${login}`,
      "-H",
      "Accept-Language: ru",
      "-H",
      "Content-Type: application/json; charset=utf-8",
      "-H",
      "processingMode: auto",
      "-H",
      "returnMoneyInMicros: false",
      "-H",
      "skipReportHeader: true",
      "-H",
      "skipReportSummary: true",
      "--data-binary",
      body,
      "https://api.direct.yandex.com/json/v501/reports",
    ], { timeout: 60000 });

    if (!result.ok) return { ok: false, error: `curl exit ${result.status}`, raw: result.stdout || result.stderr };
    const separator = result.stdout.indexOf("\r\n\r\n");
    const text = separator >= 0 ? result.stdout.slice(separator + 4).trim() : result.stdout.trim();
    if (text.startsWith("CampaignId") || text.startsWith("Query\t") || text.includes("\t")) {
      return { ok: true, tsv: text, rows: parseTsv(text) };
    }
    if (!/201|202/.test(result.stdout.slice(0, 200))) return { ok: false, error: "Direct report failed", raw: text.slice(0, 1000) };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }

  return { ok: false, error: "Direct report was not ready after retries" };
}

function metrikaRequest(env, params) {
  const token = env.YANDEX_METRIKA_TOKEN || env.YANDEX_OAUTH_TOKEN || env.YANDEX_WEBMASTER_TOKEN;
  if (!token) return { ok: false, error: "missing Yandex token for Metrika" };
  const url = new URL("https://api-metrika.yandex.net/stat/v1/data");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const result = jsonCurl(["-s", "-L", "-H", `Authorization: OAuth ${token}`, url.toString()]);
  if (!result.ok) return result;
  if (result.data?.errors) return { ok: false, error: result.data.errors };
  return { ok: true, data: result.data };
}

function webmasterRequest(env, endpoint) {
  const token = env.YANDEX_WEBMASTER_TOKEN;
  const userId = env.YANDEX_WEBMASTER_USER_ID;
  const hostId = env.YANDEX_WEBMASTER_HOST_ID;
  if (!token || !userId || !hostId) return { ok: false, error: "missing Webmaster env" };
  const url = `https://api.webmaster.yandex.net/v4/user/${userId}/hosts/${hostId}${endpoint}`;
  const result = jsonCurl(["-s", "-L", "-H", `Authorization: OAuth ${token}`, url]);
  if (!result.ok) return result;
  if (result.data?.error_code) return { ok: false, error: result.data };
  return { ok: true, data: result.data };
}

function gscStatus(env) {
  const missing = ["GSC_CLIENT_ID", "GSC_REFRESH_TOKEN", "GSC_SITE_URL"].filter((key) => !env[key]);
  if (missing.length) return { ok: false, missing, reason: "missing_project_gsc_oauth_config" };
  return { ok: true, note: "GSC config present; use npm run seo:gsc for detailed Search Console report" };
}

function aggregateCampaignRows(rows, includeWatchedDefaults = true) {
  const totals = new Map();
  for (const row of rows) {
    const id = row.CampaignId || "unknown";
    const current = totals.get(id) || {
      campaignId: id,
      campaignName: row.CampaignName || "",
      campaignType: row.CampaignType || "",
      campaignUrlPath: row.CampaignUrlPath || "",
      campaignHost: hostFromUrl(row.CampaignUrlPath),
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
    };
    current.impressions += numberValue(row.Impressions);
    current.clicks += numberValue(row.Clicks);
    current.cost += money(row.Cost);
    current.conversions += numberValue(row.Conversions);
    totals.set(id, current);
  }
  if (includeWatchedDefaults) {
    for (const id of campaigns) {
      if (!totals.has(id)) {
        totals.set(id, {
          campaignId: id,
          campaignName: "",
          campaignType: "",
          campaignUrlPath: "",
          campaignHost: null,
          impressions: 0,
          clicks: 0,
          cost: 0,
          conversions: 0,
        });
      }
    }
  }
  return [...totals.values()].sort((a, b) => {
    const aIndex = campaigns.indexOf(a.campaignId);
    const bIndex = campaigns.indexOf(b.campaignId);
    if (aIndex >= 0 || bIndex >= 0) return (aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER) - (bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER);
    return Number(a.campaignId) - Number(b.campaignId);
  });
}

function summarizeMetrikaRows(data) {
  const rows = data?.data || [];
  return rows.map((row) => ({
    dims: (row.dimensions || []).map((dimension) => dimension.name),
    visits: numberValue(row.metrics?.[0]),
    hardGoals: numberValue(row.metrics?.[1]),
  }));
}

function buildMarkdown(report) {
  const lines = [
    `# Росомаха API-only аудит ${report.generatedAt.slice(0, 10)}`,
    "",
    `Источник: только API и локальные сценарии. Браузер и UI не использовались.`,
    `Логин Direct: \`${report.policy.directLogin}\``,
    "",
    "## Что проверено",
    "",
    "- Яндекс Директ: управляемые ЕПК через `campaigns.get v501`; все исторически показывавшиеся кампании и их посадочные через Reports API `CampaignUrlPath`.",
    "- Метрика: счетчики 107139619 каталог / 105918356 квиз, hard goals 517600157 (crm_conversion после ответа CRM) / 496461698 за 1, 7, 30 дней. Старую DOM-цель формы 517599639 считать мягкой.",
    "- rosomaha-rus.ru: отдельный объект; публично установлен счетчик 50606578, но API-доступ и hard goal этим запуском не переносятся с других доменов.",
    "- Yandex Webmaster: host xn--80aa8ahaki9a.site, summary, diagnostics, sitemaps, popular queries.",
    "- Google Search Console: только наличие проектного API-конфига, без браузера и OAuth UI.",
    "",
    "## Свежие цифры Direct",
    "",
  ];

  if (report.direct.campaignsSnapshot.ok) {
    const visible = report.direct.campaignsSnapshot.data.Campaigns || [];
    const byId = new Map(visible.map((campaign) => [String(campaign.Id), campaign]));
    lines.push("### campaigns.get");
    for (const id of campaigns) {
      const campaign = byId.get(id);
      if (campaign) {
        lines.push(`- ${id}: State=${campaign.State || "n/a"}, Status=${campaign.Status || "n/a"}`);
      } else {
        lines.push(`- ${id}: не возвращён ` + "`campaigns.get`" + `; для кампаний Мастера использовать только Reports API и не менять их через неподтверждённый метод`);
      }
    }
    lines.push("");
  } else {
    lines.push(`- Ошибка campaigns.get: ${report.direct.campaignsSnapshot.error}`);
    lines.push("");
  }

  for (const range of report.direct.ranges) {
    lines.push(`### ${range.days}д: ${range.date1}..${range.date2}`);
    if (!range.ok) {
      lines.push(`- Ошибка: ${range.error}`);
      continue;
    }
    for (const row of range.totals) {
      lines.push(`- ${row.campaignId}: ${row.cost.toFixed(2)} ₽ / ${row.clicks} кликов / ${row.impressions} показов / конверсии Direct ${row.conversions} (не считать заявками)`);
    }
    lines.push("");
  }

  lines.push("## Посадочные кампаний Direct за всё время");
  lines.push("");
  if (report.direct.accountLandingMap.ok) {
    for (const row of report.direct.accountLandingMap.campaigns) {
      lines.push(`- ${row.campaignId} — ${row.campaignName || "без названия"}: ${row.campaignUrlPath || "URL недоступен"} (${row.campaignType || "тип недоступен"})`);
    }
    lines.push(`- rosomaha-rus.ru: ${report.direct.accountLandingMap.matchesRosomahaRus.length ? "найдена кампания" : "кампания со статистикой не обнаружена"}. Черновик Мастера без показов публичный Reports API не доказывает.`);
  } else {
    lines.push(`- Источник недоступен: ${report.direct.accountLandingMap.error}`);
  }
  lines.push("");

  lines.push("## Метрика: hard goals");
  lines.push("");
  for (const counter of report.metrika.counters) {
    lines.push(`### ${counter.name} ${counter.id}, цель ${counter.hardGoalId}`);
    for (const range of counter.ranges) {
      if (!range.ok) {
        lines.push(`- ${range.days}д: ошибка ${range.error}`);
      } else {
        lines.push(`- ${range.days}д ${range.date1}..${range.date2}: ${range.visits} визитов yandex/cpc, hard goals ${range.hardGoals}`);
      }
    }
    lines.push("");
  }

  const w = report.webmaster;
  lines.push("## SEO / Webmaster");
  if (w.summary.ok) {
    lines.push(`- Searchable pages: ${w.summary.data.searchable_pages_count ?? "n/a"}`);
    lines.push(`- SQI: ${w.summary.data.sqi ?? "n/a"}`);
  } else {
    lines.push(`- Summary error: ${w.summary.error}`);
  }
  if (w.diagnostics.ok) {
    const present = Object.entries(w.diagnostics.data.problems || {}).filter(([, value]) => value.state === "PRESENT");
    lines.push(`- Active diagnostics: ${present.length ? present.map(([code]) => code).join(", ") : "нет"}`);
  }
  if (w.sitemaps.ok) {
    const sitemaps = w.sitemaps.data.sitemaps || [];
    lines.push(`- Sitemaps: ${sitemaps.length}, errors total ${sitemaps.reduce((sum, item) => sum + Number(item.errors_count || 0), 0)}`);
  }
  if (w.queries.ok) {
    lines.push(`- Popular queries rows: ${(w.queries.data.queries || []).length}`);
  }

  lines.push("", "## GSC API");
  if (report.gsc.ok) {
    lines.push("- Конфиг присутствует; подробный отчет можно снимать через `npm run seo:gsc`.");
  } else {
    lines.push(`- Нельзя подтверждать Google clicks/impressions/positions: ${report.gsc.reason}; missing=${(report.gsc.missing || []).join(", ")}`);
  }

  lines.push(
    "",
    "## Спор ролей",
    "",
    "- Директолог: каталоговая 708505950 не должна запускаться без заявки; квиз 705770573 можно анализировать как намеренно работающий, но чистить мусорные запросы нужно до масштабирования.",
    "- Аналитик Метрики/CRM: заявкой считаются только 517600157 для каталога и 496461698 для квиза; DOM-цель формы 517599639, Direct conversions, телефоны, открытия квиза и мессенджеры отдельно.",
    "- SEO/Webmaster-аудитор: основной SEO-актив только xn--80aa8ahaki9a.site; rosomaha.site остается рекламной квиз-воронкой.",
    "- Маркетолог-стратег: главный следующий шаг не бюджет, а связка spend -> hard goal -> CRM unique lead.",
    "- Критик рисков: GSC нельзя объявлять рабочим, пока нет project-specific refresh token; это конфиг-пробел, а не рыночный ноль.",
    "",
    "## Один вывод",
    "",
    `Готовность рекламы получать подтвержденные заявки: ${report.readinessScore}/10. Следующий безопасный шаг: подтвердить CRM-уникальность квизовых hard goals и подготовить минус-слова/исключения по мусорным запросам без запуска остановленных кампаний.`,
    "",
  );

  return `${lines.join("\n")}\n`;
}

const env = parseEnvFile(envPath);
const policy = {
  apiOnly: true,
  browserAllowed: false,
  directLogin: env.YANDEX_DIRECT_LOGIN || directLoginDefault,
  catalog: "https://xn--80aa8ahaki9a.site/",
  quiz: "https://rosomaha.site/",
  bitrix: "https://rosomaha-rus.ru/",
};

const campaignsSnapshot = directJsonRequest(env, "campaigns", "get", {
  SelectionCriteria: { Ids: campaigns.map(Number) },
  FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate"],
  TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
  UnifiedCampaignFieldNames: ["CounterIds"],
});

const directRanges = [1, 7, 30].map((days) => {
  const range = rangeForDays(days);
  const result = directReport(env, "CAMPAIGN_PERFORMANCE_REPORT", ["CampaignId", "CampaignName", "CampaignType", "CampaignUrlPath", "Impressions", "Clicks", "Cost", "Conversions"], range.date1, range.date2);
  return {
    ...range,
    ok: result.ok,
    error: result.error || null,
    totals: result.ok ? aggregateCampaignRows(result.rows) : [],
    rows: result.ok ? result.rows : [],
  };
});

const queryRange = rangeForDays(7);
const queries = directReport(env, "SEARCH_QUERY_PERFORMANCE_REPORT", ["CampaignId", "CampaignName", "Query", "Impressions", "Clicks", "Cost", "Conversions"], queryRange.date1, queryRange.date2);
const accountLandingResult = directReport(
  env,
  "CAMPAIGN_PERFORMANCE_REPORT",
  ["CampaignId", "CampaignName", "CampaignType", "CampaignUrlPath", "Impressions", "Clicks", "Cost", "Conversions"],
  null,
  null,
  [],
  { dateRangeType: "ALL_TIME", campaigns: null },
);
const accountLandingCampaigns = accountLandingResult.ok ? aggregateCampaignRows(accountLandingResult.rows, false) : [];
const metrika = {
  counters: counters.map((counter) => ({
    ...counter,
    ranges: [1, 7, 30].map((days) => {
      const range = rangeForDays(days);
      const result = metrikaRequest(env, {
        ids: counter.id,
        date1: range.date1,
        date2: range.date2,
        metrics: `ym:s:visits,ym:s:goal${counter.hardGoalId}reaches`,
        dimensions: "ym:s:UTMSource,ym:s:UTMMedium,ym:s:UTMCampaign",
        filters: "ym:s:UTMSource=='yandex' AND ym:s:UTMMedium=='cpc'",
        accuracy: "full",
        limit: 100,
      });
      const rows = result.ok ? summarizeMetrikaRows(result.data) : [];
      return {
        ...range,
        ok: result.ok,
        error: result.error || null,
        visits: rows.reduce((sum, row) => sum + row.visits, 0),
        hardGoals: rows.reduce((sum, row) => sum + row.hardGoals, 0),
        rows,
      };
    }),
  })),
};

const webmaster = {
  summary: webmasterRequest(env, "/summary/"),
  diagnostics: webmasterRequest(env, "/diagnostics/"),
  sitemaps: webmasterRequest(env, "/sitemaps/"),
  queries: webmasterRequest(
    env,
    "/search-queries/popular/?order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&query_indicator=AVG_CLICK_POSITION&limit=500",
  ),
};

const report = {
  generatedAt: new Date().toISOString(),
  policy,
  direct: {
    campaignsSnapshot,
    ranges: directRanges,
    accountLandingMap: {
      ok: accountLandingResult.ok,
      error: accountLandingResult.error || null,
      campaigns: accountLandingCampaigns,
      matchesRosomahaRus: accountLandingCampaigns.filter((campaign) => ["rosomaha-rus.ru", "www.rosomaha-rus.ru"].includes(campaign.campaignHost)),
    },
    queries: {
      ok: queries.ok,
      error: queries.error || null,
      range: queryRange,
      rows: queries.ok
        ? queries.rows
            .map((row) => ({
              campaignId: row.CampaignId,
              query: row.Query,
              impressions: numberValue(row.Impressions),
              clicks: numberValue(row.Clicks),
              cost: money(row.Cost),
              conversions: numberValue(row.Conversions),
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 100)
        : [],
    },
  },
  metrika,
  webmaster,
  gsc: gscStatus(env),
  readinessScore: 4,
};

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(jsonDir, { recursive: true });
const jsonPath = path.join(jsonDir, `ROSOMAHA_API_ONLY_AUDIT_${stamp}.json`);
const mdPath = path.join(outDir, `ROSOMAHA_API_ONLY_MARKETING_AUDIT_${new Date().toISOString().slice(0, 10)}_API_FIXED.md`);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");

console.log(mdPath);
console.log(jsonPath);
