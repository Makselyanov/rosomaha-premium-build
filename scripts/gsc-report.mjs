import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, ".env.seo.local");
const REPORT_DIR = path.join(ROOT_DIR, "seo-reports");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API_BASE = "https://searchconsole.googleapis.com";
const TRANSPORT_TIMEOUT_MS = 30_000;

export const SITE_ALIASES = Object.freeze({
  catalog: "https://xn--80aa8ahaki9a.site/",
  bitrix: "sc-domain:rosomaha-rus.ru",
});

export const QUERY_PROBES = Object.freeze([
  "купить квадроцикл",
  "купить вездеход",
  "ремонт квадроциклов",
  "обслуживание квадроциклов",
]);

export function parseArgs(argv) {
  const args = {
    days: 28,
    envPath: DEFAULT_ENV_PATH,
    rowLimit: 1000,
    save: true,
    site: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--days must be a positive integer");
      }
      args.days = value;
      i += 1;
    } else if (arg === "--env") {
      if (!argv[i + 1]) throw new Error("--env requires a path");
      args.envPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--site") {
      if (!argv[i + 1]) throw new Error("--site requires catalog or bitrix");
      args.site = argv[i + 1];
      i += 1;
    } else if (arg === "--row-limit") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 1000) {
        throw new Error("--row-limit must be an integer from 1 to 1000");
      }
      args.rowLimit = value;
      i += 1;
    } else if (arg === "--no-save") {
      args.save = false;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/gsc-report.mjs
  node scripts/gsc-report.mjs --days 90 --site catalog
  node scripts/gsc-report.mjs --site bitrix --row-limit 1000
  node scripts/gsc-report.mjs --env .env.seo.local

Allowed properties:
  catalog = ${SITE_ALIASES.catalog}
  bitrix  = ${SITE_ALIASES.bitrix}

Required variables in .env.seo.local:
  GSC_CLIENT_ID
  GSC_REFRESH_TOKEN

Optional variables:
  GSC_CLIENT_SECRET
  GSC_SITE_URL (used only without --site and only when it exactly matches an allowed property)
`);
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadConfig(envPath) {
  const fileVars = fs.existsSync(envPath)
    ? parseEnv(fs.readFileSync(envPath, "utf8"))
    : {};
  const merged = { ...fileVars, ...process.env };

  return {
    envPath,
    clientId: merged.GSC_CLIENT_ID || "",
    clientSecret: merged.GSC_CLIENT_SECRET || "",
    refreshToken: merged.GSC_REFRESH_TOKEN || "",
    siteUrl: merged.GSC_SITE_URL || "",
  };
}

function getMissingConfigKeys(config) {
  const required = [
    ["GSC_CLIENT_ID", config.clientId],
    ["GSC_REFRESH_TOKEN", config.refreshToken],
  ];
  return required.filter(([, value]) => !value).map(([key]) => key);
}

export function resolveSiteSelection(requestedAlias, envSiteUrl = "") {
  if (requestedAlias !== null && requestedAlias !== undefined) {
    if (!Object.hasOwn(SITE_ALIASES, requestedAlias)) {
      throw new Error(
        `Unknown --site alias: ${requestedAlias}. Allowed: ${Object.keys(SITE_ALIASES).join(", ")}`,
      );
    }
    return { alias: requestedAlias, siteUrl: SITE_ALIASES[requestedAlias] };
  }

  if (envSiteUrl) {
    const match = Object.entries(SITE_ALIASES).find(([, siteUrl]) => siteUrl === envSiteUrl);
    if (!match) {
      throw new Error("GSC_SITE_URL is not an exact allowed property");
    }
    return { alias: match[0], siteUrl: match[1] };
  }

  return { alias: "catalog", siteUrl: SITE_ALIASES.catalog };
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateRange(days, now = new Date()) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function nativeHttpsTextRequest(url, requestOptions, timeoutMs = TRANSPORT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const rawBody = requestOptions.body;
    const body =
      rawBody === undefined || rawBody === null
        ? null
        : Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.from(String(rawBody), "utf8");
    const headers = { ...(requestOptions.headers || {}) };
    if (body && !Object.keys(headers).some((name) => name.toLowerCase() === "content-length")) {
      headers["Content-Length"] = String(body.byteLength);
    }

    const request = https.request(
      url,
      { method: requestOptions.method || "GET", headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const status = response.statusCode || 0;
          finish(resolve, {
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", (error) => finish(reject, error));
        response.on("aborted", () => finish(reject, new Error("HTTPS response aborted")));
      },
    );

    timeout = setTimeout(() => {
      request.destroy(new Error(`HTTPS request timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timeout.unref?.();
    request.on("error", (error) => finish(reject, error));
    if (body) request.write(body);
    request.end();
  });
}

async function requestTextWithFallback(
  url,
  requestOptions,
  {
    fetchImpl = globalThis.fetch,
    nativeRequest = nativeHttpsTextRequest,
    timeoutMs = TRANSPORT_TIMEOUT_MS,
  } = {},
) {
  try {
    const response = await fetchImpl(url, {
      ...requestOptions,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch {
    return nativeRequest(url, requestOptions, timeoutMs);
  }
}

function redactSecretValues(value, secrets) {
  let redacted = String(value);
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

export async function getAccessToken(config, transportOptions = {}) {
  const tokenParams = {
    client_id: config.clientId,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  };
  if (config.clientSecret) tokenParams.client_secret = config.clientSecret;

  let response;
  try {
    response = await requestTextWithFallback(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(tokenParams).toString(),
      },
      transportOptions,
    );
  } catch {
    throw new Error("OAuth token exchange failed: transport unavailable");
  }
  const payload = parseJsonText(response.text) || {};

  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || response.status;
    throw new Error(
      `OAuth token exchange failed: ${redactSecretValues(detail, [
        config.refreshToken,
        config.clientSecret,
      ])}`,
    );
  }

  return payload.access_token;
}

export async function gscRequest(token, method, pathName, body, transportOptions = {}) {
  const response = await requestTextWithFallback(
    `${GSC_API_BASE}${pathName}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    transportOptions,
  );

  const payload = parseJsonText(response.text);

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `GSC HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

function parseJsonText(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

export async function safeGscRequest(token, method, pathName, body, transportOptions = {}) {
  try {
    return {
      ok: true,
      data: await gscRequest(token, method, pathName, body, transportOptions),
    };
  } catch (error) {
    const message = redactSecretValues(error.message || "Unknown error", [token]);
    return {
      ok: false,
      error: {
        status: error.status || 0,
        message,
      },
    };
  }
}

function searchAnalytics(request, token, siteUrl, query) {
  return request(
    token,
    "POST",
    `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    query,
  );
}

export function requireSiteOwner(sitesResult, siteUrl) {
  if (!sitesResult.ok) {
    throw new Error(`sites.list failed; siteOwner cannot be verified: ${sitesResult.error.message}`);
  }

  const site = (sitesResult.data?.siteEntry || []).find((entry) => entry.siteUrl === siteUrl);
  if (!site) throw new Error(`Allowed property is absent from sites.list: ${siteUrl}`);
  if (site.permissionLevel !== "siteOwner") {
    throw new Error(
      `siteOwner permission required for ${siteUrl}; received ${site.permissionLevel || "none"}`,
    );
  }
  return { siteUrl: site.siteUrl, permissionLevel: site.permissionLevel };
}

function extractTotals(result) {
  if (!result.ok) return null;
  const row = result.data.rows?.[0];
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
  };
}

export function normalizeQueryProbe(query, result) {
  if (!result.ok) {
    return { query, status: "request_failed", rows: [], error: result.error };
  }
  const rows = result.data?.rows || [];
  return {
    query,
    status: rows.length ? "returned_by_api" : "not_returned_by_api",
    rows,
    error: null,
  };
}

function inspectionUrlFromSite(siteUrl) {
  if (siteUrl.startsWith("sc-domain:")) {
    return `https://${siteUrl.slice("sc-domain:".length)}/`;
  }
  return siteUrl;
}

function markdownTable(rows, columns) {
  if (!rows.length) return "- no data";
  const header = `| ${columns.map((c) => c.title).join(" | ")} |`;
  const sep = `| ${columns.map((c) => c.align || "---").join(" | ")} |`;
  const body = rows.map((row, index) => {
    const values = columns.map((column) =>
      String(column.value(row, index)).replace(/\|/g, "\\|"),
    );
    return `| ${values.join(" | ")} |`;
  });
  return [header, sep, ...body].join("\n");
}

function buildMarkdown(report) {
  const totals = extractTotals(report.totals);
  const lines = [
    `# Google Search Console report: ${report.siteUrl}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Property alias: ${report.property.alias}`,
    `Period: ${report.dateRange.startDate} - ${report.dateRange.endDate}`,
    `Row limit: ${report.requestSpec.rowLimit}`,
    "",
    "## Totals",
  ];

  if (totals) {
    lines.push(`- Clicks: ${totals.clicks}`);
    lines.push(`- Impressions: ${totals.impressions}`);
    lines.push(`- CTR: ${(totals.ctr * 100).toFixed(2)}%`);
    lines.push(`- Average position: ${totals.position.toFixed(2)}`);
  } else {
    lines.push(`- Request failed: ${report.totals.error.message}`);
  }

  const columns = [
    { title: "#", value: (_row, index) => index + 1 },
    { title: "Value", value: (row) => (row.keys || []).join(" + ") },
    { title: "Clicks", align: "---:", value: (row) => row.clicks || 0 },
    { title: "Impressions", align: "---:", value: (row) => row.impressions || 0 },
    { title: "CTR", align: "---:", value: (row) => `${((row.ctr || 0) * 100).toFixed(2)}%` },
    { title: "Position", align: "---:", value: (row) => (row.position || 0).toFixed(1) },
  ];

  for (const [heading, result] of [
    ["Top queries", report.byQuery],
    ["Top pages", report.byPage],
    ["Query + page", report.byQueryPage],
    ["Devices", report.byDevice],
  ]) {
    lines.push("", `## ${heading}`);
    lines.push(
      result.ok
        ? markdownTable(result.data.rows || [], columns)
        : `- Request failed: ${result.error.message}`,
    );
  }

  lines.push("", "## Exact query probes");
  for (const probe of report.queryProbes) {
    lines.push(`- ${probe.query}: ${probe.status}`);
    if (probe.status === "request_failed") lines.push(`  - Error: ${probe.error.message}`);
  }

  lines.push("", "## Sitemaps");
  if (report.sitemaps.ok) {
    const sitemaps = report.sitemaps.data.sitemap || [];
    if (sitemaps.length === 0) {
      lines.push("- No sitemaps registered");
    } else {
      for (const sitemap of sitemaps) {
        lines.push(
          `- ${sitemap.path}: errors=${sitemap.errors || 0}, warnings=${sitemap.warnings || 0}, lastSubmitted=${sitemap.lastSubmitted || "n/a"}`,
        );
      }
    }
  } else {
    lines.push(`- Request failed: ${report.sitemaps.error.message}`);
  }

  lines.push("", "## Homepage inspection");
  if (report.inspection.ok) {
    const index = report.inspection.data.inspectionResult?.indexStatusResult || {};
    lines.push(`- Verdict: ${index.verdict || "n/a"}`);
    lines.push(`- Coverage: ${index.coverageState || "n/a"}`);
    lines.push(`- Last crawl: ${index.lastCrawlTime || "n/a"}`);
    lines.push(`- Robots: ${index.robotsTxtState || "n/a"}`);
  } else {
    lines.push(`- Request failed: ${report.inspection.error.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function collectProviderErrors(results) {
  return Object.entries(results)
    .filter(([, result]) => result && result.ok === false)
    .map(([request, result]) => ({ request, ...result.error }));
}

export function getOutputPaths(reportDir, propertyAlias, generatedAt) {
  if (!Object.hasOwn(SITE_ALIASES, propertyAlias)) {
    throw new Error(`Cannot build output path for unknown property: ${propertyAlias}`);
  }
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const outputs = {
    latestJson: path.join(reportDir, `latest-gsc-report-${propertyAlias}.json`),
    latestMarkdown: path.join(reportDir, `latest-gsc-report-${propertyAlias}.md`),
    receiptJson: path.join(reportDir, `gsc-report-receipt-${propertyAlias}-${timestamp}.json`),
  };
  if (propertyAlias === "catalog") {
    outputs.legacyLatestJson = path.join(reportDir, "latest-gsc-report.json");
    outputs.legacyLatestMarkdown = path.join(reportDir, "latest-gsc-report.md");
  }
  return outputs;
}

function writeFileDurably(filePath, content, flag) {
  const handle = fs.openSync(filePath, flag, 0o600);
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

export function writeLatestAtomic(filePath, content) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileDurably(tempPath, content, "wx");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

export function saveReportArtifacts(reportDir, report, markdown) {
  fs.mkdirSync(reportDir, { recursive: true });
  const outputs = getOutputPaths(reportDir, report.property.alias, report.generatedAt);
  const json = `${JSON.stringify(report, null, 2)}\n`;

  // The receipt is the immutable run record. Create it before replacing any latest files so
  // a timestamp collision fails closed without changing an existing baseline.
  writeFileDurably(outputs.receiptJson, json, "wx");
  writeLatestAtomic(outputs.latestJson, json);
  writeLatestAtomic(outputs.latestMarkdown, markdown);
  if (outputs.legacyLatestJson) {
    writeLatestAtomic(outputs.legacyLatestJson, json);
    writeLatestAtomic(outputs.legacyLatestMarkdown, markdown);
  }

  return outputs;
}

export async function executeReport({
  args,
  config,
  now = new Date(),
  tokenProvider = getAccessToken,
  request = safeGscRequest,
}) {
  const property = resolveSiteSelection(args.site, config.siteUrl);
  const missing = getMissingConfigKeys(config);
  if (missing.length) {
    throw new Error(`Google Search Console API config is incomplete: ${missing.join(", ")}`);
  }

  const token = await tokenProvider(config);
  const sitesResult = await request(token, "GET", "/webmasters/v3/sites");
  const siteAccess = requireSiteOwner(sitesResult, property.siteUrl);
  const dateRange = getDateRange(args.days, now);
  const baseQuery = { ...dateRange, rowLimit: args.rowLimit };
  const requestBodies = {
    totals: { ...dateRange, rowLimit: 1 },
    byQuery: { ...baseQuery, dimensions: ["query"] },
    byPage: { ...baseQuery, dimensions: ["page"] },
    byQueryPage: { ...baseQuery, dimensions: ["query", "page"] },
    byDevice: { ...baseQuery, dimensions: ["device"] },
    byCountry: { ...baseQuery, dimensions: ["country"] },
    queryProbes: QUERY_PROBES.map((query) => ({
      query,
      body: {
        ...baseQuery,
        dimensions: ["query", "page"],
        dimensionFilterGroups: [
          {
            filters: [{ dimension: "query", operator: "equals", expression: query }],
          },
        ],
      },
    })),
  };
  const sitePath = `/webmasters/v3/sites/${encodeURIComponent(property.siteUrl)}`;

  const [totals, byQuery, byPage, byQueryPage, byDevice, byCountry, sitemaps, ...probeResults] =
    await Promise.all([
      searchAnalytics(request, token, property.siteUrl, requestBodies.totals),
      searchAnalytics(request, token, property.siteUrl, requestBodies.byQuery),
      searchAnalytics(request, token, property.siteUrl, requestBodies.byPage),
      searchAnalytics(request, token, property.siteUrl, requestBodies.byQueryPage),
      searchAnalytics(request, token, property.siteUrl, requestBodies.byDevice),
      searchAnalytics(request, token, property.siteUrl, requestBodies.byCountry),
      request(token, "GET", `${sitePath}/sitemaps`),
      ...requestBodies.queryProbes.map(({ body }) =>
        searchAnalytics(request, token, property.siteUrl, body),
      ),
    ]);

  const inspectionUrl = inspectionUrlFromSite(property.siteUrl);
  const inspection = await request(token, "POST", "/v1/urlInspection/index:inspect", {
    inspectionUrl,
    siteUrl: property.siteUrl,
  });
  const queryProbes = QUERY_PROBES.map((query, index) =>
    normalizeQueryProbe(query, probeResults[index]),
  );
  const providerResults = {
    totals,
    byQuery,
    byPage,
    byQueryPage,
    byDevice,
    byCountry,
    sitemaps,
    inspection,
    ...Object.fromEntries(
      queryProbes
        .filter((probe) => probe.status === "request_failed")
        .map((probe) => [`queryProbe:${probe.query}`, { ok: false, error: probe.error }]),
    ),
  };

  return {
    receiptVersion: 1,
    generatedAt: new Date(now).toISOString(),
    provider: "Google Search Console API",
    property: { ...property, permissionLevel: siteAccess.permissionLevel },
    siteUrl: property.siteUrl,
    dateRange,
    requestSpec: {
      rowLimit: args.rowLimit,
      searchAnalytics: requestBodies,
      inspection: { inspectionUrl, siteUrl: property.siteUrl },
    },
    siteAccess,
    totals,
    byQuery,
    byPage,
    byQueryPage,
    byDevice,
    byCountry,
    queryProbes,
    sitemaps,
    inspection,
    providerErrors: collectProviderErrors(providerResults),
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }

  const config = loadConfig(args.envPath);
  const report = await executeReport({ args, config });
  const markdown = buildMarkdown(report);
  const totalsValue = extractTotals(report.totals);

  console.log(`Site: ${report.siteUrl}`);
  console.log(`Property: ${report.property.alias}`);
  console.log(`Period: ${report.dateRange.startDate} - ${report.dateRange.endDate}`);
  if (totalsValue) {
    console.log(
      `Totals: clicks=${totalsValue.clicks}, impressions=${totalsValue.impressions}, CTR=${(totalsValue.ctr * 100).toFixed(2)}%, position=${totalsValue.position.toFixed(2)}`,
    );
  } else {
    console.log(`Totals request failed: ${report.totals.error.message}`);
  }

  if (args.save) {
    const outputs = saveReportArtifacts(REPORT_DIR, report, markdown);
    console.log(`Saved: ${outputs.latestMarkdown}`);
    console.log(`Receipt: ${outputs.receiptJson}`);
  }

  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((error) => {
    console.error("GSC report failed.");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
