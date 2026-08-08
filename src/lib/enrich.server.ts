/** Serveripoolsed abifunktsioonid (ainult server). */

type WikiInfo = { extract: string | null; image: string | null };

export async function fetchWikiInfo(title: string): Promise<WikiInfo> {
  const empty: WikiInfo = { extract: null, image: null };
  try {
    const q = encodeURIComponent(`${title} Muhu`);
    const searchUrl = `https://et.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${q}&srlimit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { "User-Agent": "MuhuPunktid/1.0" },
    });
    if (!searchRes.ok) return empty;
    const search = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const hit = search.query?.search?.[0]?.title;
    if (!hit) return empty;

    const pageUrl = `https://et.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=800&titles=${encodeURIComponent(hit)}`;
    const pageRes = await fetch(pageUrl, {
      headers: { "User-Agent": "MuhuPunktid/1.0" },
    });
    if (!pageRes.ok) return empty;
    const page = (await pageRes.json()) as {
      query?: {
        pages?: Record<
          string,
          { extract?: string; thumbnail?: { source?: string } }
        >;
      };
    };
    const first = Object.values(page.query?.pages ?? {})[0];
    return {
      extract: first?.extract?.slice(0, 2000) ?? null,
      image: first?.thumbnail?.source ?? null,
    };
  } catch {
    return empty;
  }
}

/** Kuni 2-lauseline eestikeelne kirjeldus Lovable AI kaudu. */
export async function generateDescription(
  title: string,
  context: string | null,
): Promise<string | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return null;
  const prompt = context
    ? `Koha nimi: "${title}" Muhu saarel Eestis.\nTaustainfo:\n${context}\n\nKirjuta eesti keeles maksimaalselt 2 lauset selle koha kohta.`
    : `Kirjuta eesti keeles maksimaalselt 2 lauset koha "${title}" kohta, mis asub Muhu saarel Eestis. Kui sa ei tea, kirjuta üldine lühike lause Muhu saare selle piirkonna kohta.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Sa kirjutad väga lühikesi eestikeelseid kohakirjeldusi. Vasta ALATI maksimaalselt kahe lausega, ilma sissejuhatuseta.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      console.error("AI gateway error", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    return sentences.slice(0, 400);
  } catch (e) {
    console.error("AI request failed", e);
    return null;
  }
}
