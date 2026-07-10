import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "api-health");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      env[key] = line.slice(eq + 1).trim();
    }
  }

  return env;
}

function curl(args, options = {}) {
  try {
    const stdout = execFileSync("curl.exe", args, {
      encoding: "utf8",
      timeout: options.timeout || 20000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: stdout.trim(), status: 0 };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || "").trim(),
      status: typeof error.status === "number" ? error.status : 1,
    };
  }
}

function jsonCurl(args) {
  const result = curl(args);
  if (!result.ok) return { ok: false, error: `curl exit ${result.status}`, raw: result.stdout || result.stderr };
  try {
    const data = result.stdout ? JSON.parse(result.stdout) : null;
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message, raw: result.stdout.slice(0, 1000) };
  }
}

function has(env, key) {
  return Boolean(env[key] && String(env[key]).trim());
}

function redactedPresence(env, keys) {
  return Object.fromEntries(keys.map((key) => [key, has(env, key)]));
}

function directProbe(env) {
  const token = env.YANDEX_OAUTH_TOKEN;
  const login = env.YANDEX_DIRECT_LOGIN || "rosomaha-rus999";
  if (!token) return { ok: false, reason: "missing YANDEX_OAUTH_TOKEN" };

  const body = JSON.stringify({
    method: "get",
    params: {
      SelectionCriteria: { Ids: [708505950] },
      FieldNames: ["Id", "Name", "State", "Status"],
    },
  });
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
    "https://api.direct.yandex.com/json/v5/campaigns",
  ]);
  if (!result.ok) return result;
  if (result.data?.error) return { ok: false, error: result.data.error };
  return { ok: true, campaignCount: result.data?.result?.Campaigns?.length || 0 };
}

function metrikaProbe(env) {
  const token = env.YANDEX_OAUTH_TOKEN || env.YANDEX_METRIKA_TOKEN || env.YANDEX_WEBMASTER_TOKEN;
  if (!token) return { ok: false, reason: "missing Yandex OAuth token for Metrika" };

  const url = new URL("https://api-metrika.yandex.net/management/v1/counters");
  url.searchParams.set("per_page", "1");
  const result = jsonCurl(["-s", "-L", "-H", `Authorization: OAuth ${token}`, url.toString()]);
  if (!result.ok) return result;
  if (result.data?.errors) return { ok: false, error: result.data.errors };
  return { ok: true, availableCountersInResponse: result.data?.counters?.length || 0 };
}

function webmasterProbe(env) {
  const token = env.YANDEX_WEBMASTER_TOKEN;
  const userId = env.YANDEX_WEBMASTER_USER_ID;
  const hostId = env.YANDEX_WEBMASTER_HOST_ID;
  if (!token || !userId || !hostId) {
    return { ok: false, reason: "missing YANDEX_WEBMASTER_TOKEN, YANDEX_WEBMASTER_USER_ID or YANDEX_WEBMASTER_HOST_ID" };
  }

  const url = `https://api.webmaster.yandex.net/v4/user/${userId}/hosts/${hostId}/summary/`;
  const result = jsonCurl(["-s", "-L", "-H", `Authorization: OAuth ${token}`, url]);
  if (!result.ok) return result;
  if (result.data?.error_code) return { ok: false, error: result.data };
  return {
    ok: true,
    searchablePages: result.data?.searchable_pages_count ?? null,
    sqi: result.data?.sqi ?? null,
  };
}

function gscProbe(env) {
  const required = ["GSC_CLIENT_ID", "GSC_REFRESH_TOKEN", "GSC_SITE_URL"];
  const missing = required.filter((key) => !has(env, key));
  if (missing.length) {
    return {
      ok: false,
      reason: "missing_project_gsc_oauth_config",
      missing,
      fix: "create/save a Rosomaha-specific GSC_REFRESH_TOKEN in .env.seo.local; API-only reports cannot mint it without OAuth consent",
    };
  }

  const params = new URLSearchParams({
    client_id: env.GSC_CLIENT_ID,
    refresh_token: env.GSC_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  if (has(env, "GSC_CLIENT_SECRET")) params.set("client_secret", env.GSC_CLIENT_SECRET);

  const tokenResult = jsonCurl([
    "-s",
    "-L",
    "-X",
    "POST",
    "-H",
    "Content-Type: application/x-www-form-urlencoded",
    "--data",
    params.toString(),
    "https://oauth2.googleapis.com/token",
  ]);
  if (!tokenResult.ok) return tokenResult;
  if (tokenResult.data?.error) {
    return {
      ok: false,
      reason: tokenResult.data.error,
      detail: tokenResult.data.error_description || "",
    };
  }

  const accessToken = tokenResult.data?.access_token;
  const sites = jsonCurl(["-s", "-L", "-H", `Authorization: Bearer ${accessToken}`, "https://searchconsole.googleapis.com/webmasters/v3/sites"]);
  if (!sites.ok) return sites;
  const target = env.GSC_SITE_URL;
  const siteEntry = (sites.data?.siteEntry || []).find((entry) => entry.siteUrl === target);
  return {
    ok: Boolean(siteEntry),
    siteUrl: target,
    permissionLevel: siteEntry?.permissionLevel || null,
    reason: siteEntry ? undefined : "token_valid_but_site_not_in_account",
  };
}

const env = parseEnvFile(envPath);
const report = {
  generatedAt: new Date().toISOString(),
  project: rootDir,
  policy: {
    browserAllowed: false,
    apiOnly: true,
    yandexLogin: env.YANDEX_DIRECT_LOGIN || "rosomaha-rus999",
    mainCatalogSite: "https://xn--80aa8ahaki9a.site/",
    quizSite: "https://rosomaha.site/",
  },
  envPath,
  envPresence: redactedPresence(env, [
    "YANDEX_OAUTH_TOKEN",
    "YANDEX_WEBMASTER_TOKEN",
    "YANDEX_WEBMASTER_USER_ID",
    "YANDEX_WEBMASTER_HOST_ID",
    "GSC_CLIENT_ID",
    "GSC_CLIENT_SECRET",
    "GSC_REFRESH_TOKEN",
    "GSC_SITE_URL",
  ]),
  probes: {
    direct: directProbe(env),
    metrika: metrikaProbe(env),
    webmaster: webmasterProbe(env),
    gsc: gscProbe(env),
  },
};

fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `ROSOMAHA_API_DOCTOR_${stamp}.json`);
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(outPath);
console.log(JSON.stringify({
  direct: report.probes.direct.ok,
  metrika: report.probes.metrika.ok,
  webmaster: report.probes.webmaster.ok,
  gsc: report.probes.gsc.ok,
  gscReason: report.probes.gsc.reason || null,
  gscMissing: report.probes.gsc.missing || [],
}, null, 2));

if (!report.probes.direct.ok || !report.probes.metrika.ok || !report.probes.webmaster.ok) {
  process.exitCode = 2;
}
