import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/lib/i18n/config";
import { getViewerIdentity, sameOriginOrMissing } from "@/lib/waitlist";

/* Смена языка интерфейса — с главной (и до входа) или из настроек профиля.
   Язык записывается в cookie (его читает сервер при каждой загрузке), а у
   вошедшего ещё и в профиль, чтобы на новом устройстве после входа сайт
   сразу открылся на нужном языке. */
export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const language = body?.language as Locale;
  if (!LOCALES.includes(language)) return NextResponse.json({ error: "Некорректное значение." }, { status: 400 });

  const viewer = await getViewerIdentity().catch(() => null);
  if (viewer && !viewer.needsMfa) {
    const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(viewer.user.id, {
      user_metadata: { ...(viewer.user.user_metadata ?? {}), language },
    });
    if (error) console.error("Language preference was not saved to the profile", error.message);
  }

  const response = NextResponse.json({ ok: true, language });
  response.cookies.set(LOCALE_COOKIE, language, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
