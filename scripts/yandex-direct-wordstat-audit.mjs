import fs from "node:fs";
import path from "node:path";

import { safeJsonRequest } from "./yandex-direct-balance.mjs";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");
const endpoint = "https://api.wordstat.yandex.net/v1/topRequests";
const regionIds = [225];
const phrases = [
  "вездеход росомаха",
  "снегоболотоход купить",
  "росомаха экстрим",
  "росомаха хантер",
];

function parseNamedSecret(filePath, secretName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Project API env is unavailable: ${filePath}`);
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() === secretName) {
      const value = line.slice(separator + 1).trim();
      if (value) return value;
    }
  }

  throw new Error(`${secretName} is unavailable in project API env`);
}

function safeProviderText(value, token) {
  return String(value || "")
    .replaceAll(token, "[REDACTED]")
    .replace(/(Bearer|OAuth)\s+[A-Za-z0-9._~+\/-]+/gi, "$1 [REDACTED]")
    .slice(0, 2000);
}

async function topRequests(phrase, token) {
  const response = await safeJsonRequest(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json;charset=utf-8",
      "User-Agent": "RosomahaWordstatApiAudit/1.0",
    },
    body: JSON.stringify({ phrase, regions: regionIds, devices: ["all"] }),
  }, { timeoutMs: 15_000, secrets: [token] });
  const payload = response.data;

  if (!response.ok) {
    const error = new Error(`Wordstat topRequests HTTP ${response.status}: ${safeProviderText(JSON.stringify(payload), token)}`);
    error.providerStatus = response.status;
    error.providerBody = safeProviderText(JSON.stringify(payload), token);
    throw error;
  }
  if (!payload || !Array.isArray(payload.topRequests)) {
    throw new Error(`Wordstat topRequests returned an unexpected payload: ${safeProviderText(JSON.stringify(payload), token)}`);
  }

  return {
    phrase,
    providerStatus: response.status,
    requestId: response.providerMeta?.requestId || null,
    topRequests: payload.topRequests.map((item) => ({
      phrase: String(item.phrase || ""),
      count: Number(item.count || 0),
    })),
  };
}

const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const receiptPath = path.join(outDir, `YANDEX_WORDSTAT_TOP_REQUESTS_713802902_${stamp}.json`);
fs.mkdirSync(outDir, { recursive: true });

const receipt = {
  generatedAt,
  mode: "read-only",
  provider: "Yandex Wordstat API",
  endpoint,
  tokenSource: `${envPath}::YANDEX_OAUTH_TOKEN`,
  tokenExposed: false,
  accountRoute: "rosomaha-yandex / rosomaha-rus999",
  campaignId: 713802902,
  regionIds,
  phrases,
  status: "pending",
  results: [],
  error: null,
};

let exitCode = 0;
try {
  const token = parseNamedSecret(envPath, "YANDEX_OAUTH_TOKEN");
  for (const phrase of phrases) {
    receipt.results.push(await topRequests(phrase, token));
  }
  receipt.status = "ok";
} catch (error) {
  receipt.status = "source_unavailable";
  receipt.error = {
    message: String(error?.message || error),
    causeCode: error?.cause?.code || null,
    causeMessage: error?.cause?.message ? String(error.cause.message).slice(0, 1000) : null,
    providerStatus: error?.providerStatus || null,
    providerBody: error?.providerBody || null,
  };
  exitCode = 2;
}

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: receipt.status,
  provider: receipt.provider,
  campaignId: receipt.campaignId,
  regionIds: receipt.regionIds,
  phraseCount: receipt.phrases.length,
  resultCount: receipt.results.length,
  providerError: receipt.error,
  receipt: path.relative(rootDir, receiptPath),
  tokenExposed: false,
}, null, 2));
process.exitCode = exitCode;
