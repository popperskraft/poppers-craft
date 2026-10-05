import { safeRelativeRedirect } from "@/lib/safe-redirect";

function safeLoginDestination(value: unknown, fallback: string) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const pathname = candidate.split(/[?#]/, 1)[0];
  // Encoded slashes in a query (e.g. MFA's next=%2Fprofile) are legitimate.
  // Validate the destination path separately, retaining the original query.
  if (!safeRelativeRedirect(pathname, "") || /[\\\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  const base = "https://www.popperscraft.org";
  const url = new URL(candidate, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
}

// Preserve the requested page without skipping a required MFA challenge.
export function loginReturnTarget(serverRedirect: unknown, requested?: string) {
  const serverTarget = safeLoginDestination(serverRedirect, "/profile");
  if (!requested) return serverTarget;
  const target = safeLoginDestination(requested, "/profile");
  const url = new URL(serverTarget, "https://www.popperscraft.org");
  if (url.pathname === "/mfa") {
    url.searchParams.set("next", target.startsWith("/mfa") ? "/profile" : target);
    return `${url.pathname}${url.search}`;
  }
  return target;
}

/* Ссылка «войдите, и вернём сюда»: главная откроет окно входа, а после
   входа отправит на next. Раньше вели на «/#login», но главная этот якорь
   не обрабатывала — человек просто оказывался наверху страницы. */
export function loginPageUrl(next?: string) {
  const target = next ? safeLoginDestination(next, "") : "";
  return target && target !== "/" ? `/?login=1&next=${encodeURIComponent(target)}` : "/?login=1";
}

/* Куда вернуть после входа из ?next= на главной (пусто — по умолчанию). */
export function loginNextTarget(value: unknown) {
  const target = safeLoginDestination(value, "");
  return target.startsWith("/") && !target.startsWith("/?") && target !== "/" ? target : "";
}
