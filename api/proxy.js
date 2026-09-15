const ALLOWED_DEFAULTS=[
  't-sh-apic.taxes.gov.il',
  'chat-router-942568278050.me-west1.run.app',
  'execution-instructions-rag-service-942568278050.me-west1.run.app'
];

function allowedHosts(){
  const extra=(process.env.TSH_ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean);
  return new Set([...ALLOWED_DEFAULTS,...extra]);
}
function cleanToken(v=''){return String(v).replace(/^Bearer\s+/i,'').trim();}
function safeJson(res,status,obj){res.status(status).setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(obj));}

export default async function handler(req,res){
  if(req.method!=='POST')return safeJson(res,405,{error:'Method not allowed'});
  try{
    const {url,method='GET',token='',authHeader='Authorization',body,accept='application/json, text/event-stream, */*'}=req.body||{};
    if(!url)return safeJson(res,400,{error:'Missing target URL'});
    let target;
    try{target=new URL(url);}catch{return safeJson(res,400,{error:'Invalid target URL'});}
    if(target.protocol!=='https:')return safeJson(res,400,{error:'Only HTTPS targets are allowed'});
    if(!allowedHosts().has(target.hostname))return safeJson(res,403,{error:'Target host is not allowed',detail:target.hostname});

    const t=cleanToken(token);
    if(!t)return safeJson(res,400,{error:'Missing token'});
    const headers={'Accept':accept};
    headers[String(authHeader||'Authorization')]=`Bearer ${t}`;
    let payload;
    const m=String(method||'GET').toUpperCase();
    if(body!==undefined && body!==null && !['GET','HEAD'].includes(m)){
      headers['Content-Type']='application/json';
      payload=JSON.stringify(body);
    }

    let upstream;
    try{
      upstream=await fetch(target.toString(),{method:m,headers,body:payload,redirect:'manual'});
    }catch(e){
      return safeJson(res,502,{error:'Upstream network failure',detail:e.message});
    }

    res.status(upstream.status);
    const ct=upstream.headers.get('content-type')||'';
    if(ct)res.setHeader('Content-Type',ct);
    const requestId=upstream.headers.get('x-request-id');
    if(requestId)res.setHeader('X-Upstream-Request-Id',requestId);

    if(ct.includes('text/event-stream') && upstream.body){
      res.setHeader('Cache-Control','no-cache, no-transform');
      const reader=upstream.body.getReader();
      const decoder=new TextDecoder();
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        res.write(decoder.decode(value,{stream:true}));
      }
      return res.end();
    }
    const text=await upstream.text();
    return res.end(text);
  }catch(e){
    return safeJson(res,500,{error:'Proxy failure',detail:e.message});
  }
}
