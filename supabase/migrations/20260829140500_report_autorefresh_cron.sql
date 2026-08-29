-- Il cron server-side che i commenti del codice descrivevano come già
-- esistente in realtà non c'era mai stato (verificato: pg_cron non era
-- installato su questo progetto) — l'unico trigger era il controllo lato
-- client in app.js::maybeAutoRefreshReport(), eseguito solo quando si apre
-- la tab Report. Se la tab non veniva mai aperta per oltre 6 mesi, il
-- report restava stale a tempo indeterminato. Questa migration crea il
-- cron reale, così la rigenerazione avviene comunque anche se l'app non
-- viene mai aperta.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net;

-- security definer: la funzione deve poter leggere monthly_report anche se
-- il cron gira senza un utente anon/autenticato (RLS su quella tabella
-- concede SELECT solo al ruolo "anon"). Legge solo generated_at, nessun
-- dato sensibile.
create or replace function public.maybe_trigger_report_regen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  last_gen timestamptz;
begin
  select generated_at into last_gen
  from public.monthly_report
  order by generated_at desc
  limit 1;

  if last_gen is null or now() - last_gen >= interval '6 months' then
    -- Stessa anon key pubblica già usata dal client per invocare questa
    -- funzione (supabase.js) — non è un segreto, è già nel bundle servito
    -- a chiunque apra l'app. La Edge Function stessa usa poi la
    -- service_role key (mai esposta) per leggere/scrivere.
    perform net.http_post(
      url := 'https://quwkqaovjxczuahjcmmh.supabase.co/functions/v1/generate-report',
      headers := jsonb_build_object(
        'Authorization', 'Bearer sb_publishable_1FWxC_BAnvblEtpTdUXrEg_iLKZDb6d',
        'apikey', 'sb_publishable_1FWxC_BAnvblEtpTdUXrEg_iLKZDb6d',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  end if;
end;
$$;

-- Gira il primo di ogni mese: non è "ogni 6 mesi" perché pg_cron non
-- esprime bene una cadenza semestrale ancorata a una data mobile — la
-- funzione sopra fa il vero controllo (>= 6 mesi dall'ultimo report) ad
-- ogni esecuzione, quindi il job mensile è solo il "battito" che verifica
-- se è il momento, non innesca una rigenerazione ogni mese.
select cron.schedule(
  'monthly-report-autorefresh-check',
  '0 6 1 * *',
  $$select public.maybe_trigger_report_regen();$$
);
