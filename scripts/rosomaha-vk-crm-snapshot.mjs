import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EXPECTED_TENANT_ID = 1;
const EXPECTED_CABINET_ID = "15434257";
const EXPECTED_TIMEZONE = "Asia/Yekaterinburg";
const SSH_HOST = "root@90.156.168.115";
const REMOTE_COMMAND =
  "cd /var/www/crm && php artisan crm:rosomaha-marketing-snapshot --tenant=1 --expected-cabinet=15434257 --json";

const TOP_LEVEL_KEYS = new Set([
  "status",
  "tenantId",
  "cabinetId",
  "cabinetValidation",
  "fetchedAt",
  "asOf",
  "timezone",
  "piiExported",
  "databaseMutations",
  "periods",
  "leadChannelHealth",
]);
const PERIOD_KEYS = new Set(["from", "to", "vkAds", "crm"]);
const PERIOD_NAMES = ["today", "days7", "previous7", "days30"];
const VK_COMPARISON_METRICS = [
  "shows",
  "clicks",
  "spent",
  "ctr",
  "cpc",
  "cpm",
  "providerGoals",
  "providerGoalCost",
  "totalCampaigns",
  "activeCampaigns",
];
const VK_KEYS = new Set([
  "status",
  "errorCode",
  "httpStatus",
  "fetchedAt",
  "shows",
  "clicks",
  "spent",
  "ctr",
  "cpc",
  "cpm",
  "providerGoals",
  "providerGoalCost",
  "campaignsStatus",
  "campaignsErrorCode",
  "totalCampaigns",
  "activeCampaigns",
]);
const CRM_KEYS = new Set(["vk", "yandex", "domains", "formReceiptChain"]);
const DOMAIN_KEYS = new Set(["bitrix", "catalog", "quiz", "unknown"]);
const AGGREGATE_KEYS = new Set([
  "deals",
  "uniqueContacts",
  "withLeadSubmissionId",
  "withModel",
  "withConfiguration",
  "working",
  "rejected",
  "success",
  "notTarget",
  "proposalOrLater",
  "currentNonTarget",
  "withCallActivity",
  "currentProposalStage",
  "currentPrepaymentState",
  "currentSuccessState",
  "currentShippedState",
  "formReceipts",
  "processedFormReceipts",
  "dealsWithSubmissionId",
  "dealsWithMatchingProcessedReceipt",
  "dealsMissingReceipt",
  "prepaymentsInPeriod",
  "successInPeriod",
  "shippedInPeriod",
  "successRevenueInPeriod",
]);
const FORM_RECEIPT_CHAIN_KEYS = new Set([
  "formReceipts",
  "processedFormReceipts",
  "dealsWithSubmissionId",
  "dealsWithMatchingProcessedReceipt",
  "orphanProcessedFormReceipts",
  "dealsMissingReceipt",
]);
const HEALTH_KEYS = new Set(["generatedAt", "okCount", "warningCount", "criticalCount", "items"]);
const HEALTH_ITEM_KEYS = new Set(["key", "status", "count24h", "count7d", "count30d", "lastSeenAt"]);
const FORBIDDEN_KEY = /(?:^|_)(?:phone|phones|email|emails|name|names|full_name|note|notes|title|token|secret|password|client_id|deal_id|external_id)(?:$|_)/i;

function defaultRunner() {
  return execFileSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      SSH_HOST,
      REMOTE_COMMAND,
    ],
    {
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

function normalizedKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function assertNoForbiddenKeys(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, [...trail, String(index)]));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(normalizedKey(key))) {
      throw new Error(`Snapshot contains forbidden field: ${[...trail, key].join(".")}`);
    }
    assertNoForbiddenKeys(nested, [...trail, key]);
  }
}

function assertPlainObject(value, trail) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Snapshot field must be an object: ${trail}`);
  }
}

function assertExactKeys(value, allowedKeys, trail) {
  assertPlainObject(value, trail);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Snapshot contains unexpected field: ${trail}.${key}`);
    }
  }
}

function assertRequiredKeys(value, requiredKeys, trail) {
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new Error(`Snapshot is missing required field: ${trail}.${key}`);
    }
  }
}

function assertNonNegativeNumber(value, trail, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Snapshot field must be a non-negative number: ${trail}`);
  }
}

function assertSafeCode(value, trail, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^[a-z0-9_.:-]{1,80}$/i.test(value)) {
    throw new Error(`Snapshot field must be a safe code: ${trail}`);
  }
}

function assertDate(value, trail) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Snapshot field must use YYYY-MM-DD: ${trail}`);
  }
}

function epochDay(value) {
  return Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
}

function assertSevenDayComparisonWindows(periods) {
  const current = periods.days7;
  const previous = periods.previous7;
  const currentFrom = epochDay(current.from);
  const currentTo = epochDay(current.to);
  const previousFrom = epochDay(previous.from);
  const previousTo = epochDay(previous.to);

  if (currentTo - currentFrom !== 6) {
    throw new Error("Snapshot periods.days7 must cover exactly seven calendar days");
  }
  if (previousTo - previousFrom !== 6) {
    throw new Error("Snapshot periods.previous7 must cover exactly seven calendar days");
  }
  if (previousTo + 1 !== currentFrom) {
    throw new Error("Snapshot periods.previous7 must immediately precede periods.days7");
  }
}

function assertTimestamp(value, trail, { nullable = false } = {}) {
  if (nullable && value === null) return;
  const isoTimestamp = typeof value === "string" && !Number.isNaN(Date.parse(value));
  const crmLocalTimestamp = typeof value === "string"
    && /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(value);
  if (!isoTimestamp && !crmLocalTimestamp) {
    throw new Error(`Snapshot field must be a timestamp: ${trail}`);
  }
}

function assertAggregate(value, trail) {
  assertExactKeys(value, AGGREGATE_KEYS, trail);
  assertRequiredKeys(value, AGGREGATE_KEYS, trail);
  for (const key of AGGREGATE_KEYS) {
    assertNonNegativeNumber(value[key], `${trail}.${key}`);
  }
}

function assertFormReceiptChain(value, trail) {
  assertExactKeys(value, FORM_RECEIPT_CHAIN_KEYS, trail);
  assertRequiredKeys(value, FORM_RECEIPT_CHAIN_KEYS, trail);
  for (const key of FORM_RECEIPT_CHAIN_KEYS) {
    assertNonNegativeNumber(value[key], `${trail}.${key}`);
  }
}

function assertVkStats(value, trail) {
  assertExactKeys(value, VK_KEYS, trail);
  assertRequiredKeys(
    value,
    [
      "status",
      "shows",
      "clicks",
      "spent",
      "ctr",
      "cpc",
      "cpm",
      "providerGoals",
      "providerGoalCost",
      "campaignsStatus",
      "campaignsErrorCode",
      "totalCampaigns",
      "activeCampaigns",
    ],
    trail,
  );
  if (!new Set(["ok", "partial", "unavailable"]).has(value.status)) {
    throw new Error(`Snapshot has invalid provider status: ${trail}.status`);
  }
  if (!new Set(["ok", "unavailable"]).has(value.campaignsStatus)) {
    throw new Error(`Snapshot has invalid campaign status: ${trail}.campaignsStatus`);
  }
  const providerMetricKeys = [
    "shows",
    "clicks",
    "spent",
    "ctr",
    "cpc",
    "cpm",
    "providerGoals",
    "providerGoalCost",
  ];
  const campaignMetricKeys = [
    "totalCampaigns",
    "activeCampaigns",
  ];
  for (const key of [...providerMetricKeys, ...campaignMetricKeys]) {
    assertNonNegativeNumber(value[key], `${trail}.${key}`, { nullable: true });
  }
  if ("httpStatus" in value) {
    assertNonNegativeNumber(value.httpStatus, `${trail}.httpStatus`, { nullable: true });
  }
  if ("fetchedAt" in value) assertTimestamp(value.fetchedAt, `${trail}.fetchedAt`, { nullable: true });
  if ("errorCode" in value) assertSafeCode(value.errorCode, `${trail}.errorCode`, { nullable: true });
  assertSafeCode(value.campaignsErrorCode, `${trail}.campaignsErrorCode`, { nullable: true });

  if (value.status === "ok") {
    if (value.campaignsStatus !== "ok") {
      throw new Error(`Complete provider period has unavailable campaigns: ${trail}`);
    }
    if (!("fetchedAt" in value) || value.fetchedAt === null) {
      throw new Error(`Complete provider period is missing fetchedAt: ${trail}`);
    }
    for (const key of [...providerMetricKeys, ...campaignMetricKeys]) {
      assertNonNegativeNumber(value[key], `${trail}.${key}`);
    }
    if (value.campaignsErrorCode !== null || ("errorCode" in value && value.errorCode !== null)) {
      throw new Error(`Complete provider period contains an error marker: ${trail}`);
    }
  }

  if (value.status === "partial") {
    if (value.campaignsStatus !== "unavailable") {
      throw new Error(`Partial provider period must identify unavailable campaigns: ${trail}`);
    }
    if (!("fetchedAt" in value) || value.fetchedAt === null) {
      throw new Error(`Partial provider period is missing fetchedAt: ${trail}`);
    }
    for (const key of providerMetricKeys) {
      assertNonNegativeNumber(value[key], `${trail}.${key}`);
    }
    for (const key of campaignMetricKeys) {
      if (value[key] !== null) {
        throw new Error(`Partial provider period has unverified campaign metric: ${trail}.${key}`);
      }
    }
    if (value.campaignsErrorCode === null) {
      throw new Error(`Partial provider period is missing campaign error code: ${trail}`);
    }
  }

  if (value.status === "unavailable") {
    if (value.campaignsStatus !== "unavailable" || !("errorCode" in value) || value.errorCode === null) {
      throw new Error(`Unavailable provider period is missing an error marker: ${trail}`);
    }
    for (const key of [...providerMetricKeys, ...campaignMetricKeys]) {
      if (value[key] !== null) {
        throw new Error(`Unavailable provider period contains unverified metric: ${trail}.${key}`);
      }
    }
  }
}

function assertHealth(value) {
  assertExactKeys(value, HEALTH_KEYS, "leadChannelHealth");
  assertRequiredKeys(value, HEALTH_KEYS, "leadChannelHealth");
  assertTimestamp(value.generatedAt, "leadChannelHealth.generatedAt", { nullable: true });
  for (const key of ["okCount", "warningCount", "criticalCount"]) {
    assertNonNegativeNumber(value[key], `leadChannelHealth.${key}`);
  }
  if (!Array.isArray(value.items)) {
    throw new Error("Snapshot field must be an array: leadChannelHealth.items");
  }
  value.items.forEach((item, index) => {
    const trail = `leadChannelHealth.items.${index}`;
    assertExactKeys(item, HEALTH_ITEM_KEYS, trail);
    assertRequiredKeys(item, HEALTH_ITEM_KEYS, trail);
    assertSafeCode(item.key, `${trail}.key`, { nullable: true });
    assertSafeCode(item.status, `${trail}.status`);
    for (const key of ["count24h", "count7d", "count30d"]) {
      assertNonNegativeNumber(item[key], `${trail}.${key}`);
    }
    assertTimestamp(item.lastSeenAt, `${trail}.lastSeenAt`, { nullable: true });
  });
}

function assertSnapshotSchema(payload) {
  assertExactKeys(payload, TOP_LEVEL_KEYS, "snapshot");
  assertRequiredKeys(payload, TOP_LEVEL_KEYS, "snapshot");

  assertDate(payload.asOf, "snapshot.asOf");
  assertTimestamp(payload.fetchedAt, "snapshot.fetchedAt");
  if (payload.timezone !== EXPECTED_TIMEZONE) {
    throw new Error(`Unexpected snapshot timezone: ${payload.timezone || "missing"}`);
  }
  if (payload.cabinetValidation !== "tenant_setting_exact_match") {
    throw new Error("Snapshot did not prove exact tenant-setting cabinet validation");
  }

  assertExactKeys(payload.periods, new Set(PERIOD_NAMES), "periods");
  assertRequiredKeys(payload.periods, PERIOD_NAMES, "periods");
  for (const periodKey of PERIOD_NAMES) {
    const period = payload.periods[periodKey];
    const trail = `periods.${periodKey}`;
    assertExactKeys(period, PERIOD_KEYS, trail);
    assertRequiredKeys(period, PERIOD_KEYS, trail);
    assertDate(period.from, `${trail}.from`);
    assertDate(period.to, `${trail}.to`);
    assertVkStats(period.vkAds, `${trail}.vkAds`);

    assertExactKeys(period.crm, CRM_KEYS, `${trail}.crm`);
    assertRequiredKeys(period.crm, CRM_KEYS, `${trail}.crm`);
    assertAggregate(period.crm.vk, `${trail}.crm.vk`);
    assertAggregate(period.crm.yandex, `${trail}.crm.yandex`);
    assertExactKeys(period.crm.domains, DOMAIN_KEYS, `${trail}.crm.domains`);
    assertRequiredKeys(period.crm.domains, DOMAIN_KEYS, `${trail}.crm.domains`);
    for (const domain of DOMAIN_KEYS) {
      assertAggregate(period.crm.domains[domain], `${trail}.crm.domains.${domain}`);
    }
    assertFormReceiptChain(period.crm.formReceiptChain, `${trail}.crm.formReceiptChain`);
  }
  assertSevenDayComparisonWindows(payload.periods);

  assertHealth(payload.leadChannelHealth);
}

export function parseAndValidateSnapshot(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) throw new Error("CRM snapshot returned empty output");

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`CRM snapshot did not return one JSON document: ${error.message}`);
  }

  const tenantId = Number(payload.tenantId ?? payload.tenant_id);
  const cabinetId = String(payload.cabinetId ?? payload.cabinet_id ?? "");
  if (tenantId !== EXPECTED_TENANT_ID) {
    throw new Error(`Unexpected CRM tenant: ${tenantId || "missing"}`);
  }
  if (cabinetId !== EXPECTED_CABINET_ID) {
    throw new Error(`Unexpected VK Ads cabinet: ${cabinetId || "missing"}`);
  }

  const status = String(payload.status ?? "");
  if (!new Set(["ok", "partial"]).has(status)) {
    throw new Error(`CRM snapshot status is not usable: ${status || "missing"}`);
  }

  const piiExported = payload.piiExported ?? payload.pii_exported;
  const databaseMutations = Number(payload.databaseMutations ?? payload.database_mutations);
  if (piiExported !== false) throw new Error("CRM snapshot did not prove pii_exported=false");
  if (databaseMutations !== 0) throw new Error("CRM snapshot did not prove database_mutations=0");

  assertNoForbiddenKeys(payload);
  assertSnapshotSchema(payload);

  const providerStatuses = Object.values(payload.periods).map((period) => period.vkAds.status);
  if (status === "ok" && providerStatuses.some((providerStatus) => providerStatus !== "ok")) {
    throw new Error("Snapshot status is inconsistent with incomplete VK Ads periods");
  }
  if (status === "partial" && providerStatuses.every((providerStatus) => providerStatus === "ok")) {
    throw new Error("Snapshot status is inconsistent with complete VK Ads periods");
  }

  return payload;
}

function rounded(value) {
  return Number(value.toFixed(2));
}

function compareMetric(current, previous) {
  const comparable = typeof current === "number" && typeof previous === "number";
  if (!comparable) {
    return {
      current,
      previous,
      delta: null,
      deltaPercent: null,
    };
  }

  const rawDelta = current - previous;
  const delta = rounded(rawDelta);
  const deltaPercent = previous === 0
    ? null
    : rounded((rawDelta / previous) * 100);
  return {
    current,
    previous,
    delta,
    deltaPercent,
  };
}

function compareMetricSet(current, previous, metricNames) {
  return Object.fromEntries(
    [...metricNames].map((metric) => [metric, compareMetric(current[metric], previous[metric])]),
  );
}

function providerComparisonStatus(currentStatus, previousStatus) {
  if (currentStatus === "ok" && previousStatus === "ok") return "complete";
  if (currentStatus === "unavailable" || previousStatus === "unavailable") return "unavailable";
  return "partial";
}

export function buildSevenDayComparison(payload) {
  const current = payload.periods.days7;
  const previous = payload.periods.previous7;

  return {
    generatedAt: payload.fetchedAt,
    asOf: payload.asOf,
    timezone: payload.timezone,
    periods: {
      current: { key: "days7", from: current.from, to: current.to },
      previous: { key: "previous7", from: previous.from, to: previous.to },
    },
    vkAds: {
      status: providerComparisonStatus(current.vkAds.status, previous.vkAds.status),
      metrics: compareMetricSet(current.vkAds, previous.vkAds, VK_COMPARISON_METRICS),
    },
    crm: {
      vk: compareMetricSet(current.crm.vk, previous.crm.vk, AGGREGATE_KEYS),
      yandex: compareMetricSet(current.crm.yandex, previous.crm.yandex, AGGREGATE_KEYS),
      domains: Object.fromEntries(
        [...DOMAIN_KEYS].map((domain) => [
          domain,
          compareMetricSet(
            current.crm.domains[domain],
            previous.crm.domains[domain],
            AGGREGATE_KEYS,
          ),
        ]),
      ),
      formReceiptChain: compareMetricSet(
        current.crm.formReceiptChain,
        previous.crm.formReceiptChain,
        FORM_RECEIPT_CHAIN_KEYS,
      ),
    },
    metricDefinitions: {
      providerGoals: "vk_ads_provider_metric_not_a_confirmed_crm_lead",
      crmDeals: "crm_aggregate_deals",
    },
  };
}

export function runSnapshot({
  runner = defaultRunner,
  outDir = path.join(process.cwd(), "marketing-audits", "vk-crm"),
  now = new Date(),
  allowPartial = false,
} = {}) {
  const payload = parseAndValidateSnapshot(runner());
  if (payload.status === "partial" && !allowPartial) {
    throw new Error("CRM snapshot is partial; explicit allowPartial mode is required");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const comparison = buildSevenDayComparison(payload);
  const comparisonBody = `${JSON.stringify(comparison, null, 2)}\n`;
  const stampedPath = path.join(outDir, `ROSOMAHA_VK_CRM_SNAPSHOT_${stamp}.json`);
  const comparisonPath = path.join(outDir, `ROSOMAHA_VK_CRM_COMPARISON_7D_${stamp}.json`);
  const latestPath = path.join(outDir, "latest.json");
  const latestComparisonPath = path.join(outDir, "latest-comparison-7d.json");
  fs.writeFileSync(stampedPath, body, "utf8");
  fs.writeFileSync(latestPath, body, "utf8");
  fs.writeFileSync(comparisonPath, comparisonBody, "utf8");
  fs.writeFileSync(latestComparisonPath, comparisonBody, "utf8");

  return {
    payload,
    comparison,
    stampedPath,
    comparisonPath,
    latestPath,
    latestComparisonPath,
  };
}

function main() {
  try {
    const allowPartial = process.argv.includes("--allow-partial");
    const result = runSnapshot({ allowPartial });
    const periods = result.payload.periods ?? {};
    const complete = result.payload.status === "ok";
    process.stdout.write(
      `${JSON.stringify({
        ok: complete,
        usable: true,
        complete,
        status: result.payload.status,
        tenantId: EXPECTED_TENANT_ID,
        cabinetId: EXPECTED_CABINET_ID,
        periods: Object.keys(periods),
        report: result.stampedPath,
        comparison: result.comparisonPath,
        latest: result.latestPath,
        latestComparison: result.latestComparisonPath,
        weekComparison: {
          current: result.comparison.periods.current,
          previous: result.comparison.periods.previous,
          vkAds: {
            clicks: result.comparison.vkAds.metrics.clicks,
            spent: result.comparison.vkAds.metrics.spent,
            providerGoals: result.comparison.vkAds.metrics.providerGoals,
          },
          crm: {
            deals: {
              vk: result.comparison.crm.vk.deals,
              yandex: result.comparison.crm.yandex.deals,
              domains: Object.fromEntries(
                [...DOMAIN_KEYS].map((domain) => [
                  domain,
                  result.comparison.crm.domains[domain].deals,
                ]),
              ),
            },
            formReceiptChain: result.comparison.crm.formReceiptChain,
          },
        },
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`Rosomaha VK/CRM snapshot failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) main();
