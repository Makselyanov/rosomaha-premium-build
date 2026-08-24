import { hasCookieConsent } from "./consent";
import { trackVkGoal, VK_PIXEL_GOALS } from "./vkPixel";

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

export const METRIKA_COUNTER_ID = 107139619;

export const METRIKA_GOALS = {
  leadSubmit: "lead_submit",
  phoneClick: "phone_click",
  telegramClick: "telegram_click",
  orderCtaClick: "order_cta_click",
  addToCart: "add_to_cart",
} as const;

export const LEGACY_METRIKA_GOALS = {
  crmConversion: "crm_conversion",
  clickOrder: "click_order",
} as const;

type GoalParams = Record<string, string | number | boolean>;
type QueuedGoal = {
  goal: string;
  params?: GoalParams;
};

const pendingGoals: QueuedGoal[] = [];
const MAX_PENDING_GOALS = 20;

export const isMetrikaReady = () =>
  typeof window !== "undefined" &&
  hasCookieConsent() &&
  typeof window.ym === "function";

export const flushMetrikaGoalQueue = () => {
  if (!isMetrikaReady()) {
    return;
  }

  const goals = pendingGoals.splice(0, pendingGoals.length);
  for (const item of goals) {
    window.ym?.(METRIKA_COUNTER_ID, "reachGoal", item.goal, item.params);
  }
};

export const reachGoal = (goal: string, params?: GoalParams) => {
  if (!isMetrikaReady()) {
    if (typeof window !== "undefined" && hasCookieConsent()) {
      pendingGoals.push({ goal, params });
      if (pendingGoals.length > MAX_PENDING_GOALS) {
        pendingGoals.shift();
      }
    }
    return;
  }

  flushMetrikaGoalQueue();
  window.ym?.(METRIKA_COUNTER_ID, "reachGoal", goal, params);
};

export const trackPhoneClick = (placement: string) => {
  reachGoal(METRIKA_GOALS.phoneClick, { placement });
  trackVkGoal(VK_PIXEL_GOALS.phoneClick, { placement });
};

export const trackTelegramClick = (placement: string) => {
  reachGoal(METRIKA_GOALS.telegramClick, { placement });
  trackVkGoal(VK_PIXEL_GOALS.telegramClick, { placement });
};

export const trackOrderCtaClick = (placement: string) => {
  reachGoal(METRIKA_GOALS.orderCtaClick, { placement });
  reachGoal(LEGACY_METRIKA_GOALS.clickOrder, { placement });
  trackVkGoal(VK_PIXEL_GOALS.orderCtaClick, { placement });
};

export const trackLeadSubmit = (params?: GoalParams) => {
  // Hard goal crm_conversion must be emitted only after CRM confirms
  // the exact deal_id for this submission. Frontend form submit stays soft.
  reachGoal(METRIKA_GOALS.leadSubmit, params);
  trackVkGoal(VK_PIXEL_GOALS.leadSubmit, params);
};

export const trackAddToCart = (params?: GoalParams) => {
  reachGoal(METRIKA_GOALS.addToCart, params);
  trackVkGoal(VK_PIXEL_GOALS.addToCart, params);
};
