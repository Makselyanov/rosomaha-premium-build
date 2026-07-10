import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initAttribution } from "@/lib/attribution";

export default function AttributionTracker() {
  const location = useLocation();

  useEffect(() => {
    initAttribution();
  }, [location.pathname, location.search]);

  return null;
}
