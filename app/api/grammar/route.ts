import { NextResponse } from "next/server";
import { sameOriginOrMissing } from "@/lib/waitlist";
import { consumeRateLimit, rateLimitResponse } from "@/lib/request-security";

export const runtime = "nodejs";

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, 4_000);
}

export async function POST(request: Request) {
  if (!sameOriginOrMissing(request)) return NextResponse.json({ error: "Запрос отклонён." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 20 * 1024) return NextResponse.json({ error: "Текст слишком большой." }, { status: 413 });
  const clientLimit = await consumeRateLimit(request, { scope: "grammar-client", limit: 24, windowSeconds: 60 * 60 });
  if (!clientLimit.allowed) return rateLimitResponse(clientLimit, "Слишком много проверок. Попробуйте позже.");

  const body = await request.json().catch(() => null);
  const text = cleanText(body?.text);
  if (text.length < 2) return NextResponse.json({ error: "Текст пустой." }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Проверка текста пока не подключена." }, { status: 503 });
  const globalLimit = await consumeRateLimit(request, {
    scope: "grammar-global",
    key: "global",
    limit: 1_200,
    windowSeconds: 60 * 60,
    cost: Math.max(1, Math.ceil(text.length / 1_000)),
  });
  if (!globalLimit.allowed) return rateLimitResponse(globalLimit, "Проверка текста временно занята. Попробуйте позже.");

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const instruction = `Исправь только орфографию, пунктуацию, опечатки и явные грамматические ошибки в тексте ниже. Сохрани язык оригинала: русский текст остаётся русским, английский — английским. Не меняй смысл, факты, имена, ссылки, сленг, тон автора и деление на абзацы. Не дописывай новые мысли. Верни только исправленный текст без кавычек, пояснений и Markdown.\n\n<text>\n${text}\n</text>`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 3_000 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const result = await response.json();
    const answer = result?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    if (!response.ok || !answer) return NextResponse.json({ error: "Gemini не ответил." }, { status: 502 });
    const corrected = answer.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/, "").trim().slice(0, 6_000);
    return NextResponse.json({ text: corrected });
  } catch {
    return NextResponse.json({ error: "Не удалось проверить текст. Попробуйте позже." }, { status: 502 });
  }
}
