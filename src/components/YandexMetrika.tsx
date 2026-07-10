import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { METRIKA_COUNTER_ID, flushMetrikaGoalQueue, isMetrikaReady } from "@/lib/metrika";
import { COOKIE_CONSENT_EVENT, hasCookieConsent } from "@/lib/consent";

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
  }
}

const tagScriptId = "yandex-metrika-tag";

const initSnippet = `
  (function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) { return; }
    }
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
  })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
`;

export default function YandexMetrika() {
  const location = useLocation();
  const initializedRef = useRef(false);
  const firstHitRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let waitForYm = 0;

    const initMetrika = () => {
      if (!hasCookieConsent() || initializedRef.current) {
        return;
      }

      if (!document.getElementById(tagScriptId)) {
        const inlineScript = document.createElement("script");
        inlineScript.id = tagScriptId;
        inlineScript.text = initSnippet;
        document.head.appendChild(inlineScript);
      }

      waitForYm = window.setInterval(() => {
        if (!isMetrikaReady()) {
          return;
        }

        if (!initializedRef.current) {
          window.ym?.(METRIKA_COUNTER_ID, "init", {
            clickmap: true,
            trackLinks: true,
            accurateTrackBounce: true,
            webvisor: true,
          });
          initializedRef.current = true;
          flushMetrikaGoalQueue();
        }

        window.clearInterval(waitForYm);
      }, 250);
    };

    initMetrika();
    window.addEventListener(COOKIE_CONSENT_EVENT, initMetrika);

    return () => {
      window.clearInterval(waitForYm);
      window.removeEventListener(COOKIE_CONSENT_EVENT, initMetrika);
    };
  }, []);

  useEffect(() => {
    if (!hasCookieConsent() || !initializedRef.current || !isMetrikaReady()) {
      return;
    }

    if (firstHitRef.current) {
      firstHitRef.current = false;
      return;
    }

    const path = `${location.pathname}${location.search}${location.hash}`;
    window.ym?.(METRIKA_COUNTER_ID, "hit", path, {
      title: document.title,
      referer: document.referrer,
    });
  }, [location]);

  return (
    <noscript>
      {hasCookieConsent() ? (
        <div>
          <img
            alt=""
            src={`https://mc.yandex.ru/watch/${METRIKA_COUNTER_ID}`}
            style={{ position: "absolute", left: "-9999px" }}
          />
        </div>
      ) : null}
    </noscript>
  );
}
