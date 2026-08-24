import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadProjectToken,
  redactSensitive,
  resolveProjectRoute,
  safeJsonRequest,
} from "./yandex-direct-balance.mjs";

export const EXPECTED_LOGIN = "rosomaha-rus999";
export const TARGET_CAMPAIGN_ID = 713802902;
export const TARGET_COUNTER_ID = 111905412;
export const HARD_GOAL_ID = 601477348;
export const PROTECTED_CAMPAIGN_IDS = Object.freeze([708505950, 705770573, 710087376]);
export const EXPECTED_REGION_ID = 225;
export const EXPECTED_GROUP_COUNT = 5;
export const EXPECTED_MIN_WEEKLY_MICROS = 300_000_000;
export const MAX_EXISTING_BID_CEILING_MICROS = 150_000_000;
export const SAFE_SINGLE_CLICK_SHARE = 0.1;
export const APPLY_GUARD_ENV = "ROSOMAHA_DIRECT_APPLY_MIN_BUDGET";
export const APPLY_GUARD_VALUE = "APPLY_713802902_WEEKLY_300_BID_30_KEEP_SUSPENDED";

const DIRECT_ORIGIN = "https://api.direct.yandex.com/json";
const CANONICAL_VERSION = "v501";
const LEGACY_VERSION = "v5";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const REPORT_DIR = path.join(PROJECT_ROOT, "marketing-audits", "yandex-direct");
const LOCK_PATH = path.resolve(
  PROJECT_ROOT,
  "..",
  "browser-locks",
  "rosomaha-direct-713802902-budget.mutation.lock",
);

export const CAMPAIGN_FIELDS = Object.freeze([
  "Id",
  "Name",
  "Status",
  "State",
  "Type",
  "StartDate",
  "EndDate",
  "StatusPayment",
  "StatusClarification",
  "SourceId",
  "Currency",
  "DailyBudget",
  "NegativeKeywords",
  "BlockedIps",
  "ExcludedSites",
  "Notification",
  "TimeTargeting",
  "TimeZone",
  "RepresentedBy",
]);

export const TEXT_CAMPAIGN_FIELDS = Object.freeze([
  "CounterIds",
  "PriorityGoals",
  "BiddingStrategy",
  "PackageBiddingStrategy",
  "AttributionModel",
  "Settings",
]);

export const LEGACY_TEXT_CAMPAIGN_FIELDS = Object.freeze([
  "CounterIds",
  "PriorityGoals",
  "BiddingStrategy",
  "AttributionModel",
  "Settings",
]);

export const UNIFIED_CAMPAIGN_FIELDS = Object.freeze([
  ...TEXT_CAMPAIGN_FIELDS,
  "TrackingParams",
]);

export const TEXT_SEARCH_PLACEMENT_FIELDS = Object.freeze([
  "SearchResults",
  "ProductGallery",
  "DynamicPlaces",
]);

export const UNIFIED_SEARCH_PLACEMENT_FIELDS = Object.freeze([
  ...TEXT_SEARCH_PLACEMENT_FIELDS,
  "Maps",
  "SearchOrganizationList",
]);

export const UNIFIED_PACKAGE_PLACEMENT_FIELDS = Object.freeze([
  "SearchResult",
  "ProductGallery",
  "Maps",
  "SearchOrganizationList",
  "Network",
  "DynamicPlaces",
]);

export const ADGROUP_FIELDS = Object.freeze([
  "Id",
  "CampaignId",
  "Status",
  "Name",
  "RegionIds",
  "RestrictedRegionIds",
  "NegativeKeywords",
  "NegativeKeywordSharedSetIds",
  "Type",
  "TrackingParams",
  "Subtype",
  "ServingStatus",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function exactInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} должен быть безопасным целым числом.`);
  return value;
}

function deepClone(value) {
  return structuredClone(value);
}

export function campaignGetParams(ids, version = CANONICAL_VERSION) {
  const normalized = ids.map((id) => exactInteger(id, "Campaign Id"));
  if (new Set(normalized).size !== normalized.length) throw new Error("Campaign Ids содержат дубли.");
  const params = {
    SelectionCriteria: { Ids: normalized },
    FieldNames: [...CAMPAIGN_FIELDS],
    Page: { Limit: 1000, Offset: 0 },
  };
  if (version === LEGACY_VERSION) {
    params.TextCampaignFieldNames = [...LEGACY_TEXT_CAMPAIGN_FIELDS];
    return params;
  }
  if (version !== CANONICAL_VERSION) throw new Error("Версия campaigns.get не разрешена.");
  params.TextCampaignFieldNames = [...TEXT_CAMPAIGN_FIELDS];
  params.UnifiedCampaignFieldNames = [...UNIFIED_CAMPAIGN_FIELDS];
  params.TextCampaignSearchStrategyPlacementTypesFieldNames = [...TEXT_SEARCH_PLACEMENT_FIELDS];
  params.UnifiedCampaignSearchStrategyPlacementTypesFieldNames = [...UNIFIED_SEARCH_PLACEMENT_FIELDS];
  params.UnifiedCampaignPackageBiddingStrategyPlatformsFieldNames = [...UNIFIED_PACKAGE_PLACEMENT_FIELDS];
  return params;
}

function directError(response, label) {
  if (!response?.ok) return new Error(`${label}: HTTP ${response?.status || "unknown"}.`);
  const error = response?.data?.error;
  if (!error) return null;
  const code = error.error_code ?? "unknown";
  const message = error.error_string || error.error_detail || "provider error";
  return new Error(`${label}: Direct error_code=${code}: ${message}`);
}

export class LiveDirectApi {
  constructor({ token, request = safeJsonRequest } = {}) {
    if (!token) throw new Error("Пустой OAuth token.");
    this.token = token;
    this.request = request;
    this.requestLog = [];
    this.mutationRequests = 0;
  }

  async call(version, service, method, params, { clientLogin = true, mutationKind = null } = {}) {
    if (![CANONICAL_VERSION, LEGACY_VERSION].includes(version)) throw new Error("Версия Direct API не разрешена.");
    const readOnly = method === "get";
    if (!readOnly && mutationKind == null) throw new Error("Mutation request не имеет mutationKind.");
    if (readOnly && mutationKind != null) throw new Error("Read-only request ошибочно помечен как mutation.");
    if (service === "clients" && clientLogin) throw new Error("Clients.get запрещён с Client-Login.");
    if (service === "dictionaries" && clientLogin) throw new Error("Dictionaries.get запрещён с Client-Login.");
    if (!["clients", "dictionaries"].includes(service) && !clientLogin) {
      throw new Error("Client-scoped Direct request требует exact Client-Login.");
    }
    if (mutationKind === "apply_budget") assertBudgetMutationPayload(params);
    if (mutationKind === "safety_suspend") assertSuspendPayload(params);

    const headers = {
      Authorization: `Bearer ${this.token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
    };
    if (clientLogin) headers["Client-Login"] = EXPECTED_LOGIN;
    const response = await this.request(
      `${DIRECT_ORIGIN}/${version}/${service}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ method, params }),
      },
      { secrets: [this.token] },
    );
    const failure = directError(response, `${service}.${method}`);
    if (failure) throw failure;
    if (clientLogin && response.providerMeta?.unitsUsedLogin && response.providerMeta.unitsUsedLogin !== EXPECTED_LOGIN) {
      throw new Error("Direct API списал баллы с другого логина.");
    }
    const result = response.data?.result;
    if (!isPlainObject(result)) throw new Error(`${service}.${method} не вернул result object.`);
    this.requestLog.push({ version, service, method, clientLogin: clientLogin ? EXPECTED_LOGIN : null, mutationKind });
    if (mutationKind) this.mutationRequests += 1;
    return result;
  }

  async getIdentity() {
    const result = await this.call(
      CANONICAL_VERSION,
      "clients",
      "get",
      { FieldNames: ["ClientId", "Login", "Type", "Archived", "Currency", "OverdraftSumAvailable"] },
      { clientLogin: false },
    );
    const clients = result.Clients;
    if (!Array.isArray(clients) || clients.length !== 1) throw new Error("Clients.get должен вернуть одного клиента.");
    const client = clients[0];
    if (client.Login !== EXPECTED_LOGIN || client.Type !== "CLIENT" || client.Archived === "YES") {
      throw new Error("OAuth identity не совпала с прямым клиентом rosomaha-rus999.");
    }
    return {
      login: client.Login,
      clientId: exactInteger(client.ClientId, "ClientId"),
      type: client.Type,
      currency: client.Currency,
      overdraftSumAvailable: client.OverdraftSumAvailable ?? null,
    };
  }

  async getCampaigns(ids) {
    const result = await this.call(
      CANONICAL_VERSION,
      "campaigns",
      "get",
      campaignGetParams(ids, CANONICAL_VERSION),
    );
    if (result.LimitedBy != null) throw new Error("campaigns.get вернул усечённый результат.");
    if (!Array.isArray(result.Campaigns)) throw new Error("campaigns.get не вернул Campaigns.");
    return result.Campaigns.map(deepClone).sort((a, b) => a.Id - b.Id);
  }

  async getProtectedCampaignViews() {
    const views = {};
    for (const version of [CANONICAL_VERSION, LEGACY_VERSION]) {
      const result = await this.call(
        version,
        "campaigns",
        "get",
        campaignGetParams(PROTECTED_CAMPAIGN_IDS, version),
      );
      if (result.LimitedBy != null) throw new Error(`campaigns.get ${version} вернул усечённый результат.`);
      if (!Array.isArray(result.Campaigns)) throw new Error(`campaigns.get ${version} не вернул Campaigns.`);
      const campaigns = result.Campaigns.map(deepClone).sort((a, b) => a.Id - b.Id);
      const unexpected = campaigns.filter((campaign) => !PROTECTED_CAMPAIGN_IDS.includes(campaign.Id));
      if (unexpected.length) throw new Error(`Protected snapshot ${version} вернул неожиданный Id.`);
      views[version] = campaigns;
    }
    return views;
  }

  async getTargetCampaign() {
    const campaigns = await this.getCampaigns([TARGET_CAMPAIGN_ID]);
    if (campaigns.length !== 1 || campaigns[0].Id !== TARGET_CAMPAIGN_ID) {
      throw new Error("campaigns.get не вернул точную кампанию 713802902.");
    }
    return campaigns[0];
  }

  async getAdGroups() {
    const result = await this.call(
      CANONICAL_VERSION,
      "adgroups",
      "get",
      {
        SelectionCriteria: { CampaignIds: [TARGET_CAMPAIGN_ID] },
        FieldNames: [...ADGROUP_FIELDS],
        Page: { Limit: 10000, Offset: 0 },
      },
    );
    if (result.LimitedBy != null) throw new Error("adgroups.get вернул усечённый результат.");
    if (!Array.isArray(result.AdGroups)) throw new Error("adgroups.get не вернул AdGroups.");
    return result.AdGroups.map(deepClone).sort((a, b) => a.Id - b.Id);
  }

  async getRubLimits() {
    const result = await this.call(
      CANONICAL_VERSION,
      "dictionaries",
      "get",
      { DictionaryNames: ["Currencies"] },
      { clientLogin: false },
    );
    const rub = result.Currencies?.find((item) => item?.Currency === "RUB");
    if (!rub) throw new Error("Dictionaries.get не вернул RUB.");
    const properties = Object.fromEntries((rub.Properties || []).map((item) => [item.Name, Number(item.Value)]));
    return {
      minimumWeeklySpendLimit: exactInteger(properties.MinimumWeeklySpendLimit, "MinimumWeeklySpendLimit"),
      minimumBid: exactInteger(properties.MinimumBid, "MinimumBid"),
      maximumBid: exactInteger(properties.MaximumBid, "MaximumBid"),
    };
  }

  async updateBudget(payload) {
    const result = await this.call(
      CANONICAL_VERSION,
      "campaigns",
      "update",
      payload,
      { mutationKind: "apply_budget" },
    );
    const item = result.UpdateResults?.[0];
    if (!item || item.Id !== TARGET_CAMPAIGN_ID || item.Errors?.length) {
      throw new Error("Campaigns.update не подтвердил точную кампанию 713802902.");
    }
    return deepClone(item);
  }

  async safetySuspend() {
    const params = { SelectionCriteria: { Ids: [TARGET_CAMPAIGN_ID] } };
    const result = await this.call(
      LEGACY_VERSION,
      "campaigns",
      "suspend",
      params,
      { mutationKind: "safety_suspend" },
    );
    const item = result.SuspendResults?.[0];
    if (!item || item.Id !== TARGET_CAMPAIGN_ID || item.Errors?.length) {
      throw new Error("Safety suspend не подтвердил кампанию 713802902.");
    }
    return deepClone(item);
  }
}

export function assertSuspendPayload(params) {
  const ids = params?.SelectionCriteria?.Ids;
  if (
    Object.keys(params || {}).length !== 1
    || Object.keys(params?.SelectionCriteria || {}).length !== 1
    || !Array.isArray(ids)
    || ids.length !== 1
    || ids[0] !== TARGET_CAMPAIGN_ID
  ) {
    throw new Error("Safety suspend обязан содержать только Id 713802902.");
  }
}

export function assertBudgetMutationPayload(params) {
  const campaigns = params?.Campaigns;
  if (!Array.isArray(campaigns) || campaigns.length !== 1) {
    throw new Error("Budget mutation должна содержать ровно одну кампанию.");
  }
  const item = campaigns[0];
  if (item?.Id !== TARGET_CAMPAIGN_ID || Object.keys(item || {}).sort().join(",") !== "Id,UnifiedCampaign") {
    throw new Error("Budget mutation разрешена только для 713802902 и UnifiedCampaign.");
  }
  if (PROTECTED_CAMPAIGN_IDS.includes(item.Id)) throw new Error("Protected campaign не может быть изменена.");
  const unified = item.UnifiedCampaign;
  if (!isPlainObject(unified) || Object.keys(unified).join(",") !== "BiddingStrategy") {
    throw new Error("Budget mutation может изменять только BiddingStrategy.");
  }
  const strategy = unified.BiddingStrategy;
  if (!isPlainObject(strategy) || Object.keys(strategy).sort().join(",") !== "Network,Search") {
    throw new Error("Budget mutation должна полностью фиксировать Search и Network.");
  }
  const search = strategy.Search;
  if (search?.BiddingStrategyType !== "WB_MAXIMUM_CLICKS") throw new Error("Разрешена только WB_MAXIMUM_CLICKS.");
  if (strategy.Network?.BiddingStrategyType !== "SERVING_OFF" || Object.keys(strategy.Network).length !== 1) {
    throw new Error("РСЯ обязана оставаться SERVING_OFF.");
  }
  const clicks = search.WbMaximumClicks;
  if (clicks?.WeeklySpendLimit !== EXPECTED_MIN_WEEKLY_MICROS || clicks?.BudgetType !== "WEEKLY_BUDGET") {
    throw new Error("WeeklySpendLimit обязан быть ровно 300 ₽.");
  }
  if (!Number.isSafeInteger(clicks.BidCeiling) || clicks.BidCeiling <= 0 || clicks.BidCeiling > 30_000_000) {
    throw new Error("BidCeiling обязан быть положительным и не выше 30 ₽.");
  }
  const allowedSearchKeys = ["BiddingStrategyType", "PlacementTypes", "WbMaximumClicks"];
  if (Object.keys(search).sort().join(",") !== allowedSearchKeys.sort().join(",")) {
    throw new Error("Search strategy содержит лишние поля.");
  }
  const allowedClickKeys = ["BidCeiling", "BudgetType", "WeeklySpendLimit"];
  if (Object.keys(clicks).sort().join(",") !== allowedClickKeys.sort().join(",")) {
    throw new Error("WbMaximumClicks содержит лишние поля.");
  }
}

export function deriveSafeBidCeiling(currentBidCeiling, limits) {
  const arithmeticCap = Math.floor(limits.minimumWeeklySpendLimit * SAFE_SINGLE_CLICK_SHARE);
  const candidate = Math.max(limits.minimumBid, arithmeticCap);
  return Math.min(currentBidCeiling, MAX_EXISTING_BID_CEILING_MICROS, candidate, limits.maximumBid);
}

function exactCounterIds(unified) {
  const ids = unified?.CounterIds?.Items;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => exactInteger(id, "Counter Id"));
}

export function assertBaseline({ campaign, groups, limits, requireSuspended = true }) {
  if (campaign?.Id !== TARGET_CAMPAIGN_ID || campaign?.Type !== "UNIFIED_CAMPAIGN") {
    throw new Error("Получена не целевая UnifiedCampaign 713802902.");
  }
  if (requireSuspended && campaign.State !== "SUSPENDED") throw new Error("Кампания обязана быть SUSPENDED.");
  if (!new Set(["ACCEPTED", "DRAFT"]).has(campaign.Status)) throw new Error("Статус кампании небезопасен для изменения.");
  const unified = campaign.UnifiedCampaign;
  if (JSON.stringify(exactCounterIds(unified)) !== JSON.stringify([TARGET_COUNTER_ID])) {
    throw new Error("CounterIds обязан содержать только 111905412.");
  }
  if (unified.PriorityGoals != null) throw new Error("PriorityGoals изменился; budget-only оператор остановлен.");
  const strategy = unified.BiddingStrategy;
  if (strategy?.Search?.BiddingStrategyType !== "WB_MAXIMUM_CLICKS") {
    throw new Error("Текущая search strategy не WB_MAXIMUM_CLICKS.");
  }
  if (strategy?.Network?.BiddingStrategyType !== "SERVING_OFF") throw new Error("РСЯ должна быть выключена.");
  const clicks = strategy.Search.WbMaximumClicks;
  if (!Number.isSafeInteger(clicks?.WeeklySpendLimit) || !Number.isSafeInteger(clicks?.BidCeiling)) {
    throw new Error("Текущий недельный бюджет или BidCeiling недоступен.");
  }
  if (clicks.BidCeiling > MAX_EXISTING_BID_CEILING_MICROS) throw new Error("Текущий BidCeiling превысил безопасный baseline 150 ₽.");
  if (limits.minimumWeeklySpendLimit !== EXPECTED_MIN_WEEKLY_MICROS) {
    throw new Error("Минимальный недельный бюджет RUB изменился у провайдера; оператор остановлен.");
  }
  if (!Array.isArray(groups) || groups.length !== EXPECTED_GROUP_COUNT) throw new Error("Ожидалось ровно пять групп.");
  for (const group of groups) {
    if (group.CampaignId !== TARGET_CAMPAIGN_ID || JSON.stringify(group.RegionIds) !== JSON.stringify([EXPECTED_REGION_ID])) {
      throw new Error("География или CampaignId группы изменились.");
    }
  }
  return {
    currentWeeklySpendLimit: clicks.WeeklySpendLimit,
    currentBidCeiling: clicks.BidCeiling,
    targetBidCeiling: deriveSafeBidCeiling(clicks.BidCeiling, limits),
  };
}

export function buildBudgetUpdatePayload(campaign, limits) {
  const baseline = assertBaseline({ campaign, groups: campaign.__groupsForValidation, limits });
  const currentSearch = campaign.UnifiedCampaign.BiddingStrategy.Search;
  const payload = {
    Campaigns: [
      {
        Id: TARGET_CAMPAIGN_ID,
        UnifiedCampaign: {
          BiddingStrategy: {
            Search: {
              BiddingStrategyType: "WB_MAXIMUM_CLICKS",
              PlacementTypes: deepClone(currentSearch.PlacementTypes),
              WbMaximumClicks: {
                WeeklySpendLimit: EXPECTED_MIN_WEEKLY_MICROS,
                BudgetType: "WEEKLY_BUDGET",
                BidCeiling: baseline.targetBidCeiling,
              },
            },
            Network: { BiddingStrategyType: "SERVING_OFF" },
          },
        },
      },
    ],
  };
  assertBudgetMutationPayload(payload);
  return payload;
}

function protectedSnapshot(views) {
  const campaigns = Object.values(views).flat();
  const coveredIds = [...new Set(campaigns.map((campaign) => campaign.Id))].sort((a, b) => a - b);
  const missingIds = PROTECTED_CAMPAIGN_IDS.filter((id) => !coveredIds.includes(id));
  return {
    coveredIds,
    missingIds,
    missingSemantics: "not_visible_in_exact_login_on_v501_or_v5",
    sha256: sha256Json(views),
  };
}

function attachGroups(campaign, groups) {
  const copy = deepClone(campaign);
  Object.defineProperty(copy, "__groupsForValidation", {
    value: deepClone(groups),
    enumerable: false,
  });
  return copy;
}

export async function collectSnapshot(api, { requireSuspended = true } = {}) {
  const identity = await api.getIdentity();
  const campaign = await api.getTargetCampaign();
  const groups = await api.getAdGroups();
  const limits = await api.getRubLimits();
  const protectedCampaignViews = await api.getProtectedCampaignViews();
  const attachedCampaign = attachGroups(campaign, groups);
  const baseline = assertBaseline({ campaign: attachedCampaign, groups, limits, requireSuspended });
  return {
    identity,
    campaign: attachedCampaign,
    groups,
    limits,
    baseline,
    campaignSha256: sha256Json(campaign),
    groupsSha256: sha256Json(groups),
    protected: protectedSnapshot(protectedCampaignViews),
  };
}

function expectedAfterCampaign(beforeCampaign, payload) {
  const expected = deepClone(beforeCampaign);
  expected.UnifiedCampaign.BiddingStrategy = deepClone(payload.Campaigns[0].UnifiedCampaign.BiddingStrategy);
  return expected;
}

function assertPostflight(before, after, payload) {
  if (after.campaign.State !== "SUSPENDED") throw new Error("Postflight: кампания вышла из SUSPENDED.");
  if (before.groupsSha256 !== after.groupsSha256) throw new Error("Postflight: группы или география изменились.");
  if (before.protected.sha256 !== after.protected.sha256
      || JSON.stringify(before.protected.coveredIds) !== JSON.stringify(after.protected.coveredIds)
      || JSON.stringify(before.protected.missingIds) !== JSON.stringify(after.protected.missingIds)) {
    throw new Error("Postflight: protected campaigns изменились.");
  }
  const expected = expectedAfterCampaign(before.campaign, payload);
  if (sha256Json(expected) !== after.campaignSha256) {
    throw new Error("Postflight: обнаружено изменение вне точного budget payload.");
  }
  if (JSON.stringify(exactCounterIds(after.campaign.UnifiedCampaign)) !== JSON.stringify([TARGET_COUNTER_ID])) {
    throw new Error("Postflight: CounterIds изменились.");
  }
  if (after.campaign.UnifiedCampaign.PriorityGoals != null) throw new Error("Postflight: PriorityGoals изменились.");
}

export class MutationLock {
  constructor(lockPath = LOCK_PATH) {
    this.lockPath = lockPath;
    this.fd = null;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
    try {
      this.fd = fs.openSync(this.lockPath, "wx", 0o600);
      fs.writeFileSync(this.fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      throw new Error(`Mutation lock недоступен: ${error.code || error.message}`);
    }
    return { path: this.lockPath, acquired: true };
  }

  release() {
    if (this.fd != null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    if (fs.existsSync(this.lockPath)) fs.unlinkSync(this.lockPath);
    return { path: this.lockPath, released: true };
  }
}

function verifyApplyGuard(env) {
  if (env?.[APPLY_GUARD_ENV] !== APPLY_GUARD_VALUE) {
    throw new Error(`Apply заблокирован: требуется ${APPLY_GUARD_ENV}=${APPLY_GUARD_VALUE}.`);
  }
}

export async function runBudgetOperation({
  mode,
  api,
  expectedCampaignSha256 = null,
  env = process.env,
  lock = new MutationLock(),
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!new Set(["audit", "dry-run", "apply-budget"]).has(mode)) throw new Error("Неизвестный режим.");
  if (!api) throw new Error("API client обязателен.");
  const execute = async () => {
    const before = await collectSnapshot(api);
    const payload = buildBudgetUpdatePayload(before.campaign, before.limits);
    const receipt = {
      schema: 1,
      operator: "rosomaha-rus-direct-budget-guard-v1",
      generatedAt,
      mode,
      account: before.identity,
      scope: {
        campaignId: TARGET_CAMPAIGN_ID,
        counterId: TARGET_COUNTER_ID,
        hardGoalId: HARD_GOAL_ID,
        protectedCampaignIds: [...PROTECTED_CAMPAIGN_IDS],
      },
      before: {
        campaignSha256: before.campaignSha256,
        state: before.campaign.State,
        status: before.campaign.Status,
        weeklySpendLimitMicros: before.baseline.currentWeeklySpendLimit,
        bidCeilingMicros: before.baseline.currentBidCeiling,
        counterIds: exactCounterIds(before.campaign.UnifiedCampaign),
        priorityGoals: before.campaign.UnifiedCampaign.PriorityGoals ?? null,
        regions: [...new Set(before.groups.flatMap((group) => group.RegionIds || []))],
        protected: before.protected,
      },
      providerLimits: before.limits,
      plan: {
        weeklySpendLimitMicros: EXPECTED_MIN_WEEKLY_MICROS,
        bidCeilingMicros: payload.Campaigns[0].UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks.BidCeiling,
        bidCeilingRule: "не более 10% недельного лимита; это защитный предел, не прогноз эффективной ставки",
        keepSuspended: true,
        launchAllowed: false,
      },
      payload,
      protectedMissingSemantics: before.protected.missingSemantics,
      mutationRequests: api.mutationRequests,
    };

    if (mode === "audit") {
      receipt.status = "ok";
      receipt.payload = null;
      return receipt;
    }
    if (mode === "dry-run") {
      receipt.status = before.baseline.currentWeeklySpendLimit === EXPECTED_MIN_WEEKLY_MICROS
        && before.baseline.currentBidCeiling === receipt.plan.bidCeilingMicros
        ? "already_exact"
        : "ready";
      return receipt;
    }

    if (before.baseline.currentWeeklySpendLimit === EXPECTED_MIN_WEEKLY_MICROS
        && before.baseline.currentBidCeiling === receipt.plan.bidCeilingMicros) {
      receipt.status = "already_exact";
      return receipt;
    }

    verifyApplyGuard(env);
    if (!/^[a-f0-9]{64}$/u.test(expectedCampaignSha256 || "")) {
      throw new Error("Apply требует --expected-campaign-sha256.");
    }
    if (expectedCampaignSha256 !== before.campaignSha256) throw new Error("Campaign CAS не совпал.");
    await api.updateBudget(payload);
    let after;
    try {
      after = await collectSnapshot(api, { requireSuspended: false });
    } catch (readError) {
      try {
        await api.safetySuspend();
        await collectSnapshot(api);
      } catch (safetyError) {
        throw new Error(`Postflight readback не выполнен; safety suspend не доказан: ${safetyError.message}`);
      }
      throw new Error(`Postflight readback не выполнен; safety suspend выполнен и подтверждён: ${readError.message}`);
    }
    if (after.campaign.State !== "SUSPENDED") {
      await api.safetySuspend();
      after = await collectSnapshot(api);
      if (after.campaign.State !== "SUSPENDED") throw new Error("Safety suspend не восстановил SUSPENDED.");
      throw new Error("Campaigns.update изменил состояние; safety suspend выполнен, apply считается failed.");
    }
    assertPostflight(before, after, payload);
    receipt.after = {
      campaignSha256: after.campaignSha256,
      state: after.campaign.State,
      status: after.campaign.Status,
      weeklySpendLimitMicros: after.baseline.currentWeeklySpendLimit,
      bidCeilingMicros: after.baseline.currentBidCeiling,
      counterIds: exactCounterIds(after.campaign.UnifiedCampaign),
      priorityGoals: after.campaign.UnifiedCampaign.PriorityGoals ?? null,
      protected: after.protected,
    };
    receipt.status = "applied";
    receipt.mutationRequests = api.mutationRequests;
    return receipt;
  };

  if (mode !== "apply-budget") return execute();
  const lockEvidence = lock.acquire();
  try {
    const receipt = await execute();
    receipt.mutationLock = { ...lockEvidence, ...lock.release() };
    return receipt;
  } catch (error) {
    lock.release();
    throw error;
  }
}

function receiptPath(mode, generatedAt) {
  const stamp = generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  return path.join(REPORT_DIR, `ROSOMAHA_RUS_DIRECT_BUDGET_GUARD_${mode}_${stamp}.json`);
}

export function saveReceipt(receipt) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outputPath = receiptPath(receipt.mode, receipt.generatedAt);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporaryPath, outputPath);
  return outputPath;
}

function parseCli(argv) {
  const [mode, ...rest] = argv;
  if (!new Set(["audit", "dry-run", "apply-budget"]).has(mode)) {
    throw new Error("Использование: node scripts/rosomaha-rus-direct-measurement.mjs audit|dry-run|apply-budget [--expected-campaign-sha256 HASH]");
  }
  let expectedCampaignSha256 = null;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--expected-campaign-sha256" || !rest[index + 1] || expectedCampaignSha256) {
      throw new Error("CLI содержит неизвестный или повторяющийся аргумент.");
    }
    expectedCampaignSha256 = rest[index + 1];
    index += 1;
  }
  if (mode !== "apply-budget" && expectedCampaignSha256) {
    throw new Error("CAS-аргумент разрешён только для apply-budget.");
  }
  return { mode, expectedCampaignSha256 };
}

export async function runCli(argv = process.argv.slice(2)) {
  const generatedAt = new Date().toISOString();
  let token = null;
  let api = null;
  let mode = "unknown";
  try {
    const parsed = parseCli(argv);
    mode = parsed.mode;
    const route = resolveProjectRoute();
    if (route.directLogin !== EXPECTED_LOGIN || route.project !== "rosomaha") throw new Error("Yandex route mismatch.");
    token = loadProjectToken(route.apiEnvPath);
    api = new LiveDirectApi({ token });
    const receipt = await runBudgetOperation({
      mode,
      api,
      expectedCampaignSha256: parsed.expectedCampaignSha256,
      generatedAt,
    });
    receipt.routing = {
      status: route.status,
      accountSlug: route.accountSlug,
      project: route.project,
      directLogin: route.directLogin,
      apiEnvPath: route.apiEnvPath,
    };
    receipt.requestLog = api.requestLog;
    receipt.mutationRequests = api.mutationRequests;
    const outputPath = saveReceipt(receipt);
    console.log(`Статус: ${receipt.status}`);
    console.log(`Кампания: ${TARGET_CAMPAIGN_ID}`);
    console.log(`Лимит dry-run: ${EXPECTED_MIN_WEEKLY_MICROS / 1_000_000} ₽/неделю`);
    console.log(`BidCeiling dry-run: ${receipt.plan?.bidCeilingMicros / 1_000_000} ₽`);
    console.log(`Внешних мутаций: ${api.mutationRequests}`);
    console.log(`Receipt: ${outputPath}`);
    return { receipt, outputPath };
  } catch (error) {
    const receipt = {
      schema: 1,
      operator: "rosomaha-rus-direct-budget-guard-v1",
      generatedAt,
      mode,
      status: "blocked",
      error: redactSensitive(error?.message || error, token ? [token] : []),
      mutationRequests: api?.mutationRequests ?? 0,
      requestLog: api?.requestLog ?? [],
    };
    const outputPath = saveReceipt(receipt);
    console.error(receipt.error);
    console.error(`Receipt: ${outputPath}`);
    process.exitCode = 1;
    return { receipt, outputPath };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await runCli();
}
