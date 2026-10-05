-- r096: фанкопопы (просьба владельца, 2026-10-03). Три фигурки — Степан,
-- Платон и Томас; каждая существует в одном экземпляре. При выдаче выпадает
-- случайная из ещё свободных, Томас — самый редкий (вес 10 против 45).
-- Получают их за трудные задания в игре; сайт хранит, у кого какая фигурка,
-- и показывает раздел «Фигурки» в профиле только тем, у кого она есть.

create table if not exists public.pc_funko_figures (
  figure text primary key check (figure in ('step', 'platon', 'tomac')),
  number smallint not null unique,
  title text not null,
  rarity_weight smallint not null check (rarity_weight > 0),
  owner_id uuid references auth.users (id) on delete set null,
  owner_login text,
  awarded_at timestamptz,
  awarded_by text
);

insert into public.pc_funko_figures (figure, number, title, rarity_weight) values
  ('step', 1, 'Степан', 45),
  ('platon', 2, 'Платон', 45),
  ('tomac', 3, 'Томас', 10)
on conflict (figure) do nothing;

alter table public.pc_funko_figures enable row level security;
revoke all on public.pc_funko_figures from anon, authenticated;
grant select, update on public.pc_funko_figures to service_role;

-- Выдать фигурку: p_figure — конкретную (если свободна), null — случайную из
-- свободных с учётом редкости. Возвращает id фигурки или 'none-left' /
-- 'taken' / 'unknown'.
create or replace function public.pc_funko_award(p_user uuid, p_login text, p_by text, p_figure text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  picked text;
begin
  perform pg_advisory_xact_lock(hashtext('pc_funko_figures'));
  if p_figure is not null then
    select figure into picked from public.pc_funko_figures where figure = p_figure for update;
    if not found then
      return 'unknown';
    end if;
    if exists (select 1 from public.pc_funko_figures where figure = p_figure and owner_id is not null) then
      return 'taken';
    end if;
  else
    -- Взвешенный случайный выбор: меньше -ln(random)/вес — тем вероятнее.
    select figure into picked from public.pc_funko_figures
      where owner_id is null
      order by -ln(1 - random()) / rarity_weight
      limit 1
      for update;
    if picked is null then
      return 'none-left';
    end if;
  end if;
  update public.pc_funko_figures
    set owner_id = p_user, owner_login = left(p_login, 32), awarded_at = now(), awarded_by = left(coalesce(p_by, ''), 60)
    where figure = picked;
  return picked;
end;
$function$;

-- Забрать фигурку (ошибочная выдача): она снова становится свободной.
create or replace function public.pc_funko_revoke(p_figure text, p_by text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('pc_funko_figures'));
  update public.pc_funko_figures
    set owner_id = null, owner_login = null, awarded_at = null, awarded_by = left(coalesce(p_by, ''), 60)
    where figure = p_figure and owner_id is not null;
  if not found then
    return 'not-owned';
  end if;
  return 'revoked';
end;
$function$;

revoke all on function public.pc_funko_award(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.pc_funko_revoke(text, text) from public, anon, authenticated;
grant execute on function public.pc_funko_award(uuid, text, text, text) to service_role;
grant execute on function public.pc_funko_revoke(text, text) to service_role;
