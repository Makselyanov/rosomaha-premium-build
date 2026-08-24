import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadProjectToken,
  nativeHttpsRequest,
  parseYandexAccountsRegistry,
  redactSensitive,
} from "./yandex-direct-balance.mjs";

export const ACCOUNT_SLUG = "rosomaha-yandex";
export const EXPECTED_LOGIN = "rosomaha-rus999";
export const EXPECTED_PROJECT = "rosomaha";
export const TARGET_DOMAIN = "rosomaha-rus.ru";
export const TARGET_COUNTER_NAME = "rosomaha-rus.ru — ООО ТПК Росомаха";
export const TARGET_TIME_ZONE = "Asia/Yekaterinburg";
export const METRIKA_API_ORIGIN = "https://api-metrika.yandex.net";
export const YANDEX_IDENTITY_URL =
  "https://login.yandex.ru/info?format=json&with_openid_identity=0";
export const MAX_RESPONSE_BYTES = 1_048_576;

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
export const REGISTRY_PATH = path.resolve(
  PROJECT_ROOT,
  "..",
  "accounts",
  "yandex-accounts.yaml",
);
export const REPORT_DIR = path.join(
  PROJECT_ROOT,
  "marketing-audits",
  "yandex-metrika",
);
export const RUNTIME_SECRET_PATH = path.join(
  PROJECT_ROOT,
  ".local-artifacts",
  "yandex-metrika",
  "rosomaha-rus-runtime.json",
);

const MODES = new Set(["audit", "dry-run", "apply"]);
const ALLOWED_SITE_HOSTS = new Set([TARGET_DOMAIN, `www.${TARGET_DOMAIN}`]);

export const CREATE_COUNTER_PAYLOAD = Object.freeze({
  name: TARGET_COUNTER_NAME,
  site2: Object.freeze({ site: TARGET_DOMAIN }),
  time_zone_name: TARGET_TIME_ZONE,
  filter_robots: 1,
  autogoals_enabled: false,
});

export const DESIRED_COUNTER = Object.freeze({
  ...CREATE_COUNTER_PAYLOAD,
  counter_flags: Object.freeze({
    use_in_benchmarks: false,
    direct_allow_use_goals_without_access: true,
    collect_first_party_data: true,
    measurement_enabled: true,
  }),
});

export const GOAL_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "hard",
    event: "crm_conversion",
    name: "CRM-заявка — подтверждён deal_id",
    isFavorite: true,
    evidenceBoundary:
      "Hard goal: событие разрешено отправлять только после ответа CRM status=ok с непустым deal_id и тем же lead_submission_id; DOM-submit не является этой целью.",
  }),
  Object.freeze({
    key: "soft",
    event: "lead_submit",
    name: "Форма отправлена — мягкий сигнал",
    isFavorite: false,
    evidenceBoundary:
      "Soft goal: техническая отправка формы; не считать заявкой, сделкой или CRM-подтверждённой конверсией.",
  }),
]);

export class SetupBlockedError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "SetupBlockedError";
    this.code = code;
    this.details = details;
  }
}

function comparablePath(value) {
  return path.normalize(String(value ?? "")).toLowerCase();
}

export function normalizeLogin(value) {
  const login = String(value ?? "").trim().toLowerCase();
  return login.endsWith("@yandex.ru") ? login.slice(0, -"@yandex.ru".length) : login;
}

export function normalizeSiteHost(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//u.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/\.$/u, "");
  } catch {
    return null;
  }
}

function routeError(message, details = null) {
  return new SetupBlockedError("route_mismatch", message, details);
}

export function resolveMetrikaRoute({
  registryPath = REGISTRY_PATH,
  projectRoot = PROJECT_ROOT,
  accountSlug = ACCOUNT_SLUG,
} = {}) {
  if (!fs.existsSync(registryPath)) {
    throw routeError("Registry yandex-accounts.yaml не найден.", { registryPath });
  }

  let accounts;
  try {
    accounts = parseYandexAccountsRegistry(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw routeError(`Registry yandex-accounts.yaml не удалось безопасно разобрать: ${error.message}.`, {
      registryPath,
    });
  }

  const account = accounts[accountSlug];
  if (!account) {
    throw routeError(`В registry отсутствует точная запись ${accountSlug}.`, { accountSlug });
  }

  const expectedEnvPath = path.join(projectRoot, ".env.seo.local");
  const services = Array.isArray(account.services)
    ? account.services.map((item) => String(item).trim())
    : [];
  const allowedProjects = Array.isArray(account.allowed_projects)
    ? account.allowed_projects.map((item) => String(item).trim().toLowerCase())
    : [];
  const checks = [
    [String(account.service ?? "").trim() === "yandex-suite", "service должен быть yandex-suite"],
    [services.includes("metrika"), "services должен включать metrika"],
    [String(account.project ?? "").trim() === EXPECTED_PROJECT, `project должен быть ${EXPECTED_PROJECT}`],
    [allowedProjects.includes(TARGET_DOMAIN), `allowed_projects должен включать ${TARGET_DOMAIN}`],
    [normalizeLogin(account.login_hint) === EXPECTED_LOGIN, `login_hint должен указывать ${EXPECTED_LOGIN}`],
    [normalizeLogin(account.direct_login) === EXPECTED_LOGIN, `direct_login должен быть ${EXPECTED_LOGIN}`],
    [
      comparablePath(account.api_env) === comparablePath(expectedEnvPath),
      `api_env должен быть ${expectedEnvPath}`,
    ],
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed) {
    throw routeError(`Маршрут ${accountSlug} остановлен: ${failed[1]}.`, {
      accountSlug,
      expectedProject: EXPECTED_PROJECT,
      expectedDomain: TARGET_DOMAIN,
      expectedLogin: EXPECTED_LOGIN,
      expectedEnvPath,
    });
  }

  return {
    status: "verified",
    accountSlug,
    service: "metrika",
    project: EXPECTED_PROJECT,
    domain: TARGET_DOMAIN,
    ulogin: EXPECTED_LOGIN,
    apiEnvPath: String(account.api_env),
    registryPath,
  };
}

export function parseMode(argv = []) {
  const flags = Array.from(argv, (value) => String(value));
  if (flags.length !== 1 || !flags[0].startsWith("--")) {
    throw new SetupBlockedError(
      "mode_required",
      "Укажите ровно один режим: --audit, --dry-run или явный --apply.",
    );
  }
  const mode = flags[0].slice(2);
  if (!MODES.has(mode)) {
    throw new SetupBlockedError(
      "mode_invalid",
      `Неизвестный режим ${flags[0]}; разрешены только --audit, --dry-run и --apply.`,
    );
  }
  return mode;
}

function metrikaUrl(pathname, parameters = {}) {
  const url = new URL(pathname, METRIKA_API_ORIGIN);
  url.searchParams.set("ulogin", EXPECTED_LOGIN);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function safeApiErrorBody(text, token) {
  return redactSensitive(String(text ?? "").slice(0, 800), [token]);
}

function curlConfigValue(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

export function curlStdinRequest(url, requestOptions, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const marker = `__ROSOMAHA_HTTP_${randomUUID()}__`;
    const maxTimeSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const configLines = [
      "silent",
      "show-error",
      `connect-timeout = \"${maxTimeSeconds}\"`,
      `max-time = \"${maxTimeSeconds}\"`,
      `request = \"${curlConfigValue(requestOptions.method)}\"`,
      `url = \"${curlConfigValue(url)}\"`,
      ...Object.entries(requestOptions.headers || {}).map(
        ([name, value]) => `header = \"${curlConfigValue(`${name}: ${value}`)}\"`,
      ),
      ...(requestOptions.body
        ? [`data-binary = \"${curlConfigValue(requestOptions.body)}\"`]
        : []),
      `write-out = \"\\n${marker}:%{http_code}\"`,
      "",
    ];

    const child = spawn("curl.exe", ["--config", "-"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`curl timeout after ${timeoutMs} ms`)));
    }, timeoutMs + 2_000);

    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > MAX_RESPONSE_BYTES + 512) {
        child.kill();
        finish(() => reject(new Error(`curl response exceeds ${MAX_RESPONSE_BYTES} bytes`)));
        return;
      }
      stdout.push(buffer);
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes <= 8_192) stderr.push(buffer);
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode) => finish(() => {
      const output = Buffer.concat(stdout).toString("utf8");
      const markerIndex = output.lastIndexOf(`\n${marker}:`);
      if (markerIndex === -1) {
        const diagnostic = Buffer.concat(stderr).toString("utf8").slice(0, 800);
        reject(new Error(`curl exit ${exitCode}: ${diagnostic || "HTTP status marker missing"}`));
        return;
      }
      const text = output.slice(0, markerIndex);
      const statusText = output.slice(markerIndex + marker.length + 2).trim();
      const status = Number(statusText);
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        reject(new Error(`curl returned invalid HTTP status ${statusText || "empty"}`));
        return;
      }
      resolve({ ok: status >= 200 && status < 300, status, text, headers: {} });
    }));

    child.stdin.on("error", (error) => finish(() => reject(error)));
    child.stdin.end(configLines.join("\n"), "utf8");
  });
}

export function createApiClient({
  token,
  fetchImpl = globalThis.fetch,
  nativeRequest = nativeHttpsRequest,
  curlRequest = curlStdinRequest,
  timeoutMs = 15_000,
} = {}) {
  if (!token || typeof token !== "string") {
    throw new SetupBlockedError("token_missing", "Проектный OAuth-токен Метрики отсутствует.");
  }
  if (typeof fetchImpl !== "function") {
    throw new SetupBlockedError("fetch_unavailable", "Fetch API недоступен.");
  }

  const calls = [];
  async function request(urlInput, { method = "GET", body = null } = {}) {
    const url = urlInput instanceof URL ? new URL(urlInput) : new URL(String(urlInput));
    if (url.protocol !== "https:") {
      throw new SetupBlockedError("unsafe_endpoint", "Разрешены только HTTPS-запросы.");
    }
    if (!["api-metrika.yandex.net", "login.yandex.ru"].includes(url.hostname)) {
      throw new SetupBlockedError("unsafe_endpoint", `Запрещённый API host ${url.hostname}.`);
    }
    if (!new Set(["GET", "POST", "PUT"]).has(method)) {
      throw new SetupBlockedError("unsafe_method", `Метод ${method} не разрешён оператором.`);
    }
    if (url.hostname === "login.yandex.ru" && method !== "GET") {
      throw new SetupBlockedError("unsafe_method", "Identity endpoint разрешён только для чтения.");
    }
    if (url.hostname === "api-metrika.yandex.net") {
      if (url.searchParams.get("ulogin") !== EXPECTED_LOGIN) {
        throw new SetupBlockedError(
          "account_not_pinned",
          `Каждый запрос Метрики должен быть закреплён через ulogin=${EXPECTED_LOGIN}.`,
        );
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      Accept: "application/json",
      Authorization: `OAuth ${token}`,
    };
    if (body !== null) headers["Content-Type"] = "application/json; charset=utf-8";
    calls.push({
      method,
      host: url.hostname,
      path: url.pathname,
      ulogin: url.searchParams.get("ulogin"),
    });

    const requestOptions = {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    };
    let response;
    let text;
    try {
      response = await fetchImpl(url, {
        ...requestOptions,
        signal: controller.signal,
      });
      text = await response.text();
    } catch (fetchError) {
      if (typeof nativeRequest !== "function") {
        const message = fetchError?.name === "AbortError"
          ? `API timeout после ${timeoutMs} мс.`
          : `API transport error: ${safeApiErrorBody(fetchError?.message || fetchError, token)}`;
        throw new SetupBlockedError("api_transport_error", message);
      }
      try {
        const nativeResponse = await nativeRequest(url.toString(), requestOptions, timeoutMs);
        response = nativeResponse;
        text = String(nativeResponse?.text ?? "");
      } catch (nativeError) {
        if (typeof curlRequest !== "function") {
          throw new SetupBlockedError(
            "api_transport_error",
            `Fetch и HTTPS transport недоступны: ${safeApiErrorBody(nativeError?.message || nativeError, token)}`,
          );
        }
        try {
          const curlResponse = await curlRequest(url.toString(), requestOptions, timeoutMs);
          response = curlResponse;
          text = String(curlResponse?.text ?? "");
        } catch (curlError) {
          throw new SetupBlockedError(
            "api_transport_error",
            `Все разрешённые API transport недоступны: ${safeApiErrorBody(curlError?.message || curlError, token)}`,
          );
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new SetupBlockedError(
        "api_response_too_large",
        `Ответ API превышает ${MAX_RESPONSE_BYTES} байт.`,
      );
    }
    if (!response.ok) {
      throw new SetupBlockedError(
        "api_error",
        `API ${method} ${url.pathname} вернул HTTP ${response.status}: ${safeApiErrorBody(text, token)}`,
        { status: response.status, host: url.hostname, path: url.pathname },
      );
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new SetupBlockedError(
        "api_invalid_json",
        `API ${method} ${url.pathname} вернул некорректный JSON.`,
      );
    }
  }

  return {
    calls,
    get: (url) => request(url, { method: "GET" }),
    post: (url, body) => request(url, { method: "POST", body }),
    put: (url, body) => request(url, { method: "PUT", body }),
  };
}

async function readIdentity(api) {
  const identity = await api.get(new URL(YANDEX_IDENTITY_URL));
  const actualLogin = normalizeLogin(identity?.login || identity?.default_email);
  if (actualLogin !== EXPECTED_LOGIN) {
    throw new SetupBlockedError(
      "account_mismatch",
      `OAuth принадлежит логину ${actualLogin || "не определён"}, ожидался ${EXPECTED_LOGIN}.`,
      { expectedLogin: EXPECTED_LOGIN, actualLogin: actualLogin || null },
    );
  }
  return { login: EXPECTED_LOGIN };
}

async function listCounters(api) {
  const response = await api.get(metrikaUrl("/management/v1/counters", {
    field: "counter_flags,mirrors",
    per_page: 10000,
    status: "Active",
  }));
  const counters = Array.isArray(response?.counters) ? response.counters : [];
  const rows = Number(response?.rows);
  if (Number.isFinite(rows) && rows > counters.length) {
    throw new SetupBlockedError(
      "counter_list_incomplete",
      `API вернул только ${counters.length} из ${rows} счётчиков; создание остановлено.`,
    );
  }
  return counters;
}

async function readCounter(api, counterId) {
  const response = await api.get(metrikaUrl(
    `/management/v1/counter/${encodeURIComponent(counterId)}`,
    { field: "counter_flags,mirrors" },
  ));
  if (!response?.counter) {
    throw new SetupBlockedError("counter_readback_missing", `Счётчик ${counterId} не прочитан после API-запроса.`);
  }
  return response.counter;
}

async function listGoals(api, counterId) {
  const response = await api.get(metrikaUrl(
    `/management/v1/counter/${encodeURIComponent(counterId)}/goals`,
  ));
  return Array.isArray(response?.goals) ? response.goals : [];
}

function validateMeasurementToken(value) {
  const token = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._~-]{16,256}$/u.test(token)) {
    throw new SetupBlockedError(
      "measurement_token_invalid",
      "API вернул measurement token небезопасного или неожиданного формата.",
    );
  }
  return token;
}

async function readMeasurementTokens(api, counterId) {
  const response = await api.get(metrikaUrl(
    `/management/v1/counter/${encodeURIComponent(counterId)}`,
    { field: "measurement_tokens,counter_flags" },
  ));
  const rawTokens = Array.isArray(response?.counter?.measurement_tokens)
    ? response.counter.measurement_tokens
    : [];
  const tokens = [...new Set(rawTokens.map(validateMeasurementToken))];
  if (tokens.length > 5) {
    throw new SetupBlockedError(
      "measurement_token_count_invalid",
      "API вернул больше пяти активных Measurement Protocol tokens.",
    );
  }
  return tokens;
}

async function generateMeasurementToken(api, counterId) {
  const response = await api.get(metrikaUrl(
    `/management/v1/counter/${encodeURIComponent(counterId)}/measurement/generate`,
  ));
  return validateMeasurementToken(response?.response);
}

export function readRuntimeSecret(runtimePath = RUNTIME_SECRET_PATH) {
  if (!fs.existsSync(runtimePath)) return null;
  const stat = fs.lstatSync(runtimePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new SetupBlockedError(
      "runtime_secret_unsafe_path",
      `Runtime secret path должен быть обычным файлом: ${runtimePath}.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  } catch {
    throw new SetupBlockedError(
      "runtime_secret_invalid",
      `Существующий runtime secret повреждён; автоматическая перезапись запрещена: ${runtimePath}.`,
    );
  }
  if (!Number.isSafeInteger(Number(parsed?.counter_id)) || Number(parsed.counter_id) <= 0) {
    throw new SetupBlockedError("runtime_secret_invalid", "Runtime secret содержит некорректный counter_id.");
  }
  return {
    counterId: Number(parsed.counter_id),
    measurementToken: validateMeasurementToken(parsed.measurement_token),
    goalIds: parsed.goal_ids && typeof parsed.goal_ids === "object"
      ? {
          crm_conversion: Number(parsed.goal_ids.crm_conversion) || null,
          lead_submit: Number(parsed.goal_ids.lead_submit) || null,
        }
      : null,
  };
}

function validateRuntimePayload(payload) {
  const counterId = Number(payload?.counter_id);
  const hardGoalId = Number(payload?.goal_ids?.crm_conversion);
  const softGoalId = Number(payload?.goal_ids?.lead_submit);
  if (!Number.isSafeInteger(counterId) || counterId <= 0) {
    throw new SetupBlockedError("runtime_secret_invalid", "Нельзя сохранить runtime secret без counter_id.");
  }
  if (!Number.isSafeInteger(hardGoalId) || hardGoalId <= 0
    || !Number.isSafeInteger(softGoalId) || softGoalId <= 0) {
    throw new SetupBlockedError("runtime_secret_invalid", "Нельзя сохранить runtime secret без двух goal IDs.");
  }
  validateMeasurementToken(payload?.measurement_token);
}

export function saveRuntimeSecret(runtimePath, payload) {
  validateRuntimePayload(payload);
  const directory = path.dirname(runtimePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.existsSync(runtimePath)) {
    const existing = readRuntimeSecret(runtimePath);
    if (existing.counterId !== Number(payload.counter_id)) {
      throw new SetupBlockedError(
        "runtime_secret_counter_mismatch",
        "Существующий runtime secret относится к другому счётчику; перезапись запрещена.",
      );
    }
  }

  const temporaryPath = path.join(
    directory,
    `.${path.basename(runtimePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  let fileDescriptor = null;
  try {
    fileDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fileDescriptor, serialized, "utf8");
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = null;
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, runtimePath);
    fs.chmodSync(runtimePath, 0o600);
  } catch (error) {
    if (fileDescriptor !== null) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {
        // The original write error remains authoritative.
      }
    }
    if (fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // A precise stale temp path is reported by the primary write error.
      }
    }
    if (error instanceof SetupBlockedError) throw error;
    throw new SetupBlockedError(
      "runtime_secret_write_failed",
      `Runtime secret не сохранён атомарно: ${error?.message || error}.`,
    );
  }

  const readback = readRuntimeSecret(runtimePath);
  if (readback.counterId !== Number(payload.counter_id)
    || readback.measurementToken !== payload.measurement_token
    || readback.goalIds?.crm_conversion !== Number(payload.goal_ids.crm_conversion)
    || readback.goalIds?.lead_submit !== Number(payload.goal_ids.lead_submit)) {
    throw new SetupBlockedError(
      "runtime_secret_readback_failed",
      "Runtime secret не прошёл локальный readback после атомарной записи.",
    );
  }
  return {
    path: runtimePath,
    saved: true,
    counterId: readback.counterId,
    goalIds: readback.goalIds,
    requestedFileMode: "0600",
  };
}

function counterPrimaryHost(counter) {
  return normalizeSiteHost(counter?.site2?.site || counter?.site2?.domain || counter?.site);
}

function counterMirrorHosts(counter) {
  const mirrors = Array.isArray(counter?.mirrors2)
    ? counter.mirrors2
    : Array.isArray(counter?.mirrors)
      ? counter.mirrors
      : [];
  return mirrors
    .map((mirror) => normalizeSiteHost(mirror?.site || mirror?.domain || mirror))
    .filter(Boolean);
}

export function resolveTargetCounter(counters) {
  const exactPrimary = [];
  const mirrorConflicts = [];
  for (const counter of counters) {
    const primary = counterPrimaryHost(counter);
    const mirrors = counterMirrorHosts(counter);
    if (primary === TARGET_DOMAIN) exactPrimary.push(counter);
    if (primary !== TARGET_DOMAIN && mirrors.includes(TARGET_DOMAIN)) {
      mirrorConflicts.push({ id: counter?.id ?? null, primary });
    }
  }

  if (exactPrimary.length > 1 || mirrorConflicts.length > 0) {
    throw new SetupBlockedError(
      "counter_ambiguous",
      `Обнаружена неоднозначная привязка ${TARGET_DOMAIN}; новый счётчик не создаётся.`,
      {
        exactPrimaryIds: exactPrimary.map((counter) => counter?.id ?? null),
        mirrorConflicts,
      },
    );
  }
  return exactPrimary[0] ?? null;
}

function sameBoolean(actual, expected) {
  const normalized = actual === true || actual === 1
    ? true
    : actual === false || actual === 0
      ? false
      : null;
  return normalized === expected;
}

export function auditCounterSettings(counter) {
  const problems = [];
  const primaryHost = counterPrimaryHost(counter);
  const mirrors = counterMirrorHosts(counter);
  const ownerLogin = normalizeLogin(counter?.owner_login);
  const permission = String(counter?.permission ?? "").trim().toLowerCase();
  const status = String(counter?.status ?? "").trim();
  const type = String(counter?.type ?? "").trim();
  const flags = counter?.counter_flags ?? {};

  if (primaryHost !== TARGET_DOMAIN) problems.push(`site2.site=${primaryHost || "не определён"}`);
  const foreignMirrors = mirrors.filter((host) => !ALLOWED_SITE_HOSTS.has(host));
  if (foreignMirrors.length) problems.push(`чужие mirrors=${foreignMirrors.join(",")}`);
  if (ownerLogin !== EXPECTED_LOGIN) problems.push(`owner_login=${ownerLogin || "не определён"}`);
  if (permission !== "own") problems.push(`permission=${permission || "не определён"}`);
  if (status !== "Active") problems.push(`status=${status || "не определён"}`);
  if (type !== "simple") problems.push(`type=${type || "не определён"}`);
  if (String(counter?.name ?? "") !== TARGET_COUNTER_NAME) problems.push("name отличается от канонического");
  if (String(counter?.time_zone_name ?? "") !== TARGET_TIME_ZONE) problems.push("time_zone_name отличается");
  if (Number(counter?.filter_robots) !== DESIRED_COUNTER.filter_robots) problems.push("filter_robots отличается");
  if (!sameBoolean(counter?.autogoals_enabled, false)) problems.push("autogoals_enabled должен быть false");
  for (const [key, expected] of Object.entries(DESIRED_COUNTER.counter_flags)) {
    if (!sameBoolean(flags[key], expected)) problems.push(`counter_flags.${key} отличается`);
  }

  return {
    ok: problems.length === 0,
    problems,
    snapshot: {
      id: counter?.id ?? null,
      name: String(counter?.name ?? ""),
      primaryHost,
      mirrors,
      ownerLogin: ownerLogin || null,
      permission: permission || null,
      status: status || null,
      type: type || null,
      timeZone: counter?.time_zone_name ?? null,
      filterRobots: counter?.filter_robots ?? null,
      autogoalsEnabled: Boolean(counter?.autogoals_enabled),
      counterFlags: Object.fromEntries(
        Object.keys(DESIRED_COUNTER.counter_flags).map((key) => [key, Boolean(flags[key])]),
      ),
    },
  };
}

export function buildGoalPayload(definition) {
  return {
    goal: {
      name: definition.name,
      type: "action",
      is_favorite: definition.isFavorite,
      conditions: [{ type: "exact", url: definition.event }],
    },
  };
}

function actionConditions(goal) {
  return Array.isArray(goal?.conditions) ? goal.conditions : [];
}

function isExactCanonicalGoal(goal, definition) {
  const conditions = actionConditions(goal);
  return goal?.type === "action"
    && conditions.length === 1
    && conditions[0]?.type === "exact"
    && conditions[0]?.url === definition.event
    && String(goal?.name ?? "") === definition.name
    && Boolean(goal?.is_favorite) === definition.isFavorite;
}

export function assessGoals(goals) {
  const result = {};
  const conflicts = [];
  for (const definition of GOAL_DEFINITIONS) {
    const eventMatches = goals.filter((goal) =>
      goal?.type === "action"
      && actionConditions(goal).some(
        (condition) => condition?.type === "exact" && condition?.url === definition.event,
      ));
    const nameMatches = goals.filter((goal) => String(goal?.name ?? "") === definition.name);
    const candidates = [...new Set([...eventMatches, ...nameMatches])];

    if (candidates.length > 1) {
      conflicts.push(`${definition.key}: найдено несколько целей по имени или событию ${definition.event}`);
      result[definition.key] = { status: "conflict", event: definition.event, id: null };
      continue;
    }
    if (candidates.length === 1 && !isExactCanonicalGoal(candidates[0], definition)) {
      conflicts.push(`${definition.key}: существующая цель ${definition.event} имеет другую структуру`);
      result[definition.key] = {
        status: "conflict",
        event: definition.event,
        id: candidates[0]?.id ?? null,
      };
      continue;
    }
    if (candidates.length === 1) {
      result[definition.key] = {
        status: "existing",
        event: definition.event,
        id: candidates[0]?.id ?? null,
      };
      continue;
    }
    result[definition.key] = { status: "missing", event: definition.event, id: null };
  }
  return { goals: result, conflicts };
}

function safeRouteEvidence(routeEvidence) {
  return {
    status: routeEvidence?.status ?? null,
    accountSlug: routeEvidence?.accountSlug ?? null,
    service: routeEvidence?.service ?? null,
    project: routeEvidence?.project ?? null,
    domain: routeEvidence?.domain ?? null,
    ulogin: routeEvidence?.ulogin ?? null,
    apiEnvPath: routeEvidence?.apiEnvPath ?? null,
  };
}

function baseReport({ mode, generatedAt, routeEvidence }) {
  return {
    receiptVersion: 1,
    generatedAt,
    mode,
    project: EXPECTED_PROJECT,
    domain: TARGET_DOMAIN,
    account: EXPECTED_LOGIN,
    routing: safeRouteEvidence(routeEvidence),
    mutationPolicy: {
      externalWritesAllowed: mode === "apply",
      runtimeSecretWriteAllowed: mode === "apply",
      browserAllowed: false,
      deleteAllowed: false,
      counterUpdateAllowed: false,
    },
    conversionPolicy: Object.fromEntries(
      GOAL_DEFINITIONS.map((definition) => [definition.key, {
        event: definition.event,
        name: definition.name,
        evidenceBoundary: definition.evidenceBoundary,
      }]),
    ),
  };
}

function planFor(counter, goalAssessment) {
  return {
    createCounter: !counter,
    createGoals: GOAL_DEFINITIONS
      .filter((definition) => goalAssessment?.goals?.[definition.key]?.status === "missing" || !counter)
      .map((definition) => definition.event),
    checkAndPersistMeasurementRuntimeInApply: true,
    forbidden: [
      "не создавать DOM-имитацию crm_conversion",
      "не объединять показатели с rosomaha.site или xn--80aa8ahaki9a.site",
      "не обновлять и не удалять неоднозначный существующий счётчик",
    ],
  };
}

function summarizeApiCalls(api) {
  return {
    getRequests: api.calls.filter((call) => call.method === "GET").length,
    postRequests: api.calls.filter((call) => call.method === "POST").length,
    putRequests: api.calls.filter((call) => call.method === "PUT").length,
    mutationRequests: api.calls.filter(
      (call) => ["POST", "PUT"].includes(call.method)
        || call.path.endsWith("/measurement/generate"),
    ).length,
  };
}

async function createCounterWithReadback(api) {
  const secondList = await listCounters(api);
  const appeared = resolveTargetCounter(secondList);
  if (appeared) return { counter: await readCounter(api, appeared.id), created: false };

  const response = await api.post(
    metrikaUrl("/management/v1/counters", { field: "counter_flags,mirrors" }),
    { counter: CREATE_COUNTER_PAYLOAD },
  );
  const counterId = response?.counter?.id;
  if (!Number.isSafeInteger(Number(counterId)) || Number(counterId) <= 0) {
    throw new SetupBlockedError("counter_create_no_id", "API создания счётчика не вернул корректный id.");
  }

  const counter = await readCounter(api, counterId);
  const afterList = await listCounters(api);
  const resolved = resolveTargetCounter(afterList);
  if (!resolved || String(resolved.id) !== String(counterId)) {
    throw new SetupBlockedError(
      "counter_create_readback_mismatch",
      "После создания точный счётчик не подтверждён повторным списком API.",
      { createdCounterId: counterId, resolvedCounterId: resolved?.id ?? null },
    );
  }
  return { counter, created: true };
}

function updateableCounterProblems(problems = []) {
  return problems.filter((problem) => ![
    "name отличается от канонического",
    "time_zone_name отличается",
    "filter_robots отличается",
    "autogoals_enabled должен быть false",
    "counter_flags.use_in_benchmarks отличается",
    "counter_flags.direct_allow_use_goals_without_access отличается",
    "counter_flags.collect_first_party_data отличается",
    "counter_flags.measurement_enabled отличается",
  ].includes(problem));
}

async function reconcileCounterSettings(api, counter) {
  const firstAudit = auditCounterSettings(counter);
  if (firstAudit.ok) return counter;

  const nonUpdateable = updateableCounterProblems(firstAudit.problems);
  if (nonUpdateable.length) {
    throw new SetupBlockedError(
      "counter_settings_mismatch",
      "Существующий счётчик не совпадает с безопасной конфигурацией; автоматическое обновление запрещено.",
      { problems: firstAudit.problems },
    );
  }

  const response = await api.put(
    metrikaUrl(`/management/v1/counter/${encodeURIComponent(counter.id)}`, {
      field: "counter_flags,mirrors",
    }),
    { counter: DESIRED_COUNTER },
  );
  const updated = response?.counter ?? await readCounter(api, counter.id);
  const finalAudit = auditCounterSettings(updated);
  if (!finalAudit.ok) {
    throw new SetupBlockedError(
      "counter_settings_update_failed",
      "API не подтвердил безопасную конфигурацию счётчика после PUT readback.",
      { problems: finalAudit.problems, counterId: counter.id },
    );
  }
  return updated;
}

async function ensureGoals(api, counterId) {
  const created = [];
  for (const definition of GOAL_DEFINITIONS) {
    const firstAssessment = assessGoals(await listGoals(api, counterId));
    if (firstAssessment.conflicts.length) {
      throw new SetupBlockedError("goal_conflict", firstAssessment.conflicts.join("; "));
    }
    if (firstAssessment.goals[definition.key].status === "existing") continue;

    const secondAssessment = assessGoals(await listGoals(api, counterId));
    if (secondAssessment.conflicts.length) {
      throw new SetupBlockedError("goal_conflict", secondAssessment.conflicts.join("; "));
    }
    if (secondAssessment.goals[definition.key].status === "existing") continue;

    const response = await api.post(
      metrikaUrl(`/management/v1/counter/${encodeURIComponent(counterId)}/goals`),
      buildGoalPayload(definition),
    );
    const goalId = response?.goal?.id;
    if (!Number.isSafeInteger(Number(goalId)) || Number(goalId) <= 0) {
      throw new SetupBlockedError(
        "goal_create_no_id",
        `API создания цели ${definition.event} не вернул корректный id.`,
      );
    }
    const readback = assessGoals(await listGoals(api, counterId));
    if (readback.conflicts.length || readback.goals[definition.key].status !== "existing") {
      throw new SetupBlockedError(
        "goal_create_readback_mismatch",
        `Цель ${definition.event} не подтверждена повторным чтением API.`,
      );
    }
    created.push({ key: definition.key, event: definition.event, id: readback.goals[definition.key].id });
  }
  return created;
}

export async function executeSetup({
  mode,
  token,
  routeEvidence,
  fetchImpl = globalThis.fetch,
  nativeRequest = nativeHttpsRequest,
  curlRequest = curlStdinRequest,
  runtimePath = RUNTIME_SECRET_PATH,
  readRuntime = readRuntimeSecret,
  saveRuntime = saveRuntimeSecret,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!MODES.has(mode)) throw new SetupBlockedError("mode_invalid", `Недопустимый mode=${mode}.`);
  if (routeEvidence?.status !== "verified"
    || routeEvidence?.accountSlug !== ACCOUNT_SLUG
    || routeEvidence?.project !== EXPECTED_PROJECT
    || routeEvidence?.domain !== TARGET_DOMAIN
    || normalizeLogin(routeEvidence?.ulogin) !== EXPECTED_LOGIN) {
    throw new SetupBlockedError("route_mismatch", "Переданный маршрут проекта не прошёл точную проверку.");
  }

  const api = createApiClient({ token, fetchImpl, nativeRequest, curlRequest });
  const report = baseReport({ mode, generatedAt, routeEvidence });
  report.identity = await readIdentity(api);

  const firstList = await listCounters(api);
  let listedCounter = resolveTargetCounter(firstList);
  let counter = listedCounter ? await readCounter(api, listedCounter.id) : null;
  let counterCreated = false;

  if (!counter && mode === "apply") {
    const creation = await createCounterWithReadback(api);
    counter = creation.counter;
    counterCreated = creation.created;
  }

  if (!counter) {
    const status = mode === "dry-run" ? "plan_ready" : "needs_apply";
    return {
      ...report,
      status,
      counter: { status: "missing", id: null, createdDuringRun: false },
      goals: Object.fromEntries(
        GOAL_DEFINITIONS.map((definition) => [definition.key, {
          status: "missing",
          event: definition.event,
          id: null,
        }]),
      ),
      plan: planFor(null, null),
      runtimeSecret: { status: "not_inspected", reason: "measurement_tokens читаются только в --apply" },
      apiEvidence: summarizeApiCalls(api),
    };
  }

  if (counter && mode === "apply" && counterCreated) {
    counter = await reconcileCounterSettings(api, counter);
  }

  const settingsAudit = auditCounterSettings(counter);
  if (!settingsAudit.ok) {
    return {
      ...report,
      status: "blocked",
      blocker: {
        code: "counter_settings_mismatch",
        message: "Существующий счётчик не совпадает с безопасной конфигурацией; автоматическое обновление запрещено.",
        problems: settingsAudit.problems,
      },
      counter: {
        status: "mismatch",
        id: counter?.id ?? null,
        createdDuringRun: counterCreated,
        settings: settingsAudit.snapshot,
      },
      goals: null,
      plan: { createCounter: false, createGoals: [], manualReviewRequired: true },
      runtimeSecret: { status: "not_inspected" },
      apiEvidence: summarizeApiCalls(api),
    };
  }

  let goalAssessment = assessGoals(await listGoals(api, counter.id));
  if (goalAssessment.conflicts.length) {
    return {
      ...report,
      status: "blocked",
      blocker: { code: "goal_conflict", message: goalAssessment.conflicts.join("; ") },
      counter: {
        status: counterCreated ? "created" : "existing",
        id: counter.id,
        createdDuringRun: counterCreated,
        settings: settingsAudit.snapshot,
      },
      goals: goalAssessment.goals,
      plan: { createCounter: false, createGoals: [], manualReviewRequired: true },
      runtimeSecret: { status: "not_inspected" },
      apiEvidence: summarizeApiCalls(api),
    };
  }

  let createdGoals = [];
  const missingBefore = GOAL_DEFINITIONS.filter(
    (definition) => goalAssessment.goals[definition.key].status === "missing",
  );
  if (mode === "apply" && missingBefore.length) {
    createdGoals = await ensureGoals(api, counter.id);
    goalAssessment = assessGoals(await listGoals(api, counter.id));
    if (goalAssessment.conflicts.length
      || GOAL_DEFINITIONS.some((definition) => goalAssessment.goals[definition.key].status !== "existing")) {
      throw new SetupBlockedError("goal_final_readback_failed", "Финальный readback целей не подтвердил конфигурацию.");
    }
  }

  const stillMissing = GOAL_DEFINITIONS.filter(
    (definition) => goalAssessment.goals[definition.key].status === "missing",
  );
  const status = stillMissing.length
    ? mode === "dry-run" ? "plan_ready" : "needs_apply"
    : "ok";

  let runtimeSecret = {
    status: "not_inspected",
    reason: "measurement_tokens читаются и сохраняются только в --apply",
  };
  if (mode === "apply" && stillMissing.length === 0) {
    const existingRuntime = readRuntime(runtimePath);
    if (existingRuntime && existingRuntime.counterId !== Number(counter.id)) {
      throw new SetupBlockedError(
        "runtime_secret_counter_mismatch",
        "Runtime secret относится к другому счётчику; Measurement Protocol provisioning остановлен.",
      );
    }

    let activeTokens = await readMeasurementTokens(api, counter.id);
    let generatedDuringRun = false;
    let measurementToken = existingRuntime?.measurementToken
      && activeTokens.includes(existingRuntime.measurementToken)
      ? existingRuntime.measurementToken
      : activeTokens[0] ?? null;
    if (!measurementToken) {
      const generatedToken = await generateMeasurementToken(api, counter.id);
      generatedDuringRun = true;
      activeTokens = await readMeasurementTokens(api, counter.id);
      if (!activeTokens.includes(generatedToken)) {
        throw new SetupBlockedError(
          "measurement_token_readback_failed",
          "Сгенерированный Measurement Protocol token не подтверждён повторным чтением API.",
        );
      }
      measurementToken = generatedToken;
    }

    const runtimePayload = {
      schema_version: 1,
      project: EXPECTED_PROJECT,
      account: EXPECTED_LOGIN,
      domain: TARGET_DOMAIN,
      counter_id: Number(counter.id),
      measurement_token: measurementToken,
      goal_ids: {
        crm_conversion: Number(goalAssessment.goals.hard.id),
        lead_submit: Number(goalAssessment.goals.soft.id),
      },
      updated_at: generatedAt,
    };
    const saved = await saveRuntime(runtimePath, runtimePayload);
    runtimeSecret = {
      status: "saved",
      path: saved.path || runtimePath,
      counterId: Number(counter.id),
      goalIds: {
        crm_conversion: Number(goalAssessment.goals.hard.id),
        lead_submit: Number(goalAssessment.goals.soft.id),
      },
      activeTokenCount: activeTokens.length,
      generatedDuringRun,
      requestedFileMode: saved.requestedFileMode || "0600",
    };
  }

  return {
    ...report,
    status,
    counter: {
      status: counterCreated ? "created" : "existing",
      id: counter.id,
      createdDuringRun: counterCreated,
      settings: settingsAudit.snapshot,
    },
    goals: goalAssessment.goals,
    createdGoals,
    plan: planFor(counter, goalAssessment),
    runtimeSecret,
    evidenceBoundary:
      "Наличие action-цели crm_conversion доказывает только конфигурацию Метрики. Оно не доказывает, что Bitrix/CRM уже отправляет событие строго после подтверждённого deal_id.",
    apiEvidence: summarizeApiCalls(api),
  };
}

function safeError(error, token) {
  return {
    code: error?.code || "unexpected_error",
    message: redactSensitive(error?.message || String(error), token ? [token] : []),
    details: error?.details && typeof error.details === "object" ? error.details : null,
  };
}

function assertNoSecrets(serialized, secrets = []) {
  for (const secret of secrets) {
    if (secret && serialized.includes(secret)) {
      throw new Error("Запись receipt остановлена: в JSON обнаружен секрет.");
    }
  }
  if (/Authorization\s*[:=]\s*(?:OAuth|Bearer)\s+(?!\[REDACTED\])/iu.test(serialized)) {
    throw new Error("Запись receipt остановлена: обнаружен Authorization header.");
  }
  if (/"(?:measurement_tokens?|oauth_token|access_token|secret)"\s*:/iu.test(serialized)) {
    throw new Error("Запись receipt остановлена: обнаружено секретное поле.");
  }
}

export function saveReceipt(reportDir, report, secrets = []) {
  const stamp = String(report.generatedAt || new Date().toISOString()).replace(/[:.]/gu, "-");
  const filename = `ROSOMAHA_RUS_METRIKA_SETUP_${stamp}_${report.mode || "unknown"}.json`;
  const outputPath = path.join(reportDir, filename);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assertNoSecrets(serialized, secrets);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(outputPath, serialized, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const generatedAt = dependencies.generatedAt || new Date().toISOString();
  const log = dependencies.log || console.log;
  const reportDir = dependencies.reportDir || REPORT_DIR;
  let mode = "unknown";
  let routeEvidence = null;
  let token = null;
  let report;

  try {
    mode = parseMode(argv);
    routeEvidence = (dependencies.resolveRoute || resolveMetrikaRoute)();
    token = (dependencies.loadToken || loadProjectToken)(routeEvidence.apiEnvPath);
    report = await (dependencies.execute || executeSetup)({
      mode,
      token,
      routeEvidence,
      fetchImpl: dependencies.fetchImpl || globalThis.fetch,
      nativeRequest: dependencies.nativeRequest || nativeHttpsRequest,
      curlRequest: dependencies.curlRequest || curlStdinRequest,
      runtimePath: dependencies.runtimePath || RUNTIME_SECRET_PATH,
      readRuntime: dependencies.readRuntime || readRuntimeSecret,
      saveRuntime: dependencies.saveRuntime || saveRuntimeSecret,
      generatedAt,
    });
  } catch (error) {
    report = {
      ...baseReport({ mode, generatedAt, routeEvidence }),
      status: "blocked",
      blocker: safeError(error, token),
    };
  }

  const outputPath = (dependencies.save || saveReceipt)(reportDir, report, token ? [token] : []);
  log(`Режим: ${mode}`);
  log(`Статус: ${report.status}`);
  log(`Счётчик: ${report.counter?.id ?? "не создан"}`);
  log(`Receipt: ${outputPath}`);
  if (report.status === "blocked") process.exitCode = 1;
  return { report, outputPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE;
if (isMain) {
  runCli().catch((error) => {
    console.error(redactSensitive(error?.message || error));
    process.exitCode = 1;
  });
}
