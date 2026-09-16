// GenAI Router QA Console proxy hotfix 0.02.2 — dual auth headers + safe diagnostics
import dns from 'node:dns/promises';
import net from 'node:net';

const ALLOWED = new Map([
  ['GET /health', true],
  ['POST /v1/files/download', true],
  ['POST /v1/conversations/new', true],
  ['POST /v1/conversations/history', true],
  ['POST /v1/conversations/id', true],
  ['DELETE /v1/conversations/id', true],
  ['POST /v1/conversations/messages', true],
  ['POST /v1/conversations/fetch/chunks/text', true],
  ['POST /v1/messages/send/feedback', true],
  ['POST /v1/statistics/active-users', true],
  ['POST /v1/statistics/conversations/count', true],
  ['POST /v1/statistics/conversations/count-by-user', true],
  ['POST /v1/statistics/messages/user/count', true],
  ['POST /v1/statistics/conversations/average-user-messages', true],
  ['POST /v1/statistics/conversations/user-message-buckets', true],
  ['POST /v1/statistics/messages/average-duration', true],
  ['POST /v1/statistics/tools/count', true],
  ['POST /v1/statistics/tools/average-duration', true],
  ['POST /v1/statistics/tools/success-rate', true],
  ['POST /v1/statistics/tokens/total', true],
  ['POST /v1/statistics/tokens/average-per-conversation', true],
  ['POST /v1/statistics/tokens/by-user', true],
  ['POST /v1/statistics/feedback/thumbs-comparison', true]
]);

function isPrivateIp(ip){
  if(!net.isIP(ip)) return false;
  if(ip==='127.0.0.1'||ip==='::1'||ip==='0.0.0.0') return true;
  if(ip.startsWith('10.')||ip.startsWith('192.168.')||ip.startsWith('169.254.')) return true;
  if(ip.startsWith('172.')){const n=Number(ip.split('.')[1]); if(n>=16&&n<=31)return true;}
  if(ip.startsWith('fc')||ip.startsWith('fd')||ip.startsWith('fe80:')) return true;
  return false;
}

async function safeTarget(baseUrl, apiPath, method){
  const base = new URL(baseUrl);
  if(base.protocol !== 'https:') throw new Error('Only HTTPS Base URL is allowed');
  if(base.username || base.password) throw new Error('Credentials in Base URL are not allowed');
  if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(base.hostname)) throw new Error('Localhost is not allowed');
  if(isPrivateIp(base.hostname)) throw new Error('Private IP targets are not allowed');
  const allowedHosts=(process.env.TSH_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(allowedHosts.length && !allowedHosts.includes(base.hostname.toLowerCase())) throw new Error('Host is not in TSH_ALLOWED_HOSTS');
  if(!ALLOWED.has(`${method.toUpperCase()} ${apiPath}`)) throw new Error('Endpoint/method is not allowed by this QA proxy');
  const normalizedBase = base.toString().replace(/\/?$/, '/');
  const normalizedApiPath = String(apiPath || '').replace(/^\/+/, '');
  const target = new URL(normalizedApiPath, normalizedBase);
  if (target.origin !== base.origin) throw new Error('Target origin must match Base URL');
  try{
    const answers=await dns.lookup(base.hostname,{all:true});
    if(answers.some(a=>isPrivateIp(a.address))) throw new Error('Resolved target is private/internal and cannot be proxied from public Vercel');
  }catch(e){
    if(String(e.message).includes('private/internal')) throw e;
    // DNS resolution errors are allowed to reach fetch, which will return the real connectivity error.
  }
  return target;
}


function safeHeaderSubset(headers){
  const names = [
    'www-authenticate',
    'x-cloud-trace-context',
    'x-request-id',
    'server',
    'via',
    'date'
  ];
  const out = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function debugSummary(d){
  const lines = [
    `QA Proxy Log ID: ${d.logId}`,
    `Request: ${d.request.method} ${d.request.target}`,
    `API Path: ${d.request.apiPath}`,
    `Auth token present: ${d.request.tokenPresent}`,
    `X-Serverless-Authorization sent: ${d.request.authHeaders.xServerlessAuthorization}`,
    `Authorization sent: ${d.request.authHeaders.authorization}`,
    `Upstream HTTP: ${d.response?.status ?? 'N/A'} ${d.response?.statusText ?? ''}`.trim(),
    `Content-Type: ${d.response?.contentType || 'N/A'}`,
    `Latency: ${d.response?.latencyMs ?? 'N/A'} ms`
  ];
  if (d.response?.bodyPreview) lines.push(`Body preview: ${d.response.bodyPreview}`);
  if (d.error) lines.push(`Proxy error: ${d.error}`);
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const p = req.body || {};
    const { baseUrl, token, authHeader='X-Serverless-Authorization', method='GET', apiPath='/', body, stream=false } = p;
    if (!baseUrl) return res.status(400).json({error:'Base URL is required'});
    const target = await safeTarget(baseUrl, apiPath, method);
    const payloadText = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    if(payloadText.length > 512_000) return res.status(413).json({error:'Request body is too large'});
    const h = {'Accept':'application/json, text/event-stream, */*'};

    // Router authentication currently requires the SAME Identity Token in both headers.
    // Keep authHeader in the request contract for backward compatibility, but do not rely on it.
    const bearer = token ? (token.startsWith('Bearer ') ? token : `Bearer ${token}`) : '';
    if (bearer) {
      h['X-Serverless-Authorization'] = bearer;
      h['Authorization'] = bearer;
    }
    let payload;
    if (body !== undefined && body !== null && method.toUpperCase() !== 'GET') {
      h['Content-Type'] = 'application/json';
      payload = payloadText;
    }
    const controller=new AbortController();
    const timeoutMs=apiPath==='/v1/conversations/messages'?60_000:30_000;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    const started = Date.now();
    let upstream;
    try{
      upstream = await fetch(target, {method:method.toUpperCase(), headers:h, body:payload, redirect:'manual', signal:controller.signal});
    } finally { clearTimeout(timer); }
    const contentType = upstream.headers.get('content-type') || '';
    const latencyMs = Date.now()-started;
    const logId = `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    const baseDebug = {
      logId,
      request: {
        method: method.toUpperCase(),
        target: target.toString(),
        apiPath,
        tokenPresent: !!token,
        authHeaders: {
          xServerlessAuthorization: !!h['X-Serverless-Authorization'],
          authorization: !!h['Authorization']
        },
        bodyBytes: payloadText ? Buffer.byteLength(payloadText, 'utf8') : 0
      },
      response: {
        status: upstream.status,
        statusText: upstream.statusText || '',
        contentType,
        latencyMs,
        headers: safeHeaderSubset(upstream.headers)
      }
    };

    if (stream || contentType.includes('text/event-stream')) {
      if (upstream.status >= 400) {
        console.error('[QA_PROXY_UPSTREAM_ERROR]', JSON.stringify(baseDebug));
      }
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType || 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Upstream-Latency-Ms', String(latencyMs));
      res.setHeader('X-QA-Debug-Log-Id', logId);
      res.setHeader('X-QA-Upstream-Status', String(upstream.status));
      if(!upstream.body) return res.end();
      const reader=upstream.body.getReader();
      while(true){ const {done,value}=await reader.read(); if(done)break; res.write(Buffer.from(value)); }
      return res.end();
    }

    const ab = await upstream.arrayBuffer();
    const buf = Buffer.from(ab);
    const isBinary = !contentType.includes('json') && !contentType.startsWith('text/') && !contentType.includes('xml');
    const responseBody = isBinary ? buf.toString('base64') : buf.toString('utf8');

    if (upstream.status >= 400) {
      const debug = {
        ...baseDebug,
        response: {
          ...baseDebug.response,
          bodyPreview: isBinary ? '[binary response]' : responseBody.slice(0, 1200)
        }
      };
      console.error('[QA_PROXY_UPSTREAM_ERROR]', JSON.stringify(debug));

      // Connection/Token check uses /health. Surface a readable, redacted diagnostic
      // through the existing UI instead of only showing "HTTP 403".
      if (apiPath === '/health') {
        return res.status(502).json({
          error: debugSummary(debug),
          diagnostics: debug
        });
      }
    }

    res.setHeader('X-QA-Debug-Log-Id', logId);
    res.setHeader('X-QA-Upstream-Status', String(upstream.status));
    return res.status(200).json({
      upstreamStatus: upstream.status,
      latencyMs,
      contentType,
      isBinary,
      body: responseBody,
      diagnostics: baseDebug
    });
  } catch (e) {
    const msg=e?.name==='AbortError'?'Upstream request timed out':(e.message || String(e));
    const logId = `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    const diagnostics = {
      logId,
      errorName: e?.name || 'Error',
      error: msg,
      causeCode: e?.cause?.code || null
    };
    console.error('[QA_PROXY_ERROR]', JSON.stringify(diagnostics));
    return res.status(502).json({
      error: `QA Proxy Log ID: ${logId}\n${msg}`,
      diagnostics
    });
  }
}
