import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { COOKIE_CONSENT_EVENT, hasCookieConsent } from "@/lib/consent";
import { initVkPixel, trackVkPageView } from "@/lib/vkPixel";

export default function VkPixel() {
  const location = useLocation();
  const initializedRef = useRef(false);
  const firstHitRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const init = () => {
      if (initializedRef.current || !hasCookieConsent()) {
        return;
      }

      initializedRef.current = initVkPixel();
      firstHitRef.current = true;
    };

    init();
    window.addEventListener(COOKIE_CONSENT_EVENT, init);

    return () => {
      window.removeEventListener(COOKIE_CONSENT_EVENT, init);
    };
  }, []);

  useEffect(() => {
    if (!initializedRef.current || !hasCookieConsent()) {
      return;
    }

    if (firstHitRef.current) {
      firstHitRef.current = false;
      return;
    }

    trackVkPageView();
  }, [location]);

  return null;
}
