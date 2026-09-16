// GenAI Router QA Console hotfix 0.02.3
// Supports the CURRENT browser contract: { url, token, method, body, accept, stream }
// Also supports the older { baseUrl, apiPath, ... } contract.
// Fixes duplicated endpoint paths, sends the Identity Token in BOTH required headers,
// and returns redacted diagnostics on every upstream error.

const ROUTER_BASE_URL =
  process.env.ROUTER_BASE_URL ||
  'https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api';

const ALLOWED = new Set([
  'GET /health',
  'POST /v1/files/download',
  'POST /v1/conversations/new',
  'POST /v1/conversations/history',
  'POST /v1/conversations/id',
  'DELETE /v1/conversations/id',
  'POST /v1/conversations/messages',
  'POST /v1/conversations/fetch/chunks/text',
  'POST /v1/messages/send/feedback',
  'POST /v1/statistics/active-users',
  'POST /v1/statistics/conversations/count',
  'POST /v1/statistics/conversations/count-by-user',
  'POST /v1/statistics/messages/user/count',
  'POST /v1/statistics/conversations/average-user-messages',
  'POST /v1/statistics/conversations/user-message-buckets',
  'POST /v1/statistics/messages/average-duration',
  'POST /v1/statistics/tools/count',
  'POST /v1/statistics/tools/average-duration',
  'POST /v1/statistics/tools/success-rate',
  'POST /v1/statistics/tokens/total',
  'POST /v1/statistics/tokens/average-per-conversation',
  'POST /v1/statistics/tokens/by-user',
  'POST /v1/statistics/feedback/thumbs-comparison'
]);

function makeLogId() {
  return `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function normalizeToken(token) {
  if (!token) return '';
  const t = String(token).trim();
  return /^Bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

function normalizeApiPath({ url, baseUrl, apiPath }) {
  // Preferred contract: explicit apiPath.
  if (apiPath) {
    const p = String(apiPath).trim();
    if (p === '/health' || p.startsWith('/v1/')) return p;
  }

  // Current deployed UI sends a full `url`.
  // If an endpoint was accidentally appended twice, e.g.
  // .../v1/conversations/new/v1/conversations/history
  // use the LAST /v1/... segment because that is the endpoint the UI is currently executing.
  const raw = String(url || baseUrl || '').trim();
  if (!raw) return '/';

  let pathname;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }

  const lastV1 = pathname.lastIndexOf('/v1/');
  if (lastV1 >= 0) return pathname.slice(lastV1);

  const healthIdx = pathname.lastIndexOf('/health');
  if (healthIdx >= 0) return '/health';

  const prefix = '/ita-chat-router-api';
  const prefixIdx = pathname.indexOf(prefix);
  if (prefixIdx >= 0) {
    const rest = pathname.slice(prefixIdx + prefix.length);
    return rest || '/';
  }

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function buildTarget(apiPath) {
  const base = ROUTER_BASE_URL.replace(/\/+$/, '');
  const path = String(apiPath || '/').replace(/^\/+/, '');
  return `${base}/${path}`;
}

function safeHeaders(headers) {
  const out = {};
  for (const name of [
    'content-type',
    'www-authenticate',
    'x-cloud-trace-context',
    'x-request-id',
    'server',
    'via',
    'date'
  ]) {
    const v = headers.get(name);
    if (v) out[name] = v;
  }
  return out;
}

function bodyPreview(text, max = 1500) {
  if (!text) return '';
  return String(text).slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const logId = makeLogId();
  const started = Date.now();

  try {
    const p = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const method = String(p.method || 'GET').toUpperCase();
    const apiPath = normalizeApiPath(p);
    const target = buildTarget(apiPath);
    const token = normalizeToken(p.token);
    const stream = !!p.stream || apiPath === '/v1/conversations/messages';

    const diagnostics = {
      logId,
      request: {
        method,
        apiPath,
        target,
        receivedUrl: p.url ? String(p.url).replace(/([?&](?:token|key|secret)=[^&]+)/ig, '[REDACTED]') : null,
        tokenPresent: !!token,
        xServerlessAuthorizationSent: !!token,
        authorizationSent: !!token,
        contentTypeSent: ['GET', 'HEAD'].includes(method) ? null : 'application/json'
      }
    };

    if (!ALLOWED.has(`${method} ${apiPath}`)) {
      diagnostics.error = 'Endpoint is not in QA proxy allow-list';
      console.error('[QA_PROXY_REJECTED]', JSON.stringify(diagnostics));
      return res.status(400).json({
        error: 'Endpoint is not allowed',
        diagnostics
      });
    }

    const headers = {
      Accept: p.accept || 'application/json, text/event-stream, */*'
    };

    // Confirmed from the working Postman request:
    // the SAME Google Identity Token is required in BOTH headers.
    if (token) {
      headers['X-Serverless-Authorization'] = token;
      headers['Authorization'] = token;
    }

    let payload;
    if (!['GET', 'HEAD'].includes(method) && p.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = typeof p.body === 'string' ? p.body : JSON.stringify(p.body);
    }

    const controller = new AbortController();
    const timeoutMs = Number(p.timeoutMs || (stream ? 120000 : 45000));
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let upstream;
    try {
      upstream = await fetch(target, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - started;
    const contentType = upstream.headers.get('content-type') || '';
    diagnostics.response = {
      status: upstream.status,
      statusText: upstream.statusText || '',
      latencyMs,
      contentType,
      headers: safeHeaders(upstream.headers)
    };

    res.setHeader('X-QA-Debug-Log-Id', logId);
    res.setHeader('X-QA-Upstream-Status', String(upstream.status));

    if (stream || contentType.includes('text/event-stream')) {
      if (upstream.status >= 400) {
        // Error streams are small enough to read as text and return with diagnostics.
        const txt = await upstream.text().catch(() => '');
        diagnostics.response.bodyPreview = bodyPreview(txt);
        console.error('[QA_PROXY_UPSTREAM_ERROR]', JSON.stringify(diagnostics));
        return res.status(200).json({
          upstreamStatus: upstream.status,
          status: upstream.status,
          latencyMs,
          contentType,
          isBinary: false,
          body: txt,
          diagnostics
        });
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType || 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');

      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    const ab = await upstream.arrayBuffer();
    const buf = Buffer.from(ab);
    const isBinary =
      !contentType.includes('json') &&
      !contentType.startsWith('text/') &&
      !contentType.includes('xml');

    const responseBody = isBinary ? buf.toString('base64') : buf.toString('utf8');

    if (upstream.status >= 400) {
      diagnostics.response.bodyPreview = isBinary ? '[binary]' : bodyPreview(responseBody);
      console.error('[QA_PROXY_UPSTREAM_ERROR]', JSON.stringify(diagnostics));
    } else {
      console.log('[QA_PROXY_OK]', JSON.stringify({
        logId,
        method,
        apiPath,
        target,
        upstreamStatus: upstream.status,
        latencyMs
      }));
    }

    // Keep HTTP 200 between browser and Vercel so the current frontend can read
    // the actual Router status from upstreamStatus/status.
    return res.status(200).json({
      upstreamStatus: upstream.status,
      status: upstream.status,
      latencyMs,
      contentType,
      isBinary,
      body: responseBody,
      diagnostics
    });

  } catch (e) {
    const msg = e?.name === 'AbortError'
      ? 'Upstream request timed out'
      : (e?.message || String(e));

    const diagnostics = {
      logId,
      errorName: e?.name || 'Error',
      error: msg,
      causeCode: e?.cause?.code || null,
      latencyMs: Date.now() - started
    };

    console.error('[QA_PROXY_ERROR]', JSON.stringify(diagnostics));

    return res.status(502).json({
      error: `QA Proxy Log ID: ${logId}\n${msg}`,
      diagnostics
    });
  }
}
