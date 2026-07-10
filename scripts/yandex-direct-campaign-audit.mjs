import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const utf8Decoder = new TextDecoder("utf-8");
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || process.argv[2] || 708505950);
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const secretsDir = path.join("C:\\Users\\Макс\\.codex\\automations\\automation-2\\secrets");
const secretsDirHome = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets");
const tokenEnvPath = path.join(secretsDirHome, "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");

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
  if (seoEnv.YANDEX_WEBMASTER_TOKEN) return seoEnv.YANDEX_WEBMASTER_TOKEN;
  throw new Error(`Missing YANDEX_OAUTH_TOKEN in ${tokenEnvPath} or ${seoEnvPath}`);
}

async function directRequest(service, method, params, token) {
  const url = `https://api.direct.yandex.com/json/v5/${service}`;
  const body = JSON.stringify({ method, params });
  const headers = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
    "Client-Login": login,
  };

  try {
    const response = await fetch(url, { method: "POST", headers, body });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  } catch (error) {
    const curlHeaders = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);

    try {
      const stdout = execFileSync(
        "curl.exe",
        ["-s", "-L", "-X", "POST", ...curlHeaders, "--data-binary", body, url],
        { encoding: "buffer" },
      );
      if (!stdout.length) throw new Error("Empty curl response");
      return JSON.parse(utf8Decoder.decode(stdout));
    } catch {
      // Never leak credentials into thrown messages (execFileSync errors include full argv).
      throw new Error(`Direct API request failed for ${service}.${method}`);
    }
  }
}

function assertDirectOk(response, label) {
  if (response.error) {
    throw new Error(`${label}: ${response.error.error_string || response.error.error_detail || JSON.stringify(response.error)}`);
  }
  return response.result;
}

async function main() {
  preflightDirectApi();
  const token = readToken();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const errors = [];
  let campaigns = null;
  let adGroups = null;

  try {
    campaigns = assertDirectOk(
      await directRequest(
        "campaigns",
        "get",
        {
          SelectionCriteria: { Ids: [campaignId] },
          FieldNames: ["Id", "Name", "Status", "State", "Type", "StartDate", "EndDate", "ClientInfo"],
          TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
        },
        token,
      ),
      "campaigns.get",
    );
  } catch (error) {
    errors.push({ service: "direct.campaigns", message: error.message });
  }

  try {
    adGroups = assertDirectOk(
      await directRequest(
        "adgroups",
        "get",
        {
          SelectionCriteria: { CampaignIds: [campaignId] },
          FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type"],
          Page: { Limit: 10000 },
        },
        token,
      ),
      "adgroups.get",
    );
  } catch (error) {
    errors.push({ service: "direct.adgroups", message: error.message });
  }

  const payload = {
    generatedAt: now.toISOString(),
    login,
    campaignId,
    campaignFound: Boolean(campaigns?.Campaigns?.length),
    adGroupsCount: adGroups?.AdGroups?.length || 0,
    errors,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `YANDEX_DIRECT_API_${campaignId}_${stamp}.json`),
    `${JSON.stringify({ payload, campaigns, adGroups }, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    `# Yandex Direct API audit — ${stamp}`,
    "",
    `Generated: ${now.toISOString()}`,
    `Client login: ${login}`,
    `Campaign: ${campaignId}`,
    "",
    "## Access check",
    `- Campaign found: ${payload.campaignFound ? "yes" : "no"}`,
    `- Ad groups visible: ${payload.adGroupsCount}`,
    "",
    "## Errors",
    ...(errors.length ? errors.map((entry) => `- ${entry.service}: ${entry.message}`) : ["- None"]),
    "",
  ];

  const mdPath = path.join(outDir, `YANDEX_DIRECT_API_${campaignId}_${stamp}.md`);
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(`${mdPath}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
