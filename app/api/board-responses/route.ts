import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { decodeSiteBoard, getApprovedMember, getViewerIdentity, sameOriginOrMissing, type SiteBoardData } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) return NextResponse.json({ error: "Ответ слишком большой." }, { status: 413 });
  const limit = await consumeRateLimit(request, { scope: "board-response", limit: 12, windowSeconds: 60 * 60 });
  if (!limit.allowed) return rateLimitResponse(limit, "Слишком много ответов. Попробуйте позже.");
  const input = await request.json().catch(() => null);
  if (input?.website) return NextResponse.json({ message: "Ответ отправлен." });
  const boardId = Number(input?.boardId);
  if (!Number.isSafeInteger(boardId)) return NextResponse.json({ error: "Блок не найден." }, { status: 400 });
  const database = createSupabaseAdminClient();
  const { data: row } = await database.from("site_updates").select("body,published,source_key").eq("id", boardId).maybeSingle();
  if (!row?.source_key?.startsWith("board:")) return NextResponse.json({ error: "Блок не найден." }, { status: 404 });
  let board: SiteBoardData;
  try { board = decodeSiteBoard(row.body); } catch { return NextResponse.json({ error: "Анкета повреждена." }, { status: 400 }); }
  const isLive = row.published || (board.status === "scheduled" && Boolean(board.publishAt) && Date.parse(String(board.publishAt)) <= Date.now());
  if (!isLive || !board.blocks.some((block) => block.type === "field")) return NextResponse.json({ error: "Эта анкета сейчас закрыта." }, { status: 403 });
  const viewer = await getViewerIdentity();
  const audience = !viewer ? "guests" : viewer.adminProfile ? "admins" : (await getApprovedMember()) ? "members" : "guests";
  if (board.audience && board.audience !== "everyone" && board.audience !== audience) return NextResponse.json({ error: "Эта анкета не для вашего аккаунта." }, { status: 403 });
  const answersInput = input?.answers && typeof input.answers === "object" ? input.answers as Record<string, unknown> : {};
  const answers: Record<string, string> = {};
  for (const field of board.blocks.filter((block) => block.type === "field")) {
    const answer = String(answersInput[field.id] ?? "").trim().slice(0, 500);
    if (field.required && !answer) return NextResponse.json({ error: `Заполните поле «${field.text}».` }, { status: 400 });
    answers[field.text] = answer;
  }
  const stored = JSON.stringify({ answers, submittedBy: viewer?.user.email ?? "Гость" });
  if (stored.length > 1200) return NextResponse.json({ error: "Ответ получился слишком длинным." }, { status: 400 });
  const globalLimit = await consumeRateLimit(request, { scope: "board-response-global", key: "global", limit: 500, windowSeconds: 24 * 60 * 60 });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Приём ответов временно занят. Попробуйте позже.");
  const { error } = await database.from("site_updates").insert({ source_key: `__board_response:${boardId}:${crypto.randomUUID()}`, badge: "FORM", title: `Ответ на блок ${boardId}`, body: stored, color: "cyan", published: false });
  if (error) return NextResponse.json({ error: "Не получилось сохранить ответ." }, { status: 500 });
  return NextResponse.json({ message: "Готово. Ответ отправлен." });
}
