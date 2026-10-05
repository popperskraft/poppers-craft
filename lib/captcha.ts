import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { consumeSingleUseToken } from "@/lib/request-security";

export const CAPTCHA_COOKIE = "pc_minecraft_captcha";

/* Сопоставление «вариант → предмет» живёт только в зашифрованной куке. Раньше
   название предмета отдавалось вместе с вариантами и стояло в адресе картинки,
   поэтому капчу решал любой скрипт, не глядя на изображение. */
export type CaptchaPayload = {
  answer: string;
  exp: number;
  nonce: string;
  icons?: Record<string, string>;
};

function secret() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TELEGRAM_BOT_TOKEN || "popperscraft-local-captcha";
}

export function signCaptcha(answer: string, icons?: Record<string, string>) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret()).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify({
    answer,
    exp: Date.now() + 5 * 60_000,
    nonce: randomBytes(16).toString("hex"),
    ...(icons ? { icons } : {}),
  }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function captchaTokenFromRequest(request: Request) {
  const rawCookie = request.headers.get("cookie") ?? "";
  return rawCookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CAPTCHA_COOKIE}=`))?.slice(CAPTCHA_COOKIE.length + 1) ?? "";
}

export function readCaptcha(request: Request): CaptchaPayload | null {
  const token = decodeURIComponent(captchaTokenFromRequest(request));
  if (!token) return null;
  const [ivEncoded, tagEncoded, encryptedEncoded] = token.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) return null;
  try {
    const key = createHash("sha256").update(secret()).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivEncoded, "base64url"));
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const payload = Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, "base64url")), decipher.final()]);
    return JSON.parse(payload.toString()) as CaptchaPayload;
  } catch {
    return null;
  }
}

export function verifyCaptchaRequest(request: Request, answer: string) {
  if (!answer) return false;
  const parsed = readCaptcha(request);
  if (!parsed) return false;
  return parsed.answer === answer && Number(parsed.exp) > Date.now();
}

export async function verifyAndConsumeCaptcha(request: Request, answer: string) {
  if (!verifyCaptchaRequest(request, answer)) return false;
  const token = captchaTokenFromRequest(request);
  const consumed = await consumeSingleUseToken(token, 600);
  return consumed.allowed;
}
