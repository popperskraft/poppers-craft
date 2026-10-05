import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFunkoFigure as isFigure, type FunkoFigureId, type OwnedFunko } from "@/lib/funko-meta";
import { getPlayerStreak } from "@/lib/player-streak";
import { getPlayerGameStats } from "@/lib/minecraft-stats";

/* Фанкопопы (просьба владельца, 2026-10-03): фигурки Степана, Платона и
   Томаса, каждая в одном экземпляре. Выдаются за трудные задания в игре
   (игровой мод вызывает /api/game/funko) или владельцем вручную в
   «Управление → FANKOPOP». Случайная выдача — из ещё свободных, Томас
   самый редкий (веса в таблице pc_funko_figures). */

export type FunkoFigure = {
  figure: FunkoFigureId;
  number: number;
  title: string;
  rarityWeight: number;
  ownerId: string | null;
  ownerLogin: string | null;
  awardedAt: string | null;
  deliveredAt: string | null;
};

type Row = { figure: string; number: number; title: string; rarity_weight: number; owner_id: string | null; owner_login: string | null; awarded_at: string | null; delivered_at?: string | null };

function toFigure(row: Row): FunkoFigure | null {
  if (!isFigure(row.figure)) return null;
  return { figure: row.figure, number: Number(row.number), title: row.title, rarityWeight: Number(row.rarity_weight), ownerId: row.owner_id, ownerLogin: row.owner_login, awardedAt: row.awarded_at, deliveredAt: row.delivered_at ?? null };
}

export async function listFunko(): Promise<FunkoFigure[]> {
  const { data, error } = await createSupabaseAdminClient().from("pc_funko_figures").select("*").order("number");
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toFigure).filter((item): item is FunkoFigure => Boolean(item));
}

/* Фигурки игрока. Сбой чтения не ломает профиль — раздел просто не покажется. */
export async function funkoOf(userId: string): Promise<OwnedFunko[]> {
  try {
    const { data, error } = await createSupabaseAdminClient().from("pc_funko_figures").select("*").eq("owner_id", userId).order("number");
    if (error) throw error;
    return ((data ?? []) as Row[]).map(toFigure).filter((item): item is FunkoFigure => Boolean(item))
      .map(({ figure, number, title, awardedAt }) => ({ figure, number, title, awardedAt }));
  } catch (error) {
    console.error("Funko lookup failed", error instanceof Error ? error.message : error);
    return [];
  }
}

export class FunkoError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/* Выдать фигурку игроку: конкретную (figure) или случайную из свободных. */
export async function awardFunko(login: string, by: string, figure: FunkoFigureId | null = null) {
  const admin = createSupabaseAdminClient();
  const { data: player, error } = await admin.from("waitlist_applications")
    .select("user_id,login")
    .eq("login", login.trim().toLowerCase().replace(/^@/, ""))
    .eq("status", "approved")
    .eq("is_deleted", false)
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!player?.user_id) throw new FunkoError("Такого игрока на сервере нет.", 404);
  const { data, error: awardError } = await admin.rpc("pc_funko_award", { p_user: player.user_id, p_login: player.login, p_by: by.slice(0, 60), p_figure: figure });
  if (awardError) throw awardError;
  const result = String(data);
  if (result === "none-left") throw new FunkoError("Все фигурки уже разобраны — каждая существует в одном экземпляре.", 409);
  if (result === "taken") throw new FunkoError("Эта фигурка уже у другого игрока.", 409);
  if (result === "unknown") throw new FunkoError("Такой фигурки нет.", 404);
  if (!isFigure(result)) throw new Error(`funko-award-${result}`);
  /* Выданную на сайте фигурку игрок забирает предметом в игре (/fankopop). */
  const { error: markError } = await admin.rpc("pc_funko_mark_admin", { p_figure: result });
  if (markError) throw markError;
  return { figure: result, login: String(player.login) };
}

/* ---- задания FANKOPOP (решение владельца 2026-10-03) ----------------------
   Фигурку за задания получают один раз: нужно выполнить все три. Серия
   засчитывается лучшая (раз набрал 180 дней — задание выполнено). */
export const FUNKO_TASKS = [
  { id: "streak", title: "Полгода на сервере", detail: "заходить каждый день 180 дней подряд", target: 180, unit: "дн." },
  { id: "playtime", title: "Ветеран", detail: "наиграть 300 часов", target: 300, unit: "ч" },
  { id: "event", title: "Чемпион ивента", detail: "выиграть официальный ивент сервера", target: 1, unit: "" },
] as const;

export type FunkoTaskProgress = { id: string; title: string; detail: string; current: number; target: number; unit: string; done: boolean };

async function approvedPlayer(login: string) {
  const { data, error } = await createSupabaseAdminClient().from("waitlist_applications")
    .select("user_id,login")
    .eq("login", login.trim().toLowerCase().replace(/^@/, ""))
    .eq("status", "approved")
    .eq("is_deleted", false)
    .eq("is_banned", false)
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) throw new FunkoError("Такого игрока на сервере нет.", 404);
  return { userId: String(data.user_id), login: String(data.login) };
}

export async function funkoProgress(login: string) {
  const player = await approvedPlayer(login);
  const admin = createSupabaseAdminClient();
  const [streak, stats, wins, figures] = await Promise.all([
    getPlayerStreak(player.login).catch(() => null),
    getPlayerGameStats(player.login).catch(() => null),
    admin.from("pc_funko_event_wins").select("id", { count: "exact", head: true }).eq("user_id", player.userId),
    listFunko(),
  ]);
  if (wins.error) throw wins.error;
  const streakDone = (streak?.bestDays ?? 0) >= FUNKO_TASKS[0].target;
  const values = {
    streak: streakDone ? FUNKO_TASKS[0].target : Math.min(streak?.currentDays ?? 0, FUNKO_TASKS[0].target),
    playtime: Math.min(Math.floor((stats?.playMinutes ?? 0) / 60), FUNKO_TASKS[1].target),
    event: Math.min(wins.count ?? 0, FUNKO_TASKS[2].target),
  } as Record<string, number>;
  const tasks: FunkoTaskProgress[] = FUNKO_TASKS.map((task) => ({ ...task, current: values[task.id], done: values[task.id] >= task.target }));
  const owned = figures.filter((item) => item.ownerId === player.userId);
  return {
    login: player.login,
    userId: player.userId,
    tasks,
    tasksDone: tasks.every((task) => task.done),
    /* Данные о стрике и часах временно недоступны — задания не засчитываем. */
    dataReady: Boolean(streak) && Boolean(stats),
    owned: owned.map((item) => ({ figure: item.figure, title: item.title, delivered: Boolean(item.deliveredAt) })),
    free: figures.filter((item) => !item.ownerId).map((item) => ({ figure: item.figure, title: item.title, chance: item.rarityWeight })),
  };
}

/* Забрать фигурку в игре: доставляются выданные владельцем, иначе — случайная
   за выполненные задания. Возвращает фигурки, которые мод должен выдать. */
export async function claimFunko(login: string) {
  const progress = await funkoProgress(login);
  const { data, error } = await createSupabaseAdminClient().rpc("pc_funko_claim", { p_user: progress.userId, p_login: progress.login, p_tasks_done: progress.tasksDone });
  if (error) throw error;
  const result = String(data);
  if (result === "not-ready") throw new FunkoError("Сначала выполните все задания FANKOPOP.", 409);
  if (result === "none-left") throw new FunkoError("Все фигурки уже разобраны — каждая существует в одном экземпляре.", 409);
  if (result === "nothing") return { login: progress.login, figures: [] as FunkoFigureId[] };
  const figures = result.split(",").filter(isFigure);
  return { login: progress.login, figures };
}

/* Победа в официальном ивенте — отмечает владелец. */
export async function addEventWin(login: string, note: string, by: string) {
  const player = await approvedPlayer(login);
  const { error } = await createSupabaseAdminClient().from("pc_funko_event_wins").insert({ user_id: player.userId, login: player.login, note: note.slice(0, 200) || null, created_by: by.slice(0, 60) });
  if (error) throw error;
  return { login: player.login };
}

export async function listEventWins() {
  const { data, error } = await createSupabaseAdminClient().from("pc_funko_event_wins").select("id,login,note,created_at,created_by").order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as Array<{ id: number; login: string; note: string | null; created_at: string; created_by: string | null }>;
}

/* Предмет потерян — выдать в игре заново (той же командой /fankopop). */
export async function redeliverFunko(figure: FunkoFigureId) {
  const { data, error } = await createSupabaseAdminClient().rpc("pc_funko_redeliver", { p_figure: figure });
  if (error) throw error;
  if (String(data) === "not-owned") throw new FunkoError("Эта фигурка ещё ни у кого не лежит.", 409);
}

export async function revokeFunko(figure: FunkoFigureId, by: string) {
  const { data, error } = await createSupabaseAdminClient().rpc("pc_funko_revoke", { p_figure: figure, p_by: by.slice(0, 60) });
  if (error) throw error;
  if (String(data) === "not-owned") throw new FunkoError("Эта фигурка ещё ни у кого не лежит.", 409);
}

export { isFigure as isFunkoFigure };
export type { FunkoFigureId, OwnedFunko };
