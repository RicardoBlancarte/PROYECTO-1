const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });

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
    if (context.env.SUPABASE_URL && context.env.SUPABASE_SERVICE_ROLE_KEY) await persistScores(context.env, symbol, articles);
    return json({ articles });
  } catch (error) {
    return json({ articles: [] }, 502);
  }
}

async function persistScores(env, symbol, articles) {
  const now = new Date().toISOString();
  const rows = await Promise.all(articles.filter(article => article.title).map(async article => {
    const headline = String(article.title).slice(0, 1000);
    const critical = /guerra|conflicto|sanci[oó]n|crisis|ataque|embargo|ruptura|disputa|bloqueo|tensi[oó]n|default|impago|colapso/i.test(headline);
    const impact = critical ? -6.5 : 1.5;
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${symbol}|${headline}|${article.seendate || now}`));
    const contentHash = [...new Uint8Array(hashBuffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { symbol, published_at: article.seendate || now, headline, source: String(article.domain || ''), impact_score: impact, conservative_summary: critical ? 'Riesgo de continuidad y prima de riesgo elevada.' : 'Señal de estabilidad operativa.', liberal_summary: critical ? 'Riesgo de disrupción y efectos macro amplios.' : 'Señal de coordinación y crecimiento.', neutral_summary: critical ? 'Impacto negativo cautelar; ampliar bandas de incertidumbre.' : 'Impacto positivo moderado; confirmar con datos de mercado.', content_hash: contentHash };
  }));
  if (!rows.length) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/asset_news_scores?on_conflict=content_hash`, { method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) }).catch(() => {});
}
