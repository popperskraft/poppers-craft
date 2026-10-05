-- r097: FANKOPOP в игре. Игрок выполняет задания (серия 180 дней, 300 часов
-- в игре, победа в ивенте) и забирает фигурку командой /fankopop в игре:
-- мод poppersfunko спрашивает сайт, сайт выдаёт случайную свободную фигурку
-- и отмечает, что предмет доставлен. Фигурки, выданные владельцем на сайте,
-- игрок получает той же командой.

alter table public.pc_funko_figures add column if not exists via text check (via in ('tasks', 'admin'));
alter table public.pc_funko_figures add column if not exists delivered_at timestamptz;

-- Победы в официальных ивентах (отмечает владелец на сайте).
create table if not exists public.pc_funko_event_wins (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  login text not null,
  note text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists pc_funko_event_wins_user_idx on public.pc_funko_event_wins (user_id);
alter table public.pc_funko_event_wins enable row level security;
revoke all on public.pc_funko_event_wins from anon, authenticated;
grant select, insert on public.pc_funko_event_wins to service_role;
grant usage, select on sequence public.pc_funko_event_wins_id_seq to service_role;

-- Забрать фигурку в игре. Сначала отдаются уже принадлежащие игроку, но ещё
-- не доставленные фигурки (выданные владельцем). Иначе, если задания
-- выполнены (p_tasks_done — проверяет сайт) и фигурки за задания у игрока ещё
-- не было, выпадает случайная свободная с учётом редкости. Возвращает id
-- фигурок через запятую или 'nothing' / 'none-left' / 'not-ready'.
create or replace function public.pc_funko_claim(p_user uuid, p_login text, p_tasks_done boolean)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  pending text;
  picked text;
begin
  perform pg_advisory_xact_lock(hashtext('pc_funko_figures'));
  select string_agg(figure, ',' order by number) into pending
    from public.pc_funko_figures where owner_id = p_user and delivered_at is null;
  if pending is not null then
    update public.pc_funko_figures set delivered_at = now() where owner_id = p_user and delivered_at is null;
    return pending;
  end if;
  if exists (select 1 from public.pc_funko_figures where owner_id = p_user and via = 'tasks') then
    return 'nothing';
  end if;
  if not p_tasks_done then
    return 'not-ready';
  end if;
  select figure into picked from public.pc_funko_figures
    where owner_id is null
    order by -ln(1 - random()) / rarity_weight
    limit 1
    for update;
  if picked is null then
    return 'none-left';
  end if;
  update public.pc_funko_figures
    set owner_id = p_user, owner_login = left(p_login, 32), awarded_at = now(), awarded_by = 'задания', via = 'tasks', delivered_at = now()
    where figure = picked;
  return picked;
end;
$function$;

-- Выданная владельцем фигурка ещё не доставлена в игру.
create or replace function public.pc_funko_mark_admin(p_figure text)
returns void
language sql
security definer
set search_path to ''
as $function$
  update public.pc_funko_figures set via = 'admin', delivered_at = null where figure = p_figure;
$function$;

-- Повторная выдача предмета (потерян): снова «не доставлена».
create or replace function public.pc_funko_redeliver(p_figure text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.pc_funko_figures set delivered_at = null where figure = p_figure and owner_id is not null;
  if not found then
    return 'not-owned';
  end if;
  return 'ok';
end;
$function$;

revoke all on function public.pc_funko_claim(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.pc_funko_mark_admin(text) from public, anon, authenticated;
revoke all on function public.pc_funko_redeliver(text) from public, anon, authenticated;
grant execute on function public.pc_funko_claim(uuid, text, boolean) to service_role;
grant execute on function public.pc_funko_mark_admin(text) to service_role;
grant execute on function public.pc_funko_redeliver(text) to service_role;

-- Отзыв фигурки сбрасывает и способ, и доставку.
create or replace function public.pc_funko_revoke(p_figure text, p_by text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('pc_funko_figures'));
  update public.pc_funko_figures
    set owner_id = null, owner_login = null, awarded_at = null, awarded_by = left(coalesce(p_by, ''), 60), via = null, delivered_at = null
    where figure = p_figure and owner_id is not null;
  if not found then
    return 'not-owned';
  end if;
  return 'revoked';
end;
$function$;
