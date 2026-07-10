import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || 708505950);
const accountSlug = "rosomaha-yandex";
const lockPath = path.join("G:\\mvp\\browser-locks", `${accountSlug}.lock`);
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const mutationUnlock = "I_UNDERSTAND_THIS_CHANGES_LIVE_DIRECT";

const additions = [
  "аренда",
  "прокат",
  "озон",
  "форум",
  "отзывы",
  "обзор",
  "видео",
  "фото",
  "мтлб",
  "гтт",
  "зырянин",
  "супертягач",
  "шерп",
  "бурлак",
  "байкал",
  "арго",
  "асгард",
  "атлант",
  "terex",
  "visuva",
  "гусеницах",
  "гусеницы",
  "гусеничный",
  "самодельный",
  "самоделка",
  "чертежи",
];

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

function assertMutationsAllowed() {
  if (process.env.YANDEX_DIRECT_MUTATIONS !== mutationUnlock) {
    throw new Error(`Blocked. Set YANDEX_DIRECT_MUTATIONS=${mutationUnlock} only after explicit owner approval.`);
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    throw new Error(`Yandex account lock exists: ${lockPath}`);
  }
  fs.writeFileSync(lockPath, `${JSON.stringify({
    accountSlug,
    project: "rosomaha",
    action: "adgroups.update negative keywords",
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
}

function releaseLock() {
  if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
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

function uniqueSorted(items) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ru"));
}

async function main() {
  assertMutationsAllowed();
  preflightDirectApi();
  acquireLock();

  try {
    const token = readToken();
    const adGroups = await directRequest("adgroups", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type", "NegativeKeywords"],
      Page: { Limit: 10000 },
    }, token);

    const before = adGroups.AdGroups.map((group) => ({
      id: group.Id,
      name: group.Name,
      negativeKeywords: group.NegativeKeywords?.Items || [],
    }));

    const updates = before.map((group) => ({
      Id: group.id,
      NegativeKeywords: { Items: uniqueSorted([...group.negativeKeywords, ...additions]) },
    }));

    const result = await directRequest("adgroups", "update", { AdGroups: updates }, token);

    const afterAdGroups = await directRequest("adgroups", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type", "NegativeKeywords"],
      Page: { Limit: 10000 },
    }, token);

    const after = afterAdGroups.AdGroups.map((group) => ({
      id: group.Id,
      name: group.Name,
      negativeKeywords: group.NegativeKeywords?.Items || [],
    }));

    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(outDir, `YANDEX_DIRECT_NEGATIVE_KEYWORDS_UPDATE_${campaignId}_${stamp}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      login,
      campaignId,
      additions,
      before,
      result,
      after,
    }, null, 2)}\n`, "utf8");
    process.stdout.write(`${filePath}\n`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  try {
    releaseLock();
  } catch {
    // best effort cleanup
  }
  console.error(error.message);
  process.exit(1);
});
