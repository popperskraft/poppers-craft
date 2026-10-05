-- r095: «Первые 10» больше не получают пропуск автоматически (решение
-- владельца 2026-10-03: «до того как играть, он должен оплатить по-любому»).
-- Место в первой десятке по-прежнему занимается само в момент одобрения —
-- голосованием или кнопкой «Сделать игроком сейчас», — а бесплатный пропуск
-- владелец дарит сам, не больше чем троим из десятки (pc_set_founder_pass).
-- Уже выданные пропуска остаются и входят в эти три.

create or replace function public.pc_sync_founders()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  taken integer;
  added integer := 0;
  slot integer;
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('pc_early_players'));
  select count(*) into taken from public.pc_early_players where kind = 'founder' and released_at is null;
  if taken >= 10 then
    return 0;
  end if;
  for r in
    select w.user_id, w.login, coalesce(w.reviewed_at, w.created_at) as approved_at
    from public.waitlist_applications w
    where w.status = 'approved'
      and not w.is_deleted
      and not w.is_banned
      and w.user_id is not null
      and not exists (select 1 from public.pc_early_players e where e.user_id = w.user_id)
      and not exists (
        select 1 from public.admin_profiles a
        where a.user_id = w.user_id and a.role = 'owner' and a.active
      )
      and not exists (
        select 1 from public.pc_access_passes p
        where p.user_id = w.user_id and p.source = 'payment'
      )
    order by coalesce(w.reviewed_at, w.created_at), w.id
    limit 10 - taken
  loop
    select min(s) into slot from generate_series(1, 10) s
      where not exists (
        select 1 from public.pc_early_players e
        where e.kind = 'founder' and e.position = s and e.released_at is null
      );
    exit when slot is null;
    -- Только место в списке: пропуск игрок оплачивает сам или получает в подарок.
    insert into public.pc_early_players (user_id, login, kind, position, approved_at)
    values (r.user_id, r.login, 'founder', slot, r.approved_at);
    added := added + 1;
  end loop;
  return added;
end;
$function$;

-- Подарить (p_grant = true) или забрать бесплатный пропуск у игрока первой
-- десятки. Подарков не больше трёх среди занятых мест; забрать можно только
-- подаренный здесь пропуск (source = 'founder'), оплаченный не трогаем.
create or replace function public.pc_set_founder_pass(p_user uuid, p_grant boolean, p_by text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  e public.pc_early_players%rowtype;
  current_source text;
  player_login text;
  gifted integer;
begin
  perform pg_advisory_xact_lock(hashtext('pc_early_players'));
  select * into e from public.pc_early_players where user_id = p_user for update;
  if not found or e.released_at is not null or e.kind <> 'founder' then
    return 'not-eligible';
  end if;
  select source into current_source from public.pc_access_passes where user_id = p_user for update;
  if p_grant then
    if current_source is not null then
      return case when current_source = 'founder' then 'already' else 'has-pass' end;
    end if;
    select w.login into player_login from public.waitlist_applications w
      where w.user_id = p_user and w.status = 'approved' and not w.is_deleted and not w.is_banned
      limit 1;
    if player_login is null then
      return 'not-approved';
    end if;
    select count(*) into gifted
      from public.pc_access_passes p
      join public.pc_early_players f on f.user_id = p.user_id
      where p.source = 'founder' and f.kind = 'founder' and f.released_at is null;
    if gifted >= 3 then
      return 'limit';
    end if;
    insert into public.pc_access_passes (user_id, login, source, granted_by)
    values (p_user, player_login, 'founder', left(coalesce(p_by, ''), 60));
    return 'granted';
  end if;
  if current_source is null then
    return 'not-granted';
  end if;
  if current_source <> 'founder' then
    return 'not-gift';
  end if;
  delete from public.pc_access_passes where user_id = p_user and source = 'founder';
  return 'revoked';
end;
$function$;

revoke all on function public.pc_set_founder_pass(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.pc_set_founder_pass(uuid, boolean, text) to service_role;
