import { hasCookieConsent } from "./consent";

/**
 * Сбор маркетинг-аналитики для передачи с заявкой в CRM.
 *
 * Как работает:
 *   - При первом заходе на сайт сохраняем в localStorage UTM, yclid, gclid,
 *     document.referrer и landing_page (первая страница).
 *   - При каждой навигации обновляем "last_*" версии тех же полей.
 *   - В момент отправки формы getAttribution() собирает полный снимок.
 *
 * Данные не портят существующие источники: если UTM уже были сохранены
 * на первом заходе, повторный визит с другими UTM обновит только last_*.
 */

const STORAGE_KEY = "rosomaha_attribution";
const SESSION_STORAGE_KEY = "rosomaha_session_attribution";
const FIELD_LIMIT = 180;
const SUMMARY_LIMIT = 900;

type AttributionBlob = Record<string, string | undefined> & {
  first_utm_source?: string;
  first_utm_medium?: string;
  first_utm_campaign?: string;
  first_utm_content?: string;
  first_utm_term?: string;
  first_utm_id?: string;
  first_yclid?: string;
  first_gclid?: string;
  first_vkclid?: string;
  first_referrer?: string;
  first_landing_page?: string;
  first_landing_at?: string;

  last_utm_source?: string;
  last_utm_medium?: string;
  last_utm_campaign?: string;
  last_utm_content?: string;
  last_utm_term?: string;
  last_utm_id?: string;
  last_yclid?: string;
  last_gclid?: string;
  last_vkclid?: string;
  last_referrer?: string;
  last_page?: string;
  last_seen_at?: string;
};

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
] as const;

const CLICK_ID_KEYS = ["yclid", "gclid", "vkclid", "vk_click_id"] as const;
const AD_ID_KEYS = [
  "campaign_id",
  "ad_id",
  "gbid",
  "phrase_id",
  "vk_campaign_id",
  "vk_ad_group_id",
  "vk_ad_id",
  "vk_form_id",
] as const;
const TRACKING_KEYS = [...UTM_KEYS, ...CLICK_ID_KEYS, ...AD_ID_KEYS] as const;

function cleanValue(value?: string | null, limit = FIELD_LIMIT) {
  if (!value) return undefined;
  const withoutControlChars = Array.from(value)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("");
  const compact = withoutControlChars.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > limit ? compact.slice(0, limit) : compact;
}

function cleanUrl(value?: string, fallbackOrigin?: string) {
  const clean = cleanValue(value, 600);
  if (!clean) return undefined;
  try {
    const url = new URL(clean, fallbackOrigin);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function readCurrentTrackingParams(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const key of TRACKING_KEYS) {
    const value = cleanValue(params.get(key));
    if (value) result[key] = value;
  }
  return result;
}

function serializeTrackingParams(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const key of TRACKING_KEYS) {
    const value = cleanValue(params[key]);
    if (value) query.set(key, value);
  }
  return query.toString() || undefined;
}

function deriveSourcePlatform(params: {
  utmSource?: string;
  yclid?: string;
  gclid?: string;
  vkclid?: string;
  referrer?: string;
}) {
  const source = params.utmSource?.toLowerCase();
  const referrer = params.referrer?.toLowerCase();

  if (source?.includes("yandex") || source === "ya" || params.yclid) return "yandex";
  if (source?.includes("vk") || source?.includes("vkontakte") || params.vkclid) return "vk";
  if (source?.includes("google") || params.gclid) return "google";
  if (source) return cleanValue(source, 40);
  if (!referrer) return "direct";
  if (referrer.includes("yandex.")) return "yandex_organic";
  if (referrer.includes("google.")) return "google_organic";
  if (referrer.includes("vk.com")) return "vk_referral";
  return "referral";
}

function deriveSourceChannel(params: {
  utmMedium?: string;
  yclid?: string;
  gclid?: string;
  vkclid?: string;
  referrer?: string;
}) {
  const medium = params.utmMedium?.toLowerCase();
  if (medium) return cleanValue(medium, 40);
  if (params.yclid || params.gclid || params.vkclid) return "cpc";
  return params.referrer ? "referral" : "direct";
}

function buildAttributionSummary(params: {
  sourcePlatform?: string;
  sourceChannel?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  yclid?: string;
  ymClientId?: string;
  vkclid?: string;
  vkCampaignId?: string;
  vkAdGroupId?: string;
  vkAdId?: string;
  vkFormId?: string;
  landingPage?: string;
  requestPage?: string;
}) {
  const lines = [
    `lead_capture=site_form`,
    params.sourcePlatform ? `source_platform=${params.sourcePlatform}` : undefined,
    params.sourceChannel ? `source_channel=${params.sourceChannel}` : undefined,
    params.utmCampaign ? `utm_campaign=${params.utmCampaign}` : undefined,
    params.utmContent ? `utm_content=${params.utmContent}` : undefined,
    params.utmTerm ? `utm_term=${params.utmTerm}` : undefined,
    params.yclid ? `yclid=${params.yclid}` : undefined,
    params.ymClientId ? `ym_client_id=${params.ymClientId}` : undefined,
    params.vkclid ? `vkclid=${params.vkclid}` : undefined,
    params.vkCampaignId ? `vk_campaign_id=${params.vkCampaignId}` : undefined,
    params.vkAdGroupId ? `vk_ad_group_id=${params.vkAdGroupId}` : undefined,
    params.vkAdId ? `vk_ad_id=${params.vkAdId}` : undefined,
    params.vkFormId ? `vk_form_id=${params.vkFormId}` : undefined,
    params.landingPage ? `landing_page=${params.landingPage}` : undefined,
    params.requestPage ? `request_page=${params.requestPage}` : undefined,
  ].filter(Boolean).join("\n");

  return cleanValue(lines, SUMMARY_LIMIT);
}

function readStorage(storageKey = STORAGE_KEY): AttributionBlob {
  try {
    const raw = localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey);
    if (!raw) return {};
    return JSON.parse(raw) as AttributionBlob;
  } catch {
    return {};
  }
}

function readSessionAttributionBlob(): AttributionBlob {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AttributionBlob;
  } catch {
    return {};
  }
}

function writeStorage(blob: AttributionBlob, options: { persistent: boolean }) {
  const serialized = JSON.stringify(blob);
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
  } catch {
    // sessionStorage может быть недоступен (Safari private mode и т.п.)
  }

  if (!options.persistent) return;

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // localStorage может быть недоступен (Safari private mode и т.п.)
  }
}

function readAttributionBlob(): AttributionBlob {
  return {
    ...readStorage(STORAGE_KEY),
    ...readStorage(SESSION_STORAGE_KEY),
  };
}

function getYmClientId(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const ym = (window as unknown as { ym?: (...args: unknown[]) => void }).ym;
    if (typeof ym !== "function") {
      resolve(undefined);
      return;
    }
    const timeoutId = setTimeout(() => resolve(undefined), 600);
    try {
      ym(107139619, "getClientID", (clientId: string) => {
        clearTimeout(timeoutId);
        resolve(clientId || undefined);
      });
    } catch {
      clearTimeout(timeoutId);
      resolve(undefined);
    }
  });
}

/**
 * Инициализация: вызывается один раз при старте приложения (main.tsx).
 * Читает текущий URL, заполняет first_* (если ещё нет) и last_*.
 */
export function initAttribution() {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const hasConsent = hasCookieConsent();
  const blob = hasConsent ? readAttributionBlob() : readSessionAttributionBlob();
  const now = new Date().toISOString();
  const currentTracking = readCurrentTrackingParams(params);
  const currentReferrer = cleanUrl(document.referrer, window.location.origin);
  const currentPage = cleanUrl(window.location.href, window.location.origin);

  // first_* — заполняем только если пустые (первый заход)
  if (!blob.first_landing_at) {
    blob.first_landing_at = now;
    blob.first_landing_page = currentPage;
    blob.first_referrer = currentReferrer;
    for (const key of TRACKING_KEYS) {
      blob[`first_${key}`] = currentTracking[key];
    }
    blob.first_vkclid = currentTracking.vkclid ?? currentTracking.vk_click_id;
  }

  // last_* — обновляем всегда когда есть новая UTM; иначе оставляем старые
  blob.last_seen_at = now;
  blob.last_page = currentPage;
  if (currentReferrer) blob.last_referrer = currentReferrer;

  if (Object.keys(currentTracking).length > 0) {
    for (const key of TRACKING_KEYS) {
      if (currentTracking[key]) blob[`last_${key}`] = currentTracking[key];
    }
    if (currentTracking.vkclid || currentTracking.vk_click_id) {
      blob.last_vkclid = currentTracking.vkclid ?? currentTracking.vk_click_id;
    }
  }

  writeStorage(blob, { persistent: hasConsent });
}

/**
 * Снимок для отправки в CRM. Возвращает плоский объект готовый для POST.
 */
export async function getAttribution(): Promise<Record<string, string | undefined>> {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const currentTracking = readCurrentTrackingParams(params);
  const currentReferrer = cleanUrl(document.referrer, window.location.origin);
  const currentPage = cleanUrl(window.location.href, window.location.origin);
  const hasConsent = hasCookieConsent();
  const blob = hasConsent ? readAttributionBlob() : readSessionAttributionBlob();
  const utmSource = currentTracking.utm_source ?? blob.last_utm_source ?? blob.first_utm_source;
  const utmMedium = currentTracking.utm_medium ?? blob.last_utm_medium ?? blob.first_utm_medium;
  const utmCampaign = currentTracking.utm_campaign ?? blob.last_utm_campaign ?? blob.first_utm_campaign;
  const utmContent = currentTracking.utm_content ?? blob.last_utm_content ?? blob.first_utm_content;
  const utmTerm = currentTracking.utm_term ?? blob.last_utm_term ?? blob.first_utm_term;
  const utmId = currentTracking.utm_id ?? blob.last_utm_id ?? blob.first_utm_id;
  const yclid = currentTracking.yclid ?? blob.last_yclid ?? blob.first_yclid;
  const gclid = currentTracking.gclid ?? blob.last_gclid ?? blob.first_gclid;
  const vkClickId = currentTracking.vk_click_id ?? blob.last_vk_click_id ?? blob.first_vk_click_id;
  const vkclid = currentTracking.vkclid ?? vkClickId ?? blob.last_vkclid ?? blob.first_vkclid;
  const referrer = currentReferrer ?? blob.last_referrer ?? blob.first_referrer;
  const vkCampaignId = currentTracking.vk_campaign_id ?? blob.last_vk_campaign_id ?? blob.first_vk_campaign_id;
  const vkAdGroupId = currentTracking.vk_ad_group_id ?? blob.last_vk_ad_group_id ?? blob.first_vk_ad_group_id;
  const vkAdId = currentTracking.vk_ad_id ?? blob.last_vk_ad_id ?? blob.first_vk_ad_id;
  const vkFormId = currentTracking.vk_form_id ?? blob.last_vk_form_id ?? blob.first_vk_form_id;
  const sourcePlatform = deriveSourcePlatform({ utmSource, yclid, gclid, vkclid, referrer });
  const sourceChannel = deriveSourceChannel({ utmMedium, yclid, gclid, vkclid, referrer });

  if (!hasConsent) {
    return {
      lead_capture: "site_form",
      attribution_scope: "session_first_last_touch",
      source_platform: sourcePlatform,
      source_channel: sourceChannel,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      utm_id: utmId,
      yclid,
      gclid,
      vkclid,
      vk_click_id: vkClickId,
      vk_campaign_id: vkCampaignId,
      vk_ad_group_id: vkAdGroupId,
      vk_ad_id: vkAdId,
      vk_form_id: vkFormId,
      referrer,
      page_url: currentPage,
      request_page: currentPage,
      all_params: serializeTrackingParams(currentTracking),
      attribution_summary: buildAttributionSummary({
        sourcePlatform,
        sourceChannel,
        utmCampaign,
        utmContent,
        utmTerm,
        yclid,
        vkclid,
        vkCampaignId,
        vkAdGroupId,
        vkAdId,
        vkFormId,
        landingPage: blob.first_landing_page,
        requestPage: currentPage,
      }),
      landing_page: blob.first_landing_page,
      first_landing_at: blob.first_landing_at,
      last_seen_at: blob.last_seen_at,
      last_page: blob.last_page,
    };
  }

  const ymUid = await getYmClientId();
  const pageUrl = currentPage;
  const queryString = serializeTrackingParams(currentTracking);
  const attributionSummary = buildAttributionSummary({
    sourcePlatform,
    sourceChannel,
    utmCampaign,
    utmContent,
    utmTerm,
    yclid,
    ymClientId: ymUid,
    vkclid,
    vkCampaignId,
    vkAdGroupId,
    vkAdId,
    vkFormId,
    landingPage: blob.first_landing_page,
    requestPage: pageUrl,
  });

  // Приоритет: last_* (актуальные параметры визита) с fallback на first_*.
  // Для UTM берём last_* чтобы не перетирать текущую кампанию старой;
  // first_* передаём отдельно чтобы CRM мог сохранить оба touch'а.
  return {
    lead_capture: "site_form",
    attribution_scope: "first_last_touch",
    source_platform: sourcePlatform,
    source_channel: sourceChannel,

    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    utm_term: utmTerm,
    utm_id: utmId,

    yclid,
    gclid,
    vkclid,
    vk_click_id: vkClickId,
    vk_campaign_id: vkCampaignId,
    vk_ad_group_id: vkAdGroupId,
    vk_ad_id: vkAdId,
    vk_form_id: vkFormId,

    referrer,
    page_url: pageUrl,
    request_page: pageUrl,
    source_transition: referrer,
    landing_page: blob.first_landing_page,
    first_referrer: blob.first_referrer,
    first_landing_at: blob.first_landing_at,
    first_utm_source: blob.first_utm_source,
    first_utm_medium: blob.first_utm_medium,
    first_utm_campaign: blob.first_utm_campaign,
    first_utm_content: blob.first_utm_content,
    first_utm_term: blob.first_utm_term,
    first_utm_id: blob.first_utm_id,
    first_yclid: blob.first_yclid,
    first_gclid: blob.first_gclid,
    first_vkclid: blob.first_vkclid,
    last_seen_at: blob.last_seen_at,
    last_page: blob.last_page,
    all_params: queryString,
    attribution_summary: attributionSummary,

    ym_uid: ymUid,
    ym_client_id: ymUid,
  };
}
