import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { revokeAllAiTokens } from "@/lib/ai-connect/oauth";
import { forgetCard } from "@/lib/payments";
import { permanentlyDeletePlayerAccount } from "@/lib/player-account-deletion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Удаление аккаунта самим игроком (Профиль → Настройки → Аккаунт и почта,
   редакция соглашения 1.2). Подтверждение — пароль от аккаунта или
   шестизначный код из письма. Сначала отключаются автопродление и карта,
   чтобы с удалённого игрока ничего не списалось, и отзываются доступы
   нейросетей; затем аккаунт стирается той же функцией, что и из «Управления»
   (lib/player-account-deletion.ts). Платежи остаются в учёте без привязки к
   аккаунту (pc_payments.user_id → NULL). */

export const DELETE_CODE_TTL_MS = 15 * 60_000;
export const DELETE_CODE_ATTEMPTS = 5;

type StoredCode = { hash: string; expiresAt: string; attempts: number };

function hashCode(userId: string, code: string) {
  return createHash("sha256").update(`account-delete:${userId}:${code}`).digest("hex");
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/* Код хранится только хешем в app_metadata — пользователь не может его
   переписать сам. Новый код заменяет старый. */
export async function issueDeletionCode(userId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const stored: StoredCode = { hash: hashCode(userId, code), expiresAt: new Date(Date.now() + DELETE_CODE_TTL_MS).toISOString(), attempts: 0 };
  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(userId, { app_metadata: { account_delete: stored } });
  return error ? null : code;
}

export async function checkDeletionCode(userId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Код — шесть цифр из письма." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return { ok: false, error: "Не удалось проверить код." };
  const stored = data.user.app_metadata?.account_delete as StoredCode | null | undefined;
  if (!stored?.hash) return { ok: false, error: "Сначала запросите код на почту." };
  if (Date.parse(stored.expiresAt) < Date.now()) return { ok: false, error: "Код устарел. Запросите новый." };
  if (stored.attempts >= DELETE_CODE_ATTEMPTS) return { ok: false, error: "Слишком много неверных попыток. Запросите новый код." };
  if (!sameHash(stored.hash, hashCode(userId, code))) {
    await admin.auth.admin.updateUserById(userId, { app_metadata: { account_delete: { ...stored, attempts: stored.attempts + 1 } } });
    return { ok: false, error: "Неверный код." };
  }
  await admin.auth.admin.updateUserById(userId, { app_metadata: { account_delete: null } });
  return { ok: true };
}

/* Пароль проверяется отдельным одноразовым входом: текущая сессия не
   трогается, а проверочная сразу закрывается. */
export async function checkPassword(email: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !email || password.length < 1 || password.length > 128) return false;
  const probe = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}

export async function deleteOwnAccount(userId: string) {
  /* Ничего не спишется: карта отвязана, автопродление выключено. */
  await forgetCard(userId);
  await revokeAllAiTokens(userId).catch(() => undefined);
  const admin = createSupabaseAdminClient();
  const { data: application, error } = await admin
    .from("waitlist_applications")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (application) {
    await permanentlyDeletePlayerAccount({ applicationId: Number(application.id), userId });
    return;
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
  if (deleteError && deleteError.status !== 404) throw deleteError;
}
