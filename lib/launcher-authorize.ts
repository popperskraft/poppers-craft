import "server-only";

/* Подтверждение входа в лаунчер через сайт. Лаунчер открывает страницу
   /launcher/authorize с номером запроса и кодом; сайт передаёт решение
   сервису авторизации (api.popperscraft.org), а лаунчер его ждёт. */

export function validLauncherToken(value: string) {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

export async function approveLauncher(payload: {
  requestId: string;
  approvalToken: string;
  approved: boolean;
  login?: string;
}) {
  const secret = process.env.POPPERSCRAFT_BROWSER_SECRET ?? "";
  if (secret.length < 32) return { ok: false as const, error: "Вход через сайт пока не настроен." };
  try {
    const response = await fetch("https://api.popperscraft.org/api/launcher/browser/approve", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-PoppersCraft-Browser-Key": secret,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    return response.ok
      ? { ok: true as const, error: "" }
      : { ok: false as const, error: data.error ?? "Сервис авторизации временно недоступен." };
  } catch {
    return { ok: false as const, error: "Сервис авторизации временно недоступен." };
  }
}
