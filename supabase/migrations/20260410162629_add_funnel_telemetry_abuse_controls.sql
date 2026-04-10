create index if not exists idx_funnel_events_client_ip_created
  on public.funnel_events ((context ->> 'client_ip'), created_at desc);
