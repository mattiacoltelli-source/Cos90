// Edge Function "generate-report"
//
// Chiamata: on-demand dal tasto "Aggiorna" nella tab Report, e in automatico
// ogni 6 mesi da un cron lato Supabase (vedi istruzioni di deploy). Gira
// isolata dal resto dell'app: nessun import dal bundle client, solo REST
// verso Supabase (con la service_role key, mai esposta al client) e una
// chiamata a Claude.
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

const ReportContentSchema = z.object({
  profile: z.array(z.string()).min(2).max(3),
  genres_note: z.string(),
  recommendations: z.array(z.object({
    title: z.string(),
    year: z.string(),
    director: z.string(),
    why: z.string(),
  })).length(10),
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

    const response = await client.messages.parse({
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
1. "profile": 2-3 paragrafi che raccontano il profilo di gusti di questa persona, con numeri concreti presi dai dati sopra.
2. "genres_note": 2-3 frasi su generi più visti vs. meglio votati.
3. "recommendations": esattamente 10 titoli reali (film o serie), mai già visti o in watchlist, ciascuno con una riga di motivazione ("why") legata a un dato concreto sopra (un regista, un genere, una struttura narrativa ricorrente).`,
      }],
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error("Claude non ha restituito un output valido.");
    }

    // ── 4. Salvataggio ──────────────────────────────────────────────────────────
    const payload = {
      seen_count: seen.length,
      avg_vote: avgVote,
      genres_top_count: genresTopCount,
      genres_top_avg: genresTopAvg,
      directors,
      profile: parsed.profile,
      genres_note: parsed.genres_note,
      recommendations: parsed.recommendations,
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
