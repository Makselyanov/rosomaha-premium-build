import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LIVE4_ACCOUNT_URL, safeJsonRequest } from "./yandex-direct-balance.mjs";
import { getAccessToken, gscRequest } from "./gsc-report.mjs";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits");
const jsonDir = path.join(outDir, "api-only-snapshots");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directLoginDefault = "rosomaha-rus999";
const directChangesSince = "2025-01-01T00:00:00Z";
const webmasterMainHost = "xn--80aa8ahaki9a.site";
const webmasterRosomahaRusHost = "rosomaha-rus.ru";
const webmasterRequestTimeoutMs = 30_000;
const webmasterRequestAttempts = 2;
const publicHttpBodyLimit = 2_000_000;
export const protectedCampaignIds = Object.freeze(["708505950", "705770573", "710087376"]);
export const targetRosomahaRusCampaignId = "713802902";
export const rosomahaRusPublicTargets = Object.freeze([
  Object.freeze({ id: "httpRoot", kind: "html", url: "http://rosomaha-rus.ru/" }),
  Object.freeze({ id: "root", kind: "html", url: "https://rosomaha-rus.ru/" }),
  Object.freeze({ id: "robots", kind: "robots", url: "https://rosomaha-rus.ru/robots.txt" }),
  Object.freeze({ id: "sitemap", kind: "sitemap", url: "https://rosomaha-rus.ru/sitemap.xml" }),
  Object.freeze({ id: "keyProduct", kind: "html", url: "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812" }),
]);
export const campaigns = Object.freeze([
  "708505950",
  "708506873",
  "705770573",
  "710087376",
  targetRosomahaRusCampaignId,
]);
const bitrixHosts = new Set(["rosomaha-rus.ru", "www.rosomaha-rus.ru"]);
const allowedDirectJsonCalls = new Set([
  "changes.checkCampaigns",
  "changes.check",
  "campaigns.get",
  "adgroups.get",
  "ads.get",
  "sitelinks.get",
]);
const allowedDirectSafeJsonCalls = new Set(["clients.get", "agencyclients.get", "strategies.get"]);
export const monitoredObjects = Object.freeze([
  Object.freeze({
    name: "catalog",
    id: "107139619",
    hardGoalId: "517600157",
    hardGoalEvent: "crm_conversion",
    softGoalId: "517599639",
    site: "xn--80aa8ahaki9a.site",
  }),
  Object.freeze({
    name: "quiz",
    id: "105918356",
    hardGoalId: "496461698",
    hardGoalEvent: null,
    softGoalId: null,
    site: "rosomaha.site",
  }),
  Object.freeze({
    name: "bitrix",
    id: "111905412",
    hardGoalId: "601477348",
    hardGoalEvent: "crm_conversion",
    softGoalId: "601477497",
    site: "rosomaha-rus.ru",
    directCampaignId: targetRosomahaRusCampaignId,
  }),
]);
const counters = monitoredObjects;

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

function safeUrlWithoutQuery(value) {
  const raw = String(value || "").trim();
  if (!raw) return { url: null, host: null };
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return { url: `${parsed.origin}${parsed.pathname}`, host: parsed.hostname.toLowerCase() };
  } catch {
    return { url: null, host: "invalid" };
  }
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const expected = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === expected);
  return entry ? String(entry[1]) : null;
}

function parseTagAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/gu;
  for (const match of tag.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (key === "link" || key === "meta") continue;
    attributes[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function resolveHttpUrl(value, baseUrl) {
  try {
    const resolved = new URL(value, baseUrl);
    return /^https?:$/u.test(resolved.protocol) ? resolved.toString() : null;
  } catch {
    return null;
  }
}

function comparablePublicUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.searchParams.sort();
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractHtmlSeoSignals(html, finalUrl) {
  const source = String(html || "");
  const linkTags = source.match(/<link\b[^>]*>/giu) || [];
  const metaTags = source.match(/<meta\b[^>]*>/giu) || [];
  const canonicalTag = linkTags
    .map(parseTagAttributes)
    .find((attributes) => String(attributes.rel || "").toLowerCase().split(/\s+/u).includes("canonical"));
  const canonical = canonicalTag?.href
    ? resolveHttpUrl(decodeXmlText(canonicalTag.href), finalUrl)
    : null;
  const robotsDirectives = metaTags
    .map(parseTagAttributes)
    .filter((attributes) => ["robots", "yandex"].includes(String(attributes.name || "").toLowerCase()))
    .map((attributes) => String(attributes.content || "").trim())
    .filter(Boolean);

  return {
    canonical,
    canonicalHost: hostFromUrl(canonical),
    canonicalMatchesFinal: Boolean(
      canonical
        && comparablePublicUrl(canonical) === comparablePublicUrl(finalUrl),
    ),
    metaRobots: robotsDirectives,
    metaNoindex: robotsDirectives.some((value) => /(?:^|,|\s)noindex(?:$|,|\s)/iu.test(value)),
  };
}

export function extractRobotsSignals(body) {
  const rows = String(body || "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s*#.*$/u, "").trim())
    .filter(Boolean);
  const sitemapUrls = [];
  let activeAgents = [];
  let directivesStarted = false;
  let disallowAll = false;

  for (const row of rows) {
    const separator = row.indexOf(":");
    if (separator < 0) continue;
    const key = row.slice(0, separator).trim().toLowerCase();
    const value = row.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (directivesStarted) activeAgents = [];
      activeAgents.push(value.toLowerCase());
      directivesStarted = false;
      continue;
    }
    if (key === "sitemap") {
      const sitemapUrl = resolveHttpUrl(value, "https://rosomaha-rus.ru/");
      if (sitemapUrl) sitemapUrls.push(sitemapUrl);
      continue;
    }
    if (key === "allow" || key === "disallow") {
      directivesStarted = true;
      if (key === "disallow" && value === "/" && activeAgents.includes("*")) disallowAll = true;
    }
  }

  return {
    userAgentPresent: rows.some((row) => /^user-agent\s*:/iu.test(row)),
    sitemapUrls: [...new Set(sitemapUrls)],
    sitemapHosts: [...new Set(sitemapUrls.map(hostFromUrl).filter(Boolean))].sort(),
    disallowAll,
  };
}

function decodeXmlText(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

export function extractSitemapSignals(body, keyProductUrl) {
  const source = String(body || "");
  const locations = [...source.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/giu)]
    .map((match) => decodeXmlText(match[1]).trim())
    .filter(Boolean);
  const locationHosts = [...new Set(locations.map(hostFromUrl).filter(Boolean))].sort();
  const comparableKeyProductUrl = comparablePublicUrl(keyProductUrl);
  return {
    type: /<sitemapindex\b/iu.test(source)
      ? "sitemapindex"
      : /<urlset\b/iu.test(source)
        ? "urlset"
        : "unknown",
    locCount: locations.length,
    locationHosts,
    allLocationsOnTargetHost: locationHosts.length > 0
      && locationHosts.every((host) => host === webmasterRosomahaRusHost),
    keyProductListed: Boolean(
      comparableKeyProductUrl
        && locations.some((location) => comparablePublicUrl(location) === comparableKeyProductUrl),
    ),
  };
}

export function analyzePublicHttpResponse(target, response) {
  const finalUrl = String(response.finalUrl || target.url);
  const status = Number(response.status || 0);
  const contentType = headerValue(response.headers, "content-type");
  const xRobotsTag = headerValue(response.headers, "x-robots-tag");
  const common = {
    id: target.id,
    kind: target.kind,
    requestedUrl: target.url,
    ok: status >= 200 && status < 400,
    sourceStatus: status > 0 ? "available" : "source_unavailable",
    status,
    redirects: response.redirects || [],
    redirectCount: (response.redirects || []).length,
    finalUrl,
    finalHost: hostFromUrl(finalUrl),
    exactFinalHost: hostFromUrl(finalUrl) === webmasterRosomahaRusHost,
    contentType,
    xRobotsTag,
    headerNoindex: /(?:^|,|\s)noindex(?:$|,|\s)/iu.test(String(xRobotsTag || "")),
    bodyBytes: Number(response.bodyBytes || 0),
    bodyTruncated: Boolean(response.bodyTruncated),
  };

  if (target.kind === "html") {
    return {
      ...common,
      html: extractHtmlSeoSignals(response.body, finalUrl),
    };
  }
  if (target.kind === "robots") {
    return {
      ...common,
      robots: extractRobotsSignals(response.body),
    };
  }
  if (target.kind === "sitemap") {
    const keyProductUrl = rosomahaRusPublicTargets.find((item) => item.id === "keyProduct").url;
    return {
      ...common,
      sitemap: extractSitemapSignals(response.body, keyProductUrl),
    };
  }
  return common;
}

async function fetchPublicHttpTarget(target, fetchImpl) {
  const redirects = [];
  let currentUrl = target.url;
  try {
    for (let attempt = 0; attempt <= 8; attempt += 1) {
      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: target.kind === "html"
            ? "text/html,application/xhtml+xml"
            : "text/plain,application/xml,text/xml;q=0.9,*/*;q=0.5",
          "User-Agent": "RosomahaApiOnlyAudit/1.0",
        },
        signal: AbortSignal.timeout(45_000),
      });
      const location = headerValue(response.headers, "location");
      if (response.status >= 300 && response.status < 400 && location) {
        const nextUrl = resolveHttpUrl(location, currentUrl);
        if (!nextUrl) throw new Error("redirect location is not an HTTP URL");
        redirects.push({ status: response.status, from: currentUrl, to: nextUrl });
        currentUrl = nextUrl;
        continue;
      }

      const fullBody = await response.text();
      const bodyBytes = Buffer.byteLength(fullBody, "utf8");
      return analyzePublicHttpResponse(target, {
        status: response.status,
        redirects,
        finalUrl: currentUrl,
        headers: response.headers,
        body: fullBody.slice(0, publicHttpBodyLimit),
        bodyBytes,
        bodyTruncated: bodyBytes > publicHttpBodyLimit,
      });
    }
    throw new Error("too many redirects");
  } catch (error) {
    return {
      id: target.id,
      kind: target.kind,
      requestedUrl: target.url,
      ok: false,
      sourceStatus: "source_unavailable",
      status: null,
      redirects,
      redirectCount: redirects.length,
      finalUrl: currentUrl,
      finalHost: hostFromUrl(currentUrl),
      exactFinalHost: false,
      error: String(error?.message || error),
    };
  }
}

export async function auditRosomahaRusPublicHttp(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    return {
      targetHost: webmasterRosomahaRusHost,
      sourceStatus: "source_unavailable",
      error: "fetch unavailable",
      targets: {},
    };
  }
  const targetResults = await Promise.all(
    rosomahaRusPublicTargets.map((target) => fetchPublicHttpTarget(target, fetchImpl)),
  );
  const targets = Object.fromEntries(targetResults.map((result) => [result.id, result]));
  const availableCount = targetResults.filter((result) => result.sourceStatus === "available").length;
  return {
    targetHost: webmasterRosomahaRusHost,
    sourceStatus: availableCount === targetResults.length
      ? "available"
      : availableCount > 0
        ? "partial"
        : "source_unavailable",
    keyProductUrl: rosomahaRusPublicTargets.find((target) => target.id === "keyProduct").url,
    targets,
    checks: {
      httpsRoot200: targets.root?.status === 200 && targets.root?.exactFinalHost,
      httpRootRedirectsToHttps: targets.httpRoot?.redirects?.some((redirect) => (
        redirect.from.startsWith("http://")
        && redirect.to.startsWith("https://")
      )) && targets.httpRoot?.status === 200 && targets.httpRoot?.exactFinalHost,
      robots200AndOpen: targets.robots?.status === 200
        && targets.robots?.robots?.userAgentPresent
        && !targets.robots?.robots?.disallowAll,
      sitemap200AndXml: targets.sitemap?.status === 200
        && ["urlset", "sitemapindex"].includes(targets.sitemap?.sitemap?.type),
      keyProduct200SelfCanonical: targets.keyProduct?.status === 200
        && targets.keyProduct?.html?.canonicalMatchesFinal
        && !targets.keyProduct?.html?.metaNoindex
        && !targets.keyProduct?.headerNoindex,
    },
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite).filter((value) => value > 0))].sort((a, b) => a - b);
}

function errorText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function directLoginForEnv(env) {
  return env.YANDEX_DIRECT_LOGIN || env.YANDEX_DIRECT_CLIENT_LOGIN || directLoginDefault;
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
  const call = `${service}.${method}`;
  if (!allowedDirectJsonCalls.has(call)) return { ok: false, error: `blocked non-read-only Direct call: ${call}` };
  const token = env.YANDEX_DIRECT_OAUTH_TOKEN || env.YANDEX_OAUTH_TOKEN;
  const login = directLoginForEnv(env);
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

async function directSafeJsonRequest(env, service, method, params, options = {}) {
  const call = `${service}.${method}`;
  if (!allowedDirectSafeJsonCalls.has(call)) {
    return { ok: false, error: `blocked non-read-only Direct call: ${call}` };
  }
  const token = env.YANDEX_DIRECT_OAUTH_TOKEN || env.YANDEX_OAUTH_TOKEN;
  const login = directLoginForEnv(env);
  if (!token) return { ok: false, error: "missing YANDEX_OAUTH_TOKEN" };

  const headers = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (options.includeClientLogin !== false) headers["Client-Login"] = login;

  let response;
  try {
    response = await safeJsonRequest(
      `https://api.direct.yandex.com/json/v501/${service}`,
      { method: "POST", headers, body: JSON.stringify({ method, params }) },
      { secrets: [token] },
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (!response.ok || response.data?.error) {
    const providerError = response.data?.error || {};
    return {
      ok: false,
      error: {
        httpStatus: response.status,
        error_code: providerError.error_code || null,
        error_string: providerError.error_string || "provider error",
        requestId: response.providerMeta?.requestId || null,
      },
    };
  }
  return {
    ok: true,
    data: response.data?.result,
    requestId: response.providerMeta?.requestId || null,
  };
}

async function directAccountScope(env) {
  const fieldNames = ["ClientId", "Login", "Type", "Archived", "AvailableCampaignTypes"];
  const owner = await directSafeJsonRequest(env, "clients", "get", { FieldNames: fieldNames }, { includeClientLogin: false });
  const agency = await directSafeJsonRequest(env, "agencyclients", "get", {
    SelectionCriteria: {},
    FieldNames: fieldNames,
    Page: { Limit: 10000, Offset: 0 },
  }, { includeClientLogin: false });
  const ownerClients = owner.ok ? owner.data?.Clients || [] : [];
  const agencyClients = agency.ok ? agency.data?.Clients || [] : [];
  const exactOwner = ownerClients.find((client) => client.Login === directLoginDefault) || null;

  return {
    ok: Boolean(owner.ok && exactOwner),
    ownerError: owner.ok ? null : owner.error,
    tokenOwner: exactOwner
      ? {
          login: exactOwner.Login,
          clientId: Number(exactOwner.ClientId),
          type: exactOwner.Type,
          archived: exactOwner.Archived,
          availableCampaignTypes: exactOwner.AvailableCampaignTypes || [],
        }
      : null,
    agencyAccess: {
      ok: agency.ok,
      errorCode: agency.ok ? null : Number(agency.error?.error_code || 0) || null,
      errorString: agency.ok ? null : agency.error?.error_string || null,
      clientCount: agencyClients.length,
      limitedBy: agency.data?.LimitedBy || null,
    },
    exactLoginVerified: exactOwner?.Login === directLoginDefault,
    directClientVerified: exactOwner?.Type === "CLIENT",
    scriptMutations: 0,
  };
}

async function directPackageStrategies(env, accountScope) {
  if (!accountScope?.exactLoginVerified || !accountScope?.directClientVerified) {
    return {
      ok: false,
      error: "Контур Direct не подтверждён как точный прямой клиент rosomaha-rus999",
      scriptMutations: 0,
    };
  }
  const result = await directSafeJsonRequest(env, "strategies", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Type", "CounterIds", "PriorityGoals", "StatusArchived"],
    Page: { Limit: 10000, Offset: 0 },
  });
  if (!result.ok) return { ok: false, error: result.error, scriptMutations: 0 };
  if (result.data?.LimitedBy) {
    return { ok: false, error: `strategies.get page truncated at ${result.data.LimitedBy}`, scriptMutations: 0 };
  }

  const strategies = result.data?.Strategies || [];
  const targetCounterId = Number(monitoredObjects.find((item) => item.name === "bitrix").id);
  const bitrixStrategies = strategies
    .filter((strategy) => (strategy.CounterIds?.Items || []).map(Number).includes(targetCounterId))
    .map((strategy) => ({
      id: Number(strategy.Id),
      name: String(strategy.Name || "").slice(0, 250),
      type: String(strategy.Type || "unknown"),
      statusArchived: String(strategy.StatusArchived || "unknown"),
      counterIds: uniqueSortedNumbers(strategy.CounterIds?.Items || []),
      priorityGoalIds: uniqueSortedNumbers((strategy.PriorityGoals?.Items || []).map((goal) => goal.GoalId)),
    }));

  return {
    ok: true,
    strategyCount: strategies.length,
    targetCounterId,
    bitrixStrategyCount: bitrixStrategies.length,
    bitrixStrategies,
    requestId: result.requestId,
    scriptMutations: 0,
    limitation: "Проверка охватывает только пакетные стратегии и сама по себе не доказывает их использование кампанией.",
  };
}

async function directAccessibleMetrikaGoals(env, accountScope) {
  const token = env.YANDEX_DIRECT_OAUTH_TOKEN || env.YANDEX_OAUTH_TOKEN;
  if (!token) return { ok: false, error: "missing YANDEX_OAUTH_TOKEN", scriptMutations: 0 };
  if (!accountScope?.exactLoginVerified || !accountScope?.directClientVerified) {
    return {
      ok: false,
      error: "Контур Direct не подтверждён как точный прямой клиент rosomaha-rus999",
      scriptMutations: 0,
    };
  }

  const body = {
    method: "GetRetargetingGoals",
    token,
    locale: "ru",
    param: {},
  };
  let response;
  try {
    response = await safeJsonRequest(
      LIVE4_ACCOUNT_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      },
      { secrets: [token] },
    );
  } catch (error) {
    return { ok: false, error: error.message, scriptMutations: 0 };
  }

  const providerError = response.data?.error || response.data?.error_code;
  if (!response.ok || providerError != null) {
    return {
      ok: false,
      error: {
        httpStatus: response.status,
        errorCode: response.data?.error_code || response.data?.error?.error_code || null,
        errorString: response.data?.error_str || response.data?.error?.error_string || "provider error",
        requestId: response.providerMeta?.requestId || null,
      },
      scriptMutations: 0,
    };
  }

  const goals = response.data?.data;
  if (!Array.isArray(goals)) {
    return {
      ok: false,
      error: "GetRetargetingGoals returned no goal array",
      requestId: response.providerMeta?.requestId || null,
      scriptMutations: 0,
    };
  }

  const bitrixGoals = goals
    .filter((goal) => bitrixHosts.has(hostFromUrl(goal.GoalDomain)))
    .map((goal) => ({
      goalId: String(goal.GoalID || ""),
      goalDomain: hostFromUrl(goal.GoalDomain),
      name: String(goal.Name || "").slice(0, 250),
      type: String(goal.Type || "unknown"),
    }));

  return {
    ok: true,
    method: "GetRetargetingGoals",
    endpoint: LIVE4_ACCOUNT_URL,
    exactLogin: directLoginDefault,
    accessibleGoalCount: goals.length,
    bitrixGoalCount: bitrixGoals.length,
    bitrixGoals,
    requestId: response.providerMeta?.requestId || null,
    scriptMutations: 0,
    limitation: "Проверка доказывает только цели Метрики, видимые клиенту Direct; она не доказывает владельца счётчика или связь с кампанией.",
  };
}

function directBatchGet(env, service, resultKey, ids, batchSize, buildParams) {
  const items = [];
  for (const batch of chunks(ids, batchSize)) {
    const result = directJsonRequest(env, service, "get", buildParams(batch));
    if (!result.ok) return { ok: false, error: result.error, items };
    if (result.data?.LimitedBy) return { ok: false, error: `${service}.get page truncated at ${result.data.LimitedBy}`, items };
    items.push(...(result.data?.[resultKey] || []));
  }
  return { ok: true, items };
}

function directChangesInventory(env) {
  const supportedCampaigns = directJsonRequest(env, "campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Type", "State", "Status", "StatusPayment", "StatusClarification"],
    TextCampaignFieldNames: ["CounterIds"],
    UnifiedCampaignFieldNames: ["CounterIds"],
    Page: { Limit: 10000, Offset: 0 },
  });
  if (!supportedCampaigns.ok) return { ok: false, since: directChangesSince, error: supportedCampaigns.error };
  if (supportedCampaigns.data?.LimitedBy) {
    return { ok: false, since: directChangesSince, error: `campaigns.get page truncated at ${supportedCampaigns.data.LimitedBy}` };
  }

  const supportedCampaignItems = supportedCampaigns.data?.Campaigns || [];
  const campaignIds = uniqueSortedNumbers(supportedCampaignItems.map((item) => item.Id));
  const changed = directJsonRequest(env, "changes", "checkCampaigns", { Timestamp: directChangesSince });
  if (!changed.ok) return { ok: false, since: directChangesSince, error: changed.error };

  const campaignChanges = changed.data?.Campaigns || [];
  const changedCampaignIds = uniqueSortedNumbers(campaignChanges.map((item) => item.CampaignId));
  const children = changedCampaignIds.length
    ? directJsonRequest(env, "changes", "check", {
        CampaignIds: changedCampaignIds,
        Timestamp: directChangesSince,
        FieldNames: ["CampaignIds", "AdGroupIds", "AdIds"],
      })
    : { ok: true, data: { Modified: {} } };
  if (!children.ok) return { ok: false, since: directChangesSince, campaignIds, error: children.error };

  const modified = children.data?.Modified || {};
  const adGroups = campaignIds.length
    ? directBatchGet(env, "adgroups", "AdGroups", campaignIds, 10, (ids) => ({
        SelectionCriteria: { CampaignIds: ids },
        FieldNames: ["Id", "CampaignId", "Type", "Status", "ServingStatus"],
        Page: { Limit: 10000, Offset: 0 },
      }))
    : { ok: true, items: [] };
  if (!adGroups.ok) return { ok: false, since: directChangesSince, campaignIds, error: adGroups.error };

  const ads = campaignIds.length
    ? directBatchGet(env, "ads", "Ads", campaignIds, 10, (ids) => ({
        SelectionCriteria: { CampaignIds: ids },
        FieldNames: ["Id", "CampaignId", "AdGroupId", "Type", "Subtype", "State", "Status", "StatusClarification"],
        TextAdFieldNames: ["Href", "SitelinkSetId"],
        DynamicTextAdFieldNames: ["SitelinkSetId"],
        TextImageAdFieldNames: ["Href"],
        TextAdBuilderAdFieldNames: ["Href"],
        CpcVideoAdBuilderAdFieldNames: ["Href"],
        CpmBannerAdBuilderAdFieldNames: ["Href"],
        CpmVideoAdBuilderAdFieldNames: ["Href"],
        Page: { Limit: 10000, Offset: 0 },
      }))
    : { ok: true, items: [] };
  if (!ads.ok) return { ok: false, since: directChangesSince, campaignIds, error: ads.error };

  const safeAds = ads.items.map((ad) => {
    const hrefs = [
      ad.TextAd?.Href,
      ad.TextImageAd?.Href,
      ad.TextAdBuilderAd?.Href,
      ad.CpcVideoAdBuilderAd?.Href,
      ad.CpmBannerAdBuilderAd?.Href,
      ad.CpmVideoAdBuilderAd?.Href,
    ].filter(Boolean);
    const urls = [...new Map(hrefs.map((href) => {
      const safe = safeUrlWithoutQuery(href);
      return [`${safe.host}|${safe.url}`, safe];
    })).values()];
    return {
      id: Number(ad.Id),
      campaignId: Number(ad.CampaignId),
      adGroupId: Number(ad.AdGroupId),
      type: ad.Type,
      state: ad.State,
      status: ad.Status,
      urls,
      sitelinkSetId: Number(ad.TextAd?.SitelinkSetId || ad.DynamicTextAd?.SitelinkSetId || 0) || null,
    };
  });

  const sitelinkSetIds = uniqueSortedNumbers(safeAds.map((ad) => ad.sitelinkSetId));
  const sitelinkSets = sitelinkSetIds.length
    ? directBatchGet(env, "sitelinks", "SitelinksSets", sitelinkSetIds, 1000, (ids) => ({
        SelectionCriteria: { Ids: ids },
        FieldNames: ["Id"],
        SitelinkFieldNames: ["Href"],
        Page: { Limit: 10000, Offset: 0 },
      }))
    : { ok: true, items: [] };
  if (!sitelinkSets.ok) return { ok: false, since: directChangesSince, campaignIds, error: sitelinkSets.error };

  const safeSitelinkSets = sitelinkSets.items.map((set) => ({
    id: Number(set.Id),
    links: (set.Sitelinks || []).map((link) => safeUrlWithoutQuery(link.Href)).filter((item) => item.url),
  }));
  const campaignMap = new Map(supportedCampaignItems.map((campaign) => [Number(campaign.Id), campaign]));
  const matchedFromAds = safeAds
    .filter((ad) => ad.urls.some((item) => bitrixHosts.has(item.host)))
    .map((ad) => ad.campaignId);
  const matchedFromSitelinks = safeSitelinkSets
    .filter((set) => set.links.some((item) => bitrixHosts.has(item.host)))
    .flatMap((set) => safeAds.filter((ad) => ad.sitelinkSetId === set.id).map((ad) => ad.campaignId));

  return {
    ok: true,
    since: directChangesSince,
    serverTimestamp: changed.data?.Timestamp || null,
    campaignIds,
    changedCampaignIds,
    unknownCampaignIds: uniqueSortedNumbers([...campaignIds, ...changedCampaignIds]).filter((id) => !campaigns.includes(String(id))),
    campaigns: campaignIds.map((id) => {
      const campaign = campaignMap.get(id);
      return campaign
        ? {
            id,
            name: campaign.Name,
            type: campaign.Type,
            state: campaign.State,
            status: campaign.Status,
            counterIds: campaign.TextCampaign?.CounterIds?.Items || campaign.UnifiedCampaign?.CounterIds?.Items || [],
          }
        : { id, unavailableViaCampaignsGet: true };
    }),
    adGroupCount: adGroups.items.length,
    adCount: safeAds.length,
    adsWithoutUrlCount: safeAds.filter((ad) => ad.urls.length === 0).length,
    adTypes: [...new Set(safeAds.map((ad) => ad.type).filter(Boolean))].sort(),
    ads: safeAds,
    sitelinks: safeSitelinkSets,
    adHosts: [...new Set(safeAds.flatMap((ad) => ad.urls.map((item) => item.host)).filter(Boolean))].sort(),
    sitelinkHosts: [...new Set(safeSitelinkSets.flatMap((set) => set.links.map((item) => item.host)).filter(Boolean))].sort(),
    matchingRosomahaRusCampaignIds: uniqueSortedNumbers([...matchedFromAds, ...matchedFromSitelinks]),
    changedObjectCounts: {
      campaigns: uniqueSortedNumbers(modified.CampaignIds || []).length,
      adGroups: uniqueSortedNumbers(modified.AdGroupIds || []).length,
      ads: uniqueSortedNumbers(modified.AdIds || []).length,
    },
    scriptMutations: 0,
    limitations: [
      "The unfiltered campaigns.get inventory covers only campaign types supported by that API service.",
      "Changes API separately reports only objects changed since the requested timestamp.",
      "Campaign Wizard objects unsupported by campaigns.get may be absent from both API inventories.",
      "An ad with no URL returned in the requested format fields blocks a complete negative landing-domain conclusion.",
      "URLs are stored without query strings or fragments.",
    ],
  };
}

function directReport(env, reportType, fields, date1, date2, extraFilter = [], options = {}) {
  const token = env.YANDEX_DIRECT_OAUTH_TOKEN || env.YANDEX_OAUTH_TOKEN;
  const login = directLoginForEnv(env);
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

function metrikaManagementRequest(env, endpoint) {
  const token = env.YANDEX_METRIKA_TOKEN || env.YANDEX_OAUTH_TOKEN || env.YANDEX_WEBMASTER_TOKEN;
  if (!token) return { ok: false, error: "missing Yandex token for Metrika" };
  const result = jsonCurl([
    "-s",
    "-L",
    "-H",
    `Authorization: OAuth ${token}`,
    `https://api-metrika.yandex.net/management/v1${endpoint}`,
  ]);
  if (!result.ok) return result;
  if (result.data?.errors) return { ok: false, error: result.data.errors };
  return { ok: true, data: result.data };
}

function normalizedHost(value) {
  return hostFromUrl(value)?.replace(/^www\./u, "") || null;
}

function summarizeGoalDefinition(goal, expectedEvent = null) {
  if (!goal) return null;
  const actionEvents = (goal.conditions || [])
    .filter((condition) => String(condition.type || "").toLowerCase() === "exact")
    .map((condition) => String(condition.url || "").trim())
    .filter(Boolean);
  return {
    id: String(goal.id || ""),
    name: String(goal.name || "").slice(0, 250),
    type: String(goal.type || "unknown"),
    actionEvents,
    expectedEvent,
    exactEventVerified: expectedEvent == null || actionEvents.includes(expectedEvent),
  };
}

function metrikaCounterDefinition(env, object) {
  const metadata = metrikaManagementRequest(env, `/counter/${object.id}`);
  const goals = metrikaManagementRequest(env, `/counter/${object.id}/goals`);
  const counter = metadata.ok ? metadata.data?.counter || null : null;
  const goalItems = goals.ok && Array.isArray(goals.data?.goals) ? goals.data.goals : [];
  const hardGoal = summarizeGoalDefinition(
    goalItems.find((goal) => String(goal.id) === object.hardGoalId),
    object.hardGoalEvent,
  );
  const softGoal = object.softGoalId
    ? summarizeGoalDefinition(goalItems.find((goal) => String(goal.id) === object.softGoalId))
    : null;
  return {
    counter: metadata.ok
      ? {
          ok: Boolean(counter),
          error: counter ? null : "counter payload missing",
          id: counter ? String(counter.id || "") : null,
          site: counter ? normalizedHost(counter.site) : null,
          exactIdVerified: Boolean(counter && String(counter.id) === object.id),
          exactSiteVerified: Boolean(counter && normalizedHost(counter.site) === normalizedHost(object.site)),
        }
      : { ok: false, error: metadata.error },
    goals: goals.ok
      ? {
          ok: true,
          hardGoal,
          hardGoalVerified: Boolean(hardGoal && hardGoal.exactEventVerified),
          softGoal,
          softGoalClassification: softGoal ? "soft_signal_not_lead" : "not_configured_or_not_found",
        }
      : { ok: false, error: goals.error, hardGoal: null, hardGoalVerified: false, softGoal: null },
  };
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

function exactHostFromWebmasterProperty(property) {
  for (const value of [property?.ascii_host_url, property?.unicode_host_url, property?.host_url]) {
    const host = hostFromUrl(value);
    if (host) return host;
  }
  const hostId = String(property?.host_id || "");
  const match = hostId.match(/^[^:]+:([^:]+):\d+$/u);
  return match ? match[1].toLowerCase() : null;
}

export function selectExactWebmasterProperty(hosts, targetHost) {
  const expected = String(targetHost || "").toLowerCase();
  return (Array.isArray(hosts) ? hosts : []).find(
    (property) => exactHostFromWebmasterProperty(property) === expected,
  ) || null;
}

function unavailableWebmasterEndpoints(reason) {
  return Object.fromEntries(
    ["summary", "indexing", "excluded", "diagnostics", "sitemaps", "queries"]
      .map((name) => [name, {
        ok: false,
        sourceStatus: "source_unavailable",
        reason,
      }]),
  );
}

export async function webmasterApiGet(env, url, request = safeJsonRequest) {
  const token = env.YANDEX_WEBMASTER_TOKEN;
  let lastError = null;
  for (let attempt = 1; attempt <= webmasterRequestAttempts; attempt += 1) {
    try {
      const response = await request(
        url,
        {
          method: "GET",
          family: 4,
          headers: {
            Authorization: "OAuth " + token,
            Accept: "application/json",
          },
        },
        {
          fetchImpl: null,
          secrets: [token],
          timeoutMs: webmasterRequestTimeoutMs,
        },
      );
      const providerError = response.data?.error_code || response.data?.error?.error_code;
      if (!response.ok || providerError) {
        return {
          ok: false,
          sourceStatus: "source_unavailable",
          httpStatus: response.status,
          errorCode: providerError || null,
          error: response.data?.error_message
            || response.data?.error?.error_string
            || "Webmaster HTTP " + response.status,
          requestId: response.providerMeta?.requestId || null,
          attempts: attempt,
        };
      }
      return {
        ok: true,
        sourceStatus: "available",
        data: response.data,
        requestId: response.providerMeta?.requestId || null,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
    }
  }
  const detail = String(lastError?.message || lastError)
    .replace("Оба сетевых транспорта Яндекс Директа недоступны:", "Сетевой транспорт Webmaster недоступен:")
    .replace("Яндекс Директ вернул не JSON", "Webmaster вернул не JSON");
  return {
    ok: false,
    sourceStatus: "source_unavailable",
    error: detail,
    attempts: webmasterRequestAttempts,
  };
}

export async function webmasterExactHostReport(
  env,
  targetHost = webmasterRosomahaRusHost,
  request = webmasterApiGet,
) {
  const token = env.YANDEX_WEBMASTER_TOKEN;
  const userId = env.YANDEX_WEBMASTER_USER_ID;
  const missing = [
    ["YANDEX_WEBMASTER_TOKEN", token],
    ["YANDEX_WEBMASTER_USER_ID", userId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const reason = "missing " + missing.join(", ");
    return {
      targetHost,
      sourceStatus: "source_unavailable",
      propertyAvailable: false,
      reason,
      inventory: { ok: false, sourceStatus: "source_unavailable", reason },
      endpoints: unavailableWebmasterEndpoints(reason),
    };
  }

  const userBase = "https://api.webmaster.yandex.net/v4/user/" + encodeURIComponent(userId);
  const inventory = await request(env, userBase + "/hosts/");
  if (!inventory.ok) {
    const reason = "webmaster_host_inventory_unavailable";
    return {
      targetHost,
      sourceStatus: "source_unavailable",
      propertyAvailable: false,
      reason,
      inventory,
      endpoints: unavailableWebmasterEndpoints(reason),
    };
  }

  const properties = Array.isArray(inventory.data?.hosts) ? inventory.data.hosts : [];
  const property = selectExactWebmasterProperty(properties, targetHost);
  if (!property) {
    const reason = "exact_host_property_not_available";
    return {
      targetHost,
      sourceStatus: "source_unavailable",
      propertyAvailable: false,
      reason,
      inventory: {
        ok: true,
        sourceStatus: "available",
        propertyCount: properties.length,
        exactMatchCount: 0,
        requestId: inventory.requestId || null,
      },
      endpoints: unavailableWebmasterEndpoints(reason),
    };
  }

  const hostId = String(property.host_id || "");
  if (!hostId) {
    const reason = "exact_host_property_has_no_host_id";
    return {
      targetHost,
      sourceStatus: "source_unavailable",
      propertyAvailable: false,
      reason,
      inventory: {
        ok: true,
        sourceStatus: "available",
        propertyCount: properties.length,
        exactMatchCount: 1,
        requestId: inventory.requestId || null,
      },
      endpoints: unavailableWebmasterEndpoints(reason),
    };
  }

  const hostBase = userBase + "/hosts/" + encodeURIComponent(hostId);
  const popularQueries = new URLSearchParams({
    order_by: "TOTAL_SHOWS",
    limit: "500",
  });
  for (const indicator of ["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION"]) {
    popularQueries.append("query_indicator", indicator);
  }
  const definitions = {
    summary: "/summary/",
    indexing: "/indexing/history/",
    excluded: "/excluded-urls/samples/",
    diagnostics: "/diagnostics/",
    sitemaps: "/sitemaps/",
    queries: "/search-queries/popular/?" + popularQueries.toString(),
  };
  const endpointEntries = await Promise.all(
    Object.entries(definitions).map(async ([name, endpoint]) => [
      name,
      await request(env, hostBase + endpoint),
    ]),
  );
  const endpoints = Object.fromEntries(endpointEntries);
  const availableEndpointCount = Object.values(endpoints).filter((result) => result.ok).length;
  return {
    targetHost,
    sourceStatus: availableEndpointCount === endpointEntries.length
      ? "available"
      : availableEndpointCount > 0
        ? "partial"
        : "source_unavailable",
    propertyAvailable: true,
    reason: null,
    property: {
      hostId,
      host: exactHostFromWebmasterProperty(property),
      verified: typeof property.verified === "boolean" ? property.verified : null,
      asciiHostUrl: property.ascii_host_url || null,
    },
    inventory: {
      ok: true,
      sourceStatus: "available",
      propertyCount: properties.length,
      exactMatchCount: 1,
      requestId: inventory.requestId || null,
    },
    endpoints,
  };
}

export function classifyGscOAuthFailure(error) {
  const detail = String(error?.message || error || "");
  const invalidGrant = detail.includes("invalid_grant") || /expired or revoked/iu.test(detail);
  return {
    ok: false,
    sourceStatus: "source_unavailable",
    reason: invalidGrant ? "invalid_grant" : "gsc_oauth_failed",
    detail,
  };
}

async function gscStatus(env) {
  const missing = ["GSC_CLIENT_ID", "GSC_REFRESH_TOKEN", "GSC_SITE_URL"].filter((key) => !env[key]);
  if (missing.length) {
    return {
      ok: false,
      sourceStatus: "source_unavailable",
      missing,
      reason: "missing_project_gsc_oauth_config",
    };
  }

  const siteUrl = env.GSC_SITE_URL;
  let accessToken;
  try {
    accessToken = await getAccessToken({
      clientId: env.GSC_CLIENT_ID,
      clientSecret: env.GSC_CLIENT_SECRET || "",
      refreshToken: env.GSC_REFRESH_TOKEN,
    });
  } catch (error) {
    return classifyGscOAuthFailure(error);
  }

  let sitesResult;
  try {
    sitesResult = await gscRequest(accessToken, "GET", "/webmasters/v3/sites");
  } catch (error) {
    return {
      ok: false,
      sourceStatus: "source_unavailable",
      reason: "gsc_sites_request_failed",
      detail: String(error?.message || error),
    };
  }

  const siteEntry = (sitesResult?.siteEntry || []).find((entry) => entry.siteUrl === siteUrl);
  if (!siteEntry) {
    return {
      ok: false,
      sourceStatus: "source_unavailable",
      reason: "token_valid_but_site_not_in_account",
      siteUrl,
    };
  }

  return {
    ok: true,
    sourceStatus: "available",
    siteUrl,
    permissionLevel: siteEntry.permissionLevel || null,
  };
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

function readinessCheck(id, label, passed, points, evidence, nextAction) {
  return {
    id,
    label,
    passed: Boolean(passed),
    pointsEarned: passed ? points : 0,
    pointsPossible: points,
    evidence,
    nextAction: passed ? null : nextAction,
  };
}

export function calculateReadiness(report) {
  const campaignItems = report.direct?.campaignsSnapshot?.ok
    ? report.direct.campaignsSnapshot.data?.Campaigns || []
    : [];
  const landingRows = report.direct?.accountLandingMap?.ok
    ? report.direct.accountLandingMap.campaigns || []
    : [];
  const exactDirectAccount = Boolean(
    report.direct?.accountScope?.exactLoginVerified
      && report.direct?.accountScope?.directClientVerified,
  );

  const objects = {};
  for (const expected of monitoredObjects) {
    const actual = (report.metrika?.counters || []).find((counter) => counter.name === expected.name);
    const counterDefinition = actual?.definition?.counter;
    const goalsDefinition = actual?.definition?.goals;
    const allRangesAvailable = Boolean(
      actual
        && [1, 7, 30].every((days) => actual.ranges?.some((range) => range.days === days && range.ok)),
    );
    const hardProofAvailable = Boolean(actual?.hardProof?.ok);
    const hardConversions30d = hardProofAvailable ? numberValue(actual.hardProof.hardGoals) : null;
    const exactLandingRows = landingRows.filter(
      (campaign) => normalizedHost(campaign.campaignHost) === normalizedHost(expected.site),
    );

    const checks = [
      readinessCheck(
        "counter_identity",
        "Счётчик доступен по API и принадлежит ровно этому домену",
        counterDefinition?.ok && counterDefinition.exactIdVerified && counterDefinition.exactSiteVerified,
        20,
        counterDefinition || { ok: false, error: actual?.definition?.counter?.error || "источник недоступен" },
        `Проверить API-доступ и привязку счётчика ${expected.id} только к ${expected.site}.`,
      ),
      readinessCheck(
        "hard_goal_definition",
        "Hard goal существует и соответствует ожидаемому action-событию",
        goalsDefinition?.ok && goalsDefinition.hardGoalVerified,
        20,
        goalsDefinition?.hardGoal || { ok: false, error: goalsDefinition?.error || "hard goal не найден" },
        `Восстановить точную hard goal ${expected.hardGoalId}; мягкую цель заявкой не считать.`,
      ),
      readinessCheck(
        "statistics_windows",
        "Статистика hard goal доступна раздельно за 1, 7 и 30 дней",
        allRangesAvailable,
        20,
        (actual?.ranges || []).map((range) => ({ days: range.days, ok: range.ok, error: range.error || null })),
        `Восстановить read-only статистику Метрики ${expected.id}; показатели других доменов не подставлять.`,
      ),
      readinessCheck(
        "natural_hard_conversion",
        "За 30 дней подтверждена хотя бы одна фактическая hard conversion",
        hardProofAvailable && hardConversions30d > 0,
        10,
        { source: "Metrika all traffic", available: hardProofAvailable, hardConversions30d },
        `Дождаться реальной несинтетической ${expected.hardGoalId}; soft goal и conversions Direct не являются заявками.`,
      ),
      readinessCheck(
        "direct_account_isolation",
        "Direct подтверждён как точный клиент rosomaha-rus999",
        exactDirectAccount,
        10,
        {
          exactLoginVerified: Boolean(report.direct?.accountScope?.exactLoginVerified),
          directClientVerified: Boolean(report.direct?.accountScope?.directClientVerified),
        },
        "Восстановить API-доступ только в изолированном контуре rosomaha-rus999.",
      ),
    ];

    if (expected.directCampaignId) {
      const campaign = campaignItems.find((item) => String(item.Id) === expected.directCampaignId) || null;
      const counterIds = (campaign?.UnifiedCampaign?.CounterIds?.Items || []).map(String);
      const priorityGoals = campaign?.UnifiedCampaign?.PriorityGoals?.Items || [];
      const priorityGoal = priorityGoals.find((goal) => String(goal.GoalId) === expected.hardGoalId) || null;
      checks.push(
        readinessCheck(
          "target_campaign",
          `Целевая кампания ${expected.directCampaignId} видна read-only API`,
          Boolean(campaign),
          5,
          campaign
            ? { id: String(campaign.Id), type: campaign.Type, state: campaign.State, status: campaign.Status }
            : { ok: false, error: "кампания не возвращена API" },
          `Проверить существование кампании ${expected.directCampaignId}, не затрагивая защищённые кампании.`,
        ),
        readinessCheck(
          "target_counter_binding",
          `Кампания ${expected.directCampaignId} привязана к счётчику ${expected.id}`,
          counterIds.includes(expected.id),
          5,
          { counterIds },
          `Привязать только счётчик ${expected.id} к кампании ${expected.directCampaignId} отдельным безопасным изменением.`,
        ),
        readinessCheck(
          "hard_priority_goal",
          `Hard goal ${expected.hardGoalId} назначена приоритетной целью кампании`,
          Boolean(priorityGoal && numberValue(priorityGoal.Value) > 0),
          10,
          priorityGoal
            ? { goalId: String(priorityGoal.GoalId), positiveBusinessValue: numberValue(priorityGoal.Value) > 0 }
            : { ok: false, error: "приоритетная hard goal не найдена" },
          "Получить доказанную бизнес-ценность CRM-заявки и только затем назначить hard goal приоритетной; значение не выдумывать.",
        ),
      );
    } else {
      checks.push(readinessCheck(
        "direct_landing_domain",
        "Direct подтверждает кампанию с посадочной ровно этого домена",
        exactLandingRows.length > 0,
        20,
        {
          sourceAvailable: Boolean(report.direct?.accountLandingMap?.ok),
          campaignIds: exactLandingRows.map((campaign) => String(campaign.campaignId)),
        },
        `Проверить посадочные Direct для ${expected.site}; не переносить кампании и показатели другого домена.`,
      ));
    }

    const score = checks.reduce((sum, check) => sum + check.pointsEarned, 0);
    objects[expected.name] = {
      site: expected.site,
      counterId: expected.id,
      hardGoalId: expected.hardGoalId,
      softGoalId: expected.softGoalId,
      score,
      scale: 100,
      status: score === 100 ? "verified_100" : score >= 90 ? "high_but_not_100" : "needs_improvement",
      hardConversions30d,
      checks,
      nextActions: checks.filter((check) => !check.passed).map((check) => check.nextAction),
      classification: {
        hardGoal: "confirmed_lead_only",
        softGoal: expected.softGoalId ? "soft_signal_not_lead" : "not_configured",
        directConversions: "ad_platform_signal_not_lead",
      },
    };
  }

  const objectScores = Object.values(objects).map((object) => object.score);
  return {
    scale: 100,
    scope: "measurement_and_attribution_evidence",
    launchAuthorization: false,
    overallScore: objectScores.length
      ? Math.round(objectScores.reduce((sum, score) => sum + score, 0) / objectScores.length)
      : 0,
    aggregation: "Среднее только для сводки; решения, показатели и доказательства остаются раздельными по доменам.",
    objects,
  };
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
    "- Яндекс Директ: полный список поддерживаемых API типов кампаний через `campaigns.get v501` без заранее заданных ID; их текущие объявления через `Ads.get`; изменения с 2025-01-01 через `Changes.checkCampaigns`/`Changes.check`; все исторически показывавшиеся кампании и посадочные через Reports API `CampaignUrlPath`.",
    "- Метрика: три раздельных объекта — xn--80aa8ahaki9a.site (107139619 / hard 517600157), rosomaha.site (105918356 / hard 496461698), rosomaha-rus.ru (111905412 / hard 601477348 / soft 601477497).",
    "- Заявками считаются только hard goals. Soft goals и conversions Direct сохраняются как диагностические сигналы и заявками не называются.",
    `- Direct: кампания ${targetRosomahaRusCampaignId} наблюдается только чтением; мутации ${protectedCampaignIds.join(", ")} запрещены.`,
    "- Публичный HTTP rosomaha-rus.ru: HTTPS root, HTTP→HTTPS, robots.txt, sitemap.xml и точный ключевой https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812 со status, redirect chain, final host, canonical и robots/sitemap-признаками.",
    "- Yandex Webmaster: основной host xn--80aa8ahaki9a.site остаётся отдельным; rosomaha-rus.ru собирается только после точного совпадения в inventory hosts, иначе source_unavailable без подстановки данных основного домена.",
    "- Google Search Console: live OAuth probe без браузера; если токен недействителен, источник помечается недоступным.",
    "",
    "## Свежие цифры Direct",
    "",
  ];

  lines.push("## Контур рекламодателя Direct");
  lines.push("");
  const scope = report.direct.accountScope;
  if (scope.ok) {
    lines.push(`- Владелец токена: ${scope.tokenOwner.login}; ClientId=${scope.tokenOwner.clientId}; Type=${scope.tokenOwner.type}; Archived=${scope.tokenOwner.archived}.`);
    lines.push(`- Доступные API-типы кампаний: ${scope.tokenOwner.availableCampaignTypes.join(", ") || "не возвращены"}.`);
    if (scope.agencyAccess.ok) {
      lines.push(`- AgencyClients.get доступен: клиентов ${scope.agencyAccess.clientCount}; этот отчёт не переносит показатели между ними.`);
    } else {
      lines.push(`- AgencyClients.get недоступен: error_code=${scope.agencyAccess.errorCode || "n/a"}; токен не даёт агентского списка клиентов.`);
    }
    lines.push(`- Изоляция точного логина: ${scope.exactLoginVerified ? "PASS" : "FAIL"}; прямой рекламодатель Type=CLIENT: ${scope.directClientVerified ? "PASS" : "не подтверждено"}.`);
    lines.push(`- Скрипт ничего не менял: mutations=${scope.scriptMutations}.`);
  } else {
    lines.push(`- Контур аккаунта не подтверждён: ${errorText(scope.ownerError)}.`);
  }
  lines.push("");

  lines.push("## Пакетные стратегии и счётчик rosomaha-rus.ru");
  lines.push("");
  const strategies = report.direct.packageStrategies;
  if (strategies.ok) {
    lines.push(`- Strategies.get: пакетных стратегий ${strategies.strategyCount}; со счётчиком ${strategies.targetCounterId} найдено ${strategies.bitrixStrategyCount}.`);
    for (const strategy of strategies.bitrixStrategies) {
      lines.push(`- StrategyId=${strategy.id}; тип=${strategy.type}; архив=${strategy.statusArchived}; цели=${strategy.priorityGoalIds.join(", ") || "не возвращены"}; название=${strategy.name || "не возвращено"}.`);
    }
    if (!strategies.bitrixStrategyCount) {
      lines.push(`- Счётчик ${strategies.targetCounterId} не найден ни в одной доступной пакетной стратегии Direct.`);
    }
    lines.push(`- Скрипт ничего не менял: mutations=${strategies.scriptMutations}.`);
    lines.push("- Ограничение: пакетная стратегия не является доказательством кампании, посадочной или фактических показов; непакетные стратегии этим методом не охватываются.");
  } else {
    lines.push(`- Источник недоступен: ${errorText(strategies.error)}.`);
  }
  lines.push("");

  lines.push("## Доступ Direct к целям Метрики rosomaha-rus.ru");
  lines.push("");
  const directGoals = report.direct.accessibleMetrikaGoals;
  if (directGoals.ok) {
    lines.push(`- Live 4 ${directGoals.method}: доступно целей/сегментов ${directGoals.accessibleGoalCount}; для rosomaha-rus.ru найдено ${directGoals.bitrixGoalCount}.`);
    if (directGoals.bitrixGoals.length) {
      for (const goal of directGoals.bitrixGoals) {
        lines.push(`- GoalID=${goal.goalId}; домен=${goal.goalDomain}; тип=${goal.type}; название=${goal.name || "не возвращено"}.`);
      }
    } else {
      lines.push("- В доступном Direct-контуре нет цели с GoalDomain rosomaha-rus.ru; переносить цели других доменов запрещено.");
    }
    lines.push(`- Скрипт ничего не менял: mutations=${directGoals.scriptMutations}.`);
    lines.push("- Ограничение: этот список доказывает только видимость целей для клиента Direct; он не доказывает владельца счётчика и не связывает цель с конкретной кампанией.");
  } else {
    lines.push(`- Источник недоступен: ${errorText(directGoals.error)}.`);
  }
  lines.push("");

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

  lines.push("## API-инвентаризация поддерживаемых типов кампаний");
  lines.push("");
  const changes = report.direct.changesInventory;
  if (changes.ok) {
    lines.push(`- Полный \`campaigns.get\` без фильтра ID: ${changes.campaignIds.length ? changes.campaignIds.join(", ") : "кампании поддерживаемых типов не найдены"}.`);
    lines.push(`- Изменившиеся с ${changes.since}: ${changes.changedCampaignIds.length ? changes.changedCampaignIds.join(", ") : "не найдены"}.`);
    lines.push(`- Текущие объявления поддерживаемых типов: ${changes.adCount}; группы: ${changes.adGroupCount}; форматы: ${changes.adTypes.length ? changes.adTypes.join(", ") : "нет"}.`);
    lines.push(`- Покрытие URL объявлений: ${changes.adCount - changes.adsWithoutUrlCount}/${changes.adCount}.`);
    lines.push(`- Хосты объявлений: ${changes.adHosts.length ? changes.adHosts.join(", ") : "не получены"}.`);
    lines.push(`- Хосты быстрых ссылок: ${changes.sitelinkHosts.length ? changes.sitelinkHosts.join(", ") : "не получены"}.`);
    if (changes.matchingRosomahaRusCampaignIds.length) {
      lines.push(`- rosomaha-rus.ru: найдены кампании ${changes.matchingRosomahaRusCampaignIds.join(", ")}.`);
    } else if (changes.adsWithoutUrlCount === 0) {
      lines.push("- rosomaha-rus.ru: не найден среди текущих объявлений и быстрых ссылок кампаний поддерживаемых API типов.");
    } else {
      lines.push(`- rosomaha-rus.ru: не найден среди объявлений с доступным URL, но у ${changes.adsWithoutUrlCount} объявлений URL не получен; отрицательный вывод неполный.`);
    }
    lines.push(`- Скрипт ничего не менял: mutations=${changes.scriptMutations}. Браузер не использован.`);
    lines.push("- Ограничение: объекты Мастера кампаний, которые не поддерживает `campaigns.get`, могут отсутствовать и остаются неподтверждёнными без отдельной UI-проверки; `Changes` отдельно ограничен указанной датой.");
  } else {
    lines.push(`- Источник недоступен: ${errorText(changes.error)}.`);
  }
  lines.push("");

  lines.push("## Метрика: hard goals");
  lines.push("");
  for (const counter of report.metrika.counters) {
    lines.push(`### ${counter.site} — счётчик ${counter.id}, hard goal ${counter.hardGoalId}`);
    const definition = counter.definition || {};
    if (definition.counter?.ok) {
      lines.push(`- API-счётчик: ID=${definition.counter.id}; домен=${definition.counter.site}; точное совпадение=${definition.counter.exactIdVerified && definition.counter.exactSiteVerified ? "PASS" : "FAIL"}.`);
    } else {
      lines.push(`- API-счётчик: источник недоступен (${errorText(definition.counter?.error || "нет ответа")}); показатели других доменов не подставлены.`);
    }
    if (definition.goals?.hardGoalVerified) {
      lines.push(`- Hard goal: PASS; ID=${definition.goals.hardGoal.id}; тип=${definition.goals.hardGoal.type}; action=${definition.goals.hardGoal.actionEvents.join(", ") || "API не вернул имя события"}.`);
    } else {
      lines.push(`- Hard goal: FAIL/недоступна; ${errorText(definition.goals?.error || "точное определение не подтверждено")}.`);
    }
    if (counter.softGoalId) {
      lines.push(`- Soft goal ${counter.softGoalId}: ${definition.goals?.softGoal ? "найдена" : "не найдена/недоступна"}; это только мягкий сигнал, не заявка.`);
    }
    for (const range of counter.ranges) {
      if (!range.ok) {
        lines.push(`- ${range.days}д: ошибка ${range.error}`);
      } else {
        lines.push(`- ${range.days}д ${range.date1}..${range.date2}: ${range.visits} визитов yandex/cpc, hard goals ${range.hardGoals}`);
      }
    }
    if (counter.hardProof?.ok) {
      lines.push(`- Все источники, 30д ${counter.hardProof.date1}..${counter.hardProof.date2}: hard goals ${counter.hardProof.hardGoals}. Это единственный конверсионный показатель, используемый в readiness.`);
    } else {
      lines.push(`- Все источники, 30д: источник hard goal недоступен (${errorText(counter.hardProof?.error || "нет ответа")}).`);
    }
    lines.push("");
  }

  const publicEvidence = report.publicHttp?.bitrix;
  lines.push("## Публичный HTTP: rosomaha-rus.ru");
  lines.push("");
  if (!publicEvidence || publicEvidence.sourceStatus === "source_unavailable") {
    lines.push("- Источник недоступен; прошлые HTTP-результаты не подставлены.");
  } else {
    const publicLabels = {
      httpRoot: "HTTP root",
      root: "HTTPS root",
      robots: "robots.txt",
      sitemap: "sitemap.xml",
      keyProduct: "ключевой https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
    };
    for (const target of rosomahaRusPublicTargets) {
      const evidence = publicEvidence.targets?.[target.id];
      if (!evidence || evidence.sourceStatus === "source_unavailable") {
        lines.push("- " + publicLabels[target.id] + ": source_unavailable"
          + (evidence?.error ? "; " + evidence.error : "") + ".");
        continue;
      }
      const redirectChain = evidence.redirects?.length
        ? evidence.redirects.map((item) => item.status + " " + item.from + " → " + item.to).join(" | ")
        : "нет";
      lines.push("- " + publicLabels[target.id] + ": status=" + evidence.status
        + "; redirects=" + redirectChain
        + "; final=" + evidence.finalUrl
        + "; final host=" + evidence.finalHost
        + "; exact host=" + (evidence.exactFinalHost ? "PASS" : "FAIL") + ".");
      if (evidence.html) {
        lines.push("  - canonical=" + (evidence.html.canonical || "не найден")
          + "; self-canonical=" + (evidence.html.canonicalMatchesFinal ? "PASS" : "FAIL")
          + "; meta/header noindex=" + (evidence.html.metaNoindex || evidence.headerNoindex ? "да" : "нет") + ".");
      }
      if (evidence.robots) {
        lines.push("  - User-agent=" + (evidence.robots.userAgentPresent ? "найден" : "не найден")
          + "; Disallow / для *=" + (evidence.robots.disallowAll ? "да" : "нет")
          + "; Sitemap=" + (evidence.robots.sitemapUrls.join(", ") || "не указан") + ".");
      }
      if (evidence.sitemap) {
        lines.push("  - тип=" + evidence.sitemap.type
          + "; loc=" + evidence.sitemap.locCount
          + "; хосты=" + (evidence.sitemap.locationHosts.join(", ") || "не извлечены")
          + "; ключевой URL в этом файле=" + (evidence.sitemap.keyProductListed ? "да" : "не доказан") + ".");
      }
    }
    lines.push("- Автоматические проверки: HTTPS root 200=" + (publicEvidence.checks.httpsRoot200 ? "PASS" : "FAIL")
      + "; HTTP→HTTPS=" + (publicEvidence.checks.httpRootRedirectsToHttps ? "PASS" : "FAIL")
      + "; robots открыт=" + (publicEvidence.checks.robots200AndOpen ? "PASS" : "FAIL")
      + "; sitemap XML=" + (publicEvidence.checks.sitemap200AndXml ? "PASS" : "FAIL")
      + "; ключевой URL 200/self-canonical/indexable="
      + (publicEvidence.checks.keyProduct200SelfCanonical ? "PASS" : "FAIL") + ".");
  }
  lines.push("");

  const w = report.webmaster;
  lines.push("## SEO / Webmaster: xn--80aa8ahaki9a.site");
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

  lines.push("", "## SEO / Webmaster: rosomaha-rus.ru");
  const bitrixWebmaster = report.webmasterByDomain?.bitrix;
  const bitrixEndpointLabels = {
    summary: "Summary",
    indexing: "Indexing",
    excluded: "Excluded URLs",
    diagnostics: "Diagnostics",
    sitemaps: "Sitemaps",
    queries: "Popular queries",
  };
  if (!bitrixWebmaster?.propertyAvailable) {
    lines.push("- Inventory: "
      + (bitrixWebmaster?.inventory?.sourceStatus || "source_unavailable")
      + "; " + (bitrixWebmaster?.inventory?.error || bitrixWebmaster?.reason || "нет ответа") + ".");
    lines.push("- Property: source_unavailable; точное свойство rosomaha-rus.ru не подтверждено ("
      + (bitrixWebmaster?.reason || "нет ответа inventory") + ").");
    lines.push("- SourceStatus: " + (bitrixWebmaster?.sourceStatus || "source_unavailable") + ".");
    for (const [name, label] of Object.entries(bitrixEndpointLabels)) {
      const endpoint = bitrixWebmaster?.endpoints?.[name];
      lines.push("- " + label + ": source_unavailable; "
        + errorText(endpoint?.error || endpoint?.reason || bitrixWebmaster?.reason || "нет ответа") + ".");
    }
    lines.push("- Данные xn--80aa8ahaki9a.site не подставлялись и не используются как данные rosomaha-rus.ru.");
  } else {
    lines.push("- Inventory: " + bitrixWebmaster.inventory.sourceStatus
      + "; properties=" + bitrixWebmaster.inventory.propertyCount
      + "; exact matches=" + bitrixWebmaster.inventory.exactMatchCount + ".");
    lines.push("- SourceStatus: " + bitrixWebmaster.sourceStatus + ".");
    lines.push("- Точное свойство: host=" + bitrixWebmaster.property.host
      + "; host_id=" + bitrixWebmaster.property.hostId
      + "; verified=" + (bitrixWebmaster.property.verified ?? "API не вернуло")
      + ".");
    const bitrixEndpoints = bitrixWebmaster.endpoints || {};
    if (bitrixEndpoints.summary?.ok) {
      lines.push("- Summary: searchable="
        + (bitrixEndpoints.summary.data?.searchable_pages_count ?? "n/a")
        + "; excluded=" + (bitrixEndpoints.summary.data?.excluded_pages_count ?? "n/a")
        + "; SQI=" + (bitrixEndpoints.summary.data?.sqi ?? "n/a") + ".");
    } else {
      lines.push("- Summary: source_unavailable; "
        + errorText(bitrixEndpoints.summary?.error || bitrixEndpoints.summary?.reason || "нет ответа") + ".");
    }
    if (bitrixEndpoints.indexing?.ok) {
      const latestIndicators = Object.entries(bitrixEndpoints.indexing.data?.indicators || {})
        .map(([name, samples]) => {
          const latest = Array.isArray(samples) ? samples.at(-1) : null;
          return name + "=" + (latest?.value ?? "n/a");
        });
      lines.push("- Indexing: " + (latestIndicators.join(", ") || "API доступно, индикаторы не возвращены") + ".");
    } else {
      lines.push("- Indexing: source_unavailable; "
        + errorText(bitrixEndpoints.indexing?.error || bitrixEndpoints.indexing?.reason || "нет ответа") + ".");
    }
    if (bitrixEndpoints.excluded?.ok) {
      lines.push("- Excluded URLs: samples="
        + (bitrixEndpoints.excluded.data?.samples?.length
          ?? bitrixEndpoints.excluded.data?.count
          ?? 0) + ".");
    } else {
      lines.push("- Excluded URLs: source_unavailable; "
        + errorText(bitrixEndpoints.excluded?.error || bitrixEndpoints.excluded?.reason || "нет ответа") + ".");
    }
    if (bitrixEndpoints.diagnostics?.ok) {
      const present = Object.entries(bitrixEndpoints.diagnostics.data?.problems || {})
        .filter(([, value]) => value.state === "PRESENT")
        .map(([code]) => code);
      lines.push("- Diagnostics: " + (present.join(", ") || "активных проблем нет") + ".");
    } else {
      lines.push("- Diagnostics: source_unavailable; "
        + errorText(bitrixEndpoints.diagnostics?.error || bitrixEndpoints.diagnostics?.reason || "нет ответа") + ".");
    }
    if (bitrixEndpoints.sitemaps?.ok) {
      const sitemaps = bitrixEndpoints.sitemaps.data?.sitemaps || [];
      lines.push("- Sitemaps: " + sitemaps.length + "; errors total="
        + sitemaps.reduce((sum, item) => sum + Number(item.errors_count || 0), 0) + ".");
    } else {
      lines.push("- Sitemaps: source_unavailable; "
        + errorText(bitrixEndpoints.sitemaps?.error || bitrixEndpoints.sitemaps?.reason || "нет ответа") + ".");
    }
    if (bitrixEndpoints.queries?.ok) {
      lines.push("- Popular queries: "
        + (bitrixEndpoints.queries.data?.count
          ?? bitrixEndpoints.queries.data?.queries?.length
          ?? 0) + " строк.");
    } else {
      lines.push("- Popular queries: source_unavailable; "
        + errorText(bitrixEndpoints.queries?.error || bitrixEndpoints.queries?.reason || "нет ответа") + ".");
    }
  }

  lines.push("", "## GSC API");
  if (report.gsc.ok) {
    lines.push(`- Live OAuth доступ подтвержден для ${report.gsc.siteUrl}; permission=${report.gsc.permissionLevel || "unknown"}.`);
  } else {
    const missingText = (report.gsc.missing || []).length ? `; missing=${report.gsc.missing.join(", ")}` : "";
    const detailText = report.gsc.detail ? `; detail=${report.gsc.detail}` : "";
    const siteText = report.gsc.siteUrl ? `; site=${report.gsc.siteUrl}` : "";
    lines.push(`- Нельзя подтверждать Google clicks/impressions/positions: ${report.gsc.reason}${missingText}${detailText}${siteText}`);
  }

  lines.push(
    "",
    "## Спор ролей",
    "",
    `- Директолог: ${targetRosomahaRusCampaignId} наблюдается отдельно и только чтением; ${protectedCampaignIds.join(", ")} этим аудитом не меняются и не запускаются.`,
    "- Аналитик Метрики/CRM: заявкой считаются только 517600157, 496461698 и 601477348 строго в своих доменах; soft goals и Direct conversions заявками не являются.",
    "- SEO/Webmaster-аудитор: xn--80aa8ahaki9a.site, rosomaha.site и rosomaha-rus.ru — три разных объекта; показатели, индексация и конверсионные выводы не объединяются.",
    "- Маркетолог-стратег: главный следующий шаг не бюджет, а связка spend -> hard goal -> CRM unique lead.",
    "- Критик рисков: GSC нельзя объявлять рабочим, пока project-specific refresh token не обновлён после invalid_grant; это контур доступа, а не рыночный ноль.",
    "",
    "## Evidence-based readiness по 100-балльной шкале",
    "",
  );

  for (const object of monitoredObjects) {
    const readiness = report.readiness.objects[object.name];
    lines.push(`### ${readiness.site}: ${readiness.score}/100`);
    lines.push(`- Hard goal: ${readiness.hardGoalId}; hard conversions за 30 дней: ${readiness.hardConversions30d ?? "источник недоступен"}.`);
    if (readiness.softGoalId) lines.push(`- Soft goal ${readiness.softGoalId}: только сигнал, не заявка и не баллы readiness.`);
    for (const check of readiness.checks) {
      lines.push(`- ${check.passed ? "PASS" : "FAIL"} ${check.pointsEarned}/${check.pointsPossible}: ${check.label}.`);
    }
    if (readiness.nextActions.length) {
      lines.push(`- Следующий безопасный шаг: ${readiness.nextActions[0]}`);
    }
    lines.push("");
  }
  lines.push(`Сводная арифметическая оценка: ${report.readiness.overallScore}/100. ${report.readiness.aggregation}`);
  lines.push("Оценка проверяет измерение и атрибуцию; она не разрешает запуск, не подтверждает собственные деньги и никогда не разрешает овердрафт.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export async function runAudit() {
  const env = parseEnvFile(envPath);
  const configuredDirectLogin = directLoginForEnv(env);
  if (configuredDirectLogin !== directLoginDefault) {
    throw new Error(`Yandex account isolation mismatch: expected ${directLoginDefault}, got ${configuredDirectLogin}`);
  }
  const policy = {
    apiOnly: true,
    browserAllowed: false,
    directLogin: configuredDirectLogin,
    readOnly: true,
    overdraftUseAllowed: false,
    launchAuthorizedByAudit: false,
    protectedCampaignIds,
    monitoredCampaignIds: campaigns,
    targetRosomahaRusCampaignId,
    domainMetricsSeparated: true,
    catalog: "https://xn--80aa8ahaki9a.site/",
    quiz: "https://rosomaha.site/",
    bitrix: "https://rosomaha-rus.ru/",
  };

  const campaignsSnapshot = directJsonRequest(env, "campaigns", "get", {
    SelectionCriteria: { Ids: campaigns.map(Number) },
    FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate"],
    TextCampaignFieldNames: ["BiddingStrategy", "Settings", "CounterIds"],
    UnifiedCampaignFieldNames: ["CounterIds", "PriorityGoals"],
  });
  const accountScope = await directAccountScope(env);
  const packageStrategies = await directPackageStrategies(env, accountScope);
  const accessibleMetrikaGoals = await directAccessibleMetrikaGoals(env, accountScope);

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
  const changesInventory = directChangesInventory(env);
  const metrika = {
    counters: counters.map((counter) => {
      const proofRange = rangeForDays(30);
      const proofResult = metrikaRequest(env, {
        ids: counter.id,
        date1: proofRange.date1,
        date2: proofRange.date2,
        metrics: `ym:s:visits,ym:s:goal${counter.hardGoalId}reaches`,
        accuracy: "full",
        limit: 1,
      });
      const proofRows = proofResult.ok ? summarizeMetrikaRows(proofResult.data) : [];
      return {
        ...counter,
        definition: metrikaCounterDefinition(env, counter),
        hardProof: {
          ...proofRange,
          scope: "all_traffic",
          ok: proofResult.ok,
          error: proofResult.error || null,
          visits: proofRows.reduce((sum, row) => sum + row.visits, 0),
          hardGoals: proofRows.reduce((sum, row) => sum + row.hardGoals, 0),
        },
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
            scope: "yandex_cpc",
            ok: result.ok,
            error: result.error || null,
            visits: rows.reduce((sum, row) => sum + row.visits, 0),
            hardGoals: rows.reduce((sum, row) => sum + row.hardGoals, 0),
            rows,
          };
        }),
      };
    }),
  };

  const webmaster = {
    targetHost: webmasterMainHost,
    hostId: env.YANDEX_WEBMASTER_HOST_ID || null,
    summary: webmasterRequest(env, "/summary/"),
    diagnostics: webmasterRequest(env, "/diagnostics/"),
    sitemaps: webmasterRequest(env, "/sitemaps/"),
    queries: webmasterRequest(
      env,
      "/search-queries/popular/?order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&query_indicator=AVG_CLICK_POSITION&limit=500",
    ),
  };
  webmaster.sourceStatus = Object.values(webmaster)
    .filter((value) => value && typeof value === "object" && Object.hasOwn(value, "ok"))
    .every((value) => value.ok)
    ? "available"
    : "partial";

  const [rosomahaRusPublicHttp, rosomahaRusWebmaster, gsc] = await Promise.all([
    auditRosomahaRusPublicHttp(),
    webmasterExactHostReport(env),
    gscStatus(env),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    policy,
    direct: {
      accountScope,
      packageStrategies,
      accessibleMetrikaGoals,
      campaignsSnapshot,
      ranges: directRanges,
      accountLandingMap: {
        ok: accountLandingResult.ok,
        error: accountLandingResult.error || null,
        campaigns: accountLandingCampaigns,
        matchesRosomahaRus: accountLandingCampaigns.filter((campaign) => bitrixHosts.has(campaign.campaignHost)),
      },
      changesInventory,
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
                classification: "ad_platform_signal_not_lead",
              }))
              .sort((a, b) => b.cost - a.cost)
              .slice(0, 100)
          : [],
      },
    },
    metrika,
    webmaster,
    webmasterByDomain: {
      catalog: webmaster,
      bitrix: rosomahaRusWebmaster,
    },
    publicHttp: {
      bitrix: rosomahaRusPublicHttp,
    },
    gsc,
  };
  report.readiness = calculateReadiness(report);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(jsonDir, { recursive: true });
  const jsonPath = path.join(jsonDir, `ROSOMAHA_API_ONLY_AUDIT_${stamp}.json`);
  const mdPath = path.join(outDir, `ROSOMAHA_API_ONLY_MARKETING_AUDIT_${new Date().toISOString().slice(0, 10)}_API_FIXED.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(report), "utf8");

  console.log(mdPath);
  console.log(jsonPath);
  return { report, mdPath, jsonPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runAudit().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
