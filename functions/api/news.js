const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const DEBATE_SYSTEM_PROMPT = 'Eres un motor de analisis financiero que simula un debate entre dos analistas macro: uno de sesgo liberal (progresista) y uno de sesgo conservador. Para el titular de noticia dado, produce la puntuacion de impacto de mercado de CADA analista de forma independiente, en una escala de -10 (muy bajista) a +10 (muy alcista). Responde EXCLUSIVAMENTE con un objeto JSON valido, sin texto adicional ni markdown, con esta forma exacta: {"liberal_impact": number, "liberal_summary": string, "conservative_impact": number, "conservative_summary": string, "neutral_summary": string}. Los "summary" deben ser una frase breve en espanol (menos de 25 palabras).';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = (url.searchParams.get('q') || '').slice(0, 300);
  const symbol = (url.searchParams.get('symbol') || 'GLOBAL').slice(0, 32).toUpperCase();
  if (!query) return json({ articles: [] });
  const endpoint = context.env.NEWS_API_KEY ? new URL('https://newsdata.io/api/1/latest') : new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  endpoint.search = context.env.NEWS_API_KEY ? new URLSearchParams({ apikey: context.env.NEWS_API_KEY, q: query, language: 'en,es', size: '10' }).toString() : new URLSearchParams({ query, mode: 'artlist', maxrecords: '10', format: 'json', sort: 'date' }).toString();
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) return json({ articles: [] }, response.status);
    const data = await response.json();
    const articles = Array.isArray(data.results) ? data.results.map(item => ({ title: item.title, url: item.link, domain: item.source_name, seendate: item.pubDate })).slice(0, 10) : Array.isArray(data.articles) ? data.articles.slice(0, 10) : [];
    const scored = context.env.SUPABASE_URL && context.env.SUPABASE_SERVICE_ROLE_KEY ? await scoreAndPersist(context.env, symbol, articles) : articles;
    return json({ articles: scored });
  } catch (error) {
    return json({ articles: [] }, 502);
  }
}

// Puntua cada titular con un analista liberal y uno conservador independientes (via LLM, con
// fallback heuristico si ANTHROPIC_API_KEY no esta configurado o la llamada falla), y deduplica
// contra asset_news_scores por content_hash para no volver a puntuar/gastar el mismo titular.
async function scoreAndPersist(env, symbol, articles) {
  const now = new Date().toISOString();
  const withHash = await Promise.all(articles.filter(article => article.title).map(async article => {
    const headline = String(article.title).slice(0, 1000);
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${symbol}|${headline}|${article.seendate || now}`));
    const contentHash = [...new Uint8Array(hashBuffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { article, headline, contentHash };
  }));
  if (!withHash.length) return articles;

  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const existingMap = await fetchExistingScores(env, headers, withHash.map(item => item.contentHash));

  const rows = [];
  const results = await Promise.all(withHash.map(async ({ article, headline, contentHash }) => {
    const existing = existingMap.get(contentHash);
    if (existing) return { article, scored: existing };
    const scored = env.ANTHROPIC_API_KEY ? await scoreWithLLM(env, headline) : null;
    const final = scored || heuristicScore(headline);
    rows.push({ symbol, published_at: article.seendate || now, headline, source: String(article.domain || ''), impact_score: final.netImpact, liberal_impact: final.liberalImpact, conservative_impact: final.conservativeImpact, conservative_summary: final.conservativeSummary, liberal_summary: final.liberalSummary, neutral_summary: final.neutralSummary, scoring_method: final.method, content_hash: contentHash });
    return { article, scored: final };
  }));

  if (rows.length) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/asset_news_scores?on_conflict=content_hash`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    }).catch(() => {});
  }

  return results.map(({ article, scored }) => ({
    ...article,
    liberalImpact: scored.liberalImpact ?? scored.liberal_impact,
    conservativeImpact: scored.conservativeImpact ?? scored.conservative_impact,
    liberalSummary: scored.liberalSummary ?? scored.liberal_summary,
    conservativeSummary: scored.conservativeSummary ?? scored.conservative_summary,
    neutralSummary: scored.neutralSummary ?? scored.neutral_summary,
    netImpact: scored.netImpact ?? scored.impact_score
  }));
}

async function fetchExistingScores(env, headers, hashes) {
  const map = new Map();
  if (!hashes.length) return map;
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/asset_news_scores`);
  url.search = new URLSearchParams({ content_hash: `in.(${hashes.join(',')})`, select: 'content_hash,impact_score,liberal_impact,conservative_impact,liberal_summary,conservative_summary,neutral_summary' }).toString();
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return map;
    const rows = await response.json();
    rows.forEach(row => map.set(row.content_hash, row));
  } catch (error) { /* treat as not cached */ }
  return map;
}

function heuristicScore(headline) {
  const critical = /guerra|conflicto|sanci[oó]n|crisis|ataque|embargo|ruptura|disputa|bloqueo|tensi[oó]n|default|impago|colapso/i.test(headline);
  const liberalImpact = critical ? -3 : 1.5;
  const conservativeImpact = critical ? -5 : 1;
  return {
    liberalImpact, conservativeImpact,
    netImpact: Math.max(-10, Math.min(10, liberalImpact + conservativeImpact)),
    conservativeSummary: critical ? 'Riesgo de continuidad y prima de riesgo elevada.' : 'Señal de estabilidad operativa.',
    liberalSummary: critical ? 'Riesgo de disrupción y efectos macro amplios.' : 'Señal de coordinación y crecimiento.',
    neutralSummary: critical ? 'Impacto negativo cautelar; ampliar bandas de incertidumbre.' : 'Impacto positivo moderado; confirmar con datos de mercado.',
    method: 'heuristic'
  };
}

async function scoreWithLLM(env, headline) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, max_tokens: 400, system: DEBATE_SYSTEM_PROMPT, messages: [{ role: 'user', content: `Titular: ${headline}` }] })
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const liberalImpact = clampScore(parsed.liberal_impact);
    const conservativeImpact = clampScore(parsed.conservative_impact);
    if (liberalImpact === null || conservativeImpact === null) return null;
    return {
      liberalImpact, conservativeImpact,
      netImpact: Math.max(-10, Math.min(10, liberalImpact + conservativeImpact)),
      liberalSummary: String(parsed.liberal_summary || '').slice(0, 300),
      conservativeSummary: String(parsed.conservative_summary || '').slice(0, 300),
      neutralSummary: String(parsed.neutral_summary || '').slice(0, 300),
      method: 'llm'
    };
  } catch (error) {
    return null;
  }
}

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(-10, Math.min(10, num));
}
