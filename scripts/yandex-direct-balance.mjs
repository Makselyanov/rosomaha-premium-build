import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXACT_LOGIN = "rosomaha-rus999";
export const V5_CLIENTS_URL = "https://api.direct.yandex.com/json/v5/clients";
export const LIVE4_ACCOUNT_URL = "https://api.direct.yandex.ru/live/v4/json/";
export const V5_CLIENT_FIELDS = Object.freeze([
  "Login",
  "Type",
  "Currency",
  "VatRate",
  "Settings",
  "Bonuses",
  "OverdraftSumAvailable",
]);
export const OWN_FUNDS_CLI_MESSAGE =
  "Собственный остаток недоступен: API показал общий баланс кабинета, но не разделил его на внесённые владельцем деньги и отсрочку/кредит; это не ноль, но без подтверждённой суммы нельзя безопасно продолжать или увеличивать расход. Овердрафт не учитывается.";

const ROOT_DIR = process.cwd();
const ENV_PATH = path.join(ROOT_DIR, ".env.seo.local");
const REPORT_DIR = path.join(ROOT_DIR, "marketing-audits", "yandex-direct-balance");
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const OWN_FUNDS_REASON =
  "API Яндекс Директа показывает общий баланс счёта, сумму для перевода, овердрафт и ожидающие бонусы отдельными полями, но не показывает, какая часть общего баланса является собственными деньгами владельца. Поэтому собственный остаток по этим методам доказать нельзя; овердрафт и бонусы к нему не прибавляются.";

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = line.slice(separatorIndex + 1).trim();
  }

  return values;
}

export function loadProjectToken(filePath = ENV_PATH) {
  const token = parseEnvFile(filePath).YANDEX_OAUTH_TOKEN?.trim();
  if (!token) {
    throw new Error("В проектном файле .env.seo.local отсутствует YANDEX_OAUTH_TOKEN.");
  }
  return token;
}

export function redactSensitive(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      text = text.split(secret).join("[REDACTED]");
    }
  }

  return text
    .replace(/Bearer\s+[^\s"',}]+/giu, "Bearer [REDACTED]")
    .replace(/("(?:token|oauth_token|authorization)"\s*:\s*")[^"]*(")/giu, "$1[REDACTED]$2")
    .replace(/\b(?:y0_|AgAA|AQAAAA)[A-Za-z0-9._~-]+\b/gu, "[REDACTED]")
    .slice(0, 800);
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (!entry) return null;
  return Array.isArray(entry[1]) ? entry[1][0] ?? null : entry[1] ?? null;
}

function safeRequestId(headers) {
  const value = getHeader(headers, "RequestId");
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  return /^[A-Za-z0-9._:-]{1,160}$/u.test(normalized)
    ? normalized
    : "[REDACTED_INVALID_REQUEST_ID]";
}

function safeUnitsUsedLogin(headers) {
  const value = getHeader(headers, "Units-Used-Login");
  if (value == null || value === "") return null;
  return String(value).trim() === EXACT_LOGIN ? EXACT_LOGIN : "[REDACTED_OTHER_LOGIN]";
}

export function nativeHttpsRequest(url, requestOptions, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:") {
      reject(new Error("Разрешены только HTTPS-запросы."));
      return;
    }

    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = https.request(
      target,
      {
        method: requestOptions.method,
        headers: requestOptions.headers,
      },
      (response) => {
        const chunks = [];
        let responseBytes = 0;
        response.on("data", (chunk) => {
          const buffer = Buffer.from(chunk);
          responseBytes += buffer.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            const error = new Error(`HTTPS response exceeds ${MAX_RESPONSE_BYTES} bytes`);
            response.destroy(error);
            request.destroy(error);
            fail(error);
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", fail);
        response.on("end", () => {
          const status = Number(response.statusCode || 0);
          succeed({
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`HTTPS timeout after ${timeoutMs} ms`));
    });
    request.on("error", fail);
    if (requestOptions.body) request.write(requestOptions.body);
    request.end();
  });
}

async function fetchRequest(url, requestOptions, fetchImpl, timeoutMs) {
  if (typeof fetchImpl !== "function") throw new Error("fetch transport is unavailable");

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`fetch timeout after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(url, { ...requestOptions, signal: controller.signal }),
      timeout,
    ]);
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
      headers: response.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function safeJsonRequest(
  url,
  requestOptions,
  {
    fetchImpl = globalThis.fetch,
    nativeRequest = nativeHttpsRequest,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    secrets = [],
  } = {},
) {
  let response;
  try {
    response = await fetchRequest(url, requestOptions, fetchImpl, timeoutMs);
  } catch (fetchError) {
    try {
      response = await nativeRequest(url, requestOptions, timeoutMs);
    } catch (nativeError) {
      throw new Error(
        `Оба сетевых транспорта Яндекс Директа недоступны: ${redactSensitive(nativeError?.message || nativeError, secrets)}`,
        { cause: fetchError },
      );
    }
  }

  let data;
  try {
    data = response.text ? JSON.parse(response.text) : null;
  } catch {
    throw new Error(
      `Яндекс Директ вернул не JSON (HTTP ${response.status}): ${redactSensitive(response.text, secrets)}`,
    );
  }

  return {
    ok: Boolean(response.ok),
    status: Number(response.status || 0),
    data,
    providerMeta: {
      requestId: safeRequestId(response.headers),
      unitsUsedLogin: safeUnitsUsedLogin(response.headers),
    },
  };
}

export function buildReadOnlyRequests(token) {
  if (typeof token !== "string" || !token.trim()) throw new Error("Пустой OAuth-токен.");

  const requests = {
    v5ClientsGet: {
      url: V5_CLIENTS_URL,
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept-Language": "ru",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          method: "get",
          params: { FieldNames: [...V5_CLIENT_FIELDS] },
        }),
      },
    },
    live4AccountGet: {
      url: LIVE4_ACCOUNT_URL,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          method: "AccountManagement",
          token,
          locale: "ru",
          param: {
            Action: "Get",
            SelectionCriteria: { Logins: [EXACT_LOGIN] },
          },
        }),
      },
    },
  };

  assertReadOnlyRequests(requests);
  return requests;
}

function hasForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase();
    if (normalized === "finance_token" || normalized === "payment-token") return true;
    return hasForbiddenKey(child);
  });
}

function hasExactKeys(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function assertReadOnlyRequests(requests) {
  const v5 = requests?.v5ClientsGet;
  const live4 = requests?.live4AccountGet;
  if (v5?.url !== V5_CLIENTS_URL || live4?.url !== LIVE4_ACCOUNT_URL) {
    throw new Error("Запрос заблокирован: endpoint не входит в фиксированный allowlist.");
  }

  const v5Body = JSON.parse(v5.options.body);
  const live4Body = JSON.parse(live4.options.body);
  const v5HeaderNames = Object.keys(v5.options.headers).map((name) => name.toLowerCase());
  const live4HeaderNames = Object.keys(live4.options.headers).map((name) => name.toLowerCase());
  if (hasForbiddenKey(v5.options.headers) || hasForbiddenKey(v5Body) || hasForbiddenKey(live4.options.headers) || hasForbiddenKey(live4Body)) {
    throw new Error("Запрос заблокирован: обнаружен финансовый токен.");
  }
  if (v5.options.method !== "POST" || v5Body.method !== "get") {
    throw new Error("Запрос заблокирован: разрешён только Clients.get.");
  }
  if (v5HeaderNames.includes("client-login")) {
    throw new Error("Запрос заблокирован: Clients.get должен подтверждать владельца без Client-Login.");
  }
  if (JSON.stringify(v5Body.params?.FieldNames) !== JSON.stringify(V5_CLIENT_FIELDS)) {
    throw new Error("Запрос заблокирован: изменён минимальный список полей Clients.get.");
  }
  if (
    !hasExactKeys(v5Body, ["method", "params"]) ||
    !hasExactKeys(v5Body.params, ["FieldNames"]) ||
    !hasExactKeys(v5.options.headers, ["Authorization", "Accept-Language", "Content-Type"]) ||
    v5.options.headers["Accept-Language"] !== "ru" ||
    !String(v5.options.headers.Authorization || "").startsWith("Bearer ")
  ) {
    throw new Error("Запрос заблокирован: Clients.get содержит лишние или изменённые поля.");
  }
  if (
    live4.options.method !== "POST" ||
    live4Body.method !== "AccountManagement" ||
    live4Body.param?.Action !== "Get" ||
    JSON.stringify(live4Body.param?.SelectionCriteria?.Logins) !== JSON.stringify([EXACT_LOGIN]) ||
    live4Body.locale !== "ru"
  ) {
    throw new Error("Запрос заблокирован: разрешён только AccountManagement Action=Get для точного логина.");
  }
  const bearerToken = String(v5.options.headers.Authorization).slice("Bearer ".length);
  if (
    !hasExactKeys(live4Body, ["method", "token", "locale", "param"]) ||
    !hasExactKeys(live4Body.param, ["Action", "SelectionCriteria"]) ||
    !hasExactKeys(live4Body.param.SelectionCriteria, ["Logins"]) ||
    !hasExactKeys(live4.options.headers, ["Content-Type"]) ||
    live4HeaderNames.length !== 1 ||
    live4Body.token !== bearerToken ||
    !live4Body.token
  ) {
    throw new Error("Запрос заблокирован: AccountManagement содержит лишние поля или другой OAuth-токен.");
  }
}

function providerFailure(label, response, secrets) {
  const error = response?.data?.error;
  const legacyCode = response?.data?.error_code;
  if (response?.ok && !error && legacyCode == null) return null;

  const details = error?.error_detail || error?.error_string || error?.message ||
    response?.data?.error_detail || response?.data?.error_str || `HTTP ${response?.status || "unknown"}`;
  const requestId = response?.providerMeta?.requestId;
  const requestSuffix = requestId ? `, RequestId=${requestId}` : "";
  return new Error(`${label} недоступен (${redactSensitive(details, secrets)}${requestSuffix}).`);
}

export function microsToDecimal(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("Значение в микросах не является безопасным целым числом.");
  }
  const source = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^-?\d+$/u.test(source)) throw new Error("Значение в микросах должно быть целым числом.");

  const micros = BigInt(source);
  const sign = micros < 0n ? "-" : "";
  const absolute = micros < 0n ? -micros : micros;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeLegacyDecimal(value) {
  const source = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/u.test(source)) {
    throw new Error("Live 4 вернул некорректное денежное значение.");
  }

  const negative = source.startsWith("-");
  const unsigned = negative ? source.slice(1) : source;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = BigInt(wholeRaw).toString();
  const fraction = fractionRaw.replace(/0+$/u, "");
  const isZero = whole === "0" && !fraction;
  return `${negative && !isZero ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function oneExactClient(v5Data) {
  const clients = v5Data?.result?.Clients;
  if (!Array.isArray(clients) || clients.length !== 1) {
    throw new Error("Проверка аккаунта остановлена: Clients.get должен вернуть ровно одного клиента.");
  }
  const client = clients[0];
  if (client?.Login !== EXACT_LOGIN) {
    throw new Error("Проверка аккаунта остановлена: Clients.get вернул другой логин.");
  }
  if (client?.Type !== "CLIENT") {
    throw new Error("Проверка аккаунта остановлена: токен принадлежит агентству или агентскому субклиенту.");
  }
  if (typeof client.Currency !== "string" || !client.Currency) {
    throw new Error("Проверка аккаунта остановлена: Clients.get не вернул валюту.");
  }

  const sharedSettings = Array.isArray(client.Settings)
    ? client.Settings.filter((setting) => setting?.Option === "SHARED_ACCOUNT_ENABLED")
    : [];
  if (sharedSettings.length !== 1 || sharedSettings[0].Value !== "YES") {
    throw new Error("Проверка аккаунта остановлена: общий счёт не подтверждён как включённый.");
  }
  return client;
}

function oneExactAccount(live4Data) {
  const actions = live4Data?.data?.ActionsResult;
  if (!Array.isArray(actions) || actions.length !== 0) {
    throw new Error("Проверка аккаунта остановлена: Live 4 вернул ошибки выбора счёта.");
  }
  const accounts = live4Data?.data?.Accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error("Проверка аккаунта остановлена: AccountManagement должен вернуть ровно один счёт.");
  }

  const account = accounts[0];
  if (account?.Login !== EXACT_LOGIN) {
    throw new Error("Проверка аккаунта остановлена: AccountManagement вернул другой логин.");
  }
  if (Object.hasOwn(account, "AgencyName") && !(account.AgencyName == null || String(account.AgencyName).trim() === "")) {
    throw new Error("Проверка аккаунта остановлена: Live 4 показывает агентство или не подтвердил его отсутствие.");
  }
  if (typeof account.Currency !== "string" || !account.Currency) {
    throw new Error("Проверка аккаунта остановлена: AccountManagement не вернул валюту.");
  }
  if (!Object.hasOwn(account, "Amount") || !Object.hasOwn(account, "AmountAvailableForTransfer")) {
    throw new Error("Проверка баланса остановлена: Live 4 не вернул обязательные денежные поля.");
  }
  return account;
}

function microsField(value, currency, source, interpretation) {
  if (value == null) {
    return {
      status: "not_returned_by_api",
      amount: null,
      currency,
      source,
      interpretation,
      includedInOwnFunds: false,
    };
  }
  return {
    status: "available",
    amount: microsToDecimal(value),
    currency,
    source,
    interpretation,
    includedInOwnFunds: false,
  };
}

function pendingBonus(client) {
  const source = "v5 Clients.get Bonuses";
  if (client.Bonuses == null) {
    return {
      status: "not_returned_by_api",
      withVat: null,
      withoutVat: null,
      currency: client.Currency,
      source,
      includedInOwnFunds: false,
    };
  }
  if (
    !Object.hasOwn(client.Bonuses, "AwaitingBonus") ||
    !Object.hasOwn(client.Bonuses, "AwaitingBonusWithoutNds")
  ) {
    throw new Error("Проверка бонуса остановлена: Clients.get вернул неполную структуру Bonuses.");
  }
  return {
    status: "available",
    withVat: microsToDecimal(client.Bonuses.AwaitingBonus),
    withoutVat: microsToDecimal(client.Bonuses.AwaitingBonusWithoutNds),
    currency: client.Currency,
    source,
    includedInOwnFunds: false,
  };
}

export function buildBalanceReport({ v5Response, live4Response, generatedAt }) {
  const client = oneExactClient(v5Response.data);
  const account = oneExactAccount(live4Response.data);
  if (client.Currency !== account.Currency) {
    throw new Error("Проверка аккаунта остановлена: валюты Clients.get и AccountManagement не совпадают.");
  }

  const currency = client.Currency;
  return {
    receiptVersion: 1,
    generatedAt,
    status: "ok",
    provider: "Yandex Direct API",
    accountIdentity: {
      login: EXACT_LOGIN,
      type: "CLIENT",
      agency: "absent",
      sharedAccountEnabled: true,
      currency,
      vatRate: client.VatRate ?? null,
    },
    providerEvidence: {
      v5ClientsGet: {
        endpoint: V5_CLIENTS_URL,
        requestId: v5Response.providerMeta?.requestId ?? null,
        unitsUsedLogin: v5Response.providerMeta?.unitsUsedLogin ?? null,
      },
      live4AccountGet: {
        endpoint: LIVE4_ACCOUNT_URL,
        action: "Get",
        requestId: live4Response.providerMeta?.requestId ?? null,
        unitsUsedLogin: live4Response.providerMeta?.unitsUsedLogin ?? null,
      },
    },
    currentSharedAccountBalance: {
      status: "available",
      amount: normalizeLegacyDecimal(account.Amount),
      currency,
      source: "Live 4 AccountManagement.Get Amount",
      interpretation: "Текущий баланс общего рекламного счёта; происхождение денег внутри суммы API не разделяет.",
      includedInOwnFunds: false,
    },
    amountAvailableForTransfer: {
      status: "available",
      amount: normalizeLegacyDecimal(account.AmountAvailableForTransfer),
      currency,
      source: "Live 4 AccountManagement.Get AmountAvailableForTransfer",
      interpretation: "Сумма, доступная для перевода по правилам Директа; это не доказанный собственный остаток.",
      includedInOwnFunds: false,
    },
    overdraftLimitAvailable: microsField(
      client.OverdraftSumAvailable,
      currency,
      "v5 Clients.get OverdraftSumAvailable",
      "Доступный лимит овердрафта. Он никогда не считается деньгами владельца и не используется в бюджете.",
    ),
    pendingBonus: pendingBonus(client),
    ownFunds: {
      status: "not_provable_via_direct_api",
      amount: null,
      currency,
      reason: OWN_FUNDS_REASON,
    },
    arithmeticPolicy: {
      combinedTotalCalculated: false,
      overdraftCountedAsOwnFunds: false,
      pendingBonusCountedAsOwnFunds: false,
      safeSpendIncreaseAllowed: false,
    },
  };
}

export async function executeBalanceAudit({
  token,
  generatedAt = new Date().toISOString(),
  request = safeJsonRequest,
  transportOptions,
} = {}) {
  const requests = buildReadOnlyRequests(token);
  const v5Response = await request(V5_CLIENTS_URL, requests.v5ClientsGet.options, {
    ...transportOptions,
    secrets: [token],
  });
  const v5Failure = providerFailure("Clients.get", v5Response, [token]);
  if (v5Failure) throw v5Failure;
  oneExactClient(v5Response.data);

  const live4Response = await request(LIVE4_ACCOUNT_URL, requests.live4AccountGet.options, {
    ...transportOptions,
    secrets: [token],
  });
  const live4Failure = providerFailure("AccountManagement.Get", live4Response, [token]);
  if (live4Failure) throw live4Failure;

  return buildBalanceReport({ v5Response, live4Response, generatedAt });
}

function writeFileDurably(filePath, content, flag) {
  const handle = fs.openSync(filePath, flag, 0o600);
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function writeLatestAtomic(filePath, content) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileDurably(temporaryPath, content, "wx");
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

export function getBalanceOutputPaths(reportDir, generatedAt) {
  const stamp = generatedAt.replace(/[:.]/gu, "-");
  return {
    receipt: path.join(reportDir, `ROSOMAHA_DIRECT_BALANCE_${stamp}.json`),
    latest: path.join(reportDir, "latest.json"),
  };
}

export function saveBalanceArtifacts(reportDir, report, secrets = []) {
  fs.mkdirSync(reportDir, { recursive: true });
  const outputs = getBalanceOutputPaths(reportDir, report.generatedAt);
  const content = `${JSON.stringify(report, null, 2)}\n`;
  for (const secret of secrets) {
    if (secret && content.includes(secret)) {
      throw new Error("Запись отчёта остановлена: в результате обнаружен секрет.");
    }
  }

  writeFileDurably(outputs.receipt, content, "wx");
  writeLatestAtomic(outputs.latest, content);
  return outputs;
}

function failureReport(generatedAt, error, token) {
  return {
    receiptVersion: 1,
    generatedAt,
    status: "source_unavailable",
    provider: "Yandex Direct API",
    accountIdentity: { login: EXACT_LOGIN },
    ownFunds: {
      status: "not_provable_via_direct_api",
      amount: null,
      currency: null,
      reason: OWN_FUNDS_REASON,
    },
    error: redactSensitive(error?.message || error, token ? [token] : []),
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    throw new Error("У фиксированного помощника нет параметров командной строки.");
  }

  const generatedAt = new Date().toISOString();
  let token = null;
  let report;
  let failed = false;
  try {
    token = loadProjectToken();
    report = await executeBalanceAudit({ token, generatedAt });
  } catch (error) {
    failed = true;
    report = failureReport(generatedAt, error, token);
  }

  const outputs = saveBalanceArtifacts(REPORT_DIR, report, token ? [token] : []);
  console.log(`Статус: ${report.status}`);
  console.log(`Аккаунт: ${EXACT_LOGIN}`);
  if (report.status === "ok") {
    console.log(
      `Баланс общего счёта: ${report.currentSharedAccountBalance.amount} ${report.currentSharedAccountBalance.currency}`,
    );
    const overdraft = report.overdraftLimitAvailable.status === "available"
      ? `${report.overdraftLimitAvailable.amount} ${report.overdraftLimitAvailable.currency}`
      : "не возвращён API";
    console.log(`Лимит овердрафта (не собственные деньги, не используется): ${overdraft}`);
  } else {
    console.log("Баланс общего счёта: недоступен");
    console.log("Лимит овердрафта (не собственные деньги, не используется): недоступен");
    console.log(`Источник недоступен: ${report.error}`);
  }
  console.log(OWN_FUNDS_CLI_MESSAGE);
  console.log(`Отчёт: ${outputs.receipt}`);

  if (failed) process.exitCode = 1;
  return { report, outputs };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((error) => {
    console.error(redactSensitive(error?.message || error));
    process.exitCode = 1;
  });
}
