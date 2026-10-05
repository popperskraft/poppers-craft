import { consumeRateLimit } from "@/lib/request-security";
import { notifySupportAdmins } from "@/lib/support-bridge";

/* Когда Попперс не может ответить (кончились токены Gemini, не принят ключ,
   сбой у Google), человека сразу передают оператору, а владельцу приходит
   сообщение в бота (просьба владельца, 2026-10-03). */

/* Причина по коду ошибки из lib/poppers-knowledge.ts (callGemini). Другие
   ошибки (например, Telegram не принял сообщение) — не сбой ИИ: null. */
export function poppersOutageReason(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (!code.startsWith("gemini-")) return null;
  if (code === "gemini-429") return { key: "quota", text: "закончились токены — квота или лимит запросов Gemini исчерпаны (ошибка 429)" };
  if (code === "gemini-key-missing") return { key: "key", text: "на сервере не задан ключ Gemini (GEMINI_API_KEY)" };
  if (code === "gemini-400" || code === "gemini-401" || code === "gemini-403") {
    return { key: "key", text: `Gemini не принимает запросы (ошибка ${code.slice("gemini-".length)}) — проверьте ключ и оплату в Google AI Studio` };
  }
  return { key: "down", text: "Gemini не отвечает — сбой у Google или сети" };
}

/* Сообщение владельцу — не чаще раза в 30 минут на одну причину, чтобы долгий
   сбой не засыпал бота уведомлениями. Ошибка отправки ничего не ломает. */
export async function reportPoppersOutage(error: unknown, where: string) {
  const reason = poppersOutageReason(error);
  if (!reason) return;
  try {
    const limit = await consumeRateLimit(new Request("https://popperscraft.local/poppers-outage"), {
      scope: "poppers-outage-alert",
      key: reason.key,
      limit: 1,
      windowSeconds: 30 * 60,
    });
    if (!limit.allowed) return;
    await notifySupportAdmins([
      "⚠️ ПОППЕРС НЕ ОТВЕЧАЕТ",
      "",
      `Причина: ${reason.text}.`,
      `Где заметили: ${where}.`,
      "",
      "Пока ИИ недоступен, вопросы сразу уходят операторам в поддержку. Следующее такое сообщение — не раньше чем через 30 минут.",
    ].join("\n"));
  } catch (caught) {
    console.error("Poppers outage alert failed", caught instanceof Error ? caught.message : "unknown");
  }
}
