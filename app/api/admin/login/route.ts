import { NextResponse } from "next/server";
import {
  isAllowedAdminEmail,
  sameOriginOrMissing,
} from "@/lib/waitlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CAPTCHA_COOKIE, verifyAndConsumeCaptcha } from "@/lib/captcha";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
    return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
  }

  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const clientLimit = await consumeRateLimit(request, { scope: "admin-login-client", limit: 20, windowSeconds: 15 * 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много попыток входа. Подождите немного.");
  if (!(await verifyAndConsumeCaptcha(request, String(body?.captchaAnswer ?? "")))) {
    const response = NextResponse.json({ error: "Капча не пройдена или уже использована. Выберите новый блок." }, { status: 400 });
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  const [accountLimit, globalLimit] = await Promise.all([
    consumeRateLimit(request, { scope: "admin-login-account", key: email || "empty", limit: 6, windowSeconds: 15 * 60 }),
    consumeRateLimit(request, { scope: "admin-login-global", key: "global", limit: 200, windowSeconds: 60 * 60 }),
  ]);
  if (!accountLimit.allowed) return rateLimitResponse(accountLimit, "Слишком много попыток входа в этот аккаунт. Подождите немного.");
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Вход администраторов временно занят. Попробуйте позже.");
  /* Не подсказываем, есть ли такая почта среди администраторов: ответ тот же,
     что и при неверном пароле. */
  if (!email || !(await isAllowedAdminEmail(email))) {
    const response = NextResponse.json({ error: "Неверная почта или пароль." }, { status: 401 });
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  if (password.length < 8 || password.length > 128) {
    return NextResponse.json(
      { error: "Введите пароль администратора." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const response = NextResponse.json(
      { error: "Неверная почта или пароль." },
      { status: 401 },
    );
    response.cookies.delete(CAPTCHA_COOKIE);
    return response;
  }
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const needsMfa = assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
  return NextResponse.json({
    ok: true,
    redirectTo: needsMfa ? "/mfa?next=%2Fadmin" : "/admin",
  });
}
