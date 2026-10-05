/* Понятное имя устройства по строке браузера (User-Agent) — для списка
   «Активные устройства». Только для показа игроку, не для проверок. */

export type DeviceKind = "launcher" | "phone" | "tablet" | "computer" | "unknown";

function browserName(ua: string) {
  if (/YaBrowser\//.test(ua)) return "Яндекс Браузер";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\/|Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/AppleWebKit\//.test(ua) && /iPhone|iPad/.test(ua)) return "Приложение PoppersCraft";
  return "";
}

export function describeDevice(userAgent: string | null | undefined): { kind: DeviceKind; label: string } {
  const ua = String(userAgent ?? "");
  if (/PoppersCraft-Launcher/i.test(ua)) return { kind: "launcher", label: "Лаунчер PoppersCraft" };
  if (!ua.trim()) return { kind: "unknown", label: "Устройство без данных" };
  const browser = browserName(ua);
  let kind: DeviceKind = "computer";
  let system = "";
  if (/iPad/.test(ua)) { kind = "tablet"; system = "iPad"; }
  else if (/iPhone|iPod/.test(ua)) { kind = "phone"; system = "iPhone"; }
  else if (/Android/.test(ua)) { kind = /Mobile/.test(ua) ? "phone" : "tablet"; system = "Android"; }
  else if (/Windows NT/.test(ua)) system = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) system = "macOS";
  else if (/CrOS/.test(ua)) system = "ChromeOS";
  else if (/Linux/.test(ua)) system = "Linux";
  const label = [browser, system].filter(Boolean).join(" · ");
  return label ? { kind, label } : { kind: "unknown", label: "Неизвестное устройство" };
}
