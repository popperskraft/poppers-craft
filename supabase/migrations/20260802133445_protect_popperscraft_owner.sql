create schema if not exists private;

create or replace function private.owner_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if lower(old.email) = 'owner@example.invalid' then
      raise exception 'PoppersCraft owner is protected'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if lower(old.email) = 'owner@example.invalid'
    and (
      lower(new.email) <> 'owner@example.invalid'
      or new.role <> 'owner'
      or new.active is distinct from true
      or new.user_id is distinct from old.user_id
    )
  then
    raise exception 'PoppersCraft owner is protected'
      using errcode = '42501';
  end if;

  if lower(new.email) = 'owner@example.invalid' then
    new.email := 'owner@example.invalid';
    new.role := 'owner';
    new.active := true;
  end if;

  return new;
end;
$$;

revoke all on function private.owner_lock()
  from public, anon, authenticated, service_role;

drop trigger if exists owner_lock on public.admin_profiles;

create trigger owner_lock
before insert or update or delete on public.admin_profiles
for each row execute function private.owner_lock();

update public.admin_profiles as profile
set
  user_id = owner_user.id,
  email = 'owner@example.invalid',
  role = 'owner',
  active = true
from auth.users as owner_user
where lower(profile.email) = 'owner@example.invalid'
  and lower(owner_user.email) = 'owner@example.invalid'
  and (profile.user_id is null or profile.user_id = owner_user.id);
