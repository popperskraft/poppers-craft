import { NextResponse } from "next/server";
import { checkDeletionCode, checkPassword, deleteOwnAccount, issueDeletionCode } from "@/lib/account-deletion";
import { getCommunityViewer } from "@/lib/community";
import { accountDeletionCodeLetter } from "@/lib/mail-letters";
import { isRealEmail, mailLocale, sendSiteMail } from "@/lib/mail";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifySupportAdmins } from "@/lib/support-bridge";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: PRIVATE });

/* Удаление аккаунта самим игроком: «send-code» присылает код на почту,
   «delete» удаляет после пароля или кода. Нужен полный вход (с кодом 2FA,
   если он включён). Аккаунты администрации так не удаляются — через владельца. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return reply({ error: "Запрос отклонён." }, 403);
  const identity = await getViewerIdentity();
  if (!identity || identity.needsMfa) return reply({ error: "Войдите в аккаунт и подтвердите вход кодом 2FA." }, 401);
  if (identity.adminProfile) return reply({ error: "Аккаунт администрации удаляет владелец сайта." }, 403);
  const userId = identity.user.id;
  const email = String(identity.user.email ?? "");
  const body = await request.json().catch(() => null) as { action?: unknown; method?: unknown; password?: unknown; code?: unknown; confirm?: unknown } | null;

  if (body?.action === "send-code") {
    if (!isRealEmail(email)) return reply({ error: "У аккаунта нет почты — подтвердите удаление паролем." }, 400);
    const limit = await consumeRateLimit(request, { scope: "account-delete-code", key: userId, limit: 3, windowSeconds: 60 * 60 });
    if (!limit.allowed) return rateLimitResponse(limit, "Код уже отправлен. Новый можно запросить позже.");
    const code = await issueDeletionCode(userId);
    if (!code) return reply({ error: "Не удалось создать код. Попробуйте позже." }, 500);
    const viewer = await getCommunityViewer({ identity, allowAuthenticated: true }).catch(() => null);
    const sent = await sendSiteMail(accountDeletionCodeLetter({
      to: email,
      login: viewer?.profile.login ?? email.split("@")[0],
      code,
      locale: mailLocale(identity.user.user_metadata?.language),
    }));
    if (!sent.ok) return reply({ error: "Письмо не отправилось. Подтвердите удаление паролем или попробуйте позже." }, 502);
    return reply({ ok: true, message: "Код отправлен на почту. Он действует 15 минут." });
  }

  if (body?.action !== "delete") return reply({ error: "Неизвестное действие." }, 400);
  if (body.confirm !== true) return reply({ error: "Отметьте, что понимаете: удаление нельзя отменить." }, 400);
  const limit = await consumeRateLimit(request, { scope: "account-delete", key: userId, limit: 10, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много попыток. Попробуйте позже.");

  if (body.method === "code") {
    const checked = await checkDeletionCode(userId, String(body.code ?? "").trim());
    if (!checked.ok) return reply({ error: checked.error }, 400);
  } else if (body.method === "password") {
    if (!(await checkPassword(email, String(body.password ?? "")))) return reply({ error: "Неверный пароль." }, 400);
  } else {
    return reply({ error: "Подтвердите удаление паролем или кодом из письма." }, 400);
  }

  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true }).catch(() => null);
  const login = viewer?.profile.login ?? email.split("@")[0];
  try {
    await deleteOwnAccount(userId);
  } catch (error) {
    console.error("Self account deletion failed", error instanceof Error ? error.message : error);
    return reply({ error: "Не удалось удалить аккаунт. Напишите в поддержку @PoppersCraftAuthBot." }, 500);
  }
  /* Сессий этого пользователя больше нет; убираем и куки входа в этом браузере. */
  await (await createSupabaseServerClient()).auth.signOut({ scope: "local" }).catch(() => undefined);
  await notifySupportAdmins([
    "Игрок удалил аккаунт сам (Настройки → Удалить аккаунт)",
    `Ник: ${login}`,
    `ID: ${userId}`,
    `Подтверждение: ${body.method === "code" ? "код из письма" : "пароль"}`,
  ].join("\n")).catch(() => undefined);
  return reply({ ok: true });
}
