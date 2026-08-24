import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACCOUNT_SLUG,
  CREATE_COUNTER_PAYLOAD,
  DESIRED_COUNTER,
  EXPECTED_LOGIN,
  EXPECTED_PROJECT,
  GOAL_DEFINITIONS,
  TARGET_DOMAIN,
  YANDEX_IDENTITY_URL,
  assessGoals,
  buildGoalPayload,
  createApiClient,
  executeSetup,
  parseMode,
  readRuntimeSecret,
  resolveMetrikaRoute,
  runCli,
  saveReceipt,
  saveRuntimeSecret,
} from "./yandex-metrika-rosomaha-rus-setup.mjs";

const TOKEN = "y0_mock_secret_token_for_tests_123456";
const GENERATED_AT = "2026-08-24T12:34:56.789Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function verifiedRoute(apiEnvPath = "G:\\mvp\\rosomaha\\.env.seo.local") {
  return {
    status: "verified",
    accountSlug: ACCOUNT_SLUG,
    service: "metrika",
    project: EXPECTED_PROJECT,
    domain: TARGET_DOMAIN,
    ulogin: EXPECTED_LOGIN,
    apiEnvPath,
  };
}

function canonicalCounter(id = 120000001, overrides = {}) {
  return {
    id,
    owner_login: EXPECTED_LOGIN,
    permission: "own",
    status: "Active",
    type: "simple",
    ...clone(DESIRED_COUNTER),
    ...overrides,
  };
}

function canonicalGoal(definition, id) {
  return {
    id,
    status: "Active",
    ...buildGoalPayload(definition).goal,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockApi({
  login = EXPECTED_LOGIN,
  counters = [],
  goalsByCounter = {},
  measurementTokensByCounter = null,
  identityError = null,
  postCreateTransform = null,
} = {}) {
  const state = {
    counters: clone(counters),
    goalsByCounter: Object.fromEntries(
      Object.entries(goalsByCounter).map(([key, goals]) => [String(key), clone(goals)]),
    ),
    measurementTokensByCounter: measurementTokensByCounter
      ? Object.fromEntries(
          Object.entries(measurementTokensByCounter).map(([key, tokens]) => [String(key), clone(tokens)]),
        )
      : Object.fromEntries(
          counters.map((counter) => [String(counter.id), [`measurement-secret-${counter.id}`]]),
        ),
    nextCounterId: 120000500,
    nextGoalId: 590000500,
  };
  const requests = [];

  const fetchImpl = async (input, options = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      method,
      url: url.toString(),
      pathname: url.pathname,
      ulogin: url.searchParams.get("ulogin"),
      authorization: options.headers?.Authorization,
      body,
    });

    if (url.hostname === "login.yandex.ru" && url.pathname === "/info") {
      if (identityError) return jsonResponse(identityError.body, identityError.status);
      return jsonResponse({ login });
    }
    assert.equal(url.hostname, "api-metrika.yandex.net");
    assert.equal(url.searchParams.get("ulogin"), EXPECTED_LOGIN);

    if (url.pathname === "/management/v1/counters") {
      if (method === "GET") {
        return jsonResponse({ counters: clone(state.counters), rows: state.counters.length });
      }
      assert.equal(method, "POST");
      const baseCounter = canonicalCounter(state.nextCounterId, body.counter);
      const counter = typeof postCreateTransform === "function"
        ? postCreateTransform(clone(baseCounter), clone(body.counter))
        : baseCounter;
      state.nextCounterId += 1;
      state.counters.push(clone(counter));
      state.goalsByCounter[String(counter.id)] = [];
      state.measurementTokensByCounter[String(counter.id)] = [`measurement-secret-${counter.id}`];
      return jsonResponse({ counter: clone(counter) });
    }

    const generateMatch = url.pathname.match(
      /^\/management\/v1\/counter\/(\d+)\/measurement\/generate$/u,
    );
    if (generateMatch && method === "GET") {
      const counterId = generateMatch[1];
      const generated = `measurement-generated-${counterId}-${state.nextGoalId}`;
      state.measurementTokensByCounter[counterId] ||= [];
      state.measurementTokensByCounter[counterId].push(generated);
      return jsonResponse({ response: generated });
    }

    const goalListMatch = url.pathname.match(/^\/management\/v1\/counter\/(\d+)\/goals$/u);
    if (goalListMatch) {
      const counterId = goalListMatch[1];
      state.goalsByCounter[counterId] ||= [];
      if (method === "GET") {
        return jsonResponse({ goals: clone(state.goalsByCounter[counterId]) });
      }
      assert.equal(method, "POST");
      const goal = {
        id: state.nextGoalId,
        status: "Active",
        ...clone(body.goal),
      };
      state.nextGoalId += 1;
      state.goalsByCounter[counterId].push(goal);
      return jsonResponse({ goal: clone(goal) });
    }

    const counterMatch = url.pathname.match(/^\/management\/v1\/counter\/(\d+)$/u);
    if (counterMatch && method === "GET") {
      const counter = state.counters.find((item) => String(item.id) === counterMatch[1]);
      const readback = counter ? clone(counter) : null;
      if (readback && String(url.searchParams.get("field") || "").includes("measurement_tokens")) {
        readback.measurement_tokens = clone(
          state.measurementTokensByCounter[counterMatch[1]] || [],
        );
      }
      return counter
        ? jsonResponse({ counter: readback })
        : jsonResponse({ errors: [{ message: "not found" }] }, 404);
    }
    if (counterMatch && method === "PUT") {
      const counterIndex = state.counters.findIndex((item) => String(item.id) === counterMatch[1]);
      if (counterIndex === -1) {
        return jsonResponse({ errors: [{ message: "not found" }] }, 404);
      }
      state.counters[counterIndex] = {
        ...state.counters[counterIndex],
        ...clone(body.counter),
      };
      return jsonResponse({ counter: clone(state.counters[counterIndex]) });
    }

    return jsonResponse({ error: `Unexpected ${method} ${url.pathname}` }, 404);
  };

  return { fetchImpl, requests, state };
}

function volatileRuntime(existing = null) {
  let current = existing ? clone(existing) : null;
  let lastPayload = null;
  return {
    dependencies: {
      runtimePath: "G:\\mvp\\rosomaha\\.local-artifacts\\yandex-metrika\\test-runtime.json",
      readRuntime: () => current,
      saveRuntime: (runtimePath, payload) => {
        lastPayload = clone(payload);
        current = {
          counterId: Number(payload.counter_id),
          measurementToken: payload.measurement_token,
          goalIds: clone(payload.goal_ids),
        };
        return {
          path: runtimePath,
          saved: true,
          counterId: current.counterId,
          goalIds: current.goalIds,
          requestedFileMode: "0600",
        };
      },
    },
    get current() {
      return current;
    },
    get lastPayload() {
      return lastPayload;
    },
  };
}

function posts(mock) {
  return mock.requests.filter((request) => request.method === "POST");
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-metrika-setup-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("CLI принимает только один явный безопасный режим", () => {
  assert.equal(parseMode(["--audit"]), "audit");
  assert.equal(parseMode(["--dry-run"]), "dry-run");
  assert.equal(parseMode(["--apply"]), "apply");
  assert.throws(() => parseMode([]), /ровно один режим/u);
  assert.throws(() => parseMode(["--audit", "--apply"]), /ровно один режим/u);
  assert.throws(() => parseMode(["--delete"]), /разрешены только/u);
});

test("API client использует инъецированный curl fallback без секрета в URL", async () => {
  const curlCalls = [];
  const client = createApiClient({
    token: TOKEN,
    fetchImpl: async () => { throw new Error("fetch unavailable"); },
    nativeRequest: async () => { throw new Error("https unavailable"); },
    curlRequest: async (url, requestOptions) => {
      curlCalls.push({ url, requestOptions });
      return { ok: true, status: 200, text: JSON.stringify({ login: EXPECTED_LOGIN }), headers: {} };
    },
  });
  const identity = await client.get(new URL(YANDEX_IDENTITY_URL));
  assert.equal(identity.login, EXPECTED_LOGIN);
  assert.equal(curlCalls.length, 1);
  assert.equal(curlCalls[0].url.includes(TOKEN), false);
  assert.equal(curlCalls[0].requestOptions.headers.Authorization, `OAuth ${TOKEN}`);
});

test("route resolver жёстко закрепляет проект, аккаунт, домен и env", (t) => {
  const projectRoot = temporaryDirectory(t);
  const registryPath = path.join(projectRoot, "yandex-accounts.yaml");
  const apiEnvPath = path.join(projectRoot, ".env.seo.local");
  fs.writeFileSync(
    registryPath,
    `accounts:\n  rosomaha-yandex:\n    service: yandex-suite\n    services: [direct, metrika, webmaster]\n    project: rosomaha\n    allowed_projects: [rosomaha, rosomaha-rus.ru]\n    login_hint: rosomaha-rus999@yandex.ru\n    direct_login: rosomaha-rus999\n    api_env: '${apiEnvPath.replaceAll("'", "''")}'\n`,
    "utf8",
  );

  const route = resolveMetrikaRoute({ registryPath, projectRoot });
  assert.equal(route.status, "verified");
  assert.equal(route.domain, TARGET_DOMAIN);
  assert.equal(route.ulogin, EXPECTED_LOGIN);
  assert.equal(route.apiEnvPath, apiEnvPath);
});

test("route resolver блокирует registry без точного домена", (t) => {
  const projectRoot = temporaryDirectory(t);
  const registryPath = path.join(projectRoot, "yandex-accounts.yaml");
  const apiEnvPath = path.join(projectRoot, ".env.seo.local");
  fs.writeFileSync(
    registryPath,
    `accounts:\n  rosomaha-yandex:\n    service: yandex-suite\n    services: [direct, metrika]\n    project: rosomaha\n    allowed_projects: [rosomaha, rosomaha.site]\n    login_hint: rosomaha-rus999@yandex.ru\n    direct_login: rosomaha-rus999\n    api_env: '${apiEnvPath.replaceAll("'", "''")}'\n`,
    "utf8",
  );
  assert.throws(
    () => resolveMetrikaRoute({ registryPath, projectRoot }),
    /allowed_projects должен включать rosomaha-rus\.ru/u,
  );
});

test("--audit при отсутствии счётчика только читает и формирует план", async () => {
  const mock = createMockApi();
  const report = await executeSetup({
    mode: "audit",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "needs_apply");
  assert.equal(report.counter.status, "missing");
  assert.deepEqual(report.plan.createGoals, ["crm_conversion", "lead_submit"]);
  assert.equal(posts(mock).length, 0);
  assert.equal(mock.requests.every((request) => request.method === "GET"), true);
});

test("--dry-run не создаёт отсутствующие цели у существующего счётчика", async () => {
  const counter = canonicalCounter();
  const mock = createMockApi({ counters: [counter], goalsByCounter: { [counter.id]: [] } });
  const report = await executeSetup({
    mode: "dry-run",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "plan_ready");
  assert.deepEqual(report.plan.createGoals, ["crm_conversion", "lead_submit"]);
  assert.equal(posts(mock).length, 0);
});

test("--apply создаёт ровно один счётчик и две раздельные action exact цели", async () => {
  const mock = createMockApi();
  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });

  assert.equal(report.status, "ok");
  assert.equal(report.counter.createdDuringRun, true);
  assert.equal(report.goals.hard.status, "existing");
  assert.equal(report.goals.soft.status, "existing");
  assert.equal(posts(mock).length, 3);
  assert.equal(mock.state.counters.length, 1);
  const createdGoals = mock.state.goalsByCounter[String(report.counter.id)];
  assert.equal(createdGoals.length, 2);
  assert.deepEqual(createdGoals[0].conditions, [{ type: "exact", url: "crm_conversion" }]);
  assert.deepEqual(createdGoals[1].conditions, [{ type: "exact", url: "lead_submit" }]);
  assert.match(report.conversionPolicy.hard.evidenceBoundary, /deal_id/u);
  assert.match(report.evidenceBoundary, /не доказывает/u);
  assert.equal(report.runtimeSecret.status, "saved");
  assert.equal(JSON.stringify(report).includes(runtime.lastPayload.measurement_token), false);
  assert.deepEqual(posts(mock)[0].body.counter, CREATE_COUNTER_PAYLOAD);
  assert.equal("favorite" in posts(mock)[0].body.counter, false);
});

test("повторный --apply полностью идемпотентен", async () => {
  const counter = canonicalCounter();
  const goals = GOAL_DEFINITIONS.map((definition, index) => canonicalGoal(definition, 590000010 + index));
  const mock = createMockApi({ counters: [counter], goalsByCounter: { [counter.id]: goals } });
  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });
  assert.equal(report.status, "ok");
  assert.equal(report.counter.createdDuringRun, false);
  assert.deepEqual(report.createdGoals, []);
  assert.equal(posts(mock).length, 0);
});

test("--apply генерирует Measurement Protocol token только когда активных токенов нет", async () => {
  const counter = canonicalCounter();
  const goals = GOAL_DEFINITIONS.map((definition, index) => canonicalGoal(definition, 590000012 + index));
  const mock = createMockApi({
    counters: [counter],
    goalsByCounter: { [counter.id]: goals },
    measurementTokensByCounter: { [counter.id]: [] },
  });
  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });
  assert.equal(report.status, "ok");
  assert.equal(report.runtimeSecret.generatedDuringRun, true);
  assert.equal(report.runtimeSecret.activeTokenCount, 1);
  assert.equal(report.apiEvidence.mutationRequests, 1);
  assert.equal(
    mock.requests.filter((request) => request.pathname.endsWith("/measurement/generate")).length,
    1,
  );
  assert.equal(JSON.stringify(report).includes(runtime.lastPayload.measurement_token), false);
});

test("--apply доводит новый счётчик через PUT, если create не принял counter_flags", async () => {
  const mock = createMockApi({
    postCreateTransform(counter) {
      delete counter.counter_flags;
      return counter;
    },
  });
  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });
  assert.equal(report.status, "ok");
  assert.equal(mock.requests.some((request) => request.method === "PUT"), true);
  assert.equal(report.apiEvidence.putRequests, 1);
  assert.equal(report.apiEvidence.mutationRequests, 4);
  assert.equal(report.counter.createdDuringRun, true);
});

test("audit полного счётчика не читает Measurement Protocol secrets", async () => {
  const counter = canonicalCounter();
  const goals = GOAL_DEFINITIONS.map((definition, index) => canonicalGoal(definition, 590000014 + index));
  const mock = createMockApi({ counters: [counter], goalsByCounter: { [counter.id]: goals } });
  const report = await executeSetup({
    mode: "audit",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "ok");
  assert.equal(report.runtimeSecret.status, "not_inspected");
  assert.equal(mock.requests.some((request) => request.url.includes("measurement_tokens")), false);
  assert.equal(mock.requests.some((request) => request.pathname.endsWith("/measurement/generate")), false);
});

test("partial state recovery создаёт только отсутствующую soft-цель", async () => {
  const counter = canonicalCounter();
  const hardGoal = canonicalGoal(GOAL_DEFINITIONS[0], 590000020);
  const mock = createMockApi({
    counters: [counter],
    goalsByCounter: { [counter.id]: [hardGoal] },
  });
  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });
  assert.equal(report.status, "ok");
  assert.equal(posts(mock).length, 1);
  assert.equal(posts(mock)[0].body.goal.conditions[0].url, "lead_submit");
  assert.deepEqual(report.createdGoals.map((goal) => goal.event), ["lead_submit"]);
});

test("гонка перед POST счётчика не создаёт дубль", async () => {
  const counter = canonicalCounter();
  const mock = createMockApi();
  let counterListReads = 0;
  const originalFetch = mock.fetchImpl;
  const fetchImpl = async (input, options) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.pathname === "/management/v1/counters" && String(options?.method || "GET") === "GET") {
      counterListReads += 1;
      if (counterListReads === 2) {
        mock.state.counters.push(clone(counter));
        mock.state.measurementTokensByCounter[String(counter.id)] = [
          `measurement-secret-${counter.id}`,
        ];
        mock.state.goalsByCounter[String(counter.id)] = GOAL_DEFINITIONS.map(
          (definition, index) => canonicalGoal(definition, 590000030 + index),
        );
      }
    }
    return originalFetch(input, options);
  };

  const runtime = volatileRuntime();
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl,
    generatedAt: GENERATED_AT,
    ...runtime.dependencies,
  });
  assert.equal(report.status, "ok");
  assert.equal(report.counter.createdDuringRun, false);
  assert.equal(posts(mock).length, 0);
  assert.equal(mock.state.counters.length, 1);
});

test("чужой OAuth login блокируется до запросов Метрики и любых POST", async () => {
  const mock = createMockApi({ login: "another-account" });
  await assert.rejects(
    executeSetup({
      mode: "apply",
      token: TOKEN,
      routeEvidence: verifiedRoute(),
      fetchImpl: mock.fetchImpl,
      generatedAt: GENERATED_AT,
    }),
    (error) => error?.code === "account_mismatch",
  );
  assert.equal(mock.requests.some((request) => request.url.includes("api-metrika.yandex.net")), false);
  assert.equal(posts(mock).length, 0);
});

test("несколько exact-счётчиков блокируют apply без POST", async () => {
  const mock = createMockApi({ counters: [canonicalCounter(120000040), canonicalCounter(120000041)] });
  await assert.rejects(
    executeSetup({
      mode: "apply",
      token: TOKEN,
      routeEvidence: verifiedRoute(),
      fetchImpl: mock.fetchImpl,
      generatedAt: GENERATED_AT,
    }),
    (error) => error?.code === "counter_ambiguous",
  );
  assert.equal(posts(mock).length, 0);
});

test("rosomaha-rus.ru как зеркало другого домена блокирует создание", async () => {
  const otherCounter = canonicalCounter(120000050, {
    site2: { site: "rosomaha.site" },
    mirrors2: [{ site: TARGET_DOMAIN }],
  });
  const mock = createMockApi({ counters: [otherCounter] });
  await assert.rejects(
    executeSetup({
      mode: "apply",
      token: TOKEN,
      routeEvidence: verifiedRoute(),
      fetchImpl: mock.fetchImpl,
      generatedAt: GENERATED_AT,
    }),
    (error) => error?.code === "counter_ambiguous",
  );
  assert.equal(posts(mock).length, 0);
});

test("чужой владелец exact-счётчика блокирует настройку целей", async () => {
  const counter = canonicalCounter(120000060, { owner_login: "foreign-owner" });
  const mock = createMockApi({ counters: [counter] });
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.match(report.blocker.problems.join(" "), /owner_login/u);
  assert.equal(posts(mock).length, 0);
});

test("отсутствующее значение настройки не принимается за подтверждённое", async () => {
  const counter = canonicalCounter(120000061, {
    counter_flags: {
      use_in_benchmarks: false,
      direct_allow_use_goals_without_access: true,
      measurement_enabled: true,
    },
  });
  const mock = createMockApi({ counters: [counter] });
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.match(report.blocker.problems.join(" "), /collect_first_party_data/u);
  assert.equal(posts(mock).length, 0);
});

test("цель с тем же событием, но другой семантикой блокирует дубликат", async () => {
  const counter = canonicalCounter();
  const conflictingGoal = {
    id: 590000070,
    name: "Просто отправка формы",
    type: "action",
    is_favorite: false,
    conditions: [{ type: "exact", url: "crm_conversion" }],
  };
  const mock = createMockApi({
    counters: [counter],
    goalsByCounter: { [counter.id]: [conflictingGoal] },
  });
  const report = await executeSetup({
    mode: "apply",
    token: TOKEN,
    routeEvidence: verifiedRoute(),
    fetchImpl: mock.fetchImpl,
    generatedAt: GENERATED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.blocker.code, "goal_conflict");
  assert.equal(posts(mock).length, 0);
});

test("assessGoals не смешивает hard и soft события", () => {
  const goals = [
    canonicalGoal(GOAL_DEFINITIONS[0], 590000080),
    canonicalGoal(GOAL_DEFINITIONS[1], 590000081),
  ];
  const assessment = assessGoals(goals);
  assert.deepEqual(assessment.conflicts, []);
  assert.equal(assessment.goals.hard.id, 590000080);
  assert.equal(assessment.goals.soft.id, 590000081);
});

test("API error и CLI receipt не раскрывают OAuth token", async (t) => {
  const reportDir = temporaryDirectory(t);
  const mock = createMockApi({
    identityError: {
      status: 401,
      body: {
        error: "unauthorized",
        authorization: `OAuth ${TOKEN}`,
        token: TOKEN,
      },
    },
  });
  const logs = [];
  const previousExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await runCli(["--audit"], {
      generatedAt: GENERATED_AT,
      reportDir,
      resolveRoute: () => verifiedRoute(),
      loadToken: () => TOKEN,
      fetchImpl: mock.fetchImpl,
      log: (line) => logs.push(line),
    });
    const receipt = fs.readFileSync(result.outputPath, "utf8");
    const observable = `${receipt}\n${logs.join("\n")}`;
    assert.equal(result.report.status, "blocked");
    assert.equal(observable.includes(TOKEN), false);
    assert.match(observable, /\[REDACTED\]/u);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("receipt writer fail-closed отклоняет объект с секретом", (t) => {
  const reportDir = temporaryDirectory(t);
  assert.throws(
    () => saveReceipt(reportDir, {
      generatedAt: GENERATED_AT,
      mode: "audit",
      status: "blocked",
      leaked: TOKEN,
    }, [TOKEN]),
    /обнаружен секрет/u,
  );
  assert.deepEqual(fs.readdirSync(reportDir), []);
});

test("runtime secret сохраняется атомарно отдельно от receipt", (t) => {
  const directory = temporaryDirectory(t);
  const runtimePath = path.join(directory, "runtime", "rosomaha-rus-runtime.json");
  const measurementToken = "measurement-runtime-secret-1234567890";
  const payload = {
    schema_version: 1,
    project: EXPECTED_PROJECT,
    account: EXPECTED_LOGIN,
    domain: TARGET_DOMAIN,
    counter_id: 120000090,
    measurement_token: measurementToken,
    goal_ids: {
      crm_conversion: 590000090,
      lead_submit: 590000091,
    },
    updated_at: GENERATED_AT,
  };
  const evidence = saveRuntimeSecret(runtimePath, payload);
  const readback = readRuntimeSecret(runtimePath);
  assert.equal(readback.counterId, payload.counter_id);
  assert.equal(readback.measurementToken, measurementToken);
  assert.deepEqual(readback.goalIds, payload.goal_ids);
  assert.equal(JSON.stringify(evidence).includes(measurementToken), false);
  assert.equal(evidence.permissionsVerified, true);
  assert.equal(
    evidence.permissionModel,
    process.platform === "win32" ? "windows_acl_owner_system_admins" : "posix",
  );
  assert.equal(fs.readdirSync(path.dirname(runtimePath)).some((name) => name.endsWith(".tmp")), false);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(runtimePath).mode & 0o777, 0o600);
  }

  const receiptPath = saveReceipt(directory, {
    generatedAt: GENERATED_AT,
    mode: "apply",
    status: "ok",
    runtimeSecret: evidence,
  }, [measurementToken]);
  assert.equal(fs.readFileSync(receiptPath, "utf8").includes(measurementToken), false);
});

test("collect_first_party_data включён в канонической конфигурации", () => {
  assert.equal(DESIRED_COUNTER.counter_flags.collect_first_party_data, true);
});
