const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = (url.searchParams.get('q') || '').slice(0, 300);
  if (!query) return json({ articles: [] });
  const endpoint = context.env.NEWS_API_KEY ? new URL('https://newsdata.io/api/1/latest') : new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  endpoint.search = context.env.NEWS_API_KEY ? new URLSearchParams({ apikey: context.env.NEWS_API_KEY, q: query, language: 'en,es', size: '10' }).toString() : new URLSearchParams({ query, mode: 'artlist', maxrecords: '10', format: 'json', sort: 'date' }).toString();
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) return json({ articles: [] }, response.status);
    const data = await response.json();
    const articles = Array.isArray(data.results) ? data.results.map(item => ({ title: item.title, url: item.link, domain: item.source_name, seendate: item.pubDate })).slice(0, 10) : Array.isArray(data.articles) ? data.articles.slice(0, 10) : [];
    return json({ articles });
  } catch (error) {
    return json({ articles: [] }, 502);
  }
}
