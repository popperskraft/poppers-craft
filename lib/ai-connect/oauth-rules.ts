import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AI_SCOPES } from "./config";

/* Правила OAuth без обращений к базе — их проверяют тесты
   (tests/ai-connect.test.cjs). */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/* Адрес возврата, который может зарегистрировать нейросеть: HTTPS или
   локальный адрес компьютера (так возвращается Claude Code). */
export function isAllowedRedirectUri(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password || value.length > 500) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/* Совпадение с зарегистрированным адресом. Для локального адреса порт не
   сравнивается: Claude Code каждый раз берёт новый (RFC 8252, 7.3). */
export function redirectUriMatches(registered: string[], requested: string) {
  if (registered.includes(requested)) return true;
  let target: URL;
  try {
    target = new URL(requested);
  } catch {
    return false;
  }
  if (target.protocol !== "http:" || !LOOPBACK_HOSTS.has(target.hostname)) return false;
  return registered.some((entry) => {
    try {
      const url = new URL(entry);
      return url.protocol === "http:" && url.hostname === target.hostname && url.pathname === target.pathname && url.search === target.search;
    } catch {
      return false;
    }
  });
}

export function base64url(bytes: Buffer) {
  return bytes.toString("base64url");
}

export function newSecret(prefix: string) {
  return `${prefix}_${base64url(randomBytes(32))}`;
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/* PKCE: только S256. */
export function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  const expected = Buffer.from(base64url(createHash("sha256").update(verifier).digest()));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* Запрошенные права: только известные; пусто — все. */
export function parseScopes(value: string | null | undefined) {
  const known = new Set<string>(AI_SCOPES);
  const asked = String(value ?? "").split(/\s+/).filter((scope) => known.has(scope));
  return asked.length ? [...new Set(asked)] : [...AI_SCOPES];
}

export function cleanClientName(value: unknown) {
  const name = String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 80);
  return name || "Нейросеть";
}
