-- r089: «Профиль → Настройки → Активные устройства».
-- Supabase видит все входы как «node» с адреса сервера (вход идёт через
-- сайт), поэтому браузер, систему и адрес сайт запоминает сам — в этой
-- таблице. Сессии берутся из auth.sessions через функции ниже; доступ только
-- у сервисной роли сайта.

create table if not exists public.pc_session_devices (
  session_id uuid primary key,
  user_id uuid not null,
  user_agent text not null default '',
  ip text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists pc_session_devices_user_idx on public.pc_session_devices (user_id);

alter table public.pc_session_devices enable row level security;
revoke all on public.pc_session_devices from anon, authenticated;
grant select, insert, update on public.pc_session_devices to service_role;

-- Активные сессии игрока с тем, что сайт о них знает.
create or replace function public.pc_list_sessions(p_user uuid)
returns table (
  id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  aal text,
  user_agent text,
  ip text,
  last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.created_at,
    s.refreshed_at at time zone 'UTC',
    s.aal::text,
    coalesce(d.user_agent, ''),
    coalesce(d.ip, ''),
    d.last_seen_at
  from auth.sessions s
  left join public.pc_session_devices d on d.session_id = s.id
  where s.user_id = p_user
    and (s.not_after is null or s.not_after > now())
  order by greatest(
    coalesce(d.last_seen_at, s.created_at),
    coalesce(s.refreshed_at at time zone 'UTC', s.created_at)
  ) desc
  limit 50;
$$;

-- Завершить выбранные сессии игрока (только его собственные). Следующий
-- запрос с этого устройства уже не пройдёт проверку входа.
create or replace function public.pc_end_sessions(p_user uuid, p_sessions uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended integer;
begin
  delete from auth.sessions where user_id = p_user and id = any(p_sessions);
  get diagnostics ended = row_count;
  return ended;
end;
$$;

revoke all on function public.pc_list_sessions(uuid) from public, anon, authenticated;
revoke all on function public.pc_end_sessions(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.pc_list_sessions(uuid) to service_role;
grant execute on function public.pc_end_sessions(uuid, uuid[]) to service_role;
