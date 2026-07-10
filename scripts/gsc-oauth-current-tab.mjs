import fs from "fs";
import http from "http";
import path from "path";
import crypto from "crypto";
import dns from "node:dns";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "url";

dns.setDefaultResultOrder("ipv4first");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, ".env.seo.local");
const CALLBACK_PORT = Number(process.env.GSC_OAUTH_PORT || 17432);
const CALLBACK_PATH = "/oauth2callback";
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
const CDP_PORT = Number(process.env.CHROME_CDP_PORT || 9223);
const SCOPES = ["https://www.googleapis.com/auth/webmasters"];
const SEARCH_CONSOLE_URL =
  "https://search.google.com/search-console/sitemaps?resource_id=https%3A%2F%2Fxn--80aa8ahaki9a.site%2F";

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

function readEnv(filePath) {
  return fs.existsSync(filePath) ? parseEnv(fs.readFileSync(filePath, "utf8")) : {};
}

function updateEnv(filePath, updates) {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    : [];
  const seen = new Set();

  const next = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !Object.prototype.hasOwnProperty.call(updates, match[1])) {
      return line;
    }
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, next.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data?.error || data?.raw || response.statusText}`);
  }
  return data;
}

async function findCurrentSearchConsoleTab(clientId = "") {
  const tabs = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const tab = tabs.find(
    (entry) =>
      entry.type === "page" &&
      entry.url &&
      (entry.url.includes("search.google.com/search-console") ||
        (clientId && entry.url.includes("accounts.google.com") && entry.url.includes(clientId))),
  );
  if (!tab?.webSocketDebuggerUrl) {
    throw new Error("Search Console tab was not found on the current Chrome CDP session.");
  }
  return tab;
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP call timed out: ${method}`));
    }, 10000);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) {
        reject(new Error(`${method} failed: ${message.error.message}`));
      } else {
        resolve(message.result);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket error while running ${method}`));
    });
  });
}

async function navigateCurrentTab(url, clientId = "") {
  const tab = await findCurrentSearchConsoleTab(clientId);
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${tab.id}`).catch(() => {});
  await cdpCall(tab.webSocketDebuggerUrl, "Page.navigate", { url });
}

function buildAuthUrl(clientId, codeChallenge) {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  return authUrl.toString();
}

function waitForOAuthCode() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth consent was not completed before timeout."));
    }, 10 * 60 * 1000);

    const server = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, REDIRECT_URI);
        if (url.pathname !== CALLBACK_PATH) {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const error = url.searchParams.get("error");
        if (error) throw new Error(`OAuth error: ${error}`);

        const code = url.searchParams.get("code");
        if (!code) throw new Error("OAuth callback did not include a code.");

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          "<!doctype html><meta charset='utf-8'><title>Google доступ получен</title><body><h1>Google доступ получен</h1><p>Можно вернуться в Codex.</p></body>",
        );
        clearTimeout(timeout);
        server.close();
        resolve(code);
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      console.log("OAUTH_SERVER_READY");
      console.log(`Callback: ${REDIRECT_URI}`);
    });
  });
}

async function exchangeCode({ code, clientId, clientSecret, codeVerifier }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    code_verifier: codeVerifier,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  let data;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Token exchange failed: ${data.error_description || data.error || response.status}`);
    }
  } catch (error) {
    const stdout = execFileSync(
      "curl.exe",
      [
        "-s",
        "-L",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/x-www-form-urlencoded",
        "--data",
        body.toString(),
        "https://oauth2.googleapis.com/token",
      ],
      { encoding: "utf8" },
    );
    data = JSON.parse(stdout);
    if (data.error) {
      throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
    }
  }
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Retry with a fresh consent grant.");
  }
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const waitCurrentFlow = args.includes("--wait-current-flow");
  const manualNavigation = args.includes("--manual-navigation");
  const envArg = args.find((arg) => !arg.startsWith("--"));
  const envPath = envArg ? path.resolve(process.cwd(), envArg) : DEFAULT_ENV_PATH;
  const env = readEnv(envPath);
  const clientId = env.GSC_CLIENT_ID;
  const clientSecret = env.GSC_CLIENT_SECRET || "";
  if (!clientId) {
    throw new Error("GSC_CLIENT_ID is required in .env.seo.local.");
  }
  const pkce = createPkcePair();

  const codePromise = waitForOAuthCode();
  if (manualNavigation) {
    const authUrl = buildAuthUrl(clientId, pkce.challenge);
    const authUrlPath = path.join(ROOT_DIR, ".codex_tmp", "gsc-auth-url.txt");
    fs.mkdirSync(path.dirname(authUrlPath), { recursive: true });
    fs.writeFileSync(authUrlPath, `${authUrl}\n`, "utf8");
    console.log(`AUTH_URL_FILE=${authUrlPath}`);
    console.log("Open this URL in the already authorized browser session.");
  } else if (waitCurrentFlow) {
    console.log("WAITING_FOR_CURRENT_OAUTH_FLOW");
    console.log("Continue the already visible Google verification/consent flow in Chrome.");
  } else {
    await navigateCurrentTab(buildAuthUrl(clientId, pkce.challenge), clientId);
    console.log("AUTH_OPENED_IN_CURRENT_TAB");
    console.log("If Google asks for confirmation, approve Search Console access in the visible tab.");
  }

  const code = await codePromise;
  const token = await exchangeCode({
    code,
    clientId,
    clientSecret,
    codeVerifier: pkce.verifier,
  });

  updateEnv(envPath, {
    GSC_CLIENT_ID: clientId,
    GSC_REFRESH_TOKEN: token.refresh_token,
    GSC_SITE_URL: "https://xn--80aa8ahaki9a.site/",
    GSC_OAUTH_SCOPES: SCOPES.join(","),
  });

  await navigateCurrentTab(SEARCH_CONSOLE_URL, clientId).catch(() => {});
  console.log("GSC_REFRESH_TOKEN_SAVED");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
