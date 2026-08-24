import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  EXACT_LOGIN,
  ENV_PATH,
  PROJECT_ROOT,
  loadProjectToken,
  nativeHttpsRequest,
  redactSensitive,
  resolveProjectRoute,
  safeJsonRequest,
} from "./yandex-direct-balance.mjs";

const DIRECT_API_BASE = "https://api.direct.yandex.com/json/v501";
const ACCOUNT_SLUG = "rosomaha-yandex";
const LOCK_PATH = path.join("G:\\mvp\\browser-locks", `${ACCOUNT_SLUG}.lock`);
const REPORT_DIR = path.join(PROJECT_ROOT, "marketing-audits", "yandex-direct");
const MUTATION_UNLOCK = "I_UNDERSTAND_THIS_CHANGES_LIVE_DIRECT";
const ROSOMAHA_RUS_COUNTER_ID = 50606578;
const VERIFIED_HOST = "rosomaha-rus.ru";
const RUSSIA_REGION_ID = 225;
const DEFAULT_WEEKLY_LIMIT_RUB = 10000;
const DEFAULT_BID_CEILING_RUB = 150;

const campaignDateSlug = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const utmCampaign = `rosomaha_rus_search_${campaignDateSlug}`;
const campaignName = `rosomaha-rus.ru Search draft ${campaignDateSlug}`;

const campaignNegativeKeywords = Object.freeze([
  "авито",
  "бу",
  "б у",
  "с пробегом",
  "ремонт",
  "запчасти",
  "запчасть",
  "самодельный",
  "самоделка",
  "своими руками",
  "чертеж",
  "чертежи",
  "вакансии",
  "вакансия",
  "работа",
  "аренда",
  "прокат",
  "отзывы",
  "обзор",
  "форум",
  "видео",
  "фото",
  "сравнение",
  "аналог",
  "шерп",
  "трэкол",
  "трекол",
  "бурлак",
  "техноволк",
  "тайфун",
  "медведь",
  "гусеничный",
  "гусеницах",
  "гусеницы",
  "мтлб",
  "гтт",
]);

const sitelinks = Object.freeze([
  {
    title: "Экстрим УАЗ",
    href: "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
    description: "Модель Экстрим 1.5 литра с мостами УАЗ.",
  },
  {
    title: "Экстрим Toyota",
    href: "https://rosomaha-rus.ru/product/extrime-1-5-litra-mosty-toyota/?oid=824",
    description: "Экстрим 1.5 литра с мостами Toyota.",
  },
  {
    title: "Хантер Toyota",
    href: "https://rosomaha-rus.ru/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800",
    description: "Хантер 1.5 литра с мостами Toyota.",
  },
  {
    title: "Опции и шины",
    href: "https://rosomaha-rus.ru/product/optsii/shiny/",
    description: "Опции, шины и дооснащение техники Росомаха.",
  },
]);

const adBlueprints = Object.freeze([
  {
    groupName: "Brand Rosomaha",
    landingPage: "https://rosomaha-rus.ru/",
    ad: {
      title: "Вездеходы Росомаха",
      title2: "Завод-изготовитель",
      text: "Квадроциклы и снегоболотоходы Росомаха. Подбор модели и связь с заводом.",
      displayUrlPath: "rosomaha-zavod",
    },
    keywords: [
      "росомаха вездеход",
      "снегоболотоход росомаха",
      "квадроцикл росомаха",
      "вездеход росомаха купить",
      "завод росомаха",
    ],
  },
  {
    groupName: "Commercial category",
    landingPage: "https://rosomaha-rus.ru/product/kvadrotsikly/?display=price",
    ad: {
      title: "Снегоболотоход купить",
      title2: "Модели Росомаха",
      text: "Каталог моделей Росомаха с ценами, комплектациями и опциями. Доставка по России.",
      displayUrlPath: "catalog",
    },
    keywords: [
      "снегоболотоход купить",
      "болотоход купить",
      "снегоболотоход от производителя",
      "вездеход низкого давления купить",
    ],
  },
  {
    groupName: "Extrime UAZ",
    landingPage: "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
    ad: {
      title: "Экстрим 1.5 УАЗ",
      title2: "от 1 850 000 ₽",
      text: "Росомаха Экстрим с 1NZ-FE и мостами УАЗ. Цена на сайте, опции и заявка заводу.",
      displayUrlPath: "extrime-uaz",
    },
    keywords: [
      "росомаха экстрим уаз",
      "экстрим 1 5 уаз купить",
      "вездеход экстрим уаз",
      "росомаха экстрим 1nz fe уаз",
    ],
  },
  {
    groupName: "Extrime Toyota",
    landingPage: "https://rosomaha-rus.ru/product/extrime-1-5-litra-mosty-toyota/?oid=824",
    ad: {
      title: "Экстрим 1.5 Toyota",
      title2: "от 2 100 000 ₽",
      text: "Росомаха Экстрим с 1NZ-FE и мостами Toyota. Цена, комплектация и форма заявки.",
      displayUrlPath: "extrime-toyota",
    },
    keywords: [
      "росомаха экстрим toyota",
      "экстрим 1 5 toyota купить",
      "вездеход экстрим тойота",
      "росомаха экстрим 1nz fe toyota",
    ],
  },
  {
    groupName: "Hunter Toyota",
    landingPage: "https://rosomaha-rus.ru/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800",
    ad: {
      title: "Хантер 1.5 Toyota",
      title2: "от 2 230 000 ₽",
      text: "Росомаха Хантер с 1NZ-FE и мостами Toyota. Цена на сайте и заявка в завод.",
      displayUrlPath: "hunter-toyota",
    },
    keywords: [
      "росомаха хантер toyota",
      "хантер 1 5 toyota купить",
      "вездеход хантер тойота",
      "росомаха хантер 1nz fe toyota",
    ],
  },
]);

function parseArgs(argv) {
  const rawArgs = argv.slice(2);
  const args = new Set(rawArgs);
  const sanitizeArg = rawArgs.find((item) => item.startsWith("--sanitize-campaign-id="));
  return {
    apply: args.has("--apply"),
    dryRun: !args.has("--apply"),
    sanitizeCampaignId: sanitizeArg ? Number(sanitizeArg.split("=")[1]) : null,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function stampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function microsFromRub(value) {
  return Math.round(Number(value) * 1_000_000);
}

function uniqueSorted(items) {
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"));
}

function curlJson(args) {
  const stdout = execFileSync("curl.exe", args, {
    encoding: "utf8",
    timeout: 20000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return stdout ? JSON.parse(stdout) : null;
}

function appendUtm(href) {
  const url = new URL(href);
  url.searchParams.set("utm_source", "yandex");
  url.searchParams.set("utm_medium", "cpc");
  url.searchParams.set("utm_campaign", utmCampaign);
  url.searchParams.set("utm_content", "{ad_id}");
  url.searchParams.set("utm_term", "{phrase_id}");
  return url.toString();
}

function ensureMarketingDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function writeArtifacts(report) {
  ensureMarketingDir();
  const stamp = stampForFile();
  const baseName = `ROSOMAHA_RUS_SEARCH_DRAFT_${stamp}`;
  const jsonPath = path.join(REPORT_DIR, `${baseName}.json`);
  const mdPath = path.join(REPORT_DIR, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${buildMarkdown(report, jsonPath)}\n`, "utf8");
  return { jsonPath, mdPath };
}

function buildMarkdown(report, jsonPath) {
  const lines = [
    `# Rosomaha rus search draft — ${report.generatedAt}`,
    "",
    `- Режим: ${report.mode}`,
    `- Логин: ${report.login}`,
    `- JSON: ${path.relative(PROJECT_ROOT, jsonPath)}`,
    `- Кампания: ${report.plan.campaign.name}`,
    `- Weekly limit: ${report.plan.campaign.weeklyLimitRub} ₽`,
    `- Bid ceiling: ${report.plan.campaign.bidCeilingRub} ₽`,
    "",
    "## Creation gates",
    ...report.gates.creation.map((gate) => `- [${gate.pass ? "OK" : "BLOCK"}] ${gate.name}: ${gate.details}`),
    "",
    "## Launch gates",
    ...report.gates.launch.map((gate) => `- [${gate.pass ? "OK" : "BLOCK"}] ${gate.name}: ${gate.details}`),
    "",
    "## Campaign payload",
    `- Групп: ${report.plan.groups.length}`,
    `- Ключей: ${report.plan.groups.reduce((sum, group) => sum + group.keywords.length, 0)}`,
    `- Быстрых ссылок: ${report.plan.sitelinks.length}`,
    `- CounterIds: ${report.plan.campaign.counterIds.length ? report.plan.campaign.counterIds.join(", ") : "(не прикреплены)"}`,
    "",
    "## Mutation result",
    ...report.mutation.notes.map((line) => `- ${line}`),
  ];

  return lines.join("\n");
}

function buildPlan(counterAccessible) {
  return {
    campaign: {
      name: campaignName,
      landingHost: VERIFIED_HOST,
      weeklyLimitRub: DEFAULT_WEEKLY_LIMIT_RUB,
      bidCeilingRub: DEFAULT_BID_CEILING_RUB,
      counterIds: counterAccessible ? [ROSOMAHA_RUS_COUNTER_ID] : [],
      negativeKeywords: [...campaignNegativeKeywords],
      utmCampaign,
      searchOnly: true,
      rsyaEnabled: false,
    },
    sitelinks: sitelinks.map((item) => ({
      ...item,
      href: appendUtm(item.href),
    })),
    groups: adBlueprints.map((group) => ({
      name: group.groupName,
      landingPage: appendUtm(group.landingPage),
      keywords: [...group.keywords],
      ad: { ...group.ad },
    })),
  };
}

function buildCreationGates({ routeEvidence, existingCampaigns, landingChecks }) {
  return [
    {
      name: "Exact Yandex route",
      pass: routeEvidence.status === "verified" && routeEvidence.directLogin === EXACT_LOGIN,
      details: routeEvidence.status === "verified"
        ? `Подтвержден точный логин ${routeEvidence.directLogin}.`
        : "Маршрут не подтвержден.",
    },
    {
      name: "No duplicate rosomaha-rus campaign",
      pass: existingCampaigns.length === 0,
      details: existingCampaigns.length
        ? `Найдены кампании с тем же именем/хостом: ${existingCampaigns.map((item) => item.name).join("; ")}`
        : "Дубликаты по имени/хосту не найдены.",
    },
    {
      name: "Landing pages alive",
      pass: landingChecks.every((item) => item.ok),
      details: landingChecks.map((item) => `${item.url} -> ${item.status}`).join("; "),
    },
  ];
}

function buildLaunchGates({ counterProbe, directGoalVisible, gscHealthy }) {
  return [
    {
      name: "Metrika counter access for rosomaha-rus.ru",
      pass: counterProbe.counterAccessible,
      details: counterProbe.counterAccessible
        ? `Счётчик ${ROSOMAHA_RUS_COUNTER_ID} виден через API.`
        : `Счётчик ${ROSOMAHA_RUS_COUNTER_ID} публично установлен на сайте, но API-доступ не доказан.`,
    },
    {
      name: "Hard goal visible in Direct",
      pass: directGoalVisible,
      details: directGoalVisible
        ? "Жёсткая цель видна в контуре Direct."
        : "Жёсткая цель для rosomaha-rus.ru в контуре Direct не доказана.",
    },
    {
      name: "Search Console health",
      pass: gscHealthy,
      details: gscHealthy
        ? "GSC доступна."
        : "GSC в проекте сейчас с invalid_grant; это не блокер для draft, но блокер для полной измеримости.",
    },
  ];
}

async function httpStatus(url) {
  const response = await nativeHttpsRequest(url, { method: "GET", headers: { "User-Agent": "Codex Rosomaha Audit" } }, 10000);
  return { ok: response.ok, status: response.status, url };
}

async function metrikaGet(url, token) {
  const response = await safeJsonRequest(url, {
    method: "GET",
    headers: {
      Authorization: `OAuth ${token}`,
      "User-Agent": "Codex Rosomaha Audit",
    },
  }, {
    timeoutMs: 20000,
    secrets: [token],
  });
  if (!response.ok) {
    throw new Error(`Metrika HTTP ${response.status}: ${redactSensitive(JSON.stringify(response.data), [token])}`);
  }
  return response.data;
}

async function probeCounter(token) {
  try {
    const url = new URL("https://api-metrika.yandex.net/management/v1/counters");
    url.searchParams.set("per_page", "100");
    let counters;
    try {
      counters = await metrikaGet(url.toString(), token);
    } catch {
      counters = curlJson(["-s", "-L", "-H", `Authorization: OAuth ${token}`, url.toString()]);
    }
    const found = (counters?.counters || []).find((item) => String(item.id) === String(ROSOMAHA_RUS_COUNTER_ID));
    return {
      counterAccessible: Boolean(found),
      counter: found
        ? {
            id: found.id,
            site: found.site,
            name: found.name,
            owner_login: found.owner_login || null,
          }
        : null,
      limitation: found
        ? null
        : `Counter ${ROSOMAHA_RUS_COUNTER_ID} not found in accessible Metrika counters list.`,
    };
  } catch (error) {
    return {
      counterAccessible: false,
      counter: null,
      limitation: error.message,
    };
  }
}

async function directRequest(token, service, method, params) {
  const endpoint = `${DIRECT_API_BASE}/${service}`;
  const response = await safeJsonRequest(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Login": EXACT_LOGIN,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ method, params }),
  }, { secrets: [token] });

  if (!response.ok || response.data?.error) {
    const details = response.data?.error?.error_detail || response.data?.error?.error_string || JSON.stringify(response.data);
    throw new Error(`${service}.${method} failed: ${redactSensitive(details, [token])}`);
  }

  return response.data?.result || {};
}

function assertActionResults(result, key, context) {
  const rows = result?.[key];
  if (!Array.isArray(rows)) return result;
  const problems = rows.flatMap((row) => {
    const errors = Array.isArray(row?.Errors) ? row.Errors : [];
    const warnings = Array.isArray(row?.Warnings) ? row.Warnings : [];
    const issues = [];
    for (const error of errors) {
      issues.push(`${context} id=${row?.Id ?? "unknown"} error ${error.Code}: ${error.Message}${error.Details ? ` (${error.Details})` : ""}`);
    }
    for (const warning of warnings) {
      issues.push(`${context} id=${row?.Id ?? "unknown"} warning ${warning.Code}: ${warning.Message}${warning.Details ? ` (${warning.Details})` : ""}`);
    }
    return issues;
  });
  if (problems.length) {
    throw new Error(problems.join("; "));
  }
  return result;
}

function collectActionIssues(result, key, context) {
  const rows = result?.[key];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const errors = Array.isArray(row?.Errors) ? row.Errors : [];
    const warnings = Array.isArray(row?.Warnings) ? row.Warnings : [];
    const issues = [];
    for (const error of errors) {
      issues.push(`${context} id=${row?.Id ?? "unknown"} error ${error.Code}: ${error.Message}${error.Details ? ` (${error.Details})` : ""}`);
    }
    for (const warning of warnings) {
      issues.push(`${context} id=${row?.Id ?? "unknown"} warning ${warning.Code}: ${warning.Message}${warning.Details ? ` (${warning.Details})` : ""}`);
    }
    return issues;
  });
}

async function fetchExistingRosomahaRusCampaigns(token) {
  const campaigns = await directRequest(token, "campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "Status", "State", "Type"],
    TextCampaignFieldNames: ["CounterIds"],
    UnifiedCampaignFieldNames: ["CounterIds"],
    Page: { Limit: 10000, Offset: 0 },
  });

  const items = campaigns.Campaigns || [];
  return items.filter((item) =>
    String(item.Name || "").toLowerCase().includes("rosomaha-rus.ru".toLowerCase()) ||
    String(item.Name || "").toLowerCase() === campaignName.toLowerCase(),
  ).map((item) => ({
    id: Number(item.Id),
    name: item.Name,
    state: item.State,
    status: item.Status,
    type: item.Type,
    counterIds: item.TextCampaign?.CounterIds?.Items || item.UnifiedCampaign?.CounterIds?.Items || [],
  }));
}

async function probeDirectGoals(token) {
  try {
    const response = await safeJsonRequest("https://api.direct.yandex.ru/live/v4/json/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        method: "GetRetargetingGoals",
        token,
        locale: "ru",
        param: {},
      }),
    }, { secrets: [token] });

    const result = response.data?.data || {};
    const goals = result.RetargetingGoals || [];
    const bitrixGoals = goals.filter((goal) => String(goal.GoalDomain || "").toLowerCase().includes(VERIFIED_HOST));
    return { directGoalVisible: bitrixGoals.length > 0, goals: bitrixGoals };
  } catch (error) {
    return { directGoalVisible: false, goals: [], limitation: error.message };
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  if (fs.existsSync(LOCK_PATH)) {
    throw new Error(`Yandex mutation lock already exists: ${LOCK_PATH}`);
  }
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify({
    accountSlug: ACCOUNT_SLUG,
    project: "rosomaha",
    login: EXACT_LOGIN,
    action: "create rosomaha-rus draft search campaign",
    startedAt: nowIso(),
    pid: process.pid,
  }, null, 2)}\n`, "utf8");
}

function releaseLock() {
  if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH, { force: true });
}

function assertMutationsAllowed() {
  if (process.env.YANDEX_DIRECT_MUTATIONS !== MUTATION_UNLOCK) {
    throw new Error(`Blocked. Set YANDEX_DIRECT_MUTATIONS=${MUTATION_UNLOCK} only for an explicit live mutation run.`);
  }
}

function campaignPayload(plan) {
  const payload = {
    Name: plan.campaign.name,
    StartDate: new Date().toISOString().slice(0, 10),
    NegativeKeywords: { Items: plan.campaign.negativeKeywords },
    UnifiedCampaign: {
      BiddingStrategy: {
        Search: {
          BiddingStrategyType: "WB_MAXIMUM_CLICKS",
          WbMaximumClicks: {
            WeeklySpendLimit: microsFromRub(plan.campaign.weeklyLimitRub),
            BidCeiling: microsFromRub(plan.campaign.bidCeilingRub),
          },
          PlacementTypes: {
            SearchResults: "YES",
            ProductGallery: "YES",
            DynamicPlaces: "NO",
            Maps: "NO",
            SearchOrganizationList: "NO",
          },
        },
        Network: {
          BiddingStrategyType: "SERVING_OFF",
          PlacementTypes: {
            Network: "NO",
            Maps: "NO",
          },
        },
      },
      Settings: [
        { Option: "ADD_METRICA_TAG", Value: "YES" },
        { Option: "ENABLE_SITE_MONITORING", Value: "YES" },
        { Option: "CAMPAIGN_EXACT_PHRASE_MATCHING_ENABLED", Value: "YES" },
      ],
    },
  };

  if (plan.campaign.counterIds.length) {
    payload.UnifiedCampaign.CounterIds = { Items: plan.campaign.counterIds };
  }

  return payload;
}

function adGroupsPayload(campaignId, plan) {
  return plan.groups.map((group) => ({
    Name: group.name,
    CampaignId: campaignId,
    RegionIds: [RUSSIA_REGION_ID],
    UnifiedAdGroup: { OfferRetargeting: "NO" },
  }));
}

function adsPayload(groupIdsByName, sitelinkSetId, plan) {
  return plan.groups.map((group) => ({
    AdGroupId: groupIdsByName.get(group.name),
    TextAd: {
      Title: group.ad.title,
      Title2: group.ad.title2,
      Text: group.ad.text,
      Href: group.landingPage,
      Mobile: "NO",
      DisplayUrlPath: group.ad.displayUrlPath,
      SitelinkSetId: sitelinkSetId,
    },
  }));
}

function keywordsPayload(groupIdsByName, plan) {
  return plan.groups.flatMap((group) =>
    group.keywords.map((keyword) => ({
      AdGroupId: groupIdsByName.get(group.name),
      Keyword: keyword,
    })),
  );
}

async function verifyCreatedObjects(token, campaignId) {
  const [campaigns, adGroups, ads, keywords] = await Promise.all([
    directRequest(token, "campaigns", "get", {
      SelectionCriteria: { Ids: [campaignId] },
      FieldNames: ["Id", "Name", "Status", "State", "Type"],
      UnifiedCampaignFieldNames: ["CounterIds"],
    }),
    directRequest(token, "adgroups", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "Name", "CampaignId", "Status", "ServingStatus", "Type"],
      Page: { Limit: 10000, Offset: 0 },
    }),
    directRequest(token, "ads", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "AdGroupId", "Type", "State", "Status", "StatusClarification"],
      TextAdFieldNames: ["Title", "Title2", "Text", "Href", "SitelinkSetId"],
      Page: { Limit: 10000, Offset: 0 },
    }),
    directRequest(token, "keywords", "get", {
      SelectionCriteria: { CampaignIds: [campaignId] },
      FieldNames: ["Id", "AdGroupId", "CampaignId", "Keyword", "State", "Status", "ServingStatus"],
      Page: { Limit: 10000, Offset: 0 },
    }),
  ]);

  return {
    campaign: (campaigns.Campaigns || [])[0] || null,
    adGroups: adGroups.AdGroups || [],
    ads: ads.Ads || [],
    keywords: keywords.Keywords || [],
  };
}

function autotargetingKeywordIds(verification) {
  return (verification?.keywords || [])
    .filter((item) => item.Keyword === "---autotargeting" && Number(item.Id))
    .map((item) => Number(item.Id));
}

async function suspendAutotargetingKeywords(token, keywordIds) {
  if (!keywordIds.length) return { suspendedIds: [] };
  const result = await directRequest(token, "keywords", "delete", {
    SelectionCriteria: { Ids: keywordIds },
  });
  return {
    ok: collectActionIssues(result, "DeleteResults", "keywords.delete").length === 0,
    issues: collectActionIssues(result, "DeleteResults", "keywords.delete"),
    result,
  };
}

async function createDraftCampaign(token, plan) {
  const mutation = {
    notes: [],
    created: {},
  };

  const sitelinkResult = await directRequest(token, "sitelinks", "add", {
    SitelinksSets: [{
      Sitelinks: plan.sitelinks.map((item) => ({
        Title: item.title,
        Href: item.href,
        Description: item.description,
      })),
    }],
  });
  assertActionResults(sitelinkResult, "AddResults", "sitelinks.add");
  const sitelinkSetId = sitelinkResult.AddResults?.[0]?.Id;
  mutation.created.sitelinkSetId = sitelinkSetId || null;
  mutation.notes.push(`Created sitelink set ${sitelinkSetId}.`);

  const campaignResult = await directRequest(token, "campaigns", "add", {
    Campaigns: [campaignPayload(plan)],
  });
  assertActionResults(campaignResult, "AddResults", "campaigns.add");
  const campaignId = campaignResult.AddResults?.[0]?.Id;
  if (!campaignId) {
    throw new Error("Campaign was not created: campaigns.add returned no Id.");
  }
  mutation.created.campaignId = campaignId;
  mutation.notes.push(`Created campaign ${campaignId}.`);

  try {
    await directRequest(token, "campaigns", "suspend", { SelectionCriteria: { Ids: [campaignId] } });
    mutation.notes.push(`Suspended campaign ${campaignId} immediately after creation.`);
  } catch (error) {
    mutation.notes.push(`Suspend attempt for campaign ${campaignId} returned: ${error.message}`);
  }

  const adGroupResult = await directRequest(token, "adgroups", "add", {
    AdGroups: adGroupsPayload(campaignId, plan),
  });
  assertActionResults(adGroupResult, "AddResults", "adgroups.add");
  const groupIds = adGroupResult.AddResults || [];
  const groupIdsByName = new Map(plan.groups.map((group, index) => [group.name, groupIds[index]?.Id]));
  if ([...groupIdsByName.values()].some((id) => !id)) {
    throw new Error("One or more ad groups were not created successfully.");
  }
  mutation.created.adGroupIds = Object.fromEntries(groupIdsByName.entries());
  mutation.notes.push(`Created ${groupIds.length} ad groups.`);

  const keywordResult = await directRequest(token, "keywords", "add", {
    Keywords: keywordsPayload(groupIdsByName, plan),
  });
  assertActionResults(keywordResult, "AddResults", "keywords.add");
  mutation.created.keywordCount = keywordResult.AddResults?.length || 0;
  mutation.notes.push(`Created ${mutation.created.keywordCount} keywords.`);

  const adsResult = await directRequest(token, "ads", "add", {
    Ads: adsPayload(groupIdsByName, sitelinkSetId, plan),
  });
  assertActionResults(adsResult, "AddResults", "ads.add");
  mutation.created.adCount = adsResult.AddResults?.length || 0;
  mutation.notes.push(`Created ${mutation.created.adCount} ads in draft/moderation state.`);

  mutation.verification = await verifyCreatedObjects(token, campaignId);
  mutation.notes.push(
    `Verification: ${mutation.verification.adGroups.length} groups, ${mutation.verification.ads.length} ads, ${mutation.verification.keywords.length} keywords.`,
  );

  const autoIds = autotargetingKeywordIds(mutation.verification);
  if (autoIds.length) {
    const autoResult = await suspendAutotargetingKeywords(token, autoIds);
    if (autoResult.ok) {
      mutation.notes.push(`Removed ${autoIds.length} autotargeting keyword(s): ${autoIds.join(", ")}.`);
      mutation.verification = await verifyCreatedObjects(token, campaignId);
      mutation.notes.push(
        `Re-verified after autotargeting cleanup: ${mutation.verification.adGroups.length} groups, ${mutation.verification.ads.length} ads, ${mutation.verification.keywords.length} keywords.`,
      );
    } else {
      mutation.notes.push(`Autotargeting cleanup blocked: ${autoResult.issues.join("; ")}`);
    }
  }
  return mutation;
}

async function sanitizeExistingCampaign(token, campaignId) {
  const mutation = {
    notes: [`Sanitizing existing campaign ${campaignId}.`],
    created: { campaignId },
  };
  mutation.verification = await verifyCreatedObjects(token, campaignId);
  const autoIds = autotargetingKeywordIds(mutation.verification);
  if (!autoIds.length) {
    mutation.notes.push("No active autotargeting keywords found.");
    return mutation;
  }
  const autoResult = await suspendAutotargetingKeywords(token, autoIds);
  if (autoResult.ok) {
    mutation.notes.push(`Removed ${autoIds.length} autotargeting keyword(s): ${autoIds.join(", ")}.`);
    mutation.verification = await verifyCreatedObjects(token, campaignId);
  } else {
    mutation.notes.push(`Autotargeting cleanup blocked: ${autoResult.issues.join("; ")}`);
  }
  return mutation;
}

async function main() {
  const args = parseArgs(process.argv);
  const token = loadProjectToken(ENV_PATH);
  const routeEvidence = resolveProjectRoute();
  if (args.sanitizeCampaignId) {
    assertMutationsAllowed();
    acquireLock();
    try {
      const mutation = await sanitizeExistingCampaign(token, args.sanitizeCampaignId);
      const report = {
        generatedAt: nowIso(),
        mode: "sanitize-existing",
        login: EXACT_LOGIN,
        routeEvidence,
        plan: {
          campaign: {
            name: `sanitize-existing-${args.sanitizeCampaignId}`,
            landingHost: VERIFIED_HOST,
            weeklyLimitRub: DEFAULT_WEEKLY_LIMIT_RUB,
            bidCeilingRub: DEFAULT_BID_CEILING_RUB,
            counterIds: [],
            negativeKeywords: [],
            utmCampaign,
            searchOnly: true,
            rsyaEnabled: false,
          },
          sitelinks: [],
          groups: [],
        },
        probes: {
          counterProbe: { counterAccessible: false, counter: null, limitation: "sanitize mode" },
          directGoals: { directGoalVisible: false, goals: [] },
          landingChecks: [],
          gscHealthy: false,
        },
        gates: {
          creation: [{
            name: "Exact Yandex route",
            pass: routeEvidence.status === "verified",
            details: `sanitize existing campaign ${args.sanitizeCampaignId}`,
          }],
          launch: [],
        },
        mutation,
      };
      const artifacts = writeArtifacts(report);
      process.stdout.write(`${artifacts.mdPath}\n${artifacts.jsonPath}\n`);
      return;
    } finally {
      releaseLock();
    }
  }

  const [counterProbe, existingCampaigns, directGoals, landingChecks] = await Promise.all([
    probeCounter(token),
    fetchExistingRosomahaRusCampaigns(token),
    probeDirectGoals(token),
    Promise.all(uniqueSorted([
      "https://rosomaha-rus.ru/",
      ...adBlueprints.map((group) => group.landingPage),
    ]).map((url) => httpStatus(url))),
  ]);

  const gscHealthy = false;
  const plan = buildPlan(counterProbe.counterAccessible);
  const creationGates = buildCreationGates({ routeEvidence, existingCampaigns, landingChecks });
  const launchGates = buildLaunchGates({
    counterProbe,
    directGoalVisible: directGoals.directGoalVisible,
    gscHealthy,
  });

  const report = {
    generatedAt: nowIso(),
    mode: args.apply ? "apply" : "dry-run",
    login: EXACT_LOGIN,
    routeEvidence,
    plan,
    probes: {
      counterProbe,
      directGoals,
      landingChecks,
      gscHealthy,
    },
    gates: {
      creation: creationGates,
      launch: launchGates,
    },
    mutation: {
      notes: args.apply
        ? ["Awaiting live mutation."]
        : ["Dry-run only. No Direct objects were changed."],
      created: {},
    },
  };

  const creationBlocked = creationGates.some((gate) => !gate.pass);
  if (creationBlocked) {
    report.mutation.notes = ["Creation gates failed. Mutation was not attempted."];
    const artifacts = writeArtifacts(report);
    process.stdout.write(`${artifacts.mdPath}\n${artifacts.jsonPath}\n`);
    process.exitCode = 2;
    return;
  }

  if (!args.apply) {
    const artifacts = writeArtifacts(report);
    process.stdout.write(`${artifacts.mdPath}\n${artifacts.jsonPath}\n`);
    return;
  }

  assertMutationsAllowed();
  acquireLock();
  try {
    report.mutation = await createDraftCampaign(token, plan);
  } finally {
    releaseLock();
  }

  const artifacts = writeArtifacts(report);
  process.stdout.write(`${artifacts.mdPath}\n${artifacts.jsonPath}\n`);
}

main().catch((error) => {
  try {
    releaseLock();
  } catch {
    // best effort cleanup
  }
  console.error(redactSensitive(error?.message || error));
  process.exit(1);
});
