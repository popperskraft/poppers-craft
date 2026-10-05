import { REFERRAL_STORAGE_KEY } from "@/lib/referral-code";

export const REFERRAL_CHANGED_EVENT = "popperscraft:referral-changed";
let rememberedReferral: string | null = null;

/* The value may be invalid: keep it visible so the applicant can correct it.
   Never silently submit an application without an invitation they entered. */
export function readReferralDraft(): string {
  if (rememberedReferral !== null) return rememberedReferral;
  try {
    return window.localStorage.getItem(REFERRAL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeReferral(value: string) {
  rememberedReferral = value;
  try {
    if (value) window.localStorage.setItem(REFERRAL_STORAGE_KEY, value);
    else window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // The current tab still retains the invitation if browser storage is blocked.
  }
  window.dispatchEvent(new Event(REFERRAL_CHANGED_EVENT));
}

export function captureReferralFromUrl() {
  const values = new URL(window.location.href).searchParams.getAll("ref");
  if (values.length) storeReferral(values.length === 1 ? values[0] : window.location.href);
  return readReferralDraft();
}

export function updateReferralDraft(value: string) {
  storeReferral(value);
  /* An edited/cleared field must win over the original link on reload. */
  const url = new URL(window.location.href);
  if (url.searchParams.has("ref")) {
    url.searchParams.delete("ref");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}
