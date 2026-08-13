import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const EXACT_LOGIN = "rosomaha-rus999";
export const V5_CLIENTS_URL = "https://api.direct.yandex.com/json/v5/clients";
export const LIVE4_ACCOUNT_URL = "https://api.direct.yandex.ru/live/v4/json/";
export const ROUTE_ACCOUNT_SLUG = "rosomaha-yandex";
export const ROUTE_SERVICE = "yandex-suite";
export const ROUTE_REQUIRED_SERVICE = "direct";
export const ROUTE_PROJECT = "rosomaha";
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
  "Собственный остаток недоступен: API не показал, сколько собственных денег реально осталось на рекламном счёте; это не означает нулевой баланс, но без подтверждённой суммы нельзя безопасно продолжать или увеличивать расход. Овердрафт не учитывать никогда.";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
export const ENV_PATH = path.join(PROJECT_ROOT, ".env.seo.local");
export const REPORT_DIR = path.join(PROJECT_ROOT, "marketing-audits", "yandex-direct-balance");
export const REGISTRY_PATH = path.resolve(PROJECT_ROOT, "..", "accounts", "yandex-accounts.yaml");
const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_BYTES = 1_048_576;
const OWN_FUNDS_REASON =
  "API Яндекс Директа показывает общий баланс счёта, сумму для перевода, овердрафт и ожидающие бонусы отдельными полями, но не показывает, какая часть общего баланса является собственными деньгами владельца. Поэтому собственный остаток по этим методам доказать нельзя; овердрафт и бонусы к нему не прибавляются.";
const OWN_FUNDS_OFFICIAL_DOCUMENTATION = Object.freeze([
  Object.freeze({
    field: "Amount и AmountAvailableForTransfer",
    url: "https://yandex.com/dev/direct/doc/dg-v4/en/live/AccountManagement_Get",
    boundary: "Документация описывает общий баланс и доступную для перевода сумму, но не состав денег по источникам.",
  }),
  Object.freeze({
    field: "OverdraftSumAvailable",
    url: "https://yandex.com/dev/direct/doc/en/clients/get",
    boundary: "Документация определяет поле как доступный лимит овердрафта, а не текущий долг или использованный овердрафт.",
  }),
  Object.freeze({
    field: "отсроченный платёж",
    url: "https://yandex.ru/support/direct/ru/payments/deferred-payment",
    boundary: "Справка подтверждает, что кредитные средства могут быть зачислены на общий счёт и потому положительный общий баланс сам по себе не доказывает собственные деньги.",
  }),
]);

function yamlRegistrySyntaxError(message) {
  throw new Error(`Некорректный YAML registry: ${message}`);
}

function decodeDoubleQuotedEscape(source, slashIndex) {
  const escapeCode = source[slashIndex + 1];
  if (!escapeCode) yamlRegistrySyntaxError("незавершённая escape-последовательность в двойных кавычках.");

  const simpleEscapes = {
    "0": "\0",
    a: "\x07",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    e: "\x1b",
    " ": " ",
    "\"": "\"",
    "/": "/",
    "\\": "\\",
    N: "\u0085",
    _: "\u00a0",
    L: "\u2028",
    P: "\u2029",
  };
  if (Object.hasOwn(simpleEscapes, escapeCode)) {
    return { value: simpleEscapes[escapeCode], nextIndex: slashIndex + 2 };
  }

  const hexLengths = { x: 2, u: 4, U: 8 };
  const hexLength = hexLengths[escapeCode];
  if (!hexLength) {
    yamlRegistrySyntaxError(`недопустимая escape-последовательность \\${escapeCode}.`);
  }
  const digits = source.slice(slashIndex + 2, slashIndex + 2 + hexLength);
  if (digits.length !== hexLength || !/^[0-9A-Fa-f]+$/u.test(digits)) {
    yamlRegistrySyntaxError(`escape-последовательность \\${escapeCode} должна содержать ${hexLength} hex-цифр.`);
  }
  const codePoint = Number.parseInt(digits, 16);
  if (codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
    yamlRegistrySyntaxError(`escape-последовательность \\${escapeCode}${digits} задаёт недопустимый Unicode-код.`);
  }
  return {
    value: String.fromCodePoint(codePoint),
    nextIndex: slashIndex + 2 + hexLength,
  };
}

function parseQuotedYamlToken(source, startIndex = 0) {
  const quote = source[startIndex];
  if (quote !== "'" && quote !== "\"") {
    yamlRegistrySyntaxError("ожидалась строка в кавычках.");
  }

  let result = "";
  for (let index = startIndex + 1; index < source.length;) {
    const character = source[index];
    if (quote === "'" && character === "'") {
      if (source[index + 1] === "'") {
        result += "'";
        index += 2;
        continue;
      }
      return { value: result, nextIndex: index + 1 };
    }
    if (quote === "\"" && character === "\\") {
      const decoded = decodeDoubleQuotedEscape(source, index);
      result += decoded.value;
      index = decoded.nextIndex;
      continue;
    }
    if (quote === "\"" && character === "\"") {
      return { value: result, nextIndex: index + 1 };
    }
    result += character;
    index += 1;
  }

  yamlRegistrySyntaxError(`незакрытая ${quote === "'" ? "одинарная" : "двойная"} кавычка.`);
}

function assertOnlyYamlCommentAfter(source, startIndex) {
  if (startIndex === source.length) return;
  const suffix = source.slice(startIndex);
  if (!/^\s/u.test(suffix)) {
    yamlRegistrySyntaxError("после значения обнаружены символы без разделителя.");
  }
  const trimmed = suffix.trimStart();
  if (trimmed && !trimmed.startsWith("#")) {
    yamlRegistrySyntaxError("после значения разрешён только YAML-комментарий.");
  }
}

function stripPlainYamlComment(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function parseYamlInlineArray(value) {
  const source = value.trimStart();
  const items = [];
  let index = 1;
  let expectingItem = true;

  while (index < source.length) {
    while (/\s/u.test(source[index] ?? "")) index += 1;
    const character = source[index];
    if (!character) yamlRegistrySyntaxError("незакрытый inline-массив.");
    if (character === "]") {
      if (expectingItem && items.length > 0) {
        yamlRegistrySyntaxError("inline-массив содержит пустой последний элемент.");
      }
      assertOnlyYamlCommentAfter(source, index + 1);
      return items;
    }
    if (!expectingItem || character === ",") {
      yamlRegistrySyntaxError("inline-массив содержит пустой элемент или пропущенную запятую.");
    }

    let parsedItem;
    if (character === "'" || character === "\"") {
      parsedItem = parseQuotedYamlToken(source, index);
      index = parsedItem.nextIndex;
    } else {
      const itemStart = index;
      while (index < source.length && source[index] !== "," && source[index] !== "]") {
        if (source[index] === "[" || source[index] === "{" || source[index] === "}") {
          yamlRegistrySyntaxError("вложенные структуры в inline-массиве запрещены.");
        }
        index += 1;
      }
      const plainItem = source.slice(itemStart, index).trim();
      if (!plainItem) yamlRegistrySyntaxError("inline-массив содержит пустой элемент.");
      if (/\s/u.test(plainItem)) {
        yamlRegistrySyntaxError("элементы inline-массива с пробелами должны быть заключены в кавычки.");
      }
      if (/["'#:]/u.test(plainItem)) {
        yamlRegistrySyntaxError("небезопасный некавыченный элемент inline-массива.");
      }
      parsedItem = { value: plainItem };
    }

    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (source[index] !== "," && source[index] !== "]") {
      yamlRegistrySyntaxError("между элементами inline-массива пропущена запятая.");
    }
    items.push(parsedItem.value);
    expectingItem = false;
    if (source[index] === ",") {
      index += 1;
      expectingItem = true;
    }
  }

  yamlRegistrySyntaxError("незакрытый inline-массив.");
}

function parseYamlScalar(value) {
  const source = value.trimStart();
  if (!source || source.startsWith("#")) return "";
  if (source.startsWith("[")) return parseYamlInlineArray(source);
  if (source.startsWith("'") || source.startsWith("\"")) {
    const parsed = parseQuotedYamlToken(source);
    assertOnlyYamlCommentAfter(source, parsed.nextIndex);
    return parsed.value;
  }

  const plain = stripPlainYamlComment(source).trim();
  if (/[\[\]{}]/u.test(plain)) {
    yamlRegistrySyntaxError("незавершённая или вложенная YAML-структура в scalar-значении.");
  }
  return plain;
}

export function parseYandexAccountsRegistry(sourceText) {
  const accounts = Object.create(null);
  let inAccounts = false;
  let currentSlug = null;

  for (const rawLine of String(sourceText ?? "").split(/\r?\n/u)) {
    if (rawLine.includes("\t")) yamlRegistrySyntaxError("табуляция в отступах запрещена.");
    const line = rawLine;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (!inAccounts) {
      if (trimmed === "accounts:") inAccounts = true;
      continue;
    }

    if (!/^\s/u.test(line)) break;

    const accountMatch = line.match(/^  ([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/u);
    if (accountMatch) {
      currentSlug = accountMatch[1].trim();
      if (Object.hasOwn(accounts, currentSlug)) {
        throw new Error(`Registry содержит дублирующий account slug ${currentSlug}.`);
      }
      accounts[currentSlug] = Object.create(null);
      continue;
    }

    if (!currentSlug) yamlRegistrySyntaxError("свойство встретилось до имени account.");

    const propertyMatch = line.match(/^    ([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (!propertyMatch) yamlRegistrySyntaxError(`неподдерживаемая структура в account ${currentSlug}.`);
    const propertyName = propertyMatch[1];
    if (Object.hasOwn(accounts[currentSlug], propertyName)) {
      throw new Error(`Registry account ${currentSlug} содержит дублирующее свойство ${propertyName}.`);
    }
    accounts[currentSlug][propertyName] = parseYamlScalar(propertyMatch[2]);
  }

  return accounts;
}

function normalizeComparablePath(filePath) {
  return path.normalize(String(filePath ?? "")).toLowerCase();
}

function routeResolutionError(message, routeEvidence) {
  const error = new Error(message);
  error.routeEvidence = routeEvidence;
  return error;
}

function routeEvidenceBase({
  registryPath,
  accountSlug,
  projectRoot,
  expectedApiEnv,
  expectedProject,
  expectedDirectLogin,
}) {
  return {
    status: "blocked",
    registryPath,
    accountSlug,
    projectRoot,
    expectedProject,
    expectedDirectLogin,
    expectedApiEnv,
  };
}

export function resolveProjectRoute({
  registryPath = REGISTRY_PATH,
  projectRoot = PROJECT_ROOT,
  accountSlug = ROUTE_ACCOUNT_SLUG,
  expectedProject = ROUTE_PROJECT,
  expectedService = ROUTE_SERVICE,
  requiredService = ROUTE_REQUIRED_SERVICE,
  expectedDirectLogin = EXACT_LOGIN,
} = {}) {
  const expectedApiEnv = path.join(projectRoot, ".env.seo.local");
  const baseEvidence = routeEvidenceBase({
    registryPath,
    accountSlug,
    projectRoot,
    expectedApiEnv,
    expectedProject,
    expectedDirectLogin,
  });

  if (!fs.existsSync(registryPath)) {
    throw routeResolutionError(
      "Маршрут Yandex account остановлен: registry yandex-accounts.yaml не найден.",
      baseEvidence,
    );
  }

  let accounts;
  try {
    accounts = parseYandexAccountsRegistry(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: registry не удалось разобрать (${error.message}).`,
      baseEvidence,
    );
  }

  const account = accounts[accountSlug];
  if (!account) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: в registry отсутствует точная запись ${accountSlug}.`,
      baseEvidence,
    );
  }

  const service = String(account.service ?? "").trim();
  if (service !== expectedService) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен иметь service ${expectedService}.`,
      { ...baseEvidence, actualService: service || null },
    );
  }

  const services = Array.isArray(account.services) ? account.services.map((value) => String(value)) : [];
  if (!services.includes(requiredService)) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен включать service ${requiredService}.`,
      { ...baseEvidence, actualServices: services },
    );
  }

  const project = String(account.project ?? "").trim();
  if (project !== expectedProject) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен быть привязан к project ${expectedProject}.`,
      { ...baseEvidence, actualProject: project || null },
    );
  }

  const allowedProjects = Array.isArray(account.allowed_projects)
    ? account.allowed_projects.map((value) => String(value))
    : [];
  if (!allowedProjects.includes(expectedProject)) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен разрешать project ${expectedProject} в allowed_projects.`,
      { ...baseEvidence, actualAllowedProjects: allowedProjects },
    );
  }

  const directLogin = String(account.direct_login ?? "").trim();
  if (directLogin !== expectedDirectLogin) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен иметь direct_login ${expectedDirectLogin}.`,
      { ...baseEvidence, actualDirectLogin: directLogin || null },
    );
  }

  const apiEnvPath = String(account.api_env ?? "").trim();
  if (!apiEnvPath || normalizeComparablePath(apiEnvPath) !== normalizeComparablePath(expectedApiEnv)) {
    throw routeResolutionError(
      `Маршрут Yandex account остановлен: ${accountSlug} должен иметь api_env ${expectedApiEnv}.`,
      { ...baseEvidence, actualApiEnv: apiEnvPath || null },
    );
  }

  return {
    status: "verified",
    registryPath,
    accountSlug,
    projectRoot,
    expectedProject,
    expectedDirectLogin,
    expectedApiEnv,
    service,
    services,
    project,
    allowedProjects,
    directLogin,
    apiEnvPath,
  };
}

export function parseProjectTokenEnv(sourceText) {
  let token = null;
  let tokenKeySeen = false;
  for (const rawLine of String(sourceText ?? "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (key !== "YANDEX_OAUTH_TOKEN") continue;
    if (tokenKeySeen) {
      throw new Error("В проектном env-файле обнаружен повторяющийся ключ YANDEX_OAUTH_TOKEN; загрузка остановлена.");
    }
    tokenKeySeen = true;
    const candidate = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z0-9._~-]+$/u.test(candidate)) {
      throw new Error("Значение YANDEX_OAUTH_TOKEN пустое или имеет небезопасный формат; загрузка остановлена.");
    }
    token = candidate;
  }
  return token;
}

export function loadProjectToken(filePath = ENV_PATH) {
  const token = fs.existsSync(filePath)
    ? parseProjectTokenEnv(fs.readFileSync(filePath, "utf8"))
    : null;
  if (!token) {
    throw new Error(`В проектном env-файле ${filePath} отсутствует YANDEX_OAUTH_TOKEN.`);
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
    const declaredLength = getHeader(response.headers, "Content-Length");
    if (/^\d+$/u.test(String(declaredLength ?? "")) && BigInt(declaredLength) > BigInt(MAX_RESPONSE_BYTES)) {
      controller.abort();
      try {
        await response.body?.cancel?.("response size limit exceeded");
      } catch {
        // Abort is already set; cancellation errors must not prevent the bounded fallback.
      }
      throw new Error(`fetch response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }

    let text;
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks = [];
      let responseBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          responseBytes += chunk.length;
          if (responseBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel("response size limit exceeded");
            controller.abort();
            throw new Error(`fetch response exceeds ${MAX_RESPONSE_BYTES} bytes`);
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock?.();
      }
      text = Buffer.concat(chunks, responseBytes).toString("utf8");
    } else {
      text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new Error(`fetch response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      text,
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
  if (
    hasForbiddenKey(v5.options.headers) ||
    hasForbiddenKey(v5Body) ||
    hasForbiddenKey(live4.options.headers) ||
    hasForbiddenKey(live4Body)
  ) {
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

function ownFundsUnavailable(currency) {
  return {
    status: "not_provable_via_direct_api",
    amount: null,
    currency,
    usableAsOwnFundsProof: false,
    ownershipComposition: "unknown",
    reason: OWN_FUNDS_REASON,
    proofBoundary: {
      directApiCanProve: [
        "текущий общий баланс счёта",
        "сумму, доступную для перевода",
        "доступный лимит овердрафта",
        "ожидающие бонусы, если поле возвращено",
      ],
      directApiCannotProve: "Какая часть общего баланса внесена владельцем, получена как отсрочка или кредит, уже использована из овердрафта либо относится к бонусам.",
      officialDocumentation: OWN_FUNDS_OFFICIAL_DOCUMENTATION.map((entry) => ({ ...entry })),
    },
    requiredExternalEvidence: {
      status: "required",
      source: "официальное подтверждение биллинга или поддержки Яндекса для конкретного рекламного счёта",
      accountLogin: EXACT_LOGIN,
      mustBeCurrentAndDated: true,
      mustSeparate: [
        "собственные внесённые деньги",
        "отсрочку и кредит",
        "текущий долг и использованный овердрафт",
        "доступный, но не использованный лимит овердрафта",
        "бонусы",
      ],
      safetyRule: OWN_FUNDS_CLI_MESSAGE,
    },
  };
}

export function buildBalanceReport({ v5Response, live4Response, generatedAt, routeEvidence = null }) {
  const client = oneExactClient(v5Response.data);
  const account = oneExactAccount(live4Response.data);
  if (client.Currency !== account.Currency) {
    throw new Error("Проверка аккаунта остановлена: валюты Clients.get и AccountManagement не совпадают.");
  }

  const currency = client.Currency;
  return {
    receiptVersion: 2,
    generatedAt,
    status: "ok",
    provider: "Yandex Direct API",
    routingEvidence: routeEvidence,
    accountIdentity: {
      login: EXACT_LOGIN,
      type: "CLIENT",
      agency: Object.hasOwn(account, "AgencyName") ? "absent" : "not_returned_by_api",
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
      "Доступная кредитная возможность (лимит). Это не текущий долг, не уже использованный овердрафт и не деньги владельца; в бюджете не используется.",
    ),
    pendingBonus: pendingBonus(client),
    ownFunds: ownFundsUnavailable(currency),
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
  routeEvidence = null,
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

  return buildBalanceReport({ v5Response, live4Response, generatedAt, routeEvidence });
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

function failureReport(generatedAt, error, token, routeEvidence = null) {
  return {
    receiptVersion: 2,
    generatedAt,
    status: "source_unavailable",
    provider: "Yandex Direct API",
    routingEvidence: routeEvidence,
    accountIdentity: { login: EXACT_LOGIN },
    ownFunds: ownFundsUnavailable(null),
    error: redactSensitive(error?.message || error, token ? [token] : []),
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    resolveRoute = resolveProjectRoute,
    loadToken = loadProjectToken,
    executeAudit = executeBalanceAudit,
    saveArtifacts = saveBalanceArtifacts,
    reportDir = REPORT_DIR,
    log = console.log,
    generatedAt = new Date().toISOString(),
  } = {},
) {
  if (argv.length > 0) {
    throw new Error("У фиксированного помощника нет параметров командной строки.");
  }

  let token = null;
  let routeEvidence = null;
  let report;
  let failed = false;
  try {
    routeEvidence = resolveRoute();
    token = loadToken(routeEvidence.apiEnvPath);
    report = await executeAudit({ token, generatedAt, routeEvidence });
  } catch (error) {
    failed = true;
    report = failureReport(generatedAt, error, token, routeEvidence ?? error?.routeEvidence ?? null);
  }

  const outputs = saveArtifacts(reportDir, report, token ? [token] : []);
  log(`Статус: ${report.status}`);
  log(`Аккаунт: ${EXACT_LOGIN}`);
  if (report.status === "ok") {
    log(
      `Баланс общего счёта: ${report.currentSharedAccountBalance.amount} ${report.currentSharedAccountBalance.currency}`,
    );
    const overdraft = report.overdraftLimitAvailable.status === "available"
      ? `${report.overdraftLimitAvailable.amount} ${report.overdraftLimitAvailable.currency}`
      : "не возвращён API";
    log(`Лимит овердрафта (не собственные деньги, не используется): ${overdraft}`);
  } else {
    log("Баланс общего счёта: недоступен");
    log("Лимит овердрафта (не собственные деньги, не используется): недоступен");
    log(`Источник недоступен: ${report.error}`);
  }
  log(OWN_FUNDS_CLI_MESSAGE);
  log(`Отчёт: ${outputs.receipt}`);

  if (failed) process.exitCode = 1;
  return { report, outputs };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE;
if (isMain) {
  runCli().catch((error) => {
    console.error(redactSensitive(error?.message || error));
    process.exitCode = 1;
  });
}
