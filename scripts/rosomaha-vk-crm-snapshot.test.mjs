import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildSevenDayComparison,
  parseAndValidateSnapshot,
  runSnapshot,
} from "./rosomaha-vk-crm-snapshot.mjs";

const aggregate = {
  deals: 2,
  uniqueContacts: 2,
  withLeadSubmissionId: 1,
  withModel: 1,
  withConfiguration: 1,
  working: 1,
  rejected: 0,
  success: 0,
  notTarget: 0,
  proposalOrLater: 0,
  currentNonTarget: 0,
  withCallActivity: 1,
  currentProposalStage: 0,
  currentPrepaymentState: 0,
  currentSuccessState: 0,
  currentShippedState: 0,
  formReceipts: 1,
  processedFormReceipts: 1,
  dealsWithSubmissionId: 1,
  dealsWithMatchingProcessedReceipt: 1,
  dealsMissingReceipt: 0,
  prepaymentsInPeriod: 0,
  successInPeriod: 0,
  shippedInPeriod: 0,
  successRevenueInPeriod: 0,
};

function vkStats(status = "ok") {
  if (status === "unavailable") {
    return {
      status,
      errorCode: "rate_limited",
      httpStatus: 429,
      shows: null,
      clicks: null,
      spent: null,
      ctr: null,
      cpc: null,
      cpm: null,
      providerGoals: null,
      providerGoalCost: null,
      campaignsStatus: "unavailable",
      campaignsErrorCode: "rate_limited",
      totalCampaigns: null,
      activeCampaigns: null,
    };
  }

  return {
    status,
    fetchedAt: "2026-08-11T08:30:00+05:00",
    shows: 100,
    clicks: 10,
    spent: 50,
    ctr: 10,
    cpc: 5,
    cpm: 500,
    providerGoals: 1,
    providerGoalCost: 50,
    campaignsStatus: "ok",
    campaignsErrorCode: null,
    totalCampaigns: 74,
    activeCampaigns: 4,
  };
}

function period(from, to, providerStatus = "ok") {
  return {
    from,
    to,
    vkAds: vkStats(providerStatus),
    crm: {
      vk: { ...aggregate },
      yandex: { ...aggregate },
      domains: {
        bitrix: { ...aggregate },
        catalog: { ...aggregate },
        quiz: { ...aggregate },
        unknown: { ...aggregate },
      },
      formReceiptChain: {
        formReceipts: 1,
        processedFormReceipts: 1,
        dealsWithSubmissionId: 1,
        dealsWithMatchingProcessedReceipt: 1,
        orphanProcessedFormReceipts: 0,
        dealsMissingReceipt: 0,
      },
    },
  };
}

function validPayload(overrides = {}) {
  return {
    status: "ok",
    tenantId: 1,
    cabinetId: "15434257",
    cabinetValidation: "tenant_setting_exact_match",
    fetchedAt: "2026-08-11T08:30:00+05:00",
    asOf: "2026-08-11",
    timezone: "Asia/Yekaterinburg",
    piiExported: false,
    databaseMutations: 0,
    periods: {
      today: period("2026-08-11", "2026-08-11"),
      days7: period("2026-08-05", "2026-08-11"),
      previous7: period("2026-07-29", "2026-08-04"),
      days30: period("2026-07-13", "2026-08-11"),
    },
    leadChannelHealth: {
      generatedAt: "11.08.2026 08:30",
      okCount: 1,
      warningCount: 0,
      criticalCount: 0,
      items: [{ key: "vk", status: "ok", count24h: 1, count7d: 2, count30d: 2, lastSeenAt: "11.08.2026 08:29" }],
    },
    ...overrides,
  };
}

test("accepts a complete isolated aggregate snapshot and writes ignored artifacts", (t) => {
  const tempRoot = path.join(process.cwd(), ".codex_tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(tempRoot, "rosomaha-vk-crm-test-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const payload = validPayload();
  const result = runSnapshot({
    runner: () => JSON.stringify(payload),
    outDir,
    now: new Date("2026-08-11T03:30:00.000Z"),
  });

  assert.deepEqual(result.payload, payload);
  assert.equal(fs.existsSync(result.stampedPath), true);
  assert.equal(fs.existsSync(result.comparisonPath), true);
  assert.equal(fs.existsSync(result.latestPath), true);
  assert.equal(fs.existsSync(result.latestComparisonPath), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.latestPath, "utf8")), payload);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(result.latestComparisonPath, "utf8")),
    result.comparison,
  );
  assert.equal(result.comparison.periods.previous.key, "previous7");
  assert.equal(
    result.comparison.metricDefinitions.providerGoals,
    "vk_ads_provider_metric_not_a_confirmed_crm_lead",
  );
});

test("builds an explicit days7 to previous7 comparison without treating provider goals as CRM deals", () => {
  const payload = validPayload();
  payload.periods.days7.vkAds.clicks = 12;
  payload.periods.previous7.vkAds.clicks = 8;
  payload.periods.days7.vkAds.providerGoals = 3;
  payload.periods.previous7.vkAds.providerGoals = 2;
  payload.periods.days7.crm.vk.deals = 5;
  payload.periods.previous7.crm.vk.deals = 4;

  const comparison = buildSevenDayComparison(parseAndValidateSnapshot(JSON.stringify(payload)));

  assert.deepEqual(comparison.vkAds.metrics.clicks, {
    current: 12,
    previous: 8,
    delta: 4,
    deltaPercent: 50,
  });
  assert.deepEqual(comparison.vkAds.metrics.providerGoals, {
    current: 3,
    previous: 2,
    delta: 1,
    deltaPercent: 50,
  });
  assert.deepEqual(comparison.crm.vk.deals, {
    current: 5,
    previous: 4,
    delta: 1,
    deltaPercent: 25,
  });
  assert.deepEqual(comparison.crm.formReceiptChain.dealsWithMatchingProcessedReceipt, {
    current: 1,
    previous: 1,
    delta: 0,
    deltaPercent: 0,
  });
  assert.notDeepEqual(comparison.vkAds.metrics.providerGoals, comparison.crm.vk.deals);
});

test("requires explicit degraded mode before writing a partial snapshot", (t) => {
  const tempRoot = path.join(process.cwd(), ".codex_tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(tempRoot, "rosomaha-vk-crm-partial-test-"));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const payload = validPayload({
    status: "partial",
    periods: {
      ...validPayload().periods,
      days30: period("2026-07-13", "2026-08-11", "unavailable"),
    },
  });

  assert.throws(
    () => runSnapshot({ runner: () => JSON.stringify(payload), outDir }),
    /explicit allowPartial mode/,
  );
  const result = runSnapshot({ runner: () => JSON.stringify(payload), outDir, allowPartial: true });
  assert.equal(result.payload.status, "partial");
});

test("fails closed on the wrong tenant or cabinet", () => {
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(validPayload({ tenantId: 2 }))),
    /Unexpected CRM tenant/,
  );
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(validPayload({ cabinetId: "999" }))),
    /Unexpected VK Ads cabinet/,
  );
});

test("fails closed when the producer does not prove privacy and read-only mode", () => {
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(validPayload({ piiExported: true }))),
    /pii_exported=false/,
  );
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(validPayload({ databaseMutations: 1 }))),
    /database_mutations=0/,
  );
});

test("rejects unexpected fields including camelCase and plural PII", () => {
  for (const extra of [
    { fullName: "Person" },
    { phones: ["+70000000000"] },
    { emails: ["person@example.test"] },
    { contact: "Person" },
    { notes: "private" },
    { dealId: 12 },
  ]) {
    assert.throws(
      () => parseAndValidateSnapshot(JSON.stringify({ ...validPayload(), ...extra })),
      /forbidden field|unexpected field/,
    );
  }
});

test("rejects incomplete schema, inconsistent status and console noise", () => {
  const missingPeriod = validPayload();
  delete missingPeriod.periods.previous7;
  assert.throws(() => parseAndValidateSnapshot(JSON.stringify(missingPeriod)), /missing required field/);

  const unexpectedPeriod = validPayload();
  unexpectedPeriod.periods.days14 = period("2026-07-29", "2026-08-11");
  assert.throws(() => parseAndValidateSnapshot(JSON.stringify(unexpectedPeriod)), /unexpected field/);

  const nonAdjacentPreviousPeriod = validPayload();
  nonAdjacentPreviousPeriod.periods.previous7 = period("2026-07-28", "2026-08-03");
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(nonAdjacentPreviousPeriod)),
    /immediately precede/,
  );

  const inconsistent = validPayload({
    periods: {
      ...validPayload().periods,
      days30: period("2026-07-13", "2026-08-11", "unavailable"),
    },
  });
  assert.throws(() => parseAndValidateSnapshot(JSON.stringify(inconsistent)), /inconsistent/);
  assert.throws(() => parseAndValidateSnapshot(`notice\n${JSON.stringify(validPayload())}`), /one JSON/);
});

test("rejects a false complete provider period with missing campaigns or metrics", () => {
  const missingCampaigns = validPayload();
  missingCampaigns.periods.today.vkAds.campaignsStatus = "unavailable";
  missingCampaigns.periods.today.vkAds.campaignsErrorCode = "provider_error";
  missingCampaigns.periods.today.vkAds.totalCampaigns = null;
  missingCampaigns.periods.today.vkAds.activeCampaigns = null;
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(missingCampaigns)),
    /unavailable campaigns/,
  );

  const missingMetrics = validPayload();
  missingMetrics.periods.today.vkAds.spent = null;
  assert.throws(
    () => parseAndValidateSnapshot(JSON.stringify(missingMetrics)),
    /non-negative number/,
  );
});
