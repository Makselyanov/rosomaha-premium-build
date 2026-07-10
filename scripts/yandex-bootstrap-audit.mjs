import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const rootDir = process.cwd();
const utf8Decoder = new TextDecoder("utf-8");
const secretsDir = path.join("C:\\Users\\Макс\\.codex\\automations\\automation-2\\secrets");
const secretsDirHome = path.join(os.homedir(), ".codex", "automations", "automation-2", "secrets");
const tokenPath = path.join(secretsDirHome, "yandex_oauth_token.txt");
const tokenEnvPath = path.join(secretsDirHome, "yandex_oauth_token.env");
const seoEnvPath = path.join(rootDir, ".env.seo.local");
const outDir = path.join(rootDir, "marketing-audits", "yandex-api");

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
  const envToken = process.env.YANDEX_OAUTH_TOKEN?.trim();
  if (envToken) return envToken;
  if (fs.existsSync(tokenEnvPath)) {
    const tokenEnv = parseEnvFile(tokenEnvPath);
    if (tokenEnv.YANDEX_OAUTH_TOKEN) return tokenEnv.YANDEX_OAUTH_TOKEN;
  }
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, "utf8").trim();
  const seoEnv = parseEnvFile(seoEnvPath);
  if (seoEnv.YANDEX_OAUTH_TOKEN) return seoEnv.YANDEX_OAUTH_TOKEN;
  if (seoEnv.YANDEX_WEBMASTER_TOKEN) return seoEnv.YANDEX_WEBMASTER_TOKEN;
  throw new Error(
    `Missing YANDEX_OAUTH_TOKEN; set env var, create ${tokenEnvPath}, or add it to ${seoEnvPath}`,
  );
}

async function requestJson(url, token) {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `OAuth ${token}`,
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Request failed ${response.status} for ${url}: ${text.slice(0, 500)}`);
    }

    return text ? JSON.parse(text) : null;
  } catch (error) {
    const stdout = execFileSync(
      "curl.exe",
      ["-s", "-L", "-H", `Authorization: OAuth ${token}`, url],
      { encoding: "buffer" },
    );

    if (!stdout.length) {
      throw error;
    }

    const text = utf8Decoder.decode(stdout);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Failed to parse JSON for ${url}: ${text.slice(0, 500)}`);
    }
  }
}

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fetchMetrika(counterId, token) {
  const counters = await requestJson("https://api-metrika.yandex.net/management/v1/counters", token);
  const found = (counters?.counters || []).find((c) => String(c.id) === String(counterId));
  const goals = await requestJson(
    `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}/goals`,
    token,
  );

  return { counter: found || null, goals: goals?.goals || [] };
}

async function fetchWebmaster(token) {
  const user = await requestJson("https://api.webmaster.yandex.net/v4/user/", token);
  const userId = user?.user_id;
  if (!userId) {
    throw new Error("Webmaster API: user_id not found");
  }

  const hosts = await requestJson(`https://api.webmaster.yandex.net/v4/user/${userId}/hosts/`, token);
  return { user, hosts };
}

function pickHostId(hosts, hostUrl) {
  const list = hosts?.hosts || [];
  const normalized = hostUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
  const entry =
    list.find((h) => String(h.unicode_host_url || "").toLowerCase().includes(normalized)) ||
    list.find((h) => String(h.host_url || "").toLowerCase().includes(normalized));
  return entry?.host_id || null;
}

async function main() {
  const token = readToken();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const metrikaCounterId = 107139619;
  const hostUrl = "https://rosomaha.site";

  const errors = [];
  let metrika = { counter: null, goals: [] };
  let webmaster = { user: null, hosts: { hosts: [] } };

  try {
    metrika = await fetchMetrika(metrikaCounterId, token);
  } catch (error) {
    errors.push({ service: "metrika", message: error.message });
  }

  try {
    webmaster = await fetchWebmaster(token);
  } catch (error) {
    errors.push({ service: "webmaster", message: error.message });
  }

  const hostId = webmaster.user ? pickHostId(webmaster.hosts, hostUrl) : null;
  let hostSummary = null;
  if (hostId) {
    const apiBase = `https://api.webmaster.yandex.net/v4/user/${webmaster.user.user_id}/hosts/${hostId}`;
    try {
      hostSummary = await requestJson(`${apiBase}/summary/`, token);
    } catch (error) {
      errors.push({ service: "webmaster.summary", message: error.message });
    }
  }

  const payload = {
    generatedAt: now.toISOString(),
    metrika: {
      counterId: metrikaCounterId,
      counterFound: Boolean(metrika.counter),
      goalsCount: metrika.goals.length,
    },
    webmaster: {
      userId: webmaster.user?.user_id || null,
      hostsCount: (webmaster.hosts?.hosts || []).length,
      pickedHostId: hostId,
    },
    errors,
  };

  safeWrite(path.join(outDir, `YANDEX_API_BOOTSTRAP_${stamp}.json`), formatJson({ payload, metrika, webmaster, hostSummary }));

  const lines = [
    `# Yandex API bootstrap — ${stamp}`,
    "",
    `Generated: ${now.toISOString()}`,
    "",
    "## Metrika",
    `- Counter: ${metrikaCounterId} (found: ${metrika.counter ? "yes" : "no"})`,
    `- Goals: ${metrika.goals.length}`,
    "",
    "## Webmaster",
    `- User ID: ${webmaster.user?.user_id || "(not available)"}`,
    `- Hosts: ${(webmaster.hosts?.hosts || []).length}`,
    `- Picked host for ${hostUrl}: ${hostId || "(not found)"}`,
    "",
    "## API errors",
    ...(errors.length ? errors.map((entry) => `- ${entry.service}: ${entry.message}`) : ["- None"]),
    "",
    "Next: add Direct API checks and campaign report pull for 708505950.",
    "",
  ];

  safeWrite(path.join(outDir, `YANDEX_API_BOOTSTRAP_${stamp}.md`), `${lines.join("\n")}\n`);

  process.stdout.write(`${path.join(outDir, `YANDEX_API_BOOTSTRAP_${stamp}.md`)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
