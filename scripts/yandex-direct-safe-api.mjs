import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const utf8Decoder = new TextDecoder("utf-8");
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || 708505950);
const secretsDir = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets");
const tokenEnvPath = path.join(secretsDir, "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");
const mutationUnlock = "I_UNDERSTAND_THIS_CHANGES_LIVE_DIRECT";

function preflightDirectApi() {
  try {
    execFileSync(
      "curl.exe",
      ["-s", "-I", "-L", "--connect-timeout", "5", "https://api.direct.yandex.com/json/v5/campaigns"],
      { stdio: "ignore" },
    );
  } catch (curlError) {
    const exitCode = curlError && typeof curlError === "object" && "status" in curlError ? curlError.status : "unknown";
    throw new Error(
      `Direct API network preflight failed (curl exit ${exitCode}). Check VPN/proxy/firewall and that api.direct.yandex.com:443 is reachable.`,
    );
  }
}

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = line.slice(separatorIndex + 1).trim();
  }

  return env;
}

function readToken() {
  if (process.env.YANDEX_OAUTH_TOKEN) return process.env.YANDEX_OAUTH_TOKEN.trim();
  const tokenEnv = parseEnvFile(tokenEnvPath);
  if (tokenEnv.YANDEX_OAUTH_TOKEN) return tokenEnv.YANDEX_OAUTH_TOKEN;
  const seoEnv = parseEnvFile(seoEnvPath);
  if (seoEnv.YANDEX_OAUTH_TOKEN) return seoEnv.YANDEX_OAUTH_TOKEN;
  throw new Error(`Missing YANDEX_OAUTH_TOKEN in ${tokenEnvPath} or ${seoEnvPath}`);
}

async function directRequest(service, method, params, token) {
  const url = `https://api.direct.yandex.com/json/v5/${service}`;
  const body = JSON.stringify({ method, params });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Client-Login": login,
    "Content-Type": "application/json; charset=utf-8",
  };

  try {
    const response = await fetch(url, { method: "POST", headers, body });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const json = JSON.parse(text);
    if (json.error) throw new Error(json.error.error_detail || json.error.error_string || JSON.stringify(json.error));
    return json.result;
  } catch (error) {
    const curlHeaders = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);

    let stdout;
    try {
      stdout = execFileSync(
        "curl.exe",
        ["-s", "-L", "-X", "POST", ...curlHeaders, "--data-binary", body, url],
        { encoding: "buffer" },
      );
    } catch (curlError) {
      // Never leak credentials into thrown messages (execFileSync errors include full argv).
      const exitCode = curlError && typeof curlError === "object" && "status" in curlError ? curlError.status : "unknown";
      throw new Error(`Direct API request failed for ${service}.${method} (curl exit ${exitCode})`);
    }

    if (!stdout?.length) throw new Error(`Direct API request failed for ${service}.${method} (empty response)`);
    const json = JSON.parse(utf8Decoder.decode(stdout));
    if (json.error) throw new Error(json.error.error_detail || json.error.error_string || JSON.stringify(json.error));
    return json.result;
  }
}

function assertMutationsAllowed(action) {
  if (process.env.YANDEX_DIRECT_MUTATIONS !== mutationUnlock) {
    throw new Error(
      `${action} is blocked. Set YANDEX_DIRECT_MUTATIONS=${mutationUnlock} only after explicit owner approval.`,
    );
  }
}

async function snapshot(token) {
  const [campaigns, adGroups] = await Promise.all([
    directRequest("campaigns", "get", {
      SelectionCriteria: { Ids: [campaignId] },
      FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate"],
      TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
    }, token),
    directRequest("adgroups", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type"],
      Page: { Limit: 10000 },
    }, token),
  ]);

  return { campaigns, adGroups };
}

async function suspendCampaign(token) {
  assertMutationsAllowed("campaigns.suspend");
  return directRequest("campaigns", "suspend", {
    SelectionCriteria: { Ids: [campaignId] },
  }, token);
}

async function resumeCampaign(token) {
  assertMutationsAllowed("campaigns.resume");
  return directRequest("campaigns", "resume", {
    SelectionCriteria: { Ids: [campaignId] },
  }, token);
}

const action = process.argv[2] || "snapshot";
preflightDirectApi();
const token = readToken();
let result;

if (action === "snapshot") result = await snapshot(token);
else if (action === "suspend-campaign") result = await suspendCampaign(token);
else if (action === "resume-campaign") result = await resumeCampaign(token);
else throw new Error(`Unknown action: ${action}`);

fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const filePath = path.join(outDir, `YANDEX_DIRECT_SAFE_API_${action}_${stamp}.json`);
fs.writeFileSync(filePath, `${JSON.stringify({ action, login, campaignId, result }, null, 2)}\n`, "utf8");
process.stdout.write(`${filePath}\n`);
