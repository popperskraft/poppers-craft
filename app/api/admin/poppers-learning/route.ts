import { NextResponse } from "next/server";
import { getAdminUser, sameOriginOrMissing } from "@/lib/waitlist";
import { listSupportTranscripts, reviewSupportTranscript, suggestedKnowledgeAnswer, type KnowledgeStatus } from "@/lib/poppers-learning";

export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "no-store" };
const STATUSES: KnowledgeStatus[] = ["new", "approved", "skipped"];

/* Переписка по обращениям, с которыми Попперс не справился, — только для администраторов. */
export async function GET() {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  }
  try {
    const transcripts = await listSupportTranscripts();
    return NextResponse.json({
      transcripts: transcripts.map((item) => ({ ...item, suggested_answer: suggestedKnowledgeAnswer(item) })),
    }, { headers: PRIVATE });
  } catch (error) {
    console.error("Poppers learning list failed", error);
    return NextResponse.json({ error: "Не удалось загрузить обращения." }, { status: 500, headers: PRIVATE });
  }
}

/* Решение по обращению: добавить ответ в базу знаний, убрать оттуда или пропустить. */
export async function PATCH(request: Request) {
  if (!sameOriginOrMissing(request)) {
    return NextResponse.json({ error: "Запрос отклонён." }, { status: 403, headers: PRIVATE });
  }
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401, headers: PRIVATE });
  }
  const body = await request.json().catch(() => null) as { threadId?: unknown; status?: unknown; question?: unknown; answer?: unknown } | null;
  const threadId = String(body?.threadId ?? "");
  const status = String(body?.status ?? "") as KnowledgeStatus;
  if (!/^[0-9a-f-]{36}$/.test(threadId) || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "Некорректные данные." }, { status: 400, headers: PRIVATE });
  }
  try {
    const transcript = await reviewSupportTranscript(threadId, {
      status,
      question: typeof body?.question === "string" ? body.question : "",
      answer: typeof body?.answer === "string" ? body.answer : "",
      by: String(admin.profile.display_name ?? "администратор"),
    });
    if (!transcript) return NextResponse.json({ error: "Обращение не найдено." }, { status: 404, headers: PRIVATE });
    return NextResponse.json({ transcript: { ...transcript, suggested_answer: suggestedKnowledgeAnswer(transcript) } }, { headers: PRIVATE });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Заполните") ? error.message : "Не удалось сохранить решение.";
    if (message === "Не удалось сохранить решение.") console.error("Poppers learning review failed", error);
    return NextResponse.json({ error: message }, { status: message === "Не удалось сохранить решение." ? 500 : 400, headers: PRIVATE });
  }
}
