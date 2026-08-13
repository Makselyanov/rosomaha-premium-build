import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  QUERY_PROBES,
  SITE_ALIASES,
  executeReport,
  getAccessToken,
  getOutputPaths,
  normalizeQueryProbe,
  parseArgs,
  resolveSiteSelection,
  safeGscRequest,
  saveReportArtifacts,
} from "./gsc-report.mjs";

const CONFIG = {
  envPath: "test.env",
  clientId: "client-id",
  clientSecret: "",
  refreshToken: "refresh-token",
  siteUrl: SITE_ALIASES.catalog,
};

function args(overrides = {}) {
  return { days: 28, envPath: "test.env", rowLimit: 1000, save: false, site: null, ...overrides };
}

function temporaryReportDir(t) {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-gsc-test-"));
  t.after(() => fs.rmSync(reportDir, { recursive: true, force: true }));
  return reportDir;
}

function artifactReport(alias, generatedAt, marker) {
  return {
    receiptVersion: 1,
    generatedAt,
    provider: "Google Search Console API",
    property: { alias, siteUrl: SITE_ALIASES[alias], permissionLevel: "siteOwner" },
    marker,
  };
}

test("site allowlist resolves aliases and rejects unknown properties", async () => {
  assert.deepEqual(resolveSiteSelection("catalog"), {
    alias: "catalog",
    siteUrl: SITE_ALIASES.catalog,
  });
  assert.deepEqual(resolveSiteSelection("bitrix"), {
    alias: "bitrix",
    siteUrl: SITE_ALIASES.bitrix,
  });
  assert.deepEqual(resolveSiteSelection(null, ""), {
    alias: "catalog",
    siteUrl: SITE_ALIASES.catalog,
  });
  assert.deepEqual(resolveSiteSelection(null, SITE_ALIASES.bitrix), {
    alias: "bitrix",
    siteUrl: SITE_ALIASES.bitrix,
  });
  assert.throws(() => resolveSiteSelection("other"), /Unknown --site alias/);
  assert.throws(() => resolveSiteSelection(null, "https://example.test/"), /not an exact allowed property/);

  let tokenCalls = 0;
  await assert.rejects(
    executeReport({
      args: args({ site: "other" }),
      config: CONFIG,
      tokenProvider: async () => {
        tokenCalls += 1;
        return "token";
      },
    }),
    /Unknown --site alias/,
  );
  assert.equal(tokenCalls, 0, "unknown property must fail before token exchange");
});

test("row limit defaults to 1000 and is bounded to 1..1000", () => {
  assert.equal(parseArgs([]).rowLimit, 1000);
  assert.equal(parseArgs(["--row-limit", "1"]).rowLimit, 1);
  assert.equal(parseArgs(["--row-limit", "1000"]).rowLimit, 1000);
  for (const value of ["0", "1001", "1.5", "nope"]) {
    assert.throws(() => parseArgs(["--row-limit", value]), /integer from 1 to 1000/);
  }
});

test("sites.list must grant exact siteOwner before analytics requests", async () => {
  const calls = [];
  await assert.rejects(
    executeReport({
      args: args(),
      config: CONFIG,
      tokenProvider: async () => "token",
      request: async (_token, method, pathName) => {
        calls.push({ method, pathName });
        return {
          ok: true,
          data: {
            siteEntry: [{ siteUrl: SITE_ALIASES.catalog, permissionLevel: "siteFullUser" }],
          },
        };
      },
    }),
    /siteOwner permission required/,
  );
  assert.deepEqual(calls, [{ method: "GET", pathName: "/webmasters/v3/sites" }]);
});

test("analytics includes query+page dimensions and four exact query filters", async () => {
  const calls = [];
  const request = async (_token, method, pathName, body) => {
    calls.push({ method, pathName, body });
    if (pathName === "/webmasters/v3/sites") {
      return {
        ok: true,
        data: { siteEntry: [{ siteUrl: SITE_ALIASES.catalog, permissionLevel: "siteOwner" }] },
      };
    }
    return { ok: true, data: {} };
  };

  const report = await executeReport({
    args: args({ rowLimit: 321 }),
    config: CONFIG,
    now: new Date("2026-08-13T12:00:00.000Z"),
    tokenProvider: async () => "secret-token",
    request,
  });
  const analytics = calls.filter((call) => call.pathName.endsWith("/searchAnalytics/query"));
  const combinedReport = analytics.find(
    (call) =>
      !call.body.dimensionFilterGroups &&
      call.body.rowLimit === 321 &&
      JSON.stringify(call.body.dimensions) === JSON.stringify(["query", "page"]),
  );
  assert.ok(combinedReport, "a separate unfiltered query+page report is required");

  const filtered = analytics.filter((call) => call.body.dimensionFilterGroups);
  assert.equal(filtered.length, 4);
  assert.deepEqual(
    filtered.map((call) => call.body.dimensionFilterGroups[0].filters[0]),
    QUERY_PROBES.map((query) => ({
      dimension: "query",
      operator: "equals",
      expression: query,
    })),
  );
  assert.equal(report.queryProbes.every((probe) => probe.status === "not_returned_by_api"), true);
  assert.equal(JSON.stringify(report).includes("secret-token"), false);
});

test("missing probe is not returned by API, not a numeric zero", () => {
  assert.deepEqual(normalizeQueryProbe("probe", { ok: true, data: {} }), {
    query: "probe",
    status: "not_returned_by_api",
    rows: [],
    error: null,
  });
  assert.equal(
    normalizeQueryProbe("probe", {
      ok: true,
      data: { rows: [{ keys: ["probe", "https://example.test/"], impressions: 0 }] },
    }).status,
    "returned_by_api",
  );
});

test("latest outputs and timestamped receipts are property-separated", () => {
  const generatedAt = "2026-08-13T12:34:56.789Z";
  const catalog = getOutputPaths("reports", "catalog", generatedAt);
  const bitrix = getOutputPaths("reports", "bitrix", generatedAt);
  assert.notEqual(catalog.latestJson, bitrix.latestJson);
  assert.match(path.basename(catalog.latestJson), /catalog/);
  assert.match(path.basename(bitrix.latestJson), /bitrix/);
  assert.match(path.basename(catalog.receiptJson), /2026-08-13T12-34-56-789Z/);
  assert.equal(path.basename(catalog.legacyLatestJson), "latest-gsc-report.json");
  assert.equal(path.basename(catalog.legacyLatestMarkdown), "latest-gsc-report.md");
  assert.equal(Object.hasOwn(bitrix, "legacyLatestJson"), false);
  assert.equal(Object.hasOwn(bitrix, "legacyLatestMarkdown"), false);
});

test("catalog writes legacy latest atomically and bitrix never changes it", (t) => {
  const reportDir = temporaryReportDir(t);
  const catalog = artifactReport("catalog", "2026-08-13T12:34:56.789Z", "catalog");
  const catalogOutputs = saveReportArtifacts(reportDir, catalog, "catalog markdown\n");

  assert.equal(fs.readFileSync(catalogOutputs.legacyLatestMarkdown, "utf8"), "catalog markdown\n");
  const updatedCatalog = artifactReport(
    "catalog",
    "2026-08-13T12:34:57.789Z",
    "updated catalog",
  );
  saveReportArtifacts(reportDir, updatedCatalog, "updated catalog markdown\n");
  const legacyJson = fs.readFileSync(catalogOutputs.legacyLatestJson, "utf8");
  const legacyMarkdown = fs.readFileSync(catalogOutputs.legacyLatestMarkdown, "utf8");
  assert.match(legacyJson, /updated catalog/);
  assert.equal(legacyMarkdown, "updated catalog markdown\n");

  const bitrix = artifactReport("bitrix", "2026-08-13T12:34:58.789Z", "bitrix");
  const bitrixOutputs = saveReportArtifacts(reportDir, bitrix, "bitrix markdown\n");
  assert.equal(Object.hasOwn(bitrixOutputs, "legacyLatestJson"), false);
  assert.equal(fs.readFileSync(catalogOutputs.legacyLatestJson, "utf8"), legacyJson);
  assert.equal(fs.readFileSync(catalogOutputs.legacyLatestMarkdown, "utf8"), legacyMarkdown);
  assert.equal(
    fs.readdirSync(reportDir).some((name) => name.endsWith(".tmp")),
    false,
    "atomic latest writes must not leave temporary files",
  );
});

test("receipt creation is immutable and a timestamp collision fails closed", (t) => {
  const reportDir = temporaryReportDir(t);
  const generatedAt = "2026-08-13T12:34:56.789Z";
  const first = artifactReport("catalog", generatedAt, "first");
  const outputs = saveReportArtifacts(reportDir, first, "first markdown\n");
  const before = Object.fromEntries(
    [
      outputs.receiptJson,
      outputs.latestJson,
      outputs.latestMarkdown,
      outputs.legacyLatestJson,
      outputs.legacyLatestMarkdown,
    ].map((filePath) => [filePath, fs.readFileSync(filePath, "utf8")]),
  );

  const second = artifactReport("catalog", generatedAt, "second");
  assert.throws(
    () => saveReportArtifacts(reportDir, second, "second markdown\n"),
    (error) => error?.code === "EEXIST",
  );
  for (const [filePath, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(filePath, "utf8"), content);
  }
});

test("fetch transport failures use bounded in-process native fallback for OAuth and GSC", async () => {
  const nativeCalls = [];
  const fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };
  const nativeRequest = async (url, requestOptions, timeoutMs) => {
    nativeCalls.push({ url, requestOptions, timeoutMs });
    if (url.includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, text: JSON.stringify({ access_token: "access-token" }) };
    }
    return { ok: true, status: 200, text: JSON.stringify({ rows: [] }) };
  };
  const transportOptions = { fetchImpl, nativeRequest, timeoutMs: 1234 };

  const token = await getAccessToken(CONFIG, transportOptions);
  const apiResult = await safeGscRequest(
    token,
    "POST",
    "/webmasters/v3/sites/test/searchAnalytics/query",
    { dimensions: ["query", "page"] },
    transportOptions,
  );

  assert.equal(token, "access-token");
  assert.deepEqual(apiResult, { ok: true, data: { rows: [] } });
  assert.equal(nativeCalls.length, 2);
  assert.equal(nativeCalls.every((call) => call.timeoutMs === 1234), true);
  assert.match(nativeCalls[0].requestOptions.body, /refresh_token=refresh-token/);
  assert.equal(nativeCalls[1].requestOptions.headers.Authorization, "Bearer access-token");
  assert.equal(
    nativeCalls[1].requestOptions.body,
    JSON.stringify({ dimensions: ["query", "page"] }),
  );
  assert.equal(JSON.stringify(apiResult).includes("access-token"), false);

  const redactedError = await safeGscRequest(token, "GET", "/echo", undefined, {
    fetchImpl,
    nativeRequest: async () => ({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: { message: `denied ${token}` } }),
    }),
    timeoutMs: 1234,
  });
  assert.equal(JSON.stringify(redactedError).includes(token), false);
  assert.match(redactedError.error.message, /\[REDACTED\]/);
});

test("HTTP provider errors do not invoke native fallback", async () => {
  let nativeCalls = 0;
  const nativeRequest = async () => {
    nativeCalls += 1;
    return { ok: true, status: 200, text: "{}" };
  };
  const apiResult = await safeGscRequest("access-token", "GET", "/denied", undefined, {
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: "denied" } }),
    }),
    nativeRequest,
  });
  assert.deepEqual(apiResult, { ok: false, error: { status: 403, message: "denied" } });

  await assert.rejects(
    getAccessToken(CONFIG, {
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "invalid_grant" }),
      }),
      nativeRequest,
    }),
    /invalid_grant/,
  );
  assert.equal(nativeCalls, 0);
});
