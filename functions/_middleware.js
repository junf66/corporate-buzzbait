// Cloudflare Pages middleware — runs before static assets on every request.
//  1. www.buzzbait.co.jp → buzzbait.co.jp (301, path and query preserved).
//     Pages' _redirects file cannot match on hostname, so this lives here.
//  2. Legacy files removed from the repo (handoff/, README.md) answer 404
//     even if an older cached copy still exists.
const LEGACY = /^\/(handoff(\/|$)|README\.md$)/i;

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);

  if (url.hostname === 'www.buzzbait.co.jp') {
    url.hostname = 'buzzbait.co.jp';
    return Response.redirect(url.toString(), 301);
  }

  if (LEGACY.test(url.pathname)) {
    // Ask the asset server for a path that never exists: it answers with 404.html.
    // (Fetching /404.html directly would get a 308 to /404 with an empty body.)
    const page = await env.ASSETS.fetch(new URL('/__not-found__', url).toString());
    return new Response(page.body, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return next();
}
