import "server-only";
import type { SkinWardrobe, SkinSlot } from "./character-models";

/* Профиль модели (пони или человек) хранится не у нас, а в сервисе моделей на
   api.popperscraft.org — тот же сервис, с которым работает редактор. Здесь
   только доступ к нему по ключу, чтобы сохранённые образы можно было надевать
   со страницы профиля. */

export type ModelServiceProfile = {
  login: string;
  mode: "human" | "pony";
  race?: string;
  size?: string;
  revision: number;
  hasPony?: boolean;
  wardrobe?: SkinWardrobe;
  slot?: SkinSlot;
  pixelsBase64?: string;
};

export class ModelServiceError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function callModelService(
  login: string,
  data: Record<string, unknown> = {},
  options: { timeoutMs?: number } = {},
): Promise<ModelServiceProfile> {
  const key = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  if (key.length < 32) throw new ModelServiceError("Работа с моделями пока недоступна.", 503);

  let response: Response;
  try {
    response = await fetch("https://api.popperscraft.org/api/models/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PoppersCraft-Browser-Key": key },
      body: JSON.stringify({ ...data, login: login.toLowerCase() }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch {
    throw new ModelServiceError("Не удалось связаться с сервером моделей. Попробуйте позже.", 503);
  }

  const payload = await response.json().catch(() => null) as (ModelServiceProfile & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new ModelServiceError(payload?.error || "Сервер моделей ответил ошибкой.", response.status || 502);
  }
  return payload;
}
