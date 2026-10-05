export function safeRelativeRedirect(value: string | null | undefined, fallback: string) {
  const candidate = String(value ?? "").trim();
  const encodedSeparatorOrControl = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i;
  if (
    !candidate.startsWith("/")
    || candidate.startsWith("//")
    || /[\\\u0000-\u001f\u007f]/.test(candidate)
    || encodedSeparatorOrControl.test(candidate)
  ) {
    return fallback;
  }
  try {
    const base = new URL("https://popperscraft.org");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
