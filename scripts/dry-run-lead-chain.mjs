import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const port = Number(process.env.ROSOMAHA_DRY_RUN_PORT || 18080);
const cdpPort = Number(process.env.PLAYWRIGHT_CDP_PORT || 9223);
const baseUrl = `http://127.0.0.1:${port}`;
const crmWebhookUrl = "https://rosomaha.centrlp.ru/api/webhooks/site-form";
const chromeStarter = "G:\\mvp\\skills\\playwright-cli-browser\\scripts\\start-agent-chrome.ps1";
const logPath = path.join(process.cwd(), ".codex_tmp", "dry-run-lead-chain.log");
const outDir = path.join(process.cwd(), "marketing-audits", "lead-chain");
const realPostUnlock = "I_UNDERSTAND_THIS_CREATES_A_TEST_LEAD";
const args = new Set(process.argv.slice(2));
const realMode = args.has("--real");
const mode = realMode ? "real" : "dry-run";
const testBaseUrl = realMode
  ? (process.env.ROSOMAHA_REAL_TEST_BASE_URL || "https://xn--80aa8ahaki9a.site")
  : baseUrl;
const testCampaign = realMode
  ? (process.env.ROSOMAHA_REAL_TEST_UTM_CAMPAIGN || "codex_real_test_9of10")
  : "codex_dry_run_9of10";
const testYclid = realMode
  ? (process.env.ROSOMAHA_REAL_TEST_YCLID || `real-test-${Date.now()}`)
  : "dry-run-yclid";
const testPhone = process.env.ROSOMAHA_TEST_PHONE || "+7 922 071-11-74";
const testName = process.env.ROSOMAHA_TEST_NAME || "Codex Test";

function log(message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(logPath, line, "utf8");
  console.error(message);
}

function spawnVite() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run dev -- --host 127.0.0.1 --port ${port}`]
    : ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { child, getOutput: () => output };
}

async function waitForServer(child, getOutput) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited early with code ${child.exitCode}:\n${getOutput()}`);
    }

    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // keep waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Vite did not become ready on ${baseUrl}:\n${getOutput()}`);
}

async function ensureDedicatedChrome() {
  const before = await fetchCdpPages().catch(() => []);
  const started = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", chromeStarter, "-Url", "about:blank", "-Port", String(cdpPort), "-Hidden"],
    { encoding: "utf8", windowsHide: true },
  );

  if (started.status !== 0) {
    throw new Error(`Failed to start dedicated Chrome profile:\n${started.stdout}\n${started.stderr}`);
  }

  const after = await fetchCdpPages();
  return { before, after, starterOutput: started.stdout.trim() };
}

async function fetchCdpPages() {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`CDP list failed: ${response.status}`);
  return (await response.json()).filter((page) => page.type === "page");
}

async function cdpJson(path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}${path}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`CDP ${path} failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.consoleMessages = [];
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
  }

  handleMessage(event) {
    const payload = JSON.parse(event.data);
    if (payload.id && this.pending.has(payload.id)) {
      const { resolve, reject } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result || {});
      return;
    }
    if (payload.method === "Runtime.consoleAPICalled") {
      this.consoleMessages.push({
        type: payload.params.type,
        args: payload.params.args?.map((arg) => arg.value ?? arg.description),
      });
      return;
    }
    if (payload.method === "Runtime.exceptionThrown" || payload.method === "Log.entryAdded") {
      this.consoleMessages.push({
        type: payload.method,
        text: payload.params?.entry?.text || payload.params?.exceptionDetails?.text,
      });
      return;
    }
    this.events.push(payload);
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
    });
  }

  async waitForEvent(method, predicate = () => true, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.events.findIndex((event) => event.method === method && predicate(event.params || {}));
      if (index >= 0) return this.events.splice(index, 1)[0].params;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${method}`);
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Runtime exception: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  child.kill("SIGTERM");
}

function assertRealModeAllowed() {
  if (!realMode) return;
  if (process.env.ROSOMAHA_REAL_CRM_POST !== realPostUnlock) {
    throw new Error(
      `Real CRM POST is blocked. Set ROSOMAHA_REAL_CRM_POST=${realPostUnlock} only after explicit owner approval.`,
    );
  }
}

function writeArtifact(result) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `ROSOMAHA_LEAD_CHAIN_${mode.toUpperCase()}_${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return file;
}

async function waitForReceipt(client) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const receiptMessage = client.consoleMessages.find((message) =>
      message.args?.some((arg) => typeof arg === "string" && arg.startsWith("__LEAD_RECEIPT__"))
    );
    if (receiptMessage) {
      const raw = receiptMessage.args.find((arg) => typeof arg === "string" && arg.startsWith("__LEAD_RECEIPT__"));
      return JSON.parse(raw.slice("__LEAD_RECEIPT__".length));
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for lead receipt");
}

function getReachedGoals(client) {
  return client.consoleMessages
    .flatMap((message) => message.args || [])
    .filter((arg) => typeof arg === "string" && arg.startsWith("__YM_GOAL__"))
    .map((arg) => arg.slice("__YM_GOAL__".length));
}

async function runDryRun() {
  assertRealModeAllowed();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "", "utf8");
  const vite = realMode ? null : spawnVite();
  let client;
  let targetId;

  try {
    if (vite) {
      log("[dry-run] waiting for local Vite");
      await waitForServer(vite.child, vite.getOutput);
    }
    log(`[${mode}] ensuring dedicated Chrome`);
    const chromeState = await ensureDedicatedChrome();
    const testUrl = `${testBaseUrl.replace(/\/$/, "")}/order?utm_source=yandex&utm_medium=cpc&utm_campaign=${encodeURIComponent(testCampaign)}&yclid=${encodeURIComponent(testYclid)}`;
    log(`[${mode}] creating CDP target`);
    const target = await cdpJson(`/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    targetId = target.id;
    client = new CdpClient(target.webSocketDebuggerUrl);

    log(`[${mode}] enabling CDP domains`);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Log.enable");
    if (!realMode) {
      await client.send("Fetch.enable", {
        patterns: [{ urlPattern: crmWebhookUrl, requestStage: "Request" }],
      });
    }
    let capturedPayload;
    const corsHeaders = [
      { name: "Access-Control-Allow-Origin", value: "*" },
      { name: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
      { name: "Access-Control-Allow-Headers", value: "content-type, accept" },
    ];
    const interceptLoop = realMode ? Promise.resolve() : (async () => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        log("[dry-run] waiting for CRM request");
        const event = await client.waitForEvent("Fetch.requestPaused", (params) => params.request?.url === crmWebhookUrl, 25_000);
        if (event.request.method === "OPTIONS") {
          log("[dry-run] fulfilling CRM OPTIONS");
          await client.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: 204,
            responseHeaders: corsHeaders,
          });
          continue;
        }

        log("[dry-run] fulfilling CRM POST");
        capturedPayload = JSON.parse(event.request.postData || "{}");
        await client.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...corsHeaders],
          body: Buffer.from(JSON.stringify({ ok: true, deal_id: "dry-run-deal-123" }), "utf8").toString("base64"),
        });
        return;
      }
      throw new Error(`Timed out waiting for CRM POST. Console: ${JSON.stringify(client.consoleMessages, null, 2)}`);
    })();

    log(`[${mode}] navigating`);
    await client.send("Page.navigate", { url: testUrl });
    await client.waitForEvent("Page.loadEventFired", () => true, 20_000);
    log(`[${mode}] submitting form`);
    await evaluate(client, `
      (() => {
        localStorage.setItem('cookie-consent', 'true');
        window.__ymCalls = [];
        window.ym = (...args) => window.__ymCalls.push(args);
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'rosomaha_last_lead_receipt') {
            console.log('__LEAD_RECEIPT__' + value);
          }
          return originalSetItem.call(this, key, value);
        };
        window.ym = (...args) => {
          window.__ymCalls.push(args);
          if (args[1] === 'reachGoal') console.log('__YM_GOAL__' + args[2]);
        };
        const setValue = (selector, value) => {
          const el = document.querySelector(selector);
          if (!el) throw new Error('Missing selector ' + selector);
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setValue('input[type="text"]', ${JSON.stringify(testName)});
        setValue('input[type="tel"]', ${JSON.stringify(testPhone)});
        setValue('textarea', ${JSON.stringify(`${mode} lead chain check`)});
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (!checkbox) throw new Error('Missing privacy checkbox');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('click', { bubbles: true }));
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('form').requestSubmit();
        return true;
      })();
    `);

    await interceptLoop;
    log(`[${mode}] waiting for receipt`);
    let receipt;
    try {
      receipt = await waitForReceipt(client);
    } catch (error) {
      throw new Error(`${error.message}\nDebug: ${JSON.stringify({ capturedPayload, consoleMessages: client.consoleMessages }, null, 2)}`);
    }

    const payloadForChecks = capturedPayload || receipt;
    assert(payloadForChecks.lead_submission_id, "lead_submission_id missing");
    assert(payloadForChecks.phone_normalized === "79220711174", "phone normalization failed");
    assert(payloadForChecks.utm_source === "yandex", "utm_source missing");
    assert(payloadForChecks.utm_medium === "cpc", "utm_medium missing");
    assert(payloadForChecks.utm_campaign === testCampaign, "utm_campaign missing");
    assert(payloadForChecks.yclid === testYclid, "yclid missing");
    if (capturedPayload) {
      assert(receipt.lead_submission_id === capturedPayload.lead_submission_id, "receipt id does not match payload id");
    }
    if (!realMode) {
      assert(receipt.crm_response_id === "dry-run-deal-123", "receipt CRM response id missing");
    }

    const reachedGoals = getReachedGoals(client);
    assert(reachedGoals.includes("lead_submit"), "lead_submit goal was not reached");
    assert(!reachedGoals.includes("crm_conversion"), "crm_conversion must not fire from frontend form submit");

    const result = {
      ok: true,
      mode,
      url: testUrl,
      chromePagesBefore: chromeState.before.length,
      chromePagesAfterStart: chromeState.after.length,
      lead_submission_id: payloadForChecks.lead_submission_id,
      crm_response_id: receipt.crm_response_id,
      reachedGoals,
      payload: {
        phone_normalized: payloadForChecks.phone_normalized,
        utm_source: payloadForChecks.utm_source,
        utm_medium: payloadForChecks.utm_medium,
        utm_campaign: payloadForChecks.utm_campaign,
        yclid: payloadForChecks.yclid,
      },
    };
    result.artifact = writeArtifact(result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (client) client.close();
    if (targetId) {
      await cdpJson(`/json/close/${targetId}`).catch(() => {});
    }
    if (vite) stopProcessTree(vite.child);
  }
}

await runDryRun();
