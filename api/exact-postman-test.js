const TARGET = 'https://chat-router-942568278050.me-west1.run.app/ita-chat-router-api/v1/conversations/new';
const BODY = { appId: 'Desktop', userId: 'aviorha@ita.gov.il', caseId: '123456789' };

const EXPECTED_AUDIENCE = 'https://chat-router-942568278050.me-west1.run.app';

function decodeJwtPayload(auth){
  try{
    const raw=String(auth||'').replace(/^Bearer\s+/i,'').trim();
    const parts=raw.split('.');
    if(parts.length!==3) return {isJwt:false};
    const json=Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
    const c=JSON.parse(json);
    const now=Math.floor(Date.now()/1000);
    return {
      isJwt:true,
      iss:c.iss||null,
      aud:c.aud||null,
      email:c.email||null,
      emailVerified:c.email_verified??null,
      iat:c.iat||null,
      exp:c.exp||null,
      expired:typeof c.exp==='number'?c.exp<=now:null,
      expiresInSec:typeof c.exp==='number'?c.exp-now:null,
      audienceMatchesService:c.aud?c.aud===EXPECTED_AUDIENCE||c.aud===EXPECTED_AUDIENCE+'/':null
    };
  }catch(e){ return {isJwt:false,decodeError:e?.message||String(e)}; }
}

function diagnosisFor(status, tokenInfo, contentType, text){
  const hints=[];
  if(tokenInfo?.expired) hints.push('ה-Identity Token פג תוקף.');
  if(tokenInfo?.aud && tokenInfo.audienceMatchesService===false) hints.push(`ה-aud של הטוקן אינו כתובת שירות ה-Cloud Run הצפויה (${EXPECTED_AUDIENCE}).`);
  if(status===403) hints.push('403 מ-Cloud Run מתאים בין היתר למצב שבו הזהות שבטוקן אינה מורשית כ-Cloud Run Invoker (run.routes.invoke / roles/run.invoker), או כשהאימות שנשלח אינו מתקבל עבור השירות.');
  if(status===401) hints.push('401 מתאים בדרך כלל לטוקן חסר/לא תקין/לא מתאים ליעד.');
  if(/text\/html/i.test(contentType||'') || /^\s*<!doctype/i.test(String(text||''))) hints.push('ה-Upstream החזיר HTML ולא JSON; ה-bodyPreview למטה נועד לזהות מי החזיר את דף החסימה.');
  return hints;
}

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

    const tokenInfo=decodeJwtPayload(auth);
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
      tokenDiagnostics:tokenInfo,
      response:{
        status:upstream.status,
        statusText:upstream.statusText||'',
        latencyMs:Date.now()-started,
        contentType,
        headers:safeHeaders(upstream.headers),
        bodyPreview:text.slice(0,5000)
      },
      diagnosis:diagnosisFor(upstream.status,tokenInfo,contentType,text)
    };
    console.log('[EXACT_POSTMAN_TEST]',JSON.stringify({...result,response:{...result.response,bodyPreview:result.response.bodyPreview.slice(0,1000)}}));
    return res.status(200).json(result);
  }catch(e){
    const result={logId:id,test:'EXACT_POSTMAN_CREATE_FROM_VERCEL',classification:'VERCEL_FETCH_ERROR',error:e?.message||String(e),latencyMs:Date.now()-started};
    console.error('[EXACT_POSTMAN_TEST_ERROR]',JSON.stringify(result));
    return res.status(200).json(result);
  }
}
