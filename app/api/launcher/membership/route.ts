import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidLogin, normalizeLogin } from "@/lib/waitlist";
import { hasServerAccess } from "@/lib/payments";
import { plusState } from "@/lib/plus-perks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  const supplied = request.headers.get("x-popperscraft-browser-key") ?? "";
  if (!safeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const login = normalizeLogin(String(body?.login ?? ""));
  if (!isValidLogin(login)) {
    return NextResponse.json({ error: "Invalid login" }, { status: 400 });
  }
  const { data, error } = await createSupabaseAdminClient()
    .from("waitlist_applications")
    .select("user_id")
    .eq("login", login)
    .eq("status", "approved")
    .eq("is_banned", false)
    .eq("is_deleted", false)
    .limit(1);
  if (error) {
    return NextResponse.json({ error: "Membership lookup failed" }, { status: 503 });
  }
  const userId = data?.[0]?.user_id ? String(data[0].user_id) : "";
  /* Доступ к серверу: одобренная анкета и пропуск, если владелец его требует. */
  const approved = Boolean(userId) && await hasServerAccess(userId);
  /* Тариф подписки для игровой стороны: своя пластинка без подписки и с PLUS —
     одна в неделю, у HYPE — одна каждый день (с 2026-10-04); пони — только у HYPE. null — подписки нет.
     Сбой чтения не мешает входу. */
  const subscription = approved
    ? await plusState(userId).then((state) => (state.active ? state.tier : null)).catch(() => null)
    : null;
  return NextResponse.json(
    { approved, subscription },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

function safeEqual(expected: string, supplied: string) {
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
