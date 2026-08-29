// Edge Function "generate-report"
//
// Chiamata: on-demand dal tasto "Aggiorna" nella tab Report, e in automatico
// ogni 6 mesi tramite un controllo lato client (app.js::maybeAutoRefreshReport,
// eseguito solo quando si apre la tab Report) — NON un cron lato Supabase:
// verificato, pg_cron non è installato su questo progetto. Gira isolata dal
// resto dell'app: nessun import dal bundle client, solo REST verso Supabase
// (con la service_role key, mai esposta al client) e una chiamata a Claude.
//
// Le statistiche (medie, conteggi, registi con più titoli) sono calcolate
// qui in codice, NON dal modello — a Claude chiediamo solo il profilo
// narrativo, la nota sui generi e le 10 raccomandazioni, che richiedono
// giudizio/conoscenza e non aritmetica.

import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const USER_ID = "default";
const MIN_SEEN_FOR_REPORT = 10;
const TMDB_API_KEY = "f8d5e378edf5128176f0d89f49310151"; // stessa chiave pubblica già usata in tmdb.js
const RECS_REQUESTED = 14; // richiediamo qualche titolo in più: alcuni verranno scartati dal filtro anti-duplicati, altri potrebbero non avere un poster su TMDB
const RECS_FINAL = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Stessa logica di sanitizeVoteInput/parseUserVote in cine-core.js,
// duplicata qui perché questa funzione gira isolata dal bundle client.
function parseVote(raw?: string | null): number {
  if (!raw) return NaN;
  const value = String(raw).trim().replace(",", ".");
  if (value.endsWith("+")) {
    const base = Number(value.slice(0, -1));
    return Number.isFinite(base) ? Math.min(10, base + 0.25) : NaN;
  }
  if (value.endsWith("-")) {
    const base = Number(value.slice(0, -1));
    return Number.isFinite(base) ? Math.max(0, base - 0.25) : NaN;
  }
  return Number(value);
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Normalizza un titolo per il confronto (minuscolo, senza accenti/punteggiatura):
// serve a scartare deterministicamente, in codice, qualunque raccomandazione
// che coincida con un titolo già visto o in watchlist — non ci affidiamo solo
// all'istruzione nel prompt, che il modello può comunque non rispettare.
function normTitle(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ReportContentSchema = z.object({
  // min(150) scarta i paragrafi-frammento ("286 titoli, media 6.75.") che il
  // modello a volte produce invece di un vero paragrafo discorsivo.
  profile: z.array(z.string().min(150)).min(2).max(3),
  genres_note: z.string(),
  // min anziché length esatta: ci servono solo RECS_FINAL titoli buoni alla
  // fine (dopo dedup e filtro poster), non serve invalidare tutta la
  // generazione se il modello ne propone qualcuno in meno di RECS_REQUESTED.
  recommendations: z.array(z.object({
    title: z.string(),
    year: z.string(),
    media_type: z.enum(["movie", "tv"]),
    director: z.string(),
    why: z.string().min(15),
  })).min(RECS_FINAL),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!SUPABASE_URL || !SERVICE_KEY) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mancanti (dovrebbero essere iniettate automaticamente).");
    }
    if (!ANTHROPIC_KEY) {
      throw new Error("Secret ANTHROPIC_API_KEY non configurata su questo progetto Supabase.");
    }

    const restHeaders = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    // ── 1. Dati grezzi da Supabase (stessa tabella "Coltel" usata dal client) ──
    const rowsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/Coltel?user_id=eq.${USER_ID}&select=list,data`,
      { headers: restHeaders },
    );
    if (!rowsRes.ok) {
      throw new Error(`Lettura Coltel fallita: ${rowsRes.status} ${await rowsRes.text()}`);
    }
    const rows: { list: string; data: any }[] = await rowsRes.json();

    const seen = rows.filter(r => r.list === "seen").map(r => r.data);
    const watchlist = rows.filter(r => r.list === "watchlist").map(r => r.data);

    if (seen.length < MIN_SEEN_FOR_REPORT) {
      return new Response(
        JSON.stringify({ error: `Servono almeno ${MIN_SEEN_FOR_REPORT} titoli visti per generare un report (ne hai ${seen.length}).` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Statistiche calcolate qui, non dal modello ──────────────────────────
    const genreCount: Record<string, number> = {};
    const genreVotes: Record<string, number[]> = {};
    const directorVotes: Record<string, number[]> = {};
    const allVotes: number[] = [];

    for (const item of seen) {
      const vote = parseVote(item.vote);
      if (Number.isFinite(vote)) allVotes.push(vote);

      for (const g of item.genre_names || []) {
        genreCount[g] = (genreCount[g] || 0) + 1;
        if (Number.isFinite(vote)) (genreVotes[g] ||= []).push(vote);
      }

      if (item.director && Number.isFinite(vote)) {
        (directorVotes[item.director] ||= []).push(vote);
      }
    }

    const avgVote = allVotes.length ? average(allVotes) : null;

    const genresTopCount = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({
        name,
        count,
        avg: genreVotes[name] ? Number(average(genreVotes[name]).toFixed(2)) : null,
      }));

    const genresTopAvg = Object.entries(genreVotes)
      .filter(([, v]) => v.length >= 5)
      .map(([name, v]) => ({ name, avg: Number(average(v).toFixed(2)), count: genreCount[name] }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8);

    const directors = Object.entries(directorVotes)
      .filter(([, v]) => v.length >= 2)
      .map(([name, v]) => ({ name, count: v.length, avg: Number(average(v).toFixed(2)) }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8);

    // Righe compatte per il prompt: tengono il costo basso anche con centinaia
    // di titoli (niente chiavi JSON ripetute 250+ volte).
    const seenLines = seen
      .map((i: any) => `${i.title} (${i.year}) | ${i.director || "—"} | ${(i.genre_names || []).join(",")} | ${i.vote || "—"}`)
      .join("\n");

    const watchlistLine = watchlist.map((i: any) => `${i.title} (${i.year})`).join(", ") || "vuota";

    // ── 3. Claude: solo profilo, nota generi e raccomandazioni ────────────────
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

    const requestParams = {
      model: "claude-sonnet-5",
      max_tokens: 4000,
      output_config: {
        effort: "medium",
        format: zodOutputFormat(ReportContentSchema),
      },
      system:
        "Sei l'analista personale di un'app di tracking film/serie TV. Scrivi in italiano, in seconda persona, tono diretto e colloquiale, mai da comunicato stampa. Basati SOLO sui dati numerici forniti nel messaggio, non inventare cifre. Per le raccomandazioni usa la tua conoscenza di film/serie realmente esistenti, e non proporre MAI un titolo già presente tra i visti o nella watchlist elencati.",
      messages: [{
        role: "user",
        content: `Statistiche già calcolate (non ricalcolarle):
- Titoli visti: ${seen.length}, voto medio: ${avgVote !== null ? avgVote.toFixed(2) : "n.d."}
- Generi più visti: ${JSON.stringify(genresTopCount)}
- Generi meglio votati (min. 5 titoli): ${JSON.stringify(genresTopAvg)}
- Registi con almeno 2 titoli, per media voto: ${JSON.stringify(directors)}

Libreria vista (titolo (anno) | regista | generi | voto):
${seenLines}

In watchlist (NON consigliare questi): ${watchlistLine}

Scrivi:
1. "profile": 2-3 paragrafi VERI — ognuno un blocco discorsivo di almeno 4-5 frasi collegate tra loro, mai una lista di frasi telegrafiche spezzate a capo (NON accettabile: "286 titoli visti, media 6.75. Thriller e Horror dominano."; corretto: "Con 286 titoli visti e una media di 6.75, sei un fruitore molto attivo che alterna generi di intrattenimento a roba più ricercata: non ti accontenti del blockbuster medio, ma nemmeno disdegni gli horror più trash quando servono per staccare la spina.") — con numeri concreti presi dai dati sopra.
2. "genres_note": 2-3 frasi discorsive (stesso principio: frasi vere, non frammenti) su generi più visti vs. meglio votati.
3. "recommendations": esattamente ${RECS_REQUESTED} titoli reali (film o serie, indica "media_type" corretto), MAI titoli già presenti nell'elenco dei visti o della watchlist qui sopra (controlla con attenzione, anche eventuali sequel/prequel/remake con lo stesso titolo esatto vanno evitati se il titolo coincide) — ne verranno scartati alcuni per sicurezza, per questo te ne chiediamo ${RECS_REQUESTED} invece di ${RECS_FINAL}. Preferisci titoli conosciuti e reperibili (non oscurità estrema): verrà cercato il loro poster su TMDB e chi non lo ha rischia di essere scartato. Ogni titolo deve avere una riga di motivazione ("why", almeno una frase completa) legata a un dato concreto sopra (un regista, un genere, una struttura narrativa ricorrente) — non lasciarla mai vuota o generica.

Formattazione: in "profile" e "genres_note", evidenzia con **doppi asterischi** al massimo 2-3 dati o nomi davvero rilevanti PER PARAGRAFO (non per frase — un paragrafo di 4-5 frasi ha diritto a 2-3 grassetti in totale, non uno a frase), e in ogni "why" al massimo 1-2. Un numero, un genere, un regista — non l'intera frase, non ogni numero o genere citato. Es: "con **286 titoli** visti sei un divoratore di **Thriller**". Niente altra formattazione markdown.`,
      }],
    };

    // Lo schema è rigido (esattamente RECS_REQUESTED consigli, ogni "why"
    // con almeno 15 caratteri) e il modello ogni tanto non lo rispetta alla
    // prima. Un retry qui, invece che lasciar fallire subito, rende
    // resiliente sia l'aggiornamento automatico ogni 6 mesi (che altrimenti
    // fallirebbe in silenzio, senza nessuno che se ne accorga) sia il tasto
    // "Aggiorna" in app.
    const MAX_ATTEMPTS = 3;
    let parsed;
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await client.messages.parse(requestParams);
        if (!response.parsed_output) {
          throw new Error("Claude non ha restituito un output valido.");
        }
        parsed = response.parsed_output;
        break;
      } catch (e) {
        lastError = e;
        console.warn(`generate-report: tentativo ${attempt}/${MAX_ATTEMPTS} fallito`, e);
      }
    }
    if (!parsed) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    // ── 4. Filtro anti-duplicati (deterministico, non ci fidiamo solo del prompt) ──
    const excluded = new Set([
      ...seen.map((i: any) => normTitle(i.title || "")),
      ...watchlist.map((i: any) => normTitle(i.title || "")),
    ]);

    const deduped = parsed.recommendations.filter(r => !excluded.has(normTitle(r.title)));

    // ── 5. Poster da TMDB (il modello non conosce i path delle locandine) ──────
    // Cerchiamo il poster su TUTTI i candidati deduplicati (non solo i primi
    // RECS_FINAL): dopo, in fase di taglio, diamo priorità a chi il poster ce
    // l'ha davvero, così finché il modello ha proposto abbastanza titoli
    // reperibili su TMDB tra i candidati extra, l'utente non vede mai una
    // card vuota nella shelf finale.
    const dedupedWithPosters = await Promise.all(deduped.map(async (r) => {
      try {
        const yearParam = r.media_type === "tv" ? "first_air_date_year" : "year";
        const url = `https://api.themoviedb.org/3/search/${r.media_type}` +
          `?api_key=${TMDB_API_KEY}&language=it-IT&query=${encodeURIComponent(r.title)}&${yearParam}=${encodeURIComponent(r.year)}`;
        const res = await fetch(url);
        if (!res.ok) return { ...r, poster_path: null };
        const data = await res.json();
        return { ...r, poster_path: data.results?.[0]?.poster_path ?? null };
      } catch {
        return { ...r, poster_path: null };
      }
    }));

    const recsWithPosters = dedupedWithPosters
      .sort((a, b) => (a.poster_path ? 0 : 1) - (b.poster_path ? 0 : 1))
      .slice(0, RECS_FINAL);

    // ── 6. Salvataggio ──────────────────────────────────────────────────────────
    const payload = {
      seen_count: seen.length,
      avg_vote: avgVote,
      genres_top_count: genresTopCount,
      genres_top_avg: genresTopAvg,
      directors,
      profile: parsed.profile,
      genres_note: parsed.genres_note,
      recommendations: recsWithPosters,
    };

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/monthly_report`, {
      method: "POST",
      headers: { ...restHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: USER_ID, payload }),
    });
    if (!insertRes.ok) {
      throw new Error(`Scrittura report fallita: ${insertRes.status} ${await insertRes.text()}`);
    }

    const [saved] = await insertRes.json();

    return new Response(JSON.stringify(saved), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
