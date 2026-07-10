import fs from "fs";
import path from "path";
import dns from "node:dns";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "url";

dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, ".env.seo.local");
const REPORT_DIR = path.join(ROOT_DIR, "seo-reports");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API_BASE = "https://searchconsole.googleapis.com";
const utf8Decoder = new TextDecoder("utf-8");

function parseArgs(argv) {
  const args = {
    days: 28,
    envPath: DEFAULT_ENV_PATH,
    save: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days" && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.days = Math.floor(value);
      i += 1;
    } else if (arg === "--env" && argv[i + 1]) {
      args.envPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--no-save") {
      args.save = false;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/gsc-report.mjs
  node scripts/gsc-report.mjs --days 90
  node scripts/gsc-report.mjs --env .env.seo.local

Required variables in .env.seo.local:
  GSC_CLIENT_ID
  GSC_REFRESH_TOKEN
  GSC_SITE_URL=https://xn--80aa8ahaki9a.site/

Optional for web OAuth clients:
  GSC_CLIENT_SECRET
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
    ["GSC_SITE_URL", config.siteUrl],
  ];
  return required.filter(([, value]) => !value).map(([key]) => key);
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateRange(days) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

async function getAccessToken(config) {
  const tokenParams = {
    client_id: config.clientId,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  };
  if (config.clientSecret) tokenParams.client_secret = config.clientSecret;
  const body = new URLSearchParams(tokenParams);

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `OAuth token exchange failed: ${payload.error_description || payload.error || response.status}`,
      );
    }

    return payload.access_token;
  } catch (error) {
    const payload = curlJson([
      "-sS",
      "-L",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/x-www-form-urlencoded",
      "--data",
      body.toString(),
      TOKEN_URL,
    ]);

    if (payload.error) {
      throw new Error(
        `OAuth token exchange failed: ${payload.error_description || payload.error}`,
      );
    }

    if (!payload.access_token) {
      throw new Error(`OAuth token exchange failed: ${error.message || "no access token"}`);
    }

    return payload.access_token;
  }
}

async function gscRequest(token, method, pathName, body) {
  try {
    const response = await fetch(`${GSC_API_BASE}${pathName}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    const payload = parseJsonText(text);

    if (!response.ok) {
      const error = new Error(payload?.error?.message || `GSC HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.status) throw error;

    const args = [
      "-sS",
      "-L",
      "-X",
      method,
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Content-Type: application/json",
      "-H",
      "Accept: application/json",
    ];
    if (body) args.push("--data-binary", JSON.stringify(body));
    args.push(`${GSC_API_BASE}${pathName}`);

    const payload = curlJson(args);
    if (payload?.error) {
      const fallbackError = new Error(payload.error.message || "GSC curl request failed");
      fallbackError.status = payload.error.code || 0;
      fallbackError.payload = payload;
      throw fallbackError;
    }

    return payload;
  }
}

function parseJsonText(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function curlJson(args) {
  const stdout = execFileSync("curl.exe", args, {
    encoding: "buffer",
    timeout: 60000,
    windowsHide: true,
  });
  return parseJsonText(utf8Decoder.decode(stdout));
}

async function safeGscRequest(token, method, pathName, body) {
  try {
    return { ok: true, data: await gscRequest(token, method, pathName, body) };
  } catch (error) {
    return {
      ok: false,
      error: {
        status: error.status || 0,
        message: error.message || "Unknown error",
        payload: error.payload || null,
      },
    };
  }
}

function searchAnalytics(token, siteUrl, query) {
  return safeGscRequest(
    token,
    "POST",
    `/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    query,
  );
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

function inspectionUrlFromSite(siteUrl) {
  if (!siteUrl) return "";
  if (siteUrl.startsWith("sc-domain:")) {
    const domain = siteUrl.slice("sc-domain:".length).trim();
    return domain ? `https://${domain}/` : "";
  }

  try {
    const url = new URL(siteUrl);
    url.search = "";
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    return url.toString();
  } catch {
    return siteUrl;
  }
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
    `Period: ${report.dateRange.startDate} - ${report.dateRange.endDate}`,
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
    { title: "Value", value: (row) => row.keys?.[0] || "" },
    { title: "Clicks", align: "---:", value: (row) => row.clicks || 0 },
    { title: "Impressions", align: "---:", value: (row) => row.impressions || 0 },
    { title: "CTR", align: "---:", value: (row) => `${((row.ctr || 0) * 100).toFixed(2)}%` },
    { title: "Position", align: "---:", value: (row) => (row.position || 0).toFixed(1) },
  ];

  lines.push("", "## Top queries");
  if (report.byQuery.ok) {
    lines.push(markdownTable(report.byQuery.data.rows || [], columns));
  } else {
    lines.push(`- Request failed: ${report.byQuery.error.message}`);
  }

  lines.push("", "## Top pages");
  if (report.byPage.ok) {
    lines.push(markdownTable(report.byPage.data.rows || [], columns));
  } else {
    lines.push(`- Request failed: ${report.byPage.error.message}`);
  }

  lines.push("", "## Devices");
  if (report.byDevice.ok) {
    lines.push(markdownTable(report.byDevice.data.rows || [], columns.slice(1)));
  } else {
    lines.push(`- Request failed: ${report.byDevice.error.message}`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadConfig(args.envPath);
  const missing = getMissingConfigKeys(config);
  if (missing.length) {
    console.error("Google Search Console API config is incomplete.");
    console.error(`Env file: ${config.envPath}`);
    console.error(`Missing: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const token = await getAccessToken(config);
  const dateRange = getDateRange(args.days);
  const baseQuery = { ...dateRange, rowLimit: 25 };
  const sitePath = `/webmasters/v3/sites/${encodeURIComponent(config.siteUrl)}`;

  const [sites, totals, byQuery, byPage, byDevice, byCountry, sitemaps] =
    await Promise.all([
      safeGscRequest(token, "GET", "/webmasters/v3/sites"),
      searchAnalytics(token, config.siteUrl, { ...dateRange, rowLimit: 1 }),
      searchAnalytics(token, config.siteUrl, { ...baseQuery, dimensions: ["query"] }),
      searchAnalytics(token, config.siteUrl, { ...baseQuery, dimensions: ["page"] }),
      searchAnalytics(token, config.siteUrl, { ...baseQuery, dimensions: ["device"] }),
      searchAnalytics(token, config.siteUrl, { ...baseQuery, dimensions: ["country"] }),
      safeGscRequest(token, "GET", `${sitePath}/sitemaps`),
    ]);

  const inspectionUrl = inspectionUrlFromSite(config.siteUrl);
  const inspection = inspectionUrl
    ? await safeGscRequest(token, "POST", "/v1/urlInspection/index:inspect", {
        inspectionUrl,
        siteUrl: config.siteUrl,
      })
    : {
        ok: false,
        error: { status: 0, message: "No inspection URL", payload: null },
      };

  const report = {
    generatedAt: new Date().toISOString(),
    siteUrl: config.siteUrl,
    dateRange,
    sites,
    totals,
    byQuery,
    byPage,
    byDevice,
    byCountry,
    sitemaps,
    inspection,
  };

  const markdown = buildMarkdown(report);
  const totalsValue = extractTotals(totals);

  console.log(`Site: ${config.siteUrl}`);
  console.log(`Period: ${dateRange.startDate} - ${dateRange.endDate}`);
  if (totalsValue) {
    console.log(
      `Totals: clicks=${totalsValue.clicks}, impressions=${totalsValue.impressions}, CTR=${(totalsValue.ctr * 100).toFixed(2)}%, position=${totalsValue.position.toFixed(2)}`,
    );
  } else {
    console.log(`Totals request failed: ${totals.error.message}`);
  }

  if (args.save) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, "latest-gsc-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(REPORT_DIR, "latest-gsc-report.md"), markdown, "utf8");
    console.log(`Saved: ${path.join(REPORT_DIR, "latest-gsc-report.md")}`);
  }
}

main().catch((error) => {
  console.error("GSC report failed.");
  console.error(error.message || error);
  process.exitCode = 1;
});
