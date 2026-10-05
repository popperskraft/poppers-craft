import "server-only";

import { X509Certificate, verify as verifySignature } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* Подписка «Поддержка сервера» из приложения PoppersCraft для iPhone.

   App Store подписывает каждую покупку (JWS, алгоритм ES256) и кладёт цепочку
   сертификатов в заголовок. Здесь цепочка проверяется до корневого сертификата
   Apple Root CA - G3, который лежит ниже целиком, — без этого подпись можно
   было бы подделать. Локальные покупки из Xcode подписаны другим корнем и не
   проходят проверку, как и задумано.

   Состояние подписки хранится в app_metadata пользователя Supabase: отдельная
   таблица не нужна, а «активна ли подписка» всегда считается заново по дате
   окончания, поэтому она гаснет сама, даже если уведомление от Apple потеряется. */

export const APP_BUNDLE_ID = process.env.APPLE_APP_BUNDLE_ID?.trim() || "org.popperscraft.app";
export const SUPPORTER_PRODUCT_ID =
  process.env.APPLE_SUPPORTER_PRODUCT_ID?.trim() || "org.popperscraft.app.supporter.monthly";

/** https://www.apple.com/certificateauthority/ — Apple Root CA - G3, срок до 2039 года. */
const APPLE_ROOT_CA_G3 = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

export type AppleTransaction = {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  appAccountToken?: string;
  environment?: string;
  type?: string;
};

export type AppleRenewalInfo = {
  autoRenewStatus?: number;
  autoRenewProductId?: string;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
};

export type SupporterState = {
  active: boolean;
  productId: string;
  expiresAt: string | null;
  originalTransactionId: string;
  environment: string;
  autoRenew: boolean | null;
  revoked: boolean;
  updatedAt: string;
};

function decodeSegment(segment: string): Record<string, unknown> {
  const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("apple-jws-payload");
  return value as Record<string, unknown>;
}

/* Отметки Apple в сертификатах (как в официальной app-store-server-library):
   конечный сертификат подписи App Store — OID 1.2.840.113635.100.6.11.1,
   промежуточный Apple WWDR — 1.2.840.113635.100.6.2.1. Без этой проверки
   подошёл бы любой сертификат, выпущенный от корня Apple, — например,
   обычный сертификат разработчика. */
const APPLE_RECEIPT_SIGNER_OID = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x0b, 0x01]);
const APPLE_WWDR_INTERMEDIATE_OID = Buffer.from([0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x06, 0x02, 0x01]);
const hasOid = (certificate: X509Certificate, oid: Buffer) => certificate.raw.includes(oid);

function certificateIsCurrent(certificate: X509Certificate, now: Date) {
  return new Date(certificate.validFrom) <= now && new Date(certificate.validTo) >= now;
}

/**
 * Проверяет подписанные Apple данные (транзакцию, сведения о продлении или
 * уведомление App Store Server Notifications V2) и возвращает их содержимое.
 * Бросает ошибку, если подпись, цепочка сертификатов или сроки не сходятся.
 */
export function verifyAppleSignedPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("apple-jws-malformed");

  const header = decodeSegment(parts[0]);
  if (header.alg !== "ES256") throw new Error("apple-jws-alg");
  const chain = Array.isArray(header.x5c) ? header.x5c : [];
  if (chain.length < 2 || chain.length > 5) throw new Error("apple-jws-chain");

  const now = new Date();
  const certificates = chain.map((entry) => new X509Certificate(Buffer.from(String(entry), "base64")));
  const root = new X509Certificate(APPLE_ROOT_CA_G3);
  if (!certificateIsCurrent(root, now)) throw new Error("apple-jws-root-expired");
  for (const certificate of certificates) {
    if (!certificateIsCurrent(certificate, now)) throw new Error("apple-jws-cert-expired");
  }

  // Каждый сертификат должен быть выпущен и подписан следующим в цепочке.
  for (let index = 0; index < certificates.length - 1; index += 1) {
    const child = certificates[index];
    const issuer = certificates[index + 1];
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) throw new Error("apple-jws-chain-broken");
  }

  // Последний сертификат цепочки — либо сам корень Apple, либо выпущен корнем.
  const last = certificates[certificates.length - 1];
  const anchored = last.raw.equals(root.raw) || (last.checkIssued(root) && last.verify(root.publicKey));
  if (!anchored) throw new Error("apple-jws-root");
  if (!hasOid(certificates[0], APPLE_RECEIPT_SIGNER_OID) || !hasOid(certificates[1], APPLE_WWDR_INTERMEDIATE_OID)) {
    throw new Error("apple-jws-purpose");
  }

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const valid = verifySignature(
    "sha256",
    signed,
    { key: certificates[0].publicKey, dsaEncoding: "ieee-p1363" },
    signature,
  );
  if (!valid) throw new Error("apple-jws-signature");

  return decodeSegment(parts[1]);
}

function isoDate(value: unknown) {
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return new Date(milliseconds).toISOString();
}

/** Собирает состояние подписки из подписанной транзакции и сведений о продлении. */
export function supporterFromTransaction(
  transaction: AppleTransaction,
  renewal: AppleRenewalInfo | null = null,
): SupporterState {
  const expiresAt = isoDate(transaction.expiresDate) ?? isoDate(renewal?.gracePeriodExpiresDate);
  const revoked = Boolean(transaction.revocationDate);
  const live = !revoked && (!expiresAt || new Date(expiresAt).getTime() > Date.now());
  return {
    active: live,
    productId: String(transaction.productId ?? SUPPORTER_PRODUCT_ID),
    expiresAt,
    originalTransactionId: String(transaction.originalTransactionId ?? transaction.transactionId ?? ""),
    environment: String(transaction.environment ?? "Production"),
    autoRenew: typeof renewal?.autoRenewStatus === "number" ? renewal.autoRenewStatus === 1 : null,
    revoked,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Состояние подписки для ответа приложению. Срок окончания проверяется здесь же,
 * поэтому подписка гаснет сама, даже если уведомление от Apple не дошло.
 */
export function readSupporter(metadata: unknown): SupporterState | null {
  const stored = (metadata as { supporter?: Partial<SupporterState> } | null)?.supporter;
  if (!stored || typeof stored !== "object") return null;
  const expiresAt = typeof stored.expiresAt === "string" ? stored.expiresAt : null;
  const revoked = Boolean(stored.revoked);
  const fresh = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  return {
    active: Boolean(stored.active) && fresh && !revoked,
    productId: String(stored.productId ?? SUPPORTER_PRODUCT_ID),
    expiresAt,
    originalTransactionId: String(stored.originalTransactionId ?? ""),
    environment: String(stored.environment ?? "Production"),
    autoRenew: typeof stored.autoRenew === "boolean" ? stored.autoRenew : null,
    revoked,
    updatedAt: String(stored.updatedAt ?? ""),
  };
}

/** Сохраняет состояние подписки у пользователя, не трогая остальные поля app_metadata. */
export async function saveSupporter(userId: string, state: SupporterState) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { supporter: state } });
  if (error) throw error;
}

/** Ищет владельца покупки: приложение всегда передаёт id аккаунта в appAccountToken. */
export async function supporterUserId(transaction: AppleTransaction) {
  const token = String(transaction.appAccountToken ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(token);
  if (error || !data?.user) return null;
  return data.user.id;
}
