/* Shared by the application form and the server. Referral codes do not contain
   account IDs or logins, and links never redirect to an external destination. */
export const REFERRAL_STORAGE_KEY = "popperscraft-referral";
export const REFERRAL_REWARD_DAYS = 30;

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const text = value.trim();
  if (/^[a-f0-9]{24}$/i.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["popperscraft.org", "www.popperscraft.org"].includes(url.hostname.toLowerCase())) return null;
    const codes = url.searchParams.getAll("ref");
    return codes.length === 1 && /^[a-f0-9]{24}$/i.test(codes[0]) ? codes[0].toLowerCase() : null;
  } catch {
    return null;
  }
}
