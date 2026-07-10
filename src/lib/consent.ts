export const COOKIE_CONSENT_KEY = "cookie-consent";
export const COOKIE_CONSENT_EVENT = "rosomaha:cookie-consent-accepted";
export const PRIVACY_CONSENT_VERSION = "rosomaha-privacy-2026-04-30";

export const hasCookieConsent = () =>
  typeof window !== "undefined" &&
  window.localStorage.getItem(COOKIE_CONSENT_KEY) === "true";
