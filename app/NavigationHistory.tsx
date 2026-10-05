"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordVisit } from "@/lib/navigation-trail";

/* Запоминает путь по сайту для кнопки «← НАЗАД» (lib/navigation-trail.ts).
   Параметры адреса тоже учитываются: вернуться можно к той же анкете
   вайтлиста или к тому же разделу настроек. */
export function NavigationHistory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    recordVisit(pathname || window.location.pathname || "/", search);
  }, [pathname, search]);

  return null;
}
