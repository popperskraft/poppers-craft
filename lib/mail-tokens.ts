import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Одноразовые ссылки из писем. В аккаунте хранится только хеш токена, и лежит
   он в app_metadata — в отличие от user_metadata пользователь не может
   переписать его своими руками через клиентский Supabase. */

export type MailActionKind = "password_reset" | "email_change" | "email_verify" | "mfa_reset";

type StoredAction = {
  hash: string;
  expiresAt: string;
  email?: string;
};

export const PASSWORD_RESET_TTL = 60 * 60; // час
export const EMAIL_CONFIRM_TTL = 24 * 60 * 60; // сутки
export const MFA_RESET_TTL = 60 * 60; // час

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sameHash(left: string, right: string) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export async function issueMailToken(
  userId: string,
  kind: MailActionKind,
  ttlSeconds: number,
  email?: string,
) {
  const token = randomBytes(32).toString("base64url");
  const action: StoredAction = {
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
    ...(email ? { email } : {}),
  };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { [kind]: action },
  });
  if (error) {
    console.error("mail token issue failed", { kind, code: error.code, status: error.status });
    return null;
  }
  return token;
}

export async function consumeMailToken(userId: string, kind: MailActionKind, token: string) {
  if (!userId || !token || token.length > 200) return { ok: false as const, reason: "invalid" as const };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return { ok: false as const, reason: "invalid" as const };

  const stored = (data.user.app_metadata as Record<string, unknown> | null)?.[kind] as StoredAction | undefined;
  if (!stored?.hash || !stored.expiresAt) return { ok: false as const, reason: "invalid" as const };
  if (!sameHash(stored.hash, hashToken(token))) return { ok: false as const, reason: "invalid" as const };
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    await clearMailToken(userId, kind);
    return { ok: false as const, reason: "expired" as const };
  }

  return { ok: true as const, user: data.user, email: stored.email };
}

export async function clearMailToken(userId: string, kind: MailActionKind, extra?: Record<string, unknown>) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { [kind]: null, ...(extra ?? {}) },
  });
  if (error) console.error("mail token clear failed", { kind, code: error.code, status: error.status });
}
