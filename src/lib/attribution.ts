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

type AttributionBlob = {
  first_utm_source?: string;
  first_utm_medium?: string;
  first_utm_campaign?: string;
  first_utm_content?: string;
  first_utm_term?: string;
  first_yclid?: string;
  first_gclid?: string;
  first_referrer?: string;
  first_landing_page?: string;
  first_landing_at?: string;

  last_utm_source?: string;
  last_utm_medium?: string;
  last_utm_campaign?: string;
  last_utm_content?: string;
  last_utm_term?: string;
  last_yclid?: string;
  last_gclid?: string;
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
] as const;

const CLICK_ID_KEYS = ["yclid", "gclid"] as const;

function readStorage(): AttributionBlob {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AttributionBlob;
  } catch {
    return {};
  }
}

function writeStorage(blob: AttributionBlob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // localStorage может быть недоступен (Safari private mode и т.п.)
  }
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
  const blob = readStorage();
  const now = new Date().toISOString();

  // Собираем текущие значения из URL
  const currentUtm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) currentUtm[key] = value;
  }
  for (const key of CLICK_ID_KEYS) {
    const value = params.get(key);
    if (value) currentUtm[key] = value;
  }

  const currentReferrer = document.referrer || undefined;
  const currentPage = window.location.href;

  // first_* — заполняем только если пустые (первый заход)
  if (!blob.first_landing_at) {
    blob.first_landing_at = now;
    blob.first_landing_page = currentPage;
    blob.first_referrer = currentReferrer;
    blob.first_utm_source = currentUtm.utm_source;
    blob.first_utm_medium = currentUtm.utm_medium;
    blob.first_utm_campaign = currentUtm.utm_campaign;
    blob.first_utm_content = currentUtm.utm_content;
    blob.first_utm_term = currentUtm.utm_term;
    blob.first_yclid = currentUtm.yclid;
    blob.first_gclid = currentUtm.gclid;
  }

  // last_* — обновляем всегда когда есть новая UTM; иначе оставляем старые
  blob.last_seen_at = now;
  blob.last_page = currentPage;
  if (currentReferrer) blob.last_referrer = currentReferrer;

  if (Object.keys(currentUtm).length > 0) {
    blob.last_utm_source = currentUtm.utm_source ?? blob.last_utm_source;
    blob.last_utm_medium = currentUtm.utm_medium ?? blob.last_utm_medium;
    blob.last_utm_campaign = currentUtm.utm_campaign ?? blob.last_utm_campaign;
    blob.last_utm_content = currentUtm.utm_content ?? blob.last_utm_content;
    blob.last_utm_term = currentUtm.utm_term ?? blob.last_utm_term;
    if (currentUtm.yclid) blob.last_yclid = currentUtm.yclid;
    if (currentUtm.gclid) blob.last_gclid = currentUtm.gclid;
  }

  writeStorage(blob);
}

/**
 * Снимок для отправки в CRM. Возвращает плоский объект готовый для POST.
 */
export async function getAttribution(): Promise<Record<string, string | undefined>> {
  if (typeof window === "undefined") return {};

  const blob = readStorage();
  const ymUid = await getYmClientId();

  // Приоритет: last_* (актуальные параметры визита) с fallback на first_*.
  // Для UTM берём last_* чтобы не перетирать текущую кампанию старой;
  // first_* передаём отдельно чтобы CRM мог сохранить оба touch'а.
  return {
    utm_source: blob.last_utm_source ?? blob.first_utm_source,
    utm_medium: blob.last_utm_medium ?? blob.first_utm_medium,
    utm_campaign: blob.last_utm_campaign ?? blob.first_utm_campaign,
    utm_content: blob.last_utm_content ?? blob.first_utm_content,
    utm_term: blob.last_utm_term ?? blob.first_utm_term,

    yclid: blob.last_yclid ?? blob.first_yclid,
    gclid: blob.last_gclid ?? blob.first_gclid,

    referrer: blob.last_referrer ?? blob.first_referrer,
    page_url: window.location.href,
    landing_page: blob.first_landing_page,
    first_referrer: blob.first_referrer,
    first_landing_at: blob.first_landing_at,

    ym_uid: ymUid,
  };
}
