import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditRosomahaRusPublicHttp,
  calculateReadiness,
  campaigns,
  classifyGscOAuthFailure,
  extractHtmlSeoSignals,
  monitoredObjects,
  protectedCampaignIds,
  rosomahaRusPublicTargets,
  selectExactWebmasterProperty,
  targetRosomahaRusCampaignId,
  webmasterApiGet,
  webmasterExactHostReport,
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

test("публичный контракт закрепляет HTTP→HTTPS и точный ключевой product URL с oid", () => {
  assert.deepEqual(
    rosomahaRusPublicTargets.map(({ id, url }) => ({ id, url })),
    [
      { id: "httpRoot", url: "http://rosomaha-rus.ru/" },
      { id: "root", url: "https://rosomaha-rus.ru/" },
      { id: "robots", url: "https://rosomaha-rus.ru/robots.txt" },
      { id: "sitemap", url: "https://rosomaha-rus.ru/sitemap.xml" },
      {
        id: "keyProduct",
        url: "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
      },
    ],
  );
});

test("canonical сравнивается с сохранённым и отсортированным query", () => {
  const finalUrl = "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812&view=full";
  const matching = extractHtmlSeoSignals(
    "<link rel=\"canonical\" href=\"?view=full&amp;oid=812\"><meta name=\"robots\" content=\"index,follow\">",
    finalUrl,
  );
  assert.equal(matching.canonicalMatchesFinal, true);
  assert.equal(matching.metaNoindex, false);

  const missingOid = extractHtmlSeoSignals(
    "<link rel=\"canonical\" href=\"?view=full\">",
    finalUrl,
  );
  assert.equal(missingOid.canonicalMatchesFinal, false);
});

test("публичный HTTP-блок офлайн собирает status, redirect, canonical, robots и sitemap", async () => {
  const keyProductUrl = rosomahaRusPublicTargets.find((target) => target.id === "keyProduct").url;
  const fetchFixture = async (url) => {
    const value = String(url);
    if (value === "http://rosomaha-rus.ru/") {
      return new Response("", {
        status: 301,
        headers: { Location: "https://rosomaha-rus.ru/" },
      });
    }
    if (value === "https://rosomaha-rus.ru/") {
      return new Response(
        "<html><head><link rel=\"canonical\" href=\"https://rosomaha-rus.ru/\"><meta name=\"robots\" content=\"index,follow\"></head></html>",
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    if (value === "https://rosomaha-rus.ru/robots.txt") {
      return new Response(
        "User-agent: *\nDisallow:\nSitemap: https://rosomaha-rus.ru/sitemap.xml\n",
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }
    if (value === "https://rosomaha-rus.ru/sitemap.xml") {
      return new Response(
        "<?xml version=\"1.0\"?><urlset><url><loc>https://rosomaha-rus.ru/</loc></url><url><loc>"
          + keyProductUrl.replace("&", "&amp;")
          + "</loc></url></urlset>",
        { status: 200, headers: { "Content-Type": "application/xml" } },
      );
    }
    if (value === keyProductUrl) {
      return new Response(
        "<html><head><link href=\"" + keyProductUrl
          + "\" rel=\"canonical\"><meta content=\"index,follow\" name=\"robots\"></head></html>",
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }
    throw new Error("unexpected fixture URL " + value);
  };

  const report = await auditRosomahaRusPublicHttp(fetchFixture);
  assert.equal(report.sourceStatus, "available");
  assert.deepEqual(report.checks, {
    httpsRoot200: true,
    httpRootRedirectsToHttps: true,
    robots200AndOpen: true,
    sitemap200AndXml: true,
    keyProduct200SelfCanonical: true,
  });
  assert.equal(report.targets.httpRoot.redirectCount, 1);
  assert.equal(report.targets.httpRoot.finalHost, "rosomaha-rus.ru");
  assert.equal(report.targets.keyProduct.html.canonical, keyProductUrl);
  assert.equal(report.targets.sitemap.sitemap.locCount, 2);
  assert.equal(report.targets.sitemap.sitemap.keyProductListed, true);
});

test("Webmaster выбирает только точный non-www host, не основной домен и не www", () => {
  const exact = {
    host_id: "https:rosomaha-rus.ru:443",
    ascii_host_url: "https://rosomaha-rus.ru:443",
  };
  const properties = [
    {
      host_id: "https:xn--80aa8ahaki9a.site:443",
      ascii_host_url: "https://xn--80aa8ahaki9a.site:443",
    },
    {
      host_id: "https:www.rosomaha-rus.ru:443",
      ascii_host_url: "https://www.rosomaha-rus.ru:443",
    },
    exact,
  ];
  assert.equal(selectExactWebmasterProperty(properties, "rosomaha-rus.ru"), exact);
  assert.equal(selectExactWebmasterProperty(properties.slice(0, 2), "rosomaha-rus.ru"), null);
});

test("Webmaster повторяет безопасный GET после сетевого тайм-аута", async () => {
  const calls = [];
  const request = async (url, options, transportOptions) => {
    calls.push({ url, options, transportOptions });
    if (calls.length === 1) throw new Error("HTTPS timeout after 30000 ms");
    return {
      ok: true,
      status: 200,
      data: { hosts: [] },
      providerMeta: { requestId: "request-2" },
    };
  };

  const result = await webmasterApiGet(
    { YANDEX_WEBMASTER_TOKEN: "offline-token" },
    "https://api.webmaster.yandex.net/v4/user/2301393527/hosts/",
    request,
  );

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.requestId, "request-2");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === "GET"));
  assert.ok(calls.every((call) => call.options.family === 4));
  assert.ok(calls.every((call) => call.transportOptions.fetchImpl === null));
  assert.ok(calls.every((call) => call.transportOptions.timeoutMs === 30_000));
});

test("если точного Webmaster property нет, endpoint не вызываются и все source_unavailable", async () => {
  const calls = [];
  const request = async (_env, url) => {
    calls.push(url);
    return {
      ok: true,
      sourceStatus: "available",
      data: {
        hosts: [{
          host_id: "https:xn--80aa8ahaki9a.site:443",
          ascii_host_url: "https://xn--80aa8ahaki9a.site:443",
        }],
      },
    };
  };
  const report = await webmasterExactHostReport({
    YANDEX_WEBMASTER_TOKEN: "offline-token",
    YANDEX_WEBMASTER_USER_ID: "2301393527",
    YANDEX_WEBMASTER_HOST_ID: "https:xn--80aa8ahaki9a.site:443",
  }, "rosomaha-rus.ru", request);

  assert.equal(report.propertyAvailable, false);
  assert.equal(report.sourceStatus, "source_unavailable");
  assert.equal(report.reason, "exact_host_property_not_available");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/v4\/user\/2301393527\/hosts\/$/u);
  assert.deepEqual(Object.keys(report.endpoints), [
    "summary",
    "indexing",
    "excluded",
    "diagnostics",
    "sitemaps",
    "queries",
  ]);
  assert.ok(Object.values(report.endpoints).every(
    (endpoint) => endpoint.ok === false && endpoint.sourceStatus === "source_unavailable",
  ));
  assert.doesNotMatch(JSON.stringify(report.endpoints), /searchable_pages_count/u);
});

test("точное Webmaster property собирает только свои шесть endpoint", async () => {
  const calls = [];
  const property = {
    host_id: "https:rosomaha-rus.ru:443",
    ascii_host_url: "https://rosomaha-rus.ru:443",
    verified: true,
  };
  const request = async (_env, url) => {
    calls.push(url);
    if (url.endsWith("/hosts/")) {
      return { ok: true, sourceStatus: "available", data: { hosts: [property] } };
    }
    if (url.includes("/summary/")) {
      return { ok: true, sourceStatus: "available", data: { searchable_pages_count: 270 } };
    }
    if (url.includes("/indexing/history/")) {
      return { ok: true, sourceStatus: "available", data: { indicators: { HTTP_2XX: [{ value: 270 }] } } };
    }
    if (url.includes("/excluded-urls/samples/")) {
      return { ok: true, sourceStatus: "available", data: { samples: [] } };
    }
    if (url.includes("/diagnostics/")) {
      return { ok: true, sourceStatus: "available", data: { problems: {} } };
    }
    if (url.includes("/sitemaps/")) {
      return { ok: true, sourceStatus: "available", data: { sitemaps: [] } };
    }
    if (url.includes("/search-queries/popular/")) {
      return { ok: true, sourceStatus: "available", data: { count: 0, queries: [] } };
    }
    throw new Error("unexpected Webmaster fixture URL " + url);
  };
  const report = await webmasterExactHostReport({
    YANDEX_WEBMASTER_TOKEN: "offline-token",
    YANDEX_WEBMASTER_USER_ID: "2301393527",
  }, "rosomaha-rus.ru", request);

  assert.equal(report.sourceStatus, "available");
  assert.equal(report.propertyAvailable, true);
  assert.equal(report.property.host, "rosomaha-rus.ru");
  assert.equal(report.property.hostId, "https:rosomaha-rus.ru:443");
  assert.equal(calls.length, 7);
  assert.ok(calls.slice(1).every((url) => url.includes("/hosts/https%3Arosomaha-rus.ru%3A443/")));
  assert.ok(Object.values(report.endpoints).every((endpoint) => endpoint.ok));
});

test("GSC invalid_grant всегда является недоступным источником, а не нулём", () => {
  const result = classifyGscOAuthFailure(
    new Error("OAuth token exchange failed: invalid_grant; Token has been expired or revoked."),
  );
  assert.equal(result.ok, false);
  assert.equal(result.sourceStatus, "source_unavailable");
  assert.equal(result.reason, "invalid_grant");
  assert.ok(!Object.hasOwn(result, "clicks"));
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

test("Markdown содержит отдельные HTTP и Webmaster блоки rosomaha-rus.ru", () => {
  assert.match(source, /## Публичный HTTP: rosomaha-rus\.ru/u);
  assert.match(source, /## SEO \/ Webmaster: rosomaha-rus\.ru/u);
  assert.match(source, /report\.webmasterByDomain\?\.bitrix/u);
  assert.match(source, /Данные xn--80aa8ahaki9a\.site не подставлялись/u);
  for (const endpoint of ["summary", "indexing", "excluded", "diagnostics", "sitemaps", "queries"]) {
    assert.match(source, new RegExp("bitrixEndpoints\\." + endpoint, "u"));
  }
});
