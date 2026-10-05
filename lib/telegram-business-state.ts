import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type TelegramAutoReplyState = {
  enabled: boolean;
  connectionId: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

function sourceKey(chatId: number) {
  return `__telegram_autoreply:${chatId}`;
}

export async function getTelegramAutoReplyState(chatId: number): Promise<TelegramAutoReplyState> {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("body,updated_at")
    .eq("source_key", sourceKey(chatId))
    .maybeSingle();
  if (error || !data) return { enabled: true, connectionId: null, updatedAt: null, updatedBy: null };
  try {
    const parsed = JSON.parse(data.body) as Partial<TelegramAutoReplyState>;
    return {
      enabled: parsed.enabled !== false,
      connectionId: typeof parsed.connectionId === "string" ? parsed.connectionId : null,
      updatedAt: data.updated_at ?? null,
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : null,
    };
  } catch {
    return { enabled: true, connectionId: null, updatedAt: data.updated_at ?? null, updatedBy: null };
  }
}

export async function setTelegramAutoReplyState(chatId: number, enabled: boolean, connectionId: string | null, updatedBy: string) {
  const updatedAt = new Date().toISOString();
  const state: TelegramAutoReplyState = {
    enabled,
    connectionId: connectionId?.slice(0, 200) || null,
    updatedAt,
    updatedBy: updatedBy.slice(0, 100),
  };
  const { error } = await createSupabaseAdminClient().from("site_updates").upsert({
    source_key: sourceKey(chatId),
    badge: "TELEGRAM",
    title: "Telegram auto reply",
    body: JSON.stringify(state),
    color: "yellow",
    published: false,
    updated_at: updatedAt,
  }, { onConflict: "source_key" });
  if (error) throw error;
  return state;
}
