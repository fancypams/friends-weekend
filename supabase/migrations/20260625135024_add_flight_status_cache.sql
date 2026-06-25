create table if not exists public.flight_status_cache (
  id uuid primary key default gen_random_uuid(),
  flight_number text not null,
  flight_date date not null,
  origin text not null,
  destination text not null,
  provider text not null default 'aerodatabox',
  status text,
  status_label text,
  scheduled_departure_at timestamptz,
  estimated_departure_at timestamptz,
  actual_departure_at timestamptz,
  scheduled_arrival_at timestamptz,
  estimated_arrival_at timestamptz,
  actual_arrival_at timestamptz,
  departure_terminal text,
  departure_gate text,
  arrival_terminal text,
  arrival_gate text,
  baggage_claim text,
  raw_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flight_status_cache_unique_leg unique (
    flight_number,
    flight_date,
    origin,
    destination,
    provider
  )
);

create index if not exists idx_flight_status_cache_expires_at
  on public.flight_status_cache (expires_at);

create index if not exists idx_flight_status_cache_leg
  on public.flight_status_cache (
    flight_number,
    flight_date,
    origin,
    destination
  );

drop trigger if exists trg_flight_status_cache_set_updated_at
  on public.flight_status_cache;

create trigger trg_flight_status_cache_set_updated_at
before update on public.flight_status_cache
for each row
execute function public.set_updated_at();

alter table public.flight_status_cache enable row level security;

drop policy if exists "Active members can read flight status cache"
  on public.flight_status_cache;

create policy "Active members can read flight status cache"
on public.flight_status_cache
for select
to authenticated
using (public.is_active_member());

grant select on public.flight_status_cache to authenticated;
grant all on public.flight_status_cache to service_role;
