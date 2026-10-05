-- r081: подключение нейросетей (ChatGPT, Claude) к аккаунту игрока через MCP.
--
-- Сайт сам выдаёт доступ по OAuth 2.1 (lib/ai-connect): нейросеть
-- регистрируется (pc_ai_clients), игрок разрешает доступ на сайте и
-- получает одноразовый код (pc_ai_codes), который обменивается на пару
-- токенов (pc_ai_tokens). Токены хранятся только в виде хеша. Всё, что
-- нейросеть сделала от имени игрока, пишется в журнал (pc_ai_activity),
-- который игрок видит в настройках профиля.
--
-- Строки не удаляются: использованный код помечается used_at, отключённый
-- токен — revoked_at. Таблицы доступны только серверу (service role).

create table if not exists public.pc_ai_clients (
  id text primary key,
  name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  created_ip text
);

create table if not exists public.pc_ai_codes (
  code_hash text primary key,
  client_id text not null references public.pc_ai_clients(id),
  user_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pc_ai_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  client_id text not null references public.pc_ai_clients(id),
  access_hash text not null unique,
  refresh_hash text not null unique,
  scopes text[] not null,
  resource text,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  replaced_by uuid
);

create index if not exists pc_ai_tokens_user on public.pc_ai_tokens (user_id, client_id) where revoked_at is null;

create table if not exists public.pc_ai_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  client_id text,
  tool text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists pc_ai_activity_user on public.pc_ai_activity (user_id, created_at desc);

alter table public.pc_ai_clients enable row level security;
alter table public.pc_ai_codes enable row level security;
alter table public.pc_ai_tokens enable row level security;
alter table public.pc_ai_activity enable row level security;

revoke all on public.pc_ai_clients, public.pc_ai_codes, public.pc_ai_tokens, public.pc_ai_activity from anon, authenticated;
grant select, insert, update on public.pc_ai_clients, public.pc_ai_codes, public.pc_ai_tokens, public.pc_ai_activity to service_role;
