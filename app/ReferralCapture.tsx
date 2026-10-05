"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureReferralFromUrl } from "./referral-storage";

/* Capture on every entry page, before a guest visits the rules or application. */
export function ReferralCapture() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => { captureReferralFromUrl(); }, [pathname, searchParams]);
  return null;
}
