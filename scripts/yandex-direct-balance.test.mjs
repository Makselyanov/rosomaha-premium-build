import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENV_PATH,
  EXACT_LOGIN,
  LIVE4_ACCOUNT_URL,
  OWN_FUNDS_CLI_MESSAGE,
  ROUTE_ACCOUNT_SLUG,
  ROUTE_PROJECT,
  ROUTE_REQUIRED_SERVICE,
  ROUTE_SERVICE,
  V5_CLIENTS_URL,
  V5_CLIENT_FIELDS,
  assertReadOnlyRequests,
  buildBalanceReport,
  buildReadOnlyRequests,
  executeBalanceAudit,
  microsToDecimal,
  normalizeLegacyDecimal,
  parseYandexAccountsRegistry,
  resolveProjectRoute,
  runCli,
  safeJsonRequest,
  saveBalanceArtifacts,
} from "./yandex-direct-balance.mjs";

const TOKEN = "test-super-secret-token";
const GENERATED_AT = "2026-08-13T12:34:56.789Z";

test("owner-facing own-funds warning is fixed and unambiguous", () => {
  assert.equal(
    OWN_FUNDS_CLI_MESSAGE,
    "Собственный остаток недоступен: API показал общий баланс кабинета, но не разделил его на внесённые владельцем деньги и отсрочку/кредит; это не ноль, но без подтверждённой суммы нельзя безопасно продолжать или увеличивать расход. Овердрафт не учитывается.",
  );
});

function client(overrides = {}) {
  return {
    Login: EXACT_LOGIN,
    Type: "CLIENT",
    Currency: "RUB",
    VatRate: 20,
    Settings: [{ Option: "SHARED_ACCOUNT_ENABLED", Value: "YES" }],
    Bonuses: {
      AwaitingBonus: 1_500_000,
      AwaitingBonusWithoutNds: 1_250_000,
    },
    OverdraftSumAvailable: 25_000_000,
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    Login: EXACT_LOGIN,
    AgencyName: null,
    Currency: "RUB",
    Amount: "1234.50",
    AmountAvailableForTransfer: "1200.00",
    ...overrides,
  };
}

function v5Response(clients = [client()], overrides = {}) {
  return {
    ok: true,
    status: 200,
    data: { result: { Clients: clients } },
    providerMeta: { requestId: "v5-request", unitsUsedLogin: EXACT_LOGIN },
    ...overrides,
  };
}

function live4Response(accounts = [account()], overrides = {}) {
  return {
    ok: true,
    status: 200,
    data: { data: { ActionsResult: [], Accounts: accounts } },
    providerMeta: { requestId: "live4-request", unitsUsedLogin: EXACT_LOGIN },
    ...overrides,
  };
}

function verifiedRoute(projectRoot = path.join("C:\\", "tmp", "rosomaha")) {
  return {
    status: "verified",
    registryPath: path.join(projectRoot, "yandex-accounts.yaml"),
    accountSlug: ROUTE_ACCOUNT_SLUG,
    projectRoot,
    expectedProject: ROUTE_PROJECT,
    expectedDirectLogin: EXACT_LOGIN,
    expectedApiEnv: path.join(projectRoot, ".env.seo.local"),
    service: ROUTE_SERVICE,
    services: ["direct", "metrika", "webmaster", "business"],
    project: ROUTE_PROJECT,
    allowedProjects: [ROUTE_PROJECT, "rosomaha.site", "xn--80aa8ahaki9a.site"],
    directLogin: EXACT_LOGIN,
    apiEnvPath: path.join(projectRoot, ".env.seo.local"),
  };
}

function report(overrides = {}) {
  return buildBalanceReport({
    v5Response: v5Response(),
    live4Response: live4Response(),
    generatedAt: GENERATED_AT,
    routeEvidence: verifiedRoute(),
    ...overrides,
  });
}

function temporaryDir(t, prefix) {
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  return targetDir;
}

function temporaryReportDir(t) {
  return temporaryDir(t, "rosomaha-direct-balance-");
}

function yamlArray(values) {
  return `[${values.map((value) => (
    /^[A-Za-z0-9._:-]+$/u.test(value) ? value : `'${value}'`
  )).join(", ")}]`;
}

function registryFixture(projectRoot, overrides = {}) {
  const services = overrides.services ?? ["direct", "metrika", "webmaster", "business"];
  const allowedProjects = overrides.allowed_projects ?? [ROUTE_PROJECT, "rosomaha.site", "xn--80aa8ahaki9a.site"];
  const slug = overrides.slug ?? ROUTE_ACCOUNT_SLUG;
  const service = overrides.service ?? ROUTE_SERVICE;
  const project = overrides.project ?? ROUTE_PROJECT;
  const apiEnvPath = overrides.api_env ?? path.join(projectRoot, ".env.seo.local");
  const directLogin = overrides.direct_login ?? EXACT_LOGIN;
  const extraAccounts = overrides.extra_accounts ?? "";
  return `accounts:
  ${slug}:
    service: ${service}
    services: ${yamlArray(services)}
    project: ${project}
    allowed_projects: ${yamlArray(allowedProjects)}
    profile_dir: 'G:\\mvp\\browser-profiles\\yandex-rosomaha'
    cdp_port: 9234
    api_env: '${apiEnvPath}'
    direct_login: ${directLogin}
${extraAccounts}`;
}

function writeRegistryFixture(t, content) {
  const projectRoot = temporaryDir(t, "rosomaha-route-project-");
  const registryDir = temporaryDir(t, "rosomaha-route-registry-");
  const registryPath = path.join(registryDir, "yandex-accounts.yaml");
  fs.writeFileSync(registryPath, content, "utf8");
  return { projectRoot, registryPath };
}

test("registry parser preserves inline arrays and detects duplicate slugs", () => {
  const parsed = parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
    services: [direct, metrika]
    allowed_projects: [rosomaha, 'rosomaha.site']
`);
  assert.deepEqual(parsed[ROUTE_ACCOUNT_SLUG].services, ["direct", "metrika"]);
  assert.deepEqual(parsed[ROUTE_ACCOUNT_SLUG].allowed_projects, ["rosomaha", "rosomaha.site"]);

  assert.throws(
    () => parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
`),
    /дублирующий account slug/,
  );
});

test("registry parser rejects duplicate properties inside one account", () => {
  assert.throws(
    () => parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
    service: other-service
`),
    /дублирующее свойство service/u,
  );
});

test("registry parser rejects unclosed quotes and invalid quoted suffixes", () => {
  const malformedValues = [
    "'G:\\mvp\\rosomaha\\.env.seo.local",
    "\"rosomaha-rus999",
    "'rosomaha' trailing-data",
    "\"rosomaha\"#comment-without-separator",
  ];

  for (const malformedValue of malformedValues) {
    assert.throws(
      () => parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    api_env: ${malformedValue}
`),
      /Некорректный YAML registry/u,
      malformedValue,
    );
  }
});

test("registry parser rejects invalid double-quoted escapes", () => {
  const malformedValues = [
    String.raw`"rosomaha\q"`,
    String.raw`"rosomaha\x0"`,
    String.raw`"rosomaha\u12XZ"`,
    String.raw`"rosomaha\U00110000"`,
  ];

  for (const malformedValue of malformedValues) {
    assert.throws(
      () => parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    project: ${malformedValue}
`),
      /Некорректный YAML registry/u,
      malformedValue,
    );
  }
});

test("registry parser rejects malformed inline arrays", () => {
  const malformedValues = [
    "[direct, metrika",
    "[direct,, metrika]",
    "[direct,]",
    "[direct metrika]",
    "['direct' 'metrika']",
    "[direct, [metrika]]",
    String.raw`[direct, "metrika\q"]`,
    "[direct] trailing-data",
  ];

  for (const malformedValue of malformedValues) {
    assert.throws(
      () => parseYandexAccountsRegistry(`accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    services: ${malformedValue}
`),
      /Некорректный YAML registry/u,
      malformedValue,
    );
  }
});

test("route resolver accepts only the exact rosomaha Yandex registry route", (t) => {
  const projectRoot = temporaryDir(t, "rosomaha-route-pass-");
  const registryPath = path.join(projectRoot, "yandex-accounts.yaml");
  fs.writeFileSync(registryPath, registryFixture(projectRoot), "utf8");

  const route = resolveProjectRoute({ registryPath, projectRoot });
  assert.equal(route.status, "verified");
  assert.equal(route.accountSlug, ROUTE_ACCOUNT_SLUG);
  assert.equal(route.service, ROUTE_SERVICE);
  assert.equal(route.project, ROUTE_PROJECT);
  assert.equal(route.directLogin, EXACT_LOGIN);
  assert.equal(route.apiEnvPath, path.join(projectRoot, ".env.seo.local"));
  assert.equal(route.services.includes(ROUTE_REQUIRED_SERVICE), true);
  assert.equal(route.allowedProjects.includes(ROUTE_PROJECT), true);
});

test("route resolver rejects missing exact account and duplicate exact account", (t) => {
  const missingProjectRoot = temporaryDir(t, "rosomaha-route-missing-");
  const missingRegistryPath = path.join(missingProjectRoot, "yandex-accounts.yaml");
  fs.writeFileSync(
    missingRegistryPath,
    registryFixture(missingProjectRoot, { slug: "other-account" }),
    "utf8",
  );
  assert.throws(
    () => resolveProjectRoute({ registryPath: missingRegistryPath, projectRoot: missingProjectRoot }),
    /отсутствует точная запись/,
  );

  const duplicateProjectRoot = temporaryDir(t, "rosomaha-route-duplicate-");
  const duplicateRegistryPath = path.join(duplicateProjectRoot, "yandex-accounts.yaml");
  fs.writeFileSync(
    duplicateRegistryPath,
    `accounts:
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
    services: [direct]
    project: ${ROUTE_PROJECT}
    allowed_projects: [${ROUTE_PROJECT}]
    api_env: '${path.join(duplicateProjectRoot, ".env.seo.local")}'
    direct_login: ${EXACT_LOGIN}
  ${ROUTE_ACCOUNT_SLUG}:
    service: ${ROUTE_SERVICE}
`,
    "utf8",
  );
  assert.throws(
    () => resolveProjectRoute({ registryPath: duplicateRegistryPath, projectRoot: duplicateProjectRoot }),
    /не удалось разобрать.*дублирующий account slug/u,
  );
});

test("route resolver rejects wrong service, direct service, project, allowed project, login, and env", (t) => {
  const cases = [
    {
      name: "wrong service",
      overrides: { service: "not-yandex-suite" },
      pattern: /service yandex-suite/,
    },
    {
      name: "missing direct service",
      overrides: { services: ["metrika", "webmaster"] },
      pattern: /должен включать service direct/,
    },
    {
      name: "wrong project",
      overrides: { project: "other-project" },
      pattern: /project rosomaha/,
    },
    {
      name: "missing allowed project",
      overrides: { allowed_projects: ["rosomaha.site"] },
      pattern: /allowed_projects/,
    },
    {
      name: "wrong direct login",
      overrides: { direct_login: "wrong-login" },
      pattern: /direct_login/,
    },
    {
      name: "wrong api env",
      overrides: { api_env: "G:\\mvp\\wrong\\.env.seo.local" },
      pattern: /api_env/,
    },
  ];

  for (const testCase of cases) {
    const projectRoot = temporaryDir(t, `rosomaha-route-${testCase.name.replace(/\s+/gu, "-")}-`);
    const registryPath = path.join(projectRoot, "yandex-accounts.yaml");
    fs.writeFileSync(registryPath, registryFixture(projectRoot, testCase.overrides), "utf8");
    assert.throws(
      () => resolveProjectRoute({ registryPath, projectRoot }),
      testCase.pattern,
      testCase.name,
    );
  }
});

test("fixed requests use only Clients.get and AccountManagement Get for the exact login", () => {
  const requests = buildReadOnlyRequests(TOKEN);
  const v5Body = JSON.parse(requests.v5ClientsGet.options.body);
  const live4Body = JSON.parse(requests.live4AccountGet.options.body);

  assert.equal(requests.v5ClientsGet.url, V5_CLIENTS_URL);
  assert.equal(v5Body.method, "get");
  assert.deepEqual(v5Body.params.FieldNames, [...V5_CLIENT_FIELDS]);
  assert.equal(
    Object.keys(requests.v5ClientsGet.options.headers).some(
      (name) => name.toLowerCase() === "client-login",
    ),
    false,
  );
  assert.equal(requests.v5ClientsGet.options.headers.Authorization, `Bearer ${TOKEN}`);

  assert.equal(requests.live4AccountGet.url, LIVE4_ACCOUNT_URL);
  assert.equal(live4Body.method, "AccountManagement");
  assert.equal(live4Body.param.Action, "Get");
  assert.deepEqual(live4Body.param.SelectionCriteria.Logins, [EXACT_LOGIN]);
  assert.equal(live4Body.token, TOKEN);
  assert.equal(Object.hasOwn(requests.live4AccountGet.options.headers, "Authorization"), false);
  assert.equal(JSON.stringify(requests).toLowerCase().includes("finance_token"), false);
});

test("read-only guard blocks a changed endpoint, Client-Login, write action, and finance token", () => {
  const changedEndpoint = structuredClone(buildReadOnlyRequests(TOKEN));
  changedEndpoint.live4AccountGet.url = "https://example.test/";
  assert.throws(() => assertReadOnlyRequests(changedEndpoint), /endpoint/);

  const clientLogin = structuredClone(buildReadOnlyRequests(TOKEN));
  clientLogin.v5ClientsGet.options.headers["Client-Login"] = EXACT_LOGIN;
  assert.throws(() => assertReadOnlyRequests(clientLogin), /Client-Login/);

  const writeAction = structuredClone(buildReadOnlyRequests(TOKEN));
  const writeBody = JSON.parse(writeAction.live4AccountGet.options.body);
  writeBody.param.Action = "TransferMoney";
  writeAction.live4AccountGet.options.body = JSON.stringify(writeBody);
  assert.throws(() => assertReadOnlyRequests(writeAction), /AccountManagement/);

  const financeToken = structuredClone(buildReadOnlyRequests(TOKEN));
  const financeBody = JSON.parse(financeToken.live4AccountGet.options.body);
  financeBody.finance_token = "forbidden";
  financeToken.live4AccountGet.options.body = JSON.stringify(financeBody);
  assert.throws(() => assertReadOnlyRequests(financeToken), /финансовый токен/);

  const extraPayload = structuredClone(buildReadOnlyRequests(TOKEN));
  const extraBody = JSON.parse(extraPayload.live4AccountGet.options.body);
  extraBody.param.Unexpected = {};
  extraPayload.live4AccountGet.options.body = JSON.stringify(extraBody);
  assert.throws(() => assertReadOnlyRequests(extraPayload), /лишние поля/);

  const differentToken = structuredClone(buildReadOnlyRequests(TOKEN));
  const differentTokenBody = JSON.parse(differentToken.live4AccountGet.options.body);
  differentTokenBody.token = "another-token";
  differentToken.live4AccountGet.options.body = JSON.stringify(differentTokenBody);
  assert.throws(() => assertReadOnlyRequests(differentToken), /другой OAuth-токен/);
});

test("execute sends both requests without putting the token in the report", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return url === V5_CLIENTS_URL ? v5Response() : live4Response();
  };

  const routeEvidence = verifiedRoute();
  const result = await executeBalanceAudit({
    token: TOKEN,
    generatedAt: GENERATED_AT,
    request,
    routeEvidence,
  });
  assert.equal(calls.length, 2);
  assert.equal(result.accountIdentity.login, EXACT_LOGIN);
  assert.equal(result.routingEvidence.accountSlug, ROUTE_ACCOUNT_SLUG);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test("execute proves exact v5 identity before calling the legacy account endpoint", async () => {
  const calls = [];
  await assert.rejects(
    executeBalanceAudit({
      token: TOKEN,
      generatedAt: GENERATED_AT,
      request: async (url) => {
        calls.push(url);
        return v5Response([client({ Login: "wrong-login" })]);
      },
      routeEvidence: verifiedRoute(),
    }),
    /другой логин/,
  );
  assert.deepEqual(calls, [V5_CLIENTS_URL]);
});

test("identity gate rejects a wrong login and non-direct client types", () => {
  for (const wrongClient of [
    client({ Login: "another-login" }),
    client({ Type: "SUBCLIENT" }),
    client({ Type: "AGENCY" }),
  ]) {
    assert.throws(
      () => report({ v5Response: v5Response([wrongClient]) }),
      /Проверка аккаунта остановлена/,
    );
  }

  assert.throws(
    () => report({ live4Response: live4Response([account({ Login: "another-login" })]) }),
    /другой логин/,
  );
  assert.throws(
    () => report({ live4Response: live4Response([account({ AgencyName: "agency" })]) }),
    /агентство/,
  );
  const noAgencyField = account();
  delete noAgencyField.AgencyName;
  assert.equal(
    report({ live4Response: live4Response([noAgencyField]) }).accountIdentity.agency,
    "absent",
  );
});

test("identity gate rejects missing, multiple, mismatched, and unconfirmed account data", () => {
  assert.throws(
    () => report({ v5Response: v5Response([]) }),
    /ровно одного клиента/,
  );
  assert.throws(
    () => report({ v5Response: v5Response([client(), client()]) }),
    /ровно одного клиента/,
  );
  assert.throws(
    () => report({ live4Response: live4Response([]) }),
    /ровно один счёт/,
  );
  assert.throws(
    () => report({ live4Response: live4Response([account(), account()]) }),
    /ровно один счёт/,
  );
  assert.throws(
    () => report({ live4Response: live4Response([account({ Currency: "USD" })]) }),
    /валюты.*не совпадают/u,
  );
  assert.throws(
    () => report({ v5Response: v5Response([client({ Settings: [] })]) }),
    /общий счёт/,
  );
  assert.throws(
    () => report({ v5Response: v5Response([client({ Settings: [
      { Option: "SHARED_ACCOUNT_ENABLED", Value: "YES" },
      { Option: "SHARED_ACCOUNT_ENABLED", Value: "YES" },
    ] })]) }),
    /общий счёт/,
  );
  assert.throws(
    () => report({ live4Response: live4Response([account()], {
      data: { data: { ActionsResult: [{ Login: EXACT_LOGIN }], Accounts: [account()] } },
    }) }),
    /ошибки выбора счёта/,
  );
});

test("money conversions preserve micros, zero, and negative values exactly", () => {
  assert.equal(microsToDecimal(1_234_567), "1.234567");
  assert.equal(microsToDecimal(0), "0");
  assert.equal(microsToDecimal(-2_500_000), "-2.5");
  assert.equal(microsToDecimal("9007199254740993000000"), "9007199254740993");
  assert.throws(() => microsToDecimal(9_007_199_254_740_993), /безопасным целым/);

  assert.equal(normalizeLegacyDecimal("0012.3400"), "12.34");
  assert.equal(normalizeLegacyDecimal("0,00"), "0");
  assert.equal(normalizeLegacyDecimal("-2.500"), "-2.5");
  assert.equal(normalizeLegacyDecimal("-0.000"), "0");
});

test("report separates all provider amounts and never calculates own funds", () => {
  const routeEvidence = verifiedRoute();
  const result = report({
    v5Response: v5Response([client({
      OverdraftSumAvailable: 5_000_000,
      Bonuses: { AwaitingBonus: 3_000_000, AwaitingBonusWithoutNds: 2_500_000 },
    })]),
    live4Response: live4Response([account({
      Amount: "100.00",
      AmountAvailableForTransfer: "90.00",
    })]),
    routeEvidence,
  });

  assert.equal(result.routingEvidence.accountSlug, ROUTE_ACCOUNT_SLUG);
  assert.equal(result.currentSharedAccountBalance.amount, "100");
  assert.equal(result.amountAvailableForTransfer.amount, "90");
  assert.equal(result.overdraftLimitAvailable.amount, "5");
  assert.equal(result.pendingBonus.withVat, "3");
  assert.equal(result.pendingBonus.withoutVat, "2.5");
  assert.deepEqual(result.ownFunds.amount, null);
  assert.equal(result.ownFunds.status, "not_provable_via_direct_api");
  assert.equal(result.arithmeticPolicy.combinedTotalCalculated, false);
  assert.equal(JSON.stringify(result).includes("\"total\""), false);
  assert.equal(result.ownFunds.reason.includes("не прибавляются"), true);
});

test("missing overdraft or bonus remains unavailable instead of becoming zero", () => {
  const result = report({
    v5Response: v5Response([client({
      OverdraftSumAvailable: null,
      Bonuses: null,
    })]),
  });
  assert.equal(result.overdraftLimitAvailable.status, "not_returned_by_api");
  assert.equal(result.overdraftLimitAvailable.amount, null);
  assert.equal(result.pendingBonus.status, "not_returned_by_api");
  assert.equal(result.pendingBonus.withVat, null);
});

test("fetch transport failure and timeout use bounded in-process HTTPS fallback", async () => {
  const calls = [];
  const nativeRequest = async (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    return {
      ok: true,
      status: 200,
      text: JSON.stringify({ result: { Clients: [] } }),
      headers: { RequestId: "native-request", "Units-Used-Login": EXACT_LOGIN },
    };
  };

  const failedFetch = await safeJsonRequest(
    V5_CLIENTS_URL,
    { method: "POST", headers: {}, body: "{}" },
    {
      fetchImpl: async () => { throw new TypeError("fetch failed"); },
      nativeRequest,
      timeoutMs: 123,
    },
  );
  assert.equal(failedFetch.providerMeta.requestId, "native-request");
  assert.equal(calls[0].timeoutMs, 123);

  const timedOutFetch = await safeJsonRequest(
    V5_CLIENTS_URL,
    { method: "POST", headers: {}, body: "{}" },
    {
      fetchImpl: async () => new Promise(() => {}),
      nativeRequest,
      timeoutMs: 5,
    },
  );
  assert.equal(timedOutFetch.ok, true);
  assert.equal(calls.length, 2);
});

test("provider and transport errors redact the OAuth token and unknown logins", async () => {
  const redactedHeader = await safeJsonRequest(
    V5_CLIENTS_URL,
    { method: "POST", headers: {}, body: "{}" },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "{}",
        headers: {
          get(name) {
            return name.toLowerCase() === "units-used-login" ? "private-representative" : null;
          },
        },
      }),
    },
  );
  assert.equal(redactedHeader.providerMeta.unitsUsedLogin, "[REDACTED_OTHER_LOGIN]");

  await assert.rejects(
    executeBalanceAudit({
      token: TOKEN,
      generatedAt: GENERATED_AT,
      routeEvidence: verifiedRoute(),
      request: async (url) => url === V5_CLIENTS_URL
        ? {
            ok: false,
            status: 401,
            data: { error: { error_detail: `denied ${TOKEN}` } },
            providerMeta: { requestId: "request-id" },
          }
        : live4Response(),
    }),
    (error) => !error.message.includes(TOKEN) && error.message.includes("[REDACTED]"),
  );

  await assert.rejects(
    safeJsonRequest(
      V5_CLIENTS_URL,
      { method: "POST", headers: {}, body: "{}" },
      {
        fetchImpl: async () => { throw new Error(`fetch ${TOKEN}`); },
        nativeRequest: async () => { throw new Error(`native ${TOKEN}`); },
        secrets: [TOKEN],
        timeoutMs: 10,
      },
    ),
    (error) => !error.message.includes(TOKEN) && error.message.includes("[REDACTED]"),
  );
});

test("timestamped receipt is immutable and collision leaves latest unchanged", (t) => {
  const reportDir = temporaryReportDir(t);
  const first = { ...report(), marker: "first" };
  const outputs = saveBalanceArtifacts(reportDir, first, [TOKEN]);
  const beforeReceipt = fs.readFileSync(outputs.receipt, "utf8");
  assert.equal(beforeReceipt.includes(TOKEN), false);

  const later = {
    ...report(),
    generatedAt: "2026-08-13T12:34:57.789Z",
    marker: "later",
  };
  saveBalanceArtifacts(reportDir, later, [TOKEN]);
  const latestAfterReplacement = fs.readFileSync(outputs.latest, "utf8");
  assert.match(latestAfterReplacement, /"marker": "later"/);

  const second = { ...report(), marker: "second" };
  assert.throws(
    () => saveBalanceArtifacts(reportDir, second, [TOKEN]),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(fs.readFileSync(outputs.receipt, "utf8"), beforeReceipt);
  assert.equal(fs.readFileSync(outputs.latest, "utf8"), latestAfterReplacement);
  assert.equal(fs.readdirSync(reportDir).some((name) => name.endsWith(".tmp")), false);
});

test("artifact writer refuses a result containing a secret", (t) => {
  const reportDir = temporaryReportDir(t);
  assert.throws(
    () => saveBalanceArtifacts(reportDir, { ...report(), leaked: TOKEN }, [TOKEN]),
    /обнаружен секрет/,
  );
  assert.deepEqual(fs.readdirSync(reportDir), []);
});

test("cli blocks before token load and API calls when route does not pass", async () => {
  const previousExitCode = process.exitCode;
  let loadTokenCalls = 0;
  let apiCalls = 0;
  let savedReport = null;
  const routeError = new Error("route blocked");
  routeError.routeEvidence = {
    status: "blocked",
    accountSlug: ROUTE_ACCOUNT_SLUG,
    expectedApiEnv: ENV_PATH,
  };

  try {
    const result = await runCli([], {
      resolveRoute: () => { throw routeError; },
      loadToken: () => {
        loadTokenCalls += 1;
        return TOKEN;
      },
      executeAudit: async () => {
        apiCalls += 1;
        return report();
      },
      saveArtifacts: (_reportDir, currentReport) => {
        savedReport = currentReport;
        return { receipt: "C:\\tmp\\receipt.json", latest: "C:\\tmp\\latest.json" };
      },
      reportDir: "C:\\tmp",
      log: () => {},
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.report.status, "source_unavailable");
    assert.equal(result.report.routingEvidence.accountSlug, ROUTE_ACCOUNT_SLUG);
  } finally {
    process.exitCode = previousExitCode;
  }

  assert.equal(loadTokenCalls, 0);
  assert.equal(apiCalls, 0);
  assert.equal(savedReport.status, "source_unavailable");
});

test("cli uses resolved env path and writes safe routing evidence into the receipt payload", async () => {
  const previousExitCode = process.exitCode;
  const route = verifiedRoute(path.join("C:\\", "tmp", "rosomaha-cli"));
  let loadedEnvPath = null;
  let savedReport = null;
  const logs = [];

  try {
    const result = await runCli([], {
      resolveRoute: () => route,
      loadToken: (filePath) => {
        loadedEnvPath = filePath;
        return TOKEN;
      },
      executeAudit: async ({ routeEvidence }) => report({ routeEvidence }),
      saveArtifacts: (_reportDir, currentReport) => {
        savedReport = currentReport;
        return { receipt: "C:\\tmp\\receipt.json", latest: "C:\\tmp\\latest.json" };
      },
      reportDir: "C:\\tmp",
      log: (line) => logs.push(line),
      generatedAt: GENERATED_AT,
    });

    assert.equal(result.report.status, "ok");
  } finally {
    process.exitCode = previousExitCode;
  }

  assert.equal(loadedEnvPath, route.apiEnvPath);
  assert.equal(savedReport.routingEvidence.accountSlug, ROUTE_ACCOUNT_SLUG);
  assert.equal(savedReport.routingEvidence.apiEnvPath, route.apiEnvPath);
  assert.equal(JSON.stringify(savedReport).includes(TOKEN), false);
  assert.equal(logs.some((line) => line.includes("Статус: ok")), true);
});
