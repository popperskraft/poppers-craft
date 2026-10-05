import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AgreementAcceptance } from "@/lib/user-agreement";

export type { AgreementAcceptance };

/* Хранение факта принятия пользовательского соглашения.

   Записи лежат в site_updates с ключом __agreement:<идентификатор пользователя>.
   Такой ключ выбран не случайно: listSiteUpdates отбрасывает всё, что
   начинается с двух подчёркиваний, поэтому согласия не попадают в публичную
   ленту обновлений, а уникальность source_key гарантирует ровно одну запись
   на пользователя.

   Согласие — юридически значимый факт, поэтому оно хранится на сервере, а не
   в браузере: localStorage чистится, подделывается и не переживает смену
   устройства. Запись содержит версию текста, дату и, для разбора спорных
   ситуаций, IP и user-agent на момент принятия. */

const AGREEMENT_PREFIX = "__agreement:";

type StoredPayload = {
  version: string;
  acceptedAt: string;
  login: string;
  ip: string;
  userAgent: string;
};

function sourceKey(userId: string) {
  return `${AGREEMENT_PREFIX}${userId}`;
}

function parsePayload(body: string | null | undefined): StoredPayload | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Partial<StoredPayload>;
    if (typeof parsed.version !== "string" || typeof parsed.acceptedAt !== "string") return null;
    return {
      version: parsed.version,
      acceptedAt: parsed.acceptedAt,
      login: typeof parsed.login === "string" ? parsed.login : "",
      ip: typeof parsed.ip === "string" ? parsed.ip : "",
      userAgent: typeof parsed.userAgent === "string" ? parsed.userAgent : "",
    };
  } catch {
    return null;
  }
}

/* Возвращает версию соглашения, принятую пользователем, или null. */
export async function getAcceptedAgreementVersion(userId: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("body")
    .eq("source_key", sourceKey(userId))
    .maybeSingle();
  if (error || !data) return null;
  return parsePayload(data.body as string)?.version ?? null;
}

export async function recordAgreementAcceptance(input: {
  userId: string;
  login: string;
  version: string;
  ip: string;
  userAgent: string;
}) {
  const payload: StoredPayload = {
    version: input.version,
    acceptedAt: new Date().toISOString(),
    login: input.login.slice(0, 40),
    ip: input.ip.slice(0, 60),
    /* Поле body ограничено 1200 символами, а user-agent бывает длинным. */
    userAgent: input.userAgent.slice(0, 300),
  };
  const { error } = await createSupabaseAdminClient()
    .from("site_updates")
    .upsert({
      source_key: sourceKey(input.userId),
      badge: "СОГЛАСИЕ",
      title: `Соглашение принял ${payload.login || input.userId}`.slice(0, 120),
      body: JSON.stringify(payload),
      color: "lime",
      /* Служебная запись: в публичной ленте её быть не должно. */
      published: false,
      updated_at: payload.acceptedAt,
    }, { onConflict: "source_key" });
  if (error) throw error;
  return payload;
}

/* Список согласий для админки, свежие сверху. */
export async function listAgreementAcceptances(): Promise<AgreementAcceptance[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("site_updates")
    .select("source_key,body,updated_at")
    .like("source_key", `${AGREEMENT_PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(1_000);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const payload = parsePayload(row.body as string);
    if (!payload) return [];
    return [{
      userId: String(row.source_key).slice(AGREEMENT_PREFIX.length),
      login: payload.login,
      version: payload.version,
      acceptedAt: payload.acceptedAt,
      ip: payload.ip,
      userAgent: payload.userAgent,
    }];
  });
}
