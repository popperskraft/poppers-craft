import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/waitlist";
import { listSupportTranscripts, transcriptsToText } from "@/lib/poppers-learning";

export const dynamic = "force-dynamic";

/* Текстовый файл для работы над инструкциями Попперса:
   ?kind=all — вся переписка, ?kind=knowledge — только база знаний. */
export async function GET(request: Request) {
  if (!(await getAdminUser())) {
    return NextResponse.json({ error: "Требуется вход администратора." }, { status: 401 });
  }
  const kind = new URL(request.url).searchParams.get("kind") === "knowledge" ? "knowledge" : "all";
  try {
    const text = transcriptsToText(await listSupportTranscripts(1_000), kind);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(`﻿${text}\n`, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="poppers-${kind === "knowledge" ? "knowledge" : "support"}-${date}.txt"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Poppers learning export failed", error);
    return NextResponse.json({ error: "Не удалось выгрузить файл." }, { status: 500 });
  }
}
