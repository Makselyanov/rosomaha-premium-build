import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  calculateReadiness,
  campaigns,
  monitoredObjects,
  protectedCampaignIds,
  targetRosomahaRusCampaignId,
} from "./rosomaha-api-only-audit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, "rosomaha-api-only-audit.mjs"), "utf8");

function metrikaCounter(expected, overrides = {}) {
  return {
    ...expected,
    definition: {
      counter: {
        ok: true,
        id: expected.id,
        site: expected.site,
        exactIdVerified: true,
        exactSiteVerified: true,
      },
      goals: {
        ok: true,
        hardGoalVerified: true,
        hardGoal: {
          id: expected.hardGoalId,
          type: "action",
          exactEventVerified: true,
        },
        softGoal: expected.softGoalId ? { id: expected.softGoalId } : null,
      },
    },
    ranges: [1, 7, 30].map((days) => ({ days, ok: true, hardGoals: 0 })),
    hardProof: { days: 30, ok: true, hardGoals: 1 },
    ...overrides,
  };
}

function idealReport() {
  const bitrix = monitoredObjects.find((item) => item.name === "bitrix");
  return {
    direct: {
      accountScope: { exactLoginVerified: true, directClientVerified: true },
      campaignsSnapshot: {
        ok: true,
        data: {
          Campaigns: [{
            Id: Number(targetRosomahaRusCampaignId),
            Type: "UNIFIED_CAMPAIGN",
            State: "OFF",
            Status: "DRAFT",
            UnifiedCampaign: {
              CounterIds: { Items: [Number(bitrix.id)] },
              PriorityGoals: { Items: [{ GoalId: Number(bitrix.hardGoalId), Value: 5000 }] },
            },
          }],
        },
      },
      accountLandingMap: {
        ok: true,
        campaigns: [
          { campaignId: "catalog-campaign", campaignHost: "xn--80aa8ahaki9a.site" },
          { campaignId: "quiz-campaign", campaignHost: "rosomaha.site" },
        ],
      },
      ranges: [{ totals: [{ conversions: 999 }] }],
    },
    metrika: { counters: monitoredObjects.map((item) => metrikaCounter(item)) },
  };
}

test("контракт содержит три раздельных домена, счётчика и hard goals", () => {
  assert.deepEqual(
    monitoredObjects.map(({ site, id, hardGoalId, softGoalId }) => ({ site, id, hardGoalId, softGoalId })),
    [
      { site: "xn--80aa8ahaki9a.site", id: "107139619", hardGoalId: "517600157", softGoalId: "517599639" },
      { site: "rosomaha.site", id: "105918356", hardGoalId: "496461698", softGoalId: null },
      { site: "rosomaha-rus.ru", id: "111905412", hardGoalId: "601477348", softGoalId: "601477497" },
    ],
  );
  assert.equal(new Set(monitoredObjects.map((item) => item.site)).size, 3);
  assert.equal(new Set(monitoredObjects.map((item) => item.id)).size, 3);
});

test("кампания rosomaha-rus.ru наблюдается, а три защищённые кампании остаются в явном запрете", () => {
  assert.equal(targetRosomahaRusCampaignId, "713802902");
  assert.ok(campaigns.includes(targetRosomahaRusCampaignId));
  assert.deepEqual(protectedCampaignIds, ["708505950", "705770573", "710087376"]);
  assert.ok(protectedCampaignIds.every((id) => campaigns.includes(id)));
});

test("полный независимый набор доказательств даёт 100/100 каждому объекту", () => {
  const readiness = calculateReadiness(idealReport());
  assert.equal(readiness.overallScore, 100);
  assert.deepEqual(
    Object.fromEntries(Object.entries(readiness.objects).map(([name, value]) => [name, value.score])),
    { catalog: 100, quiz: 100, bitrix: 100 },
  );
});

test("soft goal и conversions Direct не заменяют реальную hard conversion", () => {
  const report = idealReport();
  const bitrix = report.metrika.counters.find((counter) => counter.name === "bitrix");
  bitrix.hardProof.hardGoals = 0;
  bitrix.softGoalReaches = 1000;
  report.direct.ranges = [{ totals: [{ campaignId: targetRosomahaRusCampaignId, conversions: 1000 }] }];

  const result = calculateReadiness(report).objects.bitrix;
  const conversionCheck = result.checks.find((check) => check.id === "natural_hard_conversion");
  assert.equal(result.score, 90);
  assert.equal(conversionCheck.passed, false);
  assert.equal(result.classification.softGoal, "soft_signal_not_lead");
  assert.equal(result.classification.directConversions, "ad_platform_signal_not_lead");
});

test("нулевая или недоказанная ценность PriorityGoal не даёт последние 10 баллов", () => {
  const report = idealReport();
  report.direct.campaignsSnapshot.data.Campaigns[0].UnifiedCampaign.PriorityGoals.Items[0].Value = 0;
  const result = calculateReadiness(report).objects.bitrix;
  assert.equal(result.score, 90);
  assert.equal(result.status, "high_but_not_100");
  assert.equal(result.checks.find((check) => check.id === "hard_priority_goal").passed, false);
});

test("посадочная одного домена не добавляет баллы другому домену", () => {
  const report = idealReport();
  report.direct.accountLandingMap.campaigns = [
    { campaignId: "only-catalog", campaignHost: "xn--80aa8ahaki9a.site" },
  ];
  const result = calculateReadiness(report);
  assert.equal(result.objects.catalog.score, 100);
  assert.equal(result.objects.quiz.score, 80);
  assert.equal(
    result.objects.quiz.checks.find((check) => check.id === "direct_landing_domain").passed,
    false,
  );
});

test("неверный домен счётчика обнуляет только соответствующий evidence-check", () => {
  const report = idealReport();
  const bitrix = report.metrika.counters.find((counter) => counter.name === "bitrix");
  bitrix.definition.counter.site = "rosomaha.site";
  bitrix.definition.counter.exactSiteVerified = false;
  const result = calculateReadiness(report).objects.bitrix;
  assert.equal(result.score, 80);
  assert.equal(result.checks.find((check) => check.id === "counter_identity").passed, false);
});

test("источник недоступен не превращается в нулевые метрики другого сайта", () => {
  const report = idealReport();
  report.metrika.counters = report.metrika.counters.filter((counter) => counter.name !== "bitrix");
  const result = calculateReadiness(report).objects.bitrix;
  assert.equal(result.score, 30);
  assert.equal(result.hardConversions30d, null);
  assert.equal(result.checks.find((check) => check.id === "counter_identity").passed, false);
  assert.equal(result.checks.find((check) => check.id === "hard_goal_definition").passed, false);
  assert.equal(result.checks.find((check) => check.id === "statistics_windows").passed, false);
});

test("скрипт не содержит устаревший счётчик и не объявляет Direct conversions заявками", () => {
  assert.doesNotMatch(source, new RegExp(["5060", "6578"].join(""), "u"));
  assert.match(source, /soft_signal_not_lead/u);
  assert.match(source, /ad_platform_signal_not_lead/u);
  assert.match(source, /не считать заявками/u);
});

test("контракт Direct остаётся API-only и read-only", () => {
  assert.doesNotMatch(source, /directJsonRequest\([^\n]+,\s*"(?:add|update|delete|resume|suspend|moderate)"/u);
  assert.doesNotMatch(source, /directSafeJsonRequest\([^\n]+,\s*"(?:add|update|delete|resume|suspend|moderate)"/u);
  assert.match(source, /readOnly:\s*true/u);
  assert.match(source, /browserAllowed:\s*false/u);
  assert.match(source, /const isMain =/u);
});
