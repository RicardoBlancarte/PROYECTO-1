const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const query = (url.searchParams.get('q') || '').slice(0, 300);
  if (!query) return json({ articles: [] });
  const endpoint = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  endpoint.search = new URLSearchParams({ query, mode: 'artlist', maxrecords: '10', format: 'json', sort: 'date' }).toString();
  try {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) return json({ articles: [] }, response.status);
    const data = await response.json();
    return json({ articles: Array.isArray(data.articles) ? data.articles.slice(0, 10) : [] });
  } catch (error) {
    return json({ articles: [] }, 502);
  }
}
