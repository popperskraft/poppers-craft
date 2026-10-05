/* Подключение нейросетей (ChatGPT, Claude) к аккаунту игрока.

   Нейросеть подключается к адресу MCP_RESOURCE по протоколу MCP. Вход —
   OAuth 2.1 с PKCE, который выдаёт сам сайт: игрок входит на
   popperscraft.org (с кодом 2FA, если он включён) и разрешает доступ на
   странице /oauth/authorize. Пароль нейросеть не видит, а токен даёт только
   действия из lib/ai-connect/tools.ts — без почты, пароля, 2FA, оплаты,
   управления и удаления аккаунта. */

/* Кому доступны нейросети. Пока только владельцу @step: части аудитории
   тема ИИ не нравится, поэтому раздел скрыт от остальных (решение
   владельца, 2026-10-02). Другим игрокам не видна вкладка «Нейросети»,
   им не выдаётся доступ на /oauth/authorize, а /mcp не принимает их токены.
   Список можно расширить переменной AI_CONNECT_USER_IDS (id через запятую). */
const AI_CONNECT_OWNER_IDS = ["b47e9d56-d9b5-441e-b931-2fcfe738fd52"];

export function canUseAiConnect(userId: string | null | undefined) {
  if (!userId) return false;
  const extra = (process.env.AI_CONNECT_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return AI_CONNECT_OWNER_IDS.includes(userId) || extra.includes(userId);
}

export const AI_CONNECT_CLOSED_MESSAGE = "Подключение нейросетей сейчас закрыто.";

export const AI_SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://popperscraft.org").replace(/\/+$/, "");
export const AI_ISSUER = AI_SITE_ORIGIN;
export const MCP_RESOURCE = `${AI_SITE_ORIGIN}/mcp`;
export const PROTECTED_RESOURCE_METADATA_URL = `${AI_SITE_ORIGIN}/.well-known/oauth-protected-resource`;

/* Сайт открывается и с www, и без него. ChatGPT и Claude требуют, чтобы
   адрес ресурса в описании совпадал с тем, что ввёл игрок, поэтому оба
   варианта считаются одним ресурсом, а описание отвечает адресом того
   хоста, с которого его спросили. Сервер авторизации — один (AI_ISSUER). */
const SITE_HOSTS = ["popperscraft.org", "www.popperscraft.org"];

export function siteHostFrom(request: Request) {
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return SITE_HOSTS.includes(host) ? host : null;
}

export function resourceFor(request: Request) {
  const host = siteHostFrom(request);
  return host ? `https://${host}/mcp` : MCP_RESOURCE;
}

export function protectedResourceMetadataFor(request: Request) {
  const host = siteHostFrom(request);
  return host ? `https://${host}/.well-known/oauth-protected-resource` : PROTECTED_RESOURCE_METADATA_URL;
}

export function isOurResource(value: string | null | undefined) {
  if (!value) return false;
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized === MCP_RESOURCE || SITE_HOSTS.some((host) => normalized === `https://${host}/mcp`);
}

export const SCOPE_READ = "popperscraft.read";
export const SCOPE_WRITE = "popperscraft.write";
export const AI_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

/* Что видит игрок на экране разрешения. */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [SCOPE_READ]: "Читать ленту, Wiki, карточки игроков, кто сейчас в игре, ваш профиль, подписку и скин",
  [SCOPE_WRITE]: "От вашего имени публиковать посты и голосования, оставлять комментарии, менять «О себе», цвет и рисунок шапки, рисовать скин и создавать пони",
};

export const CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/* Дневные лимиты действий через нейросеть (на игрока). */
export const AI_DAILY_LIMITS = {
  post: 10,
  comment: 50,
  profile: 20,
  skin: 15,
} as const;
