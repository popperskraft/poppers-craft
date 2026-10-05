"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    const recoverScroll = () => {
      document.documentElement.classList.remove("cookie-consent-open");
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    };
    recoverScroll();
    window.addEventListener("pageshow", recoverScroll);
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
    return () => {
      window.removeEventListener("load", register);
      window.removeEventListener("pageshow", recoverScroll);
    };
  }, []);

  return null;
}
