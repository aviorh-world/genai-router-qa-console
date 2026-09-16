const TARGET = 'https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api/v1/conversations/new';
const BODY = { appId: 'Desktop', userId: 'aviorha@ita.gov.il', caseId: '123456789' };

function bearer(token) {
  const t = String(token || '').trim();
  if (!t) return '';
  return /^Bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}
function logId(){ return `exact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
function safeHeaders(headers){
  const out={};
  for(const k of ['content-type','www-authenticate','x-cloud-trace-context','x-request-id','server','via','date']){
    const v=headers.get(k); if(v) out[k]=v;
  }
  return out;
}
function classify(status, contentType, text){
  const t=String(text||'');
  if(/Blocked By Category/i.test(t) || /Suspicious/i.test(t) || /הגישה לדף אינה מורשית/i.test(t)) return 'SECURITY_GATE_BLOCKED';
  if(status===201) return 'ROUTER_REACHED_CREATE_OK';
  if(status===401 || status===403) return 'UPSTREAM_AUTH_OR_AUTHZ_REJECTED';
  if(status>=200 && status<300) return 'UPSTREAM_REACHED_OK';
  if(/text\/html/i.test(contentType||'')) return 'HTML_UPSTREAM_ERROR';
  return 'UPSTREAM_ERROR';
}

export default async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  const id=logId();
  const started=Date.now();
  try{
    const payload=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const auth=bearer(payload.token);
    if(!auth) return res.status(400).json({error:'Identity Token is required',logId:id});

    const requestEvidence={
      method:'POST',
      url:TARGET,
      headers:{
        'X-Serverless-Authorization':'Bearer [REDACTED]',
        'Authorization':'Bearer [REDACTED]',
        'Content-Type':'application/json',
        'Accept':'application/json, */*'
      },
      body:BODY
    };

    const upstream=await fetch(TARGET,{
      method:'POST',
      headers:{
        'X-Serverless-Authorization':auth,
        'Authorization':auth,
        'Content-Type':'application/json',
        'Accept':'application/json, */*'
      },
      body:JSON.stringify(BODY),
      redirect:'manual'
    });
    const text=await upstream.text();
    const contentType=upstream.headers.get('content-type')||'';
    const classification=classify(upstream.status,contentType,text);
    const result={
      logId:id,
      test:'EXACT_POSTMAN_CREATE_FROM_VERCEL',
      classification,
      request:requestEvidence,
      response:{
        status:upstream.status,
        statusText:upstream.statusText||'',
        latencyMs:Date.now()-started,
        contentType,
        headers:safeHeaders(upstream.headers),
        bodyPreview:text.slice(0,5000)
      }
    };
    console.log('[EXACT_POSTMAN_TEST]',JSON.stringify({...result,response:{...result.response,bodyPreview:result.response.bodyPreview.slice(0,1000)}}));
    return res.status(200).json(result);
  }catch(e){
    const result={logId:id,test:'EXACT_POSTMAN_CREATE_FROM_VERCEL',classification:'VERCEL_FETCH_ERROR',error:e?.message||String(e),latencyMs:Date.now()-started};
    console.error('[EXACT_POSTMAN_TEST_ERROR]',JSON.stringify(result));
    return res.status(200).json(result);
  }
}
