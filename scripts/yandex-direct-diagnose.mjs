import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "rosomaha-rus999";
const campaignId = Number(process.env.YANDEX_DIRECT_CAMPAIGN_ID || 708505950);
const secretsDir = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets");
const tokenEnvPath = path.join(secretsDir, "yandex_oauth_token.env");
const seoEnvPath = path.join(process.cwd(), ".env.seo.local");

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

async function post(service, method, params, token) {
  const url = `https://api.direct.yandex.com/json/v5/${service}`;
  const body = JSON.stringify({ method, params });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      "Client-Login": login,
    },
    body,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    url,
    service,
    method,
    httpStatus: response.status,
    ok: response.ok,
    directError: json?.error || null,
    resultKeys: json?.result ? Object.keys(json.result) : null,
    bodyHead: text.slice(0, 1200),
  };
}

async function main() {
  const token = readToken();
  const checks = [];

  checks.push(await post(
    "campaigns",
    "get",
    {
      SelectionCriteria: { Ids: [campaignId] },
      FieldNames: ["Id", "Name", "Status", "State", "Type"],
      TextCampaignFieldNames: ["BiddingStrategy", "Settings"],
    },
    token,
  ));

  checks.push(await post(
    "adgroups",
    "get",
    {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type"],
      Page: { Limit: 10 },
    },
    token,
  ));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    login,
    campaignId,
    checks,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
