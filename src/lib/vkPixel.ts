import { hasCookieConsent } from "./consent";

declare global {
  interface Window {
    _tmr?: Array<Record<string, unknown>>;
  }
}

export const VK_PIXEL_ID = 3748677;

export const VK_PIXEL_GOALS = {
  leadSubmit: "leadSubmit",
  phoneClick: "phoneClick",
  telegramClick: "telegramClick",
  orderCtaClick: "orderCtaClick",
  addToCart: "addToCart",
} as const;

type VkGoalParams = Record<string, string | number | boolean>;

const scriptId = "tmr-code";

const getQueue = () => {
  window._tmr = window._tmr || [];
  return window._tmr;
};

export const initVkPixel = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (!hasCookieConsent()) {
    return false;
  }

  getQueue().push({
    id: VK_PIXEL_ID,
    type: "pageView",
    start: new Date().getTime(),
    url: window.location.href,
    title: document.title,
    referrer: document.referrer,
  });

  if (!document.getElementById(scriptId)) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://top-fwz1.mail.ru/js/code.js";
    const anchor = document.getElementsByTagName("script")[0] || document.head.firstChild;
    anchor?.parentNode?.insertBefore(script, anchor);
  }

  return true;
};

export const trackVkPageView = () => {
  if (typeof window === "undefined" || !hasCookieConsent()) {
    return;
  }

  getQueue().push({
    id: VK_PIXEL_ID,
    type: "pageView",
    url: window.location.href,
    title: document.title,
    referrer: document.referrer,
  });
};

export const trackVkGoal = (goal: string, params?: VkGoalParams) => {
  if (typeof window === "undefined" || !hasCookieConsent()) {
    return;
  }

  getQueue().push({
    id: VK_PIXEL_ID,
    type: "reachGoal",
    goal,
    ...(params ? { params } : {}),
  });
};
