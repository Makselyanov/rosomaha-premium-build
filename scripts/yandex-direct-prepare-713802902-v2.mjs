import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outDir = path.join(rootDir, "marketing-audits", "yandex-direct");
const semanticReceiptRelative = "marketing-audits/yandex-direct/YANDEX_DIRECT_SEMANTIC_RESEARCH_713802902_2026-08-24T09-56-54-516Z.json";
const semanticReceiptPath = path.join(rootDir, semanticReceiptRelative);
const campaignId = 713802902;
const login = "rosomaha-rus999";
const campaignUtm = "rosomaha_rus_search_models";
const protectedCampaignIds = [708505950, 705770573, 710087376];

const ids = {
  groups: {
    brand: 5791834449,
    category: 5791834450,
    extrimeFamily: 5791834451,
    parkedExtrimeToyota: 5791834452,
    hunter: 5791834453,
  },
  ads: {
    brand: "1919379464991658812",
    category: "1919379464991658813",
    extrimeUaz: "1919379464991658814",
    parkedExtrimeToyota: "1919379464991658815",
    hunter: "1919379464991658816",
  },
  keywords: {
    brand: [57915373903, 57915373904, 57915373905, 57915373906, 57915373907],
    category: [57915373908, 57915373909, 57915373910, 57915373911],
    extrimeFamily: [57915373912, 57915373913, 57915373914, 57915373915],
    parkedExtrimeToyota: [57915373916, 57915373917, 57915373918, 57915373919],
    hunter: [57915373920, 57915373921, 57915373922, 57915373923],
  },
  autotargeting: {
    brand: 205791834449,
    category: 205791834450,
    extrimeFamily: 205791834451,
    parkedExtrimeToyota: 205791834452,
    hunter: 205791834453,
  },
  existingGenericImageHash: "s1UdPIWzqoERf75fEOE7hw",
};

const baselineNegatives = [
  "!своими руками",
  "ozon",
  "wildberries",
  "авито",
  "аренда",
  "бу",
  "вакансия",
  "википедия",
  "детский",
  "дисней",
  "дром",
  "животное",
  "запчасти",
  "игрушка",
  "игра",
  "инструкция",
  "кино",
  "комикс",
  "логан",
  "люди икс",
  "marvel",
  "озон",
  "оружие",
  "патроны",
  "персонаж",
  "прицел",
  "прокат",
  "работа",
  "радиоуправляемый",
  "ремонт",
  "ружье",
  "самоделка",
  "самодельный",
  "скачать",
  "схема",
  "фильм",
  "винтовка",
  "волверин",
  "wolverine",
  "чертеж",
];

const page = {
  home: "https://rosomaha-rus.ru/",
  catalog: "https://rosomaha-rus.ru/product/kvadrotsikly/",
  options: "https://rosomaha-rus.ru/product/optsii/",
  delivery: "https://rosomaha-rus.ru/delivery/",
  contacts: "https://rosomaha-rus.ru/contacts/",
  extrimeUaz: "https://rosomaha-rus.ru/product/extrime-s-1-5l-dvs-1nz-fe/?oid=812",
  extrimeToyota: "https://rosomaha-rus.ru/product/extrime-1-5-litra-mosty-toyota/?oid=824",
  hunter: "https://rosomaha-rus.ru/product/hunter-s-1-5l-dvs-1nz-fe/?oid=800",
};

function utmUrl(base, content, term, anchor = "") {
  const url = new URL(base);
  url.searchParams.set("utm_source", "yandex");
  url.searchParams.set("utm_medium", "cpc");
  url.searchParams.set("utm_campaign", campaignUtm);
  url.searchParams.set("utm_content", content);
  url.searchParams.set("utm_term", term);
  url.hash = anchor;
  return decodeURIComponent(url.toString());
}

const commonUtmContent = "{campaign_id}.{gbid}.{ad_id}.{phrase_id}.{source_type}.{device_type}";

function adHref(base) {
  return utmUrl(base, commonUtmContent, "{keyword}");
}

function sitelink(title, base, description, token, anchor = "") {
  return {
    Title: title,
    Href: utmUrl(base, `{campaign_id}.{ad_id}.{phrase_id}.sitelink_${token}`, `sitelink_${token}`, anchor),
    Description: description,
  };
}

function modelSitelinks(base, token) {
  return [
    sitelink("Комплектация", base, "Параметры и комплектация выбранной модели.", `${token}_spec`, "price"),
    sitelink("Дополнительные опции", base, "Доступные опции для выбранной модели.", `${token}_options`, "opt-price"),
    sitelink("Как купить", base, "Как отправить заявку на выбранную модель.", `${token}_buy`, "buy"),
    sitelink("Доставка", base, "Условия доставки техники Росомаха.", `${token}_delivery`, "delivery"),
  ];
}

const sitelinkSets = {
  generic: [
    sitelink("Каталог моделей", page.catalog, "Модели и комплектации техники Росомаха.", "catalog"),
    sitelink("Опции", page.options, "Дополнительное оснащение для техники.", "options"),
    sitelink("Доставка по РФ", page.delivery, "Условия доставки и оплаты техники.", "delivery"),
    sitelink("Контакты завода", page.contacts, "Телефоны и адрес производителя Росомаха.", "contacts"),
  ],
  extrimeUaz: modelSitelinks(page.extrimeUaz, "extrime_uaz"),
  extrimeToyota: modelSitelinks(page.extrimeToyota, "extrime_toyota"),
  hunter: modelSitelinks(page.hunter, "hunter"),
};

const creatives = {
  brand: {
    Titles: [
      "Вездеходы Росомаха от завода",
      "Купить вездеход Росомаха",
      "Квадроциклы Росомаха от завода",
      "Снегоболотоходы Росомаха",
      "Модели Росомаха с доставкой по РФ",
    ],
    Texts: [
      "Выберите модель и комплектацию. Производство и доставка по России.",
      "Техника Росомаха для охоты, рыбалки и хозяйства. Связь напрямую с заводом.",
      "Каталог моделей, опций и комплектаций. Получите консультацию производителя.",
    ],
    Href: adHref(page.home),
    DisplayUrlPath: "models",
    AdImageHashes: { Items: [ids.existingGenericImageHash] },
    SitelinkSetId: "{{SITELINK_SET_ID:generic}}",
  },
  category: {
    Titles: [
      "Снегоболотоходы от завода Росомаха",
      "Купить снегоболотоход Росомаха",
      "Вездеходы на шинах низкого давления",
      "Квадроциклы для охоты и рыбалки",
      "Каталог вездеходов Росомаха",
    ],
    Texts: [
      "Модели для охоты, рыбалки и хозяйства. Комплектации и доставка по России.",
      "Выберите вездеход на шинах низкого давления и отправьте заявку заводу.",
      "Каталог техники Росомаха: модели, опции, комплектации и условия доставки.",
    ],
    Href: adHref(page.catalog),
    DisplayUrlPath: "catalog",
    AdImageHashes: { Items: [ids.existingGenericImageHash] },
    SitelinkSetId: "{{SITELINK_SET_ID:generic}}",
  },
  extrimeUaz: {
    Titles: [
      "Росомаха Экстрим с мостами УАЗ",
      "Экстрим 1.5 с двигателем 1NZ-FE",
      "Экстрим с мостами УАЗ от завода",
      "Купить Росомаху Экстрим УАЗ",
    ],
    Texts: [
      "Модель Экстрим: двигатель 1NZ-FE и мосты УАЗ. Выберите комплектацию.",
      "Доставка по России и дополнительные опции. Получите консультацию завода.",
      "Характеристики, комплектация и заявка на модель Экстрим — на сайте.",
    ],
    Href: adHref(page.extrimeUaz),
    DisplayUrlPath: "extrime-uaz",
    AdImageHashes: { Items: [ids.existingGenericImageHash] },
    SitelinkSetId: "{{SITELINK_SET_ID:extrimeUaz}}",
  },
  extrimeToyota: {
    Titles: [
      "Росомаха Экстрим с мостами Toyota",
      "Экстрим 1.5 с двигателем 1NZ-FE",
      "Экстрим Toyota от завода Росомаха",
      "Купить Росомаху Экстрим Toyota",
    ],
    Texts: [
      "Модель Экстрим: двигатель 1NZ-FE и мосты Toyota. Выберите комплектацию.",
      "Доставка по России и дополнительные опции. Получите консультацию завода.",
      "Характеристики, комплектация и заявка на модель Экстрим — на сайте.",
    ],
    Href: adHref(page.extrimeToyota),
    DisplayUrlPath: "extrime-toyota",
    AdImageHashes: { Items: [ids.existingGenericImageHash] },
    SitelinkSetId: "{{SITELINK_SET_ID:extrimeToyota}}",
  },
  hunter: {
    Titles: [
      "Росомаха Хантер с мостами Toyota",
      "Хантер 1.5 с двигателем 1NZ-FE",
      "Хантер Toyota от завода Росомаха",
      "Купить Росомаху Хантер Toyota",
    ],
    Texts: [
      "Модель Хантер: двигатель 1NZ-FE и мосты Toyota. Выберите комплектацию.",
      "Доставка по России и дополнительные опции. Получите консультацию завода.",
      "Характеристики, комплектация и заявка на модель Хантер — на сайте.",
    ],
    Href: adHref(page.hunter),
    DisplayUrlPath: "hunter-toyota",
    AdImageHashes: { Items: [ids.existingGenericImageHash] },
    SitelinkSetId: "{{SITELINK_SET_ID:hunter}}",
  },
};

const acceptedImageEvidence = {
  hash: ids.existingGenericImageHash,
  sourceUrl: "https://rosomaha-rus.ru/upload/iblock/52f/d2tbeda8napwhdsli7hlhuc7izv021dd.jpeg",
  width: 1600,
  height: 1200,
  sha256: "b402701476e2ac786db806d61443d8910f89b297dad2f1016d0a3d707d140cfa",
  providerReceipt: "marketing-audits/yandex-direct/YANDEX_DIRECT_IMAGE_ATTACH_713802902_SUCCESS_2026-08-24T09-35-50-787Z.json",
  providerStatus: "uploaded and attached to all five ads",
  reason: "Model OG images are 1000x561 and fail the official WIDE minimum 1080x607; reuse the site-owned provider-accepted image instead of uploading invalid files.",
};

const keywordUpdate = [
  [ids.keywords.brand[0], "росомаха вездеход купить"],
  [ids.keywords.brand[1], "вездеход росомаха цена"],
  [ids.keywords.brand[2], "квадроцикл росомаха купить"],
  [ids.keywords.brand[3], "снегоболотоход росомаха купить"],
  [ids.keywords.brand[4], "вездеход росомаха официальный сайт"],
  [ids.keywords.category[0], "снегоболотоход купить"],
  [ids.keywords.category[1], "снегоболотоход цена"],
  [ids.keywords.category[2], "снегоболотоход от производителя"],
  [ids.keywords.category[3], "вездеход на шинах низкого давления купить"],
  [ids.keywords.extrimeFamily[0], "росомаха экстрим"],
  [ids.keywords.extrimeFamily[1], "росомаха экстрим купить"],
  [ids.keywords.extrimeFamily[2], "росомаха экстрим цена"],
  [ids.keywords.extrimeFamily[3], "вездеход росомаха экстрим"],
  [ids.keywords.hunter[0], "росомаха хантер"],
  [ids.keywords.hunter[1], "вездеход росомаха хантер"],
  [ids.keywords.hunter[2], "снегоболотоход росомаха хантер"],
].map(([Id, Keyword]) => ({ Id, Keyword }));

const keywordAdd = [
  [ids.groups.brand, "росомаха завод вездеходов"],
  [ids.groups.category, "вездеход купить от производителя"],
  [ids.groups.category, "квадроцикл вездеход купить"],
  [ids.groups.category, "болотоход купить"],
  [ids.groups.extrimeFamily, "квадроцикл росомаха экстрим"],
].map(([AdGroupId, Keyword]) => ({ AdGroupId, Keyword }));

// Direct normalises word order inside a group.  The first interrupted apply
// proved these two evidence phrases with warning 10140 and returned the exact
// existing canonical IDs.  Keep their YES semantic meaning as aliases, but do
// not submit them again as duplicate Keywords.add rows.
const providerNormalizedSemanticAliases = [
  {
    evidenceKeyword: "купить вездеход росомаха",
    canonicalKeywordId: ids.keywords.brand[0],
    canonicalKeyword: "росомаха вездеход купить",
    providerCode: 10140,
  },
  {
    evidenceKeyword: "росомаха квадроцикл купить",
    canonicalKeywordId: ids.keywords.brand[2],
    canonicalKeyword: "квадроцикл росомаха купить",
    providerCode: 10140,
  },
];

const providerNormalizedNegativeAliases = [
  {
    omittedVariant: "ружьё",
    materializedVariant: "ружье",
    reason: "Direct readback normalised е/ё and retained one negative keyword in all five groups",
  },
];

const keywordSuspendIds = [
  ...ids.keywords.parkedExtrimeToyota,
  ids.keywords.hunter[3],
];

const stagedRequests = [
  {
    step: 1,
    dependency: null,
    version: "v501",
    service: "sitelinks",
    request: {
      method: "add",
      params: {
        SitelinksSets: Object.values(sitelinkSets).map((Sitelinks) => ({ Sitelinks })),
      },
    },
    resolves: Object.keys(sitelinkSets).map((key) => `{{SITELINK_SET_ID:${key}}}`),
  },
  {
    step: 2,
    dependency: null,
    version: "v501",
    service: "adgroups",
    request: {
      method: "update",
      params: {
        AdGroups: [
          { Id: ids.groups.brand, Name: "S | RF | Brand | Rosomaha", NegativeKeywords: { Items: [...baselineNegatives, "экстрим", "хантер"] } },
          { Id: ids.groups.category, Name: "S | RF | Category | Snow-swamp", NegativeKeywords: { Items: [...baselineNegatives, "росомаха", "экстрим", "хантер"] } },
          { Id: ids.groups.extrimeFamily, Name: "S | RF | Model | Extrime", NegativeKeywords: { Items: [...baselineNegatives, "хантер", "плюс"] } },
          { Id: ids.groups.parkedExtrimeToyota, Name: "PARKED | duplicate | Extrime Toyota", NegativeKeywords: { Items: baselineNegatives } },
          { Id: ids.groups.hunter, Name: "S | RF | Model | Hunter", NegativeKeywords: { Items: [...baselineNegatives, "экстрим"] } },
        ],
      },
    },
  },
  {
    step: 3,
    dependency: null,
    version: "v5",
    service: "keywords",
    request: { method: "update", params: { Keywords: keywordUpdate } },
  },
  {
    step: 4,
    dependency: "step 3 provider readback contains no duplicate-keyword replacement warnings",
    version: "v5",
    service: "keywords",
    request: { method: "add", params: { Keywords: keywordAdd } },
  },
  {
    step: 5,
    dependency: null,
    version: "v5",
    service: "keywords",
    request: {
      method: "suspend",
      params: {
        SelectionCriteria: {
          Ids: keywordSuspendIds,
        },
      },
    },
  },
  {
    step: 6,
    dependency: "step 1 resolved without warnings or errors",
    version: "v501",
    service: "ads",
    request: {
      method: "update",
      params: {
        Ads: [
          { Id: ids.ads.brand, ResponsiveAd: creatives.brand },
          { Id: ids.ads.category, ResponsiveAd: creatives.category },
          { Id: ids.ads.extrimeUaz, ResponsiveAd: creatives.extrimeUaz },
          { Id: ids.ads.hunter, ResponsiveAd: creatives.hunter },
        ],
      },
    },
  },
  {
    step: 7,
    dependency: "step 1 resolved without warnings or errors",
    version: "v501",
    service: "ads",
    request: {
      method: "add",
      params: {
        Ads: [{
          AdGroupId: ids.groups.extrimeFamily,
          ResponsiveAd: {
            ...creatives.extrimeToyota,
            // Ads.add expects a plain array; Ads.update expects ArrayOfString.Items.
            AdImageHashes: creatives.extrimeToyota.AdImageHashes.Items,
          },
        }],
      },
    },
    resolves: ["{{NEW_AD_ID:extrimeToyota}}"],
  },
  {
    step: 8,
    dependency: "step 7 new ad exists in group 5791834451 and readback matches",
    version: "v501",
    service: "ads",
    request: {
      method: "suspend",
      params: { SelectionCriteria: { Ids: [ids.ads.parkedExtrimeToyota] } },
    },
  },
];

function codepointLength(value) {
  return [...String(value)].length;
}

function validate() {
  const errors = [];
  const verifiedHosts = new Set(["rosomaha-rus.ru"]);
  for (const [key, creative] of Object.entries(creatives)) {
    if (creative.Titles.length < 1 || creative.Titles.length > 7) errors.push(`${key}: titles count`);
    if (creative.Texts.length < 1 || creative.Texts.length > 3) errors.push(`${key}: texts count`);
    for (const title of creative.Titles) {
      if (codepointLength(title) > 56) errors.push(`${key}: title > 56: ${title}`);
      if (title.split(/\s+/).some((word) => codepointLength(word) > 22)) errors.push(`${key}: title word > 22: ${title}`);
    }
    for (const text of creative.Texts) {
      if (codepointLength(text) > 81) errors.push(`${key}: text > 81: ${text}`);
      if (text.split(/\s+/).some((word) => codepointLength(word) > 23)) errors.push(`${key}: text word > 23: ${text}`);
    }
    const href = new URL(creative.Href);
    if (!verifiedHosts.has(href.hostname)) errors.push(`${key}: foreign host ${href.hostname}`);
    for (const macro of ["{campaign_id}", "{ad_id}", "{phrase_id}", "{keyword}"]) {
      if (!creative.Href.includes(macro)) errors.push(`${key}: missing macro ${macro}`);
    }
  }
  for (const [key, links] of Object.entries(sitelinkSets)) {
    if (links.length < 1 || links.length > 8) errors.push(`${key}: sitelinks count`);
    for (const link of links) {
      if (codepointLength(link.Title) > 30) errors.push(`${key}: sitelink title > 30: ${link.Title}`);
      if (codepointLength(link.Description) > 60) errors.push(`${key}: sitelink description > 60: ${link.Description}`);
      if (!verifiedHosts.has(new URL(link.Href).hostname)) errors.push(`${key}: foreign sitelink host`);
    }
  }
  const activeKeywords = [...keywordUpdate, ...keywordAdd];
  if (new Set(activeKeywords.map((item) => item.Keyword.toLowerCase())).size !== activeKeywords.length) {
    errors.push("duplicate desired keywords in update payload");
  }
  if (!fs.existsSync(semanticReceiptPath)) {
    errors.push(`missing semantic evidence ${semanticReceiptRelative}`);
  } else {
    const semanticReceipt = JSON.parse(fs.readFileSync(semanticReceiptPath, "utf8"));
    if (semanticReceipt.login !== login || Number(semanticReceipt.campaignId) !== campaignId) {
      errors.push("semantic evidence identity mismatch");
    }
    const yesKeywords = new Set(
      (semanticReceipt.results || [])
        .filter((item) => item.allDevices === "YES")
        .map((item) => String(item.keyword || "").toLowerCase()),
    );
    for (const item of [...activeKeywords, ...providerNormalizedSemanticAliases.map((item) => ({ Keyword: item.evidenceKeyword }))]) {
      if (!yesKeywords.has(item.Keyword.toLowerCase())) {
        errors.push(`keyword lacks YES evidence: ${item.Keyword}`);
      }
    }
    for (const alias of providerNormalizedSemanticAliases) {
      const canonical = keywordUpdate.find((item) => item.Id === alias.canonicalKeywordId);
      if (!canonical || canonical.Keyword !== alias.canonicalKeyword) {
        errors.push(`provider-normalized alias lost canonical target: ${alias.evidenceKeyword}`);
      }
    }
  }
  const addResponsive = stagedRequests.find((item) => item.service === "ads" && item.request.method === "add")
    ?.request.params.Ads[0].ResponsiveAd;
  if (!Array.isArray(addResponsive?.AdImageHashes)) {
    errors.push("Ads.add ResponsiveAd.AdImageHashes must be an array");
  }
  return errors;
}

const validationErrors = validate();
const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const payload = {
  generatedAt,
  mode: "dry-run",
  exactLogin: login,
  campaignId,
  protectedCampaignIds,
  authorizationBoundary: {
    campaignRemainsSuspended: true,
    moderationCalled: false,
    resumeCalled: false,
    budgetChanged: false,
    priorityGoalChanged: false,
    externalMutationCount: 0,
  },
  decision: {
    activeStructure: ["brand", "category", "extrime family with two ads", "hunter"],
    parkedStructure: ["separate Extrime Toyota group: no confirmed demand for bridge-specific phrase cluster"],
    reason: "Direct KeywordsResearch confirmed model-family demand but not bridge-specific Extrime/Hunter variants; Wordstat numeric source is unavailable in this environment.",
  },
  publicLandingEvidence: {
    checkedAt: generatedAt,
    allStatus200: true,
    exactHost: "rosomaha-rus.ru",
    pages: page,
    modelAnchorsVerified: ["price", "opt-price", "buy", "delivery"],
  },
  imageEvidence: acceptedImageEvidence,
  semanticEvidence: {
    source: "Yandex Direct KeywordsResearch.hasSearchVolume",
    receipt: semanticReceiptRelative,
    limitation: "YES/NO only; not Wordstat frequency and not a traffic forecast",
    wordstatReceipt: "marketing-audits/yandex-direct/YANDEX_WORDSTAT_TOP_REQUESTS_713802902_2026-08-24T21-11-01-533Z.json",
    wordstatStatus: "source_unavailable: UND_ERR_CONNECT_TIMEOUT before provider response",
    yesEvidencePhraseCount: keywordUpdate.length + keywordAdd.length + providerNormalizedSemanticAliases.length,
    materializedUniqueKeywordCount: keywordUpdate.length + keywordAdd.length,
    providerNormalizedAliasCount: providerNormalizedSemanticAliases.length,
  },
  providerNormalizationEvidence: {
    semanticAliases: providerNormalizedSemanticAliases,
    negativeAliases: providerNormalizedNegativeAliases,
  },
  sitelinkSets,
  creatives,
  keywords: {
    update: keywordUpdate,
    add: keywordAdd,
    providerNormalizedAliases: providerNormalizedSemanticAliases,
    // Direct error 8305 proves autotargeting cannot be suspended.  Safety is
    // instead enforced by suspending the group's exact sole ad below.
    suspendIds: keywordSuspendIds,
    parkedAutotargetingSafety: {
      id: ids.autotargeting.parkedExtrimeToyota,
      adGroupId: ids.groups.parkedExtrimeToyota,
      remainsOn: true,
      soleAdId: ids.ads.parkedExtrimeToyota,
      soleAdMustBeSuspended: true,
    },
  },
  stagedRequests,
  placeholderRules: {
    sitelinkSetId: "Resolve by position from step 1 Sitelinks.add AddResults after zero Errors.",
    newAdId: "Resolve from step 7 Ads.add AddResults after zero Errors.",
  },
  validation: {
    ok: validationErrors.length === 0,
    errors: validationErrors,
    rules: [
      "1-7 titles, each <=56 code points, each word <=22",
      "1-3 texts, each <=81 code points, each word <=23",
      "sitelink titles <=30 and descriptions <=60",
      "only rosomaha-rus.ru links",
      "main and sitelink UTM macros preserved",
      "all ads reuse the site-owned image already accepted and attached by Yandex",
      "every desired keyword has exact KeywordsResearch.hasSearchVolume=YES evidence",
      "23 YES evidence phrases map to 21 unique provider-normalized keyword rows",
      "Ads.add uses the array schema while Ads.update uses ArrayOfString.Items",
    ],
  },
  applyGate: "BLOCKED until campaign/budget/priority goal owner completes launch gate; this artifact does not authorize mutation or resume.",
};

fs.mkdirSync(outDir, { recursive: true });
const outputPath = path.join(outDir, `YANDEX_DIRECT_CREATIVE_SEMANTIC_DRY_RUN_713802902_${stamp}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: payload.validation.ok,
  campaignId,
  externalMutationCount: 0,
  stagedRequestCount: stagedRequests.length,
  activeGroupCount: 4,
  parkedGroupCount: 1,
  creativeCount: Object.keys(creatives).length,
  desiredActiveExplicitKeywordCount: keywordUpdate.length + keywordAdd.length,
  semanticEvidencePhraseCount: keywordUpdate.length + keywordAdd.length + providerNormalizedSemanticAliases.length,
  providerNormalizedAliasCount: providerNormalizedSemanticAliases.length,
  output: path.relative(rootDir, outputPath),
  errors: validationErrors,
}, null, 2));
process.exitCode = payload.validation.ok ? 0 : 1;
