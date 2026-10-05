import { NextResponse } from "next/server";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revokeAllAiTokens } from "@/lib/ai-connect/oauth";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (
    currentPassword.length < 1 ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    return NextResponse.json(
      { error: "Новый пароль должен содержать от 8 до 128 символов." },
      { status: 400 },
    );
  }
  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "Новый пароль должен отличаться от текущего." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Сначала войдите в аккаунт." }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    current_password: currentPassword,
  });
  if (error) {
    return NextResponse.json(
      { error: "Текущий пароль неверен или новый пароль слишком простой." },
      { status: 400 },
    );
  }

  /* Новый пароль обрывает и подключения нейросетей: если доступ к
     аккаунту был у чужого, его нейросеть тоже теряет доступ. */
  await revokeAllAiTokens(user.id).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    message: "Пароль изменён.",
  });
}
