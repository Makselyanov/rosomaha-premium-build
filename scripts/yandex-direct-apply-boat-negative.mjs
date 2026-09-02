import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const login = "rosomaha-rus999";
const campaignId = 713802902;
const negativeKeyword = "лодка";
const mutationUnlock = "I_UNDERSTAND_THIS_CHANGES_LIVE_DIRECT";
const lockPath = "G:\\mvp\\browser-locks\\rosomaha-yandex.lock";
const tokenEnvPath = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets", "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const receiptDir = path.join(rootDir, "marketing-audits", "yandex-direct");

function parseEnvFile(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) values[key] = line.slice(separator + 1).trim();
  }
  return values;
}

function readToken() {
  const automationEnv = fs.existsSync(tokenEnvPath) ? parseEnvFile(tokenEnvPath) : {};
  const projectEnv = fs.existsSync(seoEnvPath) ? parseEnvFile(seoEnvPath) : {};
  const token = process.env.YANDEX_OAUTH_TOKEN || automationEnv.YANDEX_OAUTH_TOKEN || projectEnv.YANDEX_OAUTH_TOKEN;
  if (!token) throw new Error("YANDEX_OAUTH_TOKEN is unavailable in the approved project secret stores");
  return token;
}

function normalize(items) {
  return [...new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ru"));
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
  if (!response.ok) throw new Error(`${service}.${method} HTTP ${response.status}`);
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(payload.error.error_detail || payload.error.error_string || `${service}.${method} failed`);
  return payload.result;
}

async function readGroups(token) {
  const result = await directRequest("adgroups", "get", {
    SelectionCriteria: { CampaignIds: [campaignId] },
    FieldNames: ["Id", "Name", "CampaignId", "NegativeKeywords"],
    Page: { Limit: 10000 },
  }, token);
  const groups = result.AdGroups || [];
  if (!groups.length || groups.some((group) => group.CampaignId !== campaignId)) throw new Error("Target campaign group scope is not proven");
  return groups.map((group) => ({
    id: group.Id,
    name: group.Name,
    negativeKeywords: normalize(group.NegativeKeywords?.Items || []),
  }));
}

function verifyReadback(before, after) {
  if (before.length !== after.length) throw new Error("Ad group count changed during mutation");
  const beforeById = new Map(before.map((group) => [group.id, group]));
  for (const group of after) {
    const original = beforeById.get(group.id);
    if (!original) throw new Error("Unexpected ad group in readback");
    const expected = normalize([...original.negativeKeywords, negativeKeyword]);
    if (JSON.stringify(group.negativeKeywords) !== JSON.stringify(expected)) {
      throw new Error(`Negative keyword readback differs for group ${group.id}`);
    }
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) throw new Error(`Yandex account lock exists: ${lockPath}`);
  fs.writeFileSync(lockPath, JSON.stringify({ accountSlug: "rosomaha-yandex", action: "exact negative лодка", startedAt: new Date().toISOString() }));
}

function releaseLock() {
  if (fs.existsSync(lockPath)) fs.rmSync(lockPath, { force: true });
}

async function main() {
  if (process.env.YANDEX_DIRECT_MUTATIONS !== mutationUnlock) throw new Error("Live mutation guard is not set");
  acquireLock();
  try {
    const token = readToken();
    const before = await readGroups(token);
    const update = await directRequest("adgroups", "update", {
      AdGroups: before.map((group) => ({ Id: group.id, NegativeKeywords: { Items: normalize([...group.negativeKeywords, negativeKeyword]) } })),
    }, token);
    const after = await readGroups(token);
    verifyReadback(before, after);
    fs.mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, `YANDEX_DIRECT_EXACT_NEGATIVE_${campaignId}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(receiptPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), login, campaignId, negativeKeyword, before, update, after, readback: "verified" }, null, 2)}\n`, "utf8");
    process.stdout.write(`${receiptPath}\n`);
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  releaseLock();
  console.error(error.message);
  process.exitCode = 1;
});
