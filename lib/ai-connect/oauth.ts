import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ACCESS_TTL_SECONDS, CODE_TTL_SECONDS, isOurResource, MCP_RESOURCE, REFRESH_TTL_SECONDS } from "./config";
import { cleanClientName, hashSecret, isAllowedRedirectUri, newSecret, pkceMatches, redirectUriMatches } from "./oauth-rules";

/* Сервер авторизации для нейросетей: регистрация клиента (RFC 7591),
   код с PKCE, токены с обновлением и отзыв. В базе лежат только хеши. */

export class OAuthError extends Error {
  constructor(public code: string, public description: string, public status = 400) {
    super(description);
  }
}

export type AiClient = { id: string; name: string; redirect_uris: string[] };
export type TokenPair = { access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number; scope: string };
export type VerifiedToken = { tokenId: string; userId: string; clientId: string; scopes: string[] };

const db = () => createSupabaseAdminClient();
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export async function registerClient(input: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown }, ip: string) {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 5 || !uris.every(isAllowedRedirectUri)) {
    throw new OAuthError("invalid_redirect_uri", "Нужны адреса возврата HTTPS или локального компьютера (не больше пяти).");
  }
  /* Нейросети — публичные клиенты: секрета нет, защищает PKCE. */
  const method = input.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") {
    throw new OAuthError("invalid_client_metadata", "Поддерживается только token_endpoint_auth_method=none.");
  }
  const client: AiClient = { id: newSecret("pcc"), name: cleanClientName(input.client_name), redirect_uris: [...new Set(uris)] };
  const { error } = await db().from("pc_ai_clients").insert({ ...client, created_ip: ip.slice(0, 100) });
  if (error) throw new OAuthError("server_error", "Не удалось зарегистрировать клиента.", 500);
  return client;
}

export async function getClient(id: string): Promise<AiClient | null> {
  if (!/^pcc_[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const { data } = await db().from("pc_ai_clients").select("id,name,redirect_uris").eq("id", id).maybeSingle();
  return data ? { id: String(data.id), name: String(data.name), redirect_uris: (data.redirect_uris ?? []).map(String) } : null;
}

export function clientAcceptsRedirect(client: AiClient, redirectUri: string) {
  return redirectUriMatches(client.redirect_uris, redirectUri);
}

export async function createAuthorizationCode(input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scopes: string[]; resource: string | null }) {
  const code = newSecret("pcd");
  const { error } = await db().from("pc_ai_codes").insert({
    code_hash: hashSecret(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    scopes: input.scopes,
    resource: input.resource,
    expires_at: inSeconds(CODE_TTL_SECONDS),
  });
  if (error) throw new OAuthError("server_error", "Не удалось выдать код.", 500);
  return code;
}

async function issueTokens(row: { user_id: string; client_id: string; scopes: string[]; resource: string | null }) {
  const access = newSecret("pca");
  const refresh = newSecret("pcr");
  const { data, error } = await db().from("pc_ai_tokens").insert({
    user_id: row.user_id,
    client_id: row.client_id,
    access_hash: hashSecret(access),
    refresh_hash: hashSecret(refresh),
    scopes: row.scopes,
    resource: row.resource,
    access_expires_at: inSeconds(ACCESS_TTL_SECONDS),
    refresh_expires_at: inSeconds(REFRESH_TTL_SECONDS),
  }).select("id").single();
  if (error || !data) throw new OAuthError("server_error", "Не удалось выдать токен.", 500);
  const pair: TokenPair = { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, scope: row.scopes.join(" ") };
  return { pair, id: String(data.id) };
}

/* Токен выдаётся только для нашего MCP: чужой resource — отказ. */
function checkResource(resource: string | null) {
  if (resource && !isOurResource(resource)) {
    throw new OAuthError("invalid_target", "Этот сервер выдаёт доступ только к PoppersCraft MCP.");
  }
}

export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string | null }) {
  checkResource(input.resource);
  /* Код одноразовый: помечаем использованным одной операцией. */
  const { data: row } = await db().from("pc_ai_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", hashSecret(input.code))
    .is("used_at", null)
    .select("client_id,user_id,redirect_uri,code_challenge,scopes,resource,expires_at")
    .maybeSingle();
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new OAuthError("invalid_grant", "Код недействителен или устарел.");
  if (row.client_id !== input.clientId || row.redirect_uri !== input.redirectUri) throw new OAuthError("invalid_grant", "Код выдан другому клиенту.");
  if (!pkceMatches(input.verifier, row.code_challenge)) throw new OAuthError("invalid_grant", "Проверка PKCE не прошла.");
  return (await issueTokens({ user_id: row.user_id, client_id: row.client_id, scopes: row.scopes, resource: row.resource ?? MCP_RESOURCE })).pair;
}

/* Обновление: старая пара отзывается, выдаётся новая (ротация для
   публичных клиентов, как требует OAuth 2.1). */
export async function refreshTokens(input: { refreshToken: string; clientId: string; resource: string | null }) {
  checkResource(input.resource);
  const { data: old } = await db().from("pc_ai_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("refresh_hash", hashSecret(input.refreshToken))
    .is("revoked_at", null)
    .select("id,user_id,client_id,scopes,resource,refresh_expires_at")
    .maybeSingle();
  if (!old || Date.parse(old.refresh_expires_at) < Date.now() || old.client_id !== input.clientId) {
    throw new OAuthError("invalid_grant", "Токен обновления недействителен.");
  }
  const { pair, id } = await issueTokens(old);
  await db().from("pc_ai_tokens").update({ replaced_by: id }).eq("id", old.id);
  forgetCachedTokens();
  return pair;
}

/* Проверка токена при каждом запросе к MCP. Ответ кэшируется на минуту,
   чтобы не ходить в базу за каждым вызовом инструмента. */
const tokenCache = new Map<string, { value: VerifiedToken; until: number }>();
const lastTouched = new Map<string, number>();

export function forgetCachedTokens() {
  tokenCache.clear();
}

export async function verifyAccessToken(token: string): Promise<VerifiedToken | null> {
  if (!/^pca_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashSecret(token);
  const cached = tokenCache.get(hash);
  if (cached && cached.until > Date.now()) return cached.value;
  const { data } = await db().from("pc_ai_tokens")
    .select("id,user_id,client_id,scopes,resource,access_expires_at,revoked_at")
    .eq("access_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at || Date.parse(data.access_expires_at) < Date.now()) return null;
  if (data.resource && !isOurResource(String(data.resource))) return null;
  const value: VerifiedToken = { tokenId: String(data.id), userId: String(data.user_id), clientId: String(data.client_id), scopes: (data.scopes ?? []).map(String) };
  tokenCache.set(hash, { value, until: Math.min(Date.now() + 60_000, Date.parse(data.access_expires_at)) });
  /* Время последнего использования — не чаще раза в 10 минут. */
  if ((lastTouched.get(value.tokenId) ?? 0) < Date.now() - 10 * 60_000) {
    lastTouched.set(value.tokenId, Date.now());
    await db().from("pc_ai_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", value.tokenId);
  }
  return value;
}

/* RFC 7009: отзыв по токену доступа или обновления. */
export async function revokeByToken(token: string) {
  const hash = hashSecret(token);
  const now = new Date().toISOString();
  await db().from("pc_ai_tokens").update({ revoked_at: now }).is("revoked_at", null).or(`access_hash.eq.${hash},refresh_hash.eq.${hash}`);
  forgetCachedTokens();
}

export async function revokeClientForUser(userId: string, clientId: string) {
  await db().from("pc_ai_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).eq("client_id", clientId).is("revoked_at", null);
  forgetCachedTokens();
}

/* Смена пароля или отключение 2FA обрывают все подключения нейросетей. */
export async function revokeAllAiTokens(userId: string) {
  await db().from("pc_ai_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).is("revoked_at", null);
  forgetCachedTokens();
}

export type AiConnection = { clientId: string; name: string; connectedAt: string; lastUsedAt: string | null };

export async function listConnections(userId: string): Promise<AiConnection[]> {
  const { data } = await db().from("pc_ai_tokens")
    .select("client_id,created_at,last_used_at,refresh_expires_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  const live = (data ?? []).filter((row) => Date.parse(row.refresh_expires_at) > Date.now());
  if (!live.length) return [];
  const ids = [...new Set(live.map((row) => String(row.client_id)))];
  const { data: clients } = await db().from("pc_ai_clients").select("id,name").in("id", ids);
  const names = new Map((clients ?? []).map((client) => [String(client.id), String(client.name)]));
  const byClient = new Map<string, AiConnection>();
  for (const row of live) {
    const id = String(row.client_id);
    const current = byClient.get(id);
    const lastUsed = row.last_used_at ? String(row.last_used_at) : null;
    byClient.set(id, {
      clientId: id,
      name: names.get(id) ?? "Нейросеть",
      connectedAt: current?.connectedAt ?? String(row.created_at),
      lastUsedAt: [current?.lastUsedAt, lastUsed].filter(Boolean).sort().pop() ?? null,
    });
  }
  return [...byClient.values()];
}

export async function logActivity(userId: string, clientId: string, tool: string, summary: string) {
  await db().from("pc_ai_activity").insert({ user_id: userId, client_id: clientId, tool, summary: summary.slice(0, 300) });
}

export async function listActivity(userId: string, limit = 20) {
  const { data } = await db().from("pc_ai_activity").select("id,client_id,tool,summary,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((row) => ({ id: Number(row.id), clientId: row.client_id ? String(row.client_id) : null, tool: String(row.tool), summary: String(row.summary), createdAt: String(row.created_at) }));
}
