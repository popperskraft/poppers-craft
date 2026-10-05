import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { describeDevice, type DeviceKind } from "@/lib/device-label";

/* Активные устройства (Профиль → Настройки). Supabase видит все входы как
   «node» с адреса сервера — вход идёт через сайт, — поэтому браузер,
   систему и адрес игрока сайт запоминает сам (pc_session_devices): при
   входе по паролю (/api/login, сюда же приходит лаунчер) и при первом
   открытии страницы в новой сессии (app/layout.tsx). Время активности
   обновляется не чаще раза в 15 минут — лимиты Supabase. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOUCH_MS = 15 * 60_000;
const touched = new Map<string, number>();

/* Номер сессии из access-токена (поле session_id). Подпись здесь не
   проверяется: вход уже проверил getUser, а владельца сверяем по sub. */
export function sessionIdFromAccessToken(token: string | null | undefined, userId?: string) {
  const payload = String(token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { session_id?: unknown; sub?: unknown };
    if (userId && claims.sub !== userId) return null;
    return typeof claims.session_id === "string" && UUID.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

export async function currentSessionId(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  return sessionIdFromAccessToken(data.session?.access_token, userId);
}

export async function rememberDevice(device: { sessionId: string | null; userId: string; userAgent: string; ip: string }) {
  if (!device.sessionId || !UUID.test(device.sessionId)) return;
  const last = touched.get(device.sessionId);
  if (last && Date.now() - last < TOUCH_MS) return;
  if (touched.size > 5_000) touched.clear();
  touched.set(device.sessionId, Date.now());
  const { error } = await createSupabaseAdminClient().from("pc_session_devices").upsert({
    session_id: device.sessionId,
    user_id: device.userId,
    user_agent: device.userAgent.slice(0, 400),
    ip: device.ip === "unknown" ? "" : device.ip.slice(0, 64),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "session_id" });
  if (error) touched.delete(device.sessionId);
}

export type ActiveDevice = {
  id: string;
  current: boolean;
  kind: DeviceKind;
  label: string;
  ip: string;
  signedInAt: string;
  lastActiveAt: string;
};

export async function listDevices(userId: string, currentId: string | null): Promise<ActiveDevice[]> {
  const { data, error } = await createSupabaseAdminClient().rpc("pc_list_sessions", { p_user: userId });
  if (error) throw new Error("Не удалось загрузить устройства.");
  return ((data ?? []) as Array<{ id: string; created_at: string; refreshed_at: string | null; user_agent: string; ip: string; last_seen_at: string | null }>)
    .map((row) => {
      const device = describeDevice(row.user_agent);
      const times = [row.created_at, row.refreshed_at, row.last_seen_at].filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))));
      return {
        id: row.id,
        current: row.id === currentId,
        kind: device.kind,
        label: device.label,
        /* Адрес лаунчера — это адрес нашего сервера, игроку он ничего не скажет. */
        ip: device.kind === "launcher" ? "" : row.ip,
        signedInAt: row.created_at,
        lastActiveAt: times.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? row.created_at,
      };
    })
    .sort((left, right) => Number(right.current) - Number(left.current) || Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
}

/* Завершает сессии игрока, кроме текущей: из этого браузера выходят кнопкой «Выйти». */
export async function endSessions(userId: string, sessionIds: string[], currentId: string | null) {
  const ids = [...new Set(sessionIds)].filter((id) => UUID.test(id) && id !== currentId);
  if (!ids.length) return 0;
  const { data, error } = await createSupabaseAdminClient().rpc("pc_end_sessions", { p_user: userId, p_sessions: ids });
  if (error) throw new Error("Не удалось завершить сеанс.");
  for (const id of ids) touched.delete(id);
  return Number(data) || 0;
}
