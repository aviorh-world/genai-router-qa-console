function safeTarget(baseUrl, apiPath) {
  const base = new URL(baseUrl);
  if (!['http:','https:'].includes(base.protocol)) throw new Error('Only http/https Base URL is allowed');
  const target = new URL(apiPath, base.toString().replace(/\/?$/, '/'));
  if (target.origin !== base.origin) throw new Error('Target origin must match Base URL');
  return target;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const p = req.body || {};
    const { baseUrl, token, method='GET', apiPath='/', body, headers={}, stream=false } = p;
    if (!baseUrl) return res.status(400).json({error:'Base URL is required'});
    const target = safeTarget(baseUrl, apiPath);
    const h = {'Accept':'application/json, text/event-stream, */*', ...headers};
    if (token) h.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    let payload;
    if (body !== undefined && body !== null && method.toUpperCase() !== 'GET') {
      h['Content-Type'] = h['Content-Type'] || 'application/json';
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const started = Date.now();
    const upstream = await fetch(target, {method:method.toUpperCase(), headers:h, body:payload, redirect:'manual'});
    const contentType = upstream.headers.get('content-type') || '';
    if (stream || contentType.includes('text/event-stream')) {
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType || 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Upstream-Latency-Ms', String(Date.now()-started));
      return res.send(text);
    }
    const ab = await upstream.arrayBuffer();
    const buf = Buffer.from(ab);
    const isBinary = !contentType.includes('json') && !contentType.startsWith('text/') && !contentType.includes('xml');
    return res.status(200).json({
      upstreamStatus: upstream.status,
      latencyMs: Date.now()-started,
      contentType,
      headers: Object.fromEntries([...upstream.headers.entries()].filter(([k])=>!['set-cookie','authorization'].includes(k.toLowerCase()))),
      isBinary,
      body: isBinary ? buf.toString('base64') : buf.toString('utf8')
    });
  } catch (e) {
    return res.status(500).json({error:e.message || String(e)});
  }
}
