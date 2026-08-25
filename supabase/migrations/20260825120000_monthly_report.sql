-- Storico dei report generati da Claude (profilo, nota sui generi, 10
-- raccomandazioni). Ogni rigenerazione INSERISCE una nuova riga invece di
-- sovrascrivere: il client legge solo l'ultima, ma lo storico resta
-- disponibile per un'eventuale vista "come sono cambiati i tuoi gusti".

create table if not exists public.monthly_report (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'default',
  generated_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists monthly_report_user_generated_idx
  on public.monthly_report (user_id, generated_at desc);

alter table public.monthly_report enable row level security;

-- Il client legge con la chiave pubblica (nessun login in questa app).
-- Nessuna policy di insert/update/delete per anon: scrive solo la Edge
-- Function "generate-report" con la service_role key, che bypassa comunque
-- RLS — le policy qui sotto riguardano solo le richieste dal client.
create policy "monthly_report_select_anon"
  on public.monthly_report
  for select
  to anon
  using (true);
