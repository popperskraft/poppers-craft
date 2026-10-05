-- Referrals are attributed only when a new application is inserted. A reward
-- is committed in the same transaction as the first real pass application.
-- No existing payment RPC, account, application, or subscription is replaced.
begin;

create table if not exists public.pc_referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{24}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.pc_referrals (
  invitee_user_id uuid primary key references auth.users(id) on delete cascade,
  inviter_user_id uuid references auth.users(id) on delete set null,
  referral_code text not null check (referral_code ~ '^[a-f0-9]{24}$'),
  created_at timestamptz not null default now(),
  reward_payment_id uuid unique references public.pc_payments(id) on delete set null,
  rewarded_at timestamptz,
  reward_days integer not null default 30 check (reward_days = 30),
  reward_hype_until timestamptz,
  check (inviter_user_id is null or inviter_user_id <> invitee_user_id),
  check ((rewarded_at is null) = (reward_hype_until is null))
);
create index if not exists pc_referrals_inviter_created_idx
  on public.pc_referrals(inviter_user_id, created_at desc);

alter table public.waitlist_applications add column if not exists referral_code text;
alter table public.pc_referral_codes enable row level security;
alter table public.pc_referrals enable row level security;
revoke all on public.pc_referral_codes, public.pc_referrals from public, anon, authenticated;
grant select, insert, update, delete on public.pc_referral_codes, public.pc_referrals to service_role;

create or replace function public.pc_referral_eligible(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.waitlist_applications a
    where a.user_id = p_user and a.status = 'approved'
      and not a.is_banned and not a.is_deleted
      and (
        not exists (select 1 from public.pc_payment_settings where pass_required_since is not null)
        or exists (select 1 from public.pc_access_passes where user_id = p_user)
      )
  );
$$;

create or replace function public.pc_get_referral_code(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_code text;
begin
  if not public.pc_referral_eligible(p_user) then return null; end if;
  insert into public.pc_referral_codes(user_id, code)
  values (p_user, left(replace(gen_random_uuid()::text, '-', ''), 24))
  on conflict (user_id) do update set user_id = excluded.user_id
  returning code into v_code;
  return v_code;
end;
$$;

create or replace function public.pc_validate_referral(p_code text, p_invitee uuid default null)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_inviter uuid; v_login text;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{24}$' then raise exception 'referral-invalid'; end if;
  select c.user_id, a.login into v_inviter, v_login
  from public.pc_referral_codes c
  join public.waitlist_applications a on a.user_id = c.user_id
  where c.code = p_code;
  if v_inviter is null or not public.pc_referral_eligible(v_inviter) then
    raise exception 'referral-invalid';
  end if;
  if p_invitee = v_inviter then raise exception 'referral-self'; end if;
  return v_login;
end;
$$;

create or replace function public.pc_attach_application_referral()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_inviter uuid;
begin
  if tg_op = 'UPDATE' then
    if new.referral_code is distinct from old.referral_code or
       (old.referral_code is not null and new.user_id is not null
         and new.user_id is distinct from old.user_id) then
      raise exception 'referral-locked';
    end if;
    -- Account deletion keeps the application with user_id = NULL. Preserve
    -- that existing FK behavior, but never transfer its referral to a user.
    return new;
  end if;
  if new.referral_code is null then return new; end if;
  perform public.pc_validate_referral(new.referral_code, new.user_id);
  select user_id into v_inviter from public.pc_referral_codes where code = new.referral_code;
  insert into public.pc_referrals(invitee_user_id, inviter_user_id, referral_code)
  values(new.user_id, v_inviter, new.referral_code);
  return new;
end;
$$;

create or replace trigger pc_application_referral
after insert or update of referral_code, user_id on public.waitlist_applications
for each row execute function public.pc_attach_application_referral();

create or replace function public.pc_reward_referral(p_payment uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_payment public.pc_payments%rowtype;
  v_referral public.pc_referrals%rowtype;
  v_login text;
  v_until timestamptz;
  v_now timestamptz := now();
  -- Fixed elapsed time, including daylight-saving transitions: exactly 30 days.
  v_duration interval := interval '720 hours';
begin
  select * into v_payment from public.pc_payments where id = p_payment;
  if not found or v_payment.kind <> 'pass' or v_payment.status <> 'succeeded'
     or v_payment.applied_at is null or v_payment.paid_at is null
     or v_payment.test is distinct from false or v_payment.amount <= 0
     or v_payment.provider <> 'yookassa' or v_payment.currency <> 'RUB'
     or nullif(v_payment.provider_payment_id, '') is null
     or v_payment.recipient_id is not null or v_payment.recurring then
    return 'ineligible-payment';
  end if;
  -- Serialize repeated callbacks and separate pass payments for this invitee.
  select * into v_referral from public.pc_referrals
    where invitee_user_id = v_payment.user_id for update;
  if not found then return 'no-referral'; end if;
  if v_referral.rewarded_at is not null then return 'already-rewarded'; end if;
  if v_payment.created_at < v_referral.created_at or v_payment.paid_at < v_referral.created_at then
    return 'purchase-before-referral';
  end if;
  if exists (
    select 1 from public.pc_payments p
    where p.user_id = v_payment.user_id and p.id <> v_payment.id
      and p.kind = 'pass' and p.status = 'succeeded' and p.test = false
      and p.amount > 0 and p.applied_at is not null and p.paid_at is not null
      and p.provider = 'yookassa' and p.currency = 'RUB'
      and nullif(p.provider_payment_id, '') is not null
      and p.recipient_id is null and not p.recurring
      and (p.paid_at, p.id) < (v_payment.paid_at, v_payment.id)
  ) then return 'earlier-purchase'; end if;
  if not public.pc_referral_eligible(v_referral.inviter_user_id) then return 'inviter-ineligible'; end if;
  if not exists (
    select 1 from public.waitlist_applications where user_id = v_payment.user_id
      and status = 'approved' and not is_banned and not is_deleted
  ) then return 'invitee-ineligible'; end if;
  select login into v_login from public.waitlist_applications where user_id = v_referral.inviter_user_id;

  -- Match the existing payment/manual-grant lock before touching subscriptions.
  -- Their SELECT FOR UPDATE + plain INSERT also needs protection while a
  -- subscription row does not exist yet; an upsert row lock alone is too late.
  perform pg_advisory_xact_lock(hashtext('pc_plus_manual'), hashtext(v_referral.inviter_user_id::text));

  -- HYPE goes first; remaining PLUS days shift intact.
  -- Existing renewal/card/cancellation/retry settings and last_payment_id stay.
  insert into public.pc_plus_subscriptions(
    user_id, login, current_period_end, hype_until, tier, renew_tier, auto_renew
  ) values (
    v_referral.inviter_user_id, v_login, v_now + v_duration, v_now + v_duration,
    'hype', 'plus', false
  )
  on conflict(user_id) do update set
    login = excluded.login,
    hype_until = greatest(public.pc_plus_subscriptions.hype_until, v_now) + v_duration,
    current_period_end = greatest(public.pc_plus_subscriptions.current_period_end, public.pc_plus_subscriptions.hype_until, v_now) + v_duration,
    tier = 'hype',
    hype_handled_at = null,
    expired_handled_at = null,
    reminded_for = null,
    updated_at = v_now
  returning hype_until into v_until;

  update public.pc_referrals set reward_payment_id = v_payment.id,
    rewarded_at = v_now, reward_hype_until = v_until
    where invitee_user_id = v_payment.user_id;
  return 'rewarded';
end;
$$;

create or replace function public.pc_reward_applied_pass_referral()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.kind = 'pass' and new.status = 'succeeded' and new.applied_at is not null then
    perform public.pc_reward_referral(new.id);
  end if;
  return new;
end;
$$;

create or replace trigger pc_applied_pass_referral
after insert or update of applied_at, status on public.pc_payments
for each row execute function public.pc_reward_applied_pass_referral();

create or replace function public.pc_referral_schema_version()
returns integer language sql stable security definer set search_path = public
as $$ select 1; $$;

revoke all on function public.pc_referral_eligible(uuid), public.pc_get_referral_code(uuid),
  public.pc_validate_referral(text,uuid), public.pc_attach_application_referral(),
  public.pc_reward_referral(uuid), public.pc_reward_applied_pass_referral(),
  public.pc_referral_schema_version() from public, anon, authenticated;
grant execute on function public.pc_referral_eligible(uuid), public.pc_get_referral_code(uuid),
  public.pc_validate_referral(text,uuid), public.pc_reward_referral(uuid),
  public.pc_referral_schema_version() to service_role;

notify pgrst, 'reload schema';
commit;
