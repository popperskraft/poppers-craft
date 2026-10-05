import "server-only";

import { AI_ISSUER, isOurResource } from "./config";
import { clientAcceptsRedirect, getClient, type AiClient } from "./oauth";
import { parseScopes } from "./oauth-rules";

/* Проверка запроса на доступ (/oauth/authorize). Пока адрес возврата не
   проверен, никуда не перенаправляем — показываем ошибку на сайте. */

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes: string[];
  resource: string | null;
};

export type AuthorizeCheck =
  | { kind: "ok"; request: AuthorizeRequest; client: AiClient }
  | { kind: "fatal"; message: string }
  | { kind: "redirect"; url: string };

export function redirectWith(redirectUri: string, params: Record<string, string>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  /* RFC 9207: адрес сервера авторизации в каждом ответе. */
  url.searchParams.set("iss", AI_ISSUER);
  return url.toString();
}

export async function checkAuthorizeRequest(input: Record<string, string | undefined>): Promise<AuthorizeCheck> {
  const clientId = input.client_id ?? "";
  const redirectUri = input.redirect_uri ?? "";
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { kind: "fatal", message: "Программа, которая просит доступ, не зарегистрирована. Начните подключение в нейросети заново." };
  if (!redirectUri || !clientAcceptsRedirect(client, redirectUri)) return { kind: "fatal", message: "Адрес возврата не совпадает с зарегистрированным. Доступ не выдан." };
  const state = (input.state ?? "").slice(0, 500);
  const fail = (error: string, description: string): AuthorizeCheck => ({ kind: "redirect", url: redirectWith(redirectUri, { error, error_description: description, state }) });
  if (input.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
  if (input.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge ?? "")) return fail("invalid_request", "PKCE with S256 is required");
  const resource = input.resource ? input.resource.replace(/\/+$/, "") : null;
  if (resource && !isOurResource(resource)) return fail("invalid_target", "Unknown resource");
  return {
    kind: "ok",
    client,
    request: { clientId, redirectUri, codeChallenge: input.code_challenge ?? "", state, scopes: parseScopes(input.scope), resource },
  };
}

/* Знакомые адреса возврата: сайт ChatGPT, сайт Claude и компьютер игрока
   (Claude Code). Для остальных экран разрешения предупреждает отдельно. */
export function redirectHost(redirectUri: string) {
  const url = new URL(redirectUri);
  const known = url.hostname === "chatgpt.com" || url.hostname === "claude.ai" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  return { host: url.host, known };
}
