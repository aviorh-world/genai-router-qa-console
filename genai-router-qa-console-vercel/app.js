const state = {
  tests: [], questions: [], operations: [], results: {}, lastStream: '', aiRating: null,
  demo: false, createdConversationId: null, selectedTestId: null,
  context: null, tokenMarkedAt: null, connectionOk: false
};

const $ = (id) => document.getElementById(id);
const esc = (v='') => String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const now = () => new Date().toISOString();

const CONTRACT_GAPS = [
  {severity:'MEDIUM',area:'Authentication',gap:'ב־Swagger לא מוגדר securityScheme. לפי ההנחיה שהתקבלה ה-Identity Token מופק ב-gcloud auth print-identity-token ונשלח ב-X-Serverless-Authorization: Bearer <TOKEN>.',impact:'דרך ההזדהות ידועה כעת, אך עדיין חסרים תיעוד פורמלי ב-Swagger וקודי שגיאה מוסכמים.'},
  {severity:'HIGH',area:'Environment / Network',gap:'ה־servers ב־Swagger אינו מצביע על TSH. הצוות ציין שנדרשת תקשורת TSH↔NON-PROD והרשאה לשירות.',impact:'Vercel ציבורי עלול לא להגיע ליעד; יש להריץ Browser Direct או Postman מתוך הרשת המתאימה.'},
  {severity:'MEDIUM',area:'Case ID',gap:'הצוות הבהיר ש-Case ID אינו קריטי להתנעה ויכול להיות ערך בדיקה; Swagger מגדיר 9 ספרות ו-nullable אך לא required.',impact:'Test Data כבר לא blocker, אך missing/null עדיין דורשים אישור Runtime.'},
  {severity:'HIGH',area:'History / Messages',gap:'הדרישה העסקית היא 20 הודעות אחרונות, אבל הכמות והסדר אינם Contract מפורש ב-Get Conversation.',impact:'לא ניתן לקבוע PASS/FAIL חד־משמעי לסדר ולגבול בלי walkthrough.'},
  {severity:'MEDIUM',area:'Delete / State',gap:'AlloyDB מזוהה כ-DB של sessions/state/logs, אך לא מוגדר אם Delete הוא Hard/Soft ומה משתנה בטבלאות.',impact:'אימות persistence נשאר ידני עד לקבלת table/schema + business rule.'},
  {severity:'MEDIUM',area:'Streaming',gap:'קיים event בשם thought ללא הגדרה האם זה Progress מסונן או reasoning פנימי.',impact:'נדרשת בדיקת אבטחה שאין חשיפת System Prompt/Chain-of-Thought.'},
  {severity:'MEDIUM',area:'Message Length',gap:'Request מאפשר עד 32,768 תווים בעוד Message persisted/returned מתועד עד 8,192.',impact:'לא ברור מה Expected עבור הודעה גדולה מ־8,192.'},
  {severity:'MEDIUM',area:'Authorization / Sources',gap:'מסמך ההרשאות מגדיר least-privilege ל-Service Accounts, אך לא ownership אפליקטיבי של File/Chunk/Case למשתמש.',impact:'בדיקות IDOR על GCS/Chunks עדיין דורשות כלל הרשאה מוסכם.'}
];

function validCaseId(v){ return /^\d{9}$/.test(v||''); }
function readiness(){
  const c=cfg();
  const tokenAge = state.tokenMarkedAt ? Date.now()-state.tokenMarkedAt : null;
  const tokenFresh = !c.token ? false : tokenAge==null ? true : tokenAge < 60*60*1000;
  const items=[
    ['TSH Base URL',!!c.baseUrl,'הערך עצמו עדיין חסר; לפי הצוות הוא אצל אנדריי'],
    ['Identity Token',!!c.token&&tokenFresh,'gcloud auth print-identity-token · תוקף ~שעה'],
    ['App ID',!!c.appId,'ברירת מחדל מה-Swagger: Desktop'],
    ['User ID',!!c.userId,'aviorha@taxes.gov.il'],
    ['Case ID',!c.caseId||validCaseId(c.caseId),'לא blocker; אם נשלח — 9 ספרות'],
    ['Cloud Access',c.cloudAccessConfirmed||state.connectionOk,'משתמש ענן + הרשאה לשירות Router']
  ];
  if($('readinessGrid')) $('readinessGrid').innerHTML=items.map(([n,ok,d])=>`<div class="ready-item ${ok?'ok':'missing'}"><b>${ok?'✓':'○'} ${esc(n)}</b><span>${esc(d)}</span></div>`).join('');
  const executable = c.executionMode!=='postman';
  const core=[
    ['Connection target',!!c.baseUrl,'TSH Base URL מדויק'],
    ['Identity',!!c.token&&tokenFresh&&!!c.userId,'X-Serverless-Authorization + aviorha@taxes.gov.il'],
    ['Test defaults',!!c.appId&&(!c.caseId||validCaseId(c.caseId)),'App ID=Desktop; Case ID יכול להיות ערך בדיקה'],
    ['Execution path',executable,'Browser Direct / Proxy; במצב Postman האתר מייצר בקשות בלבד']
  ];
  if($('blockingSummary')) $('blockingSummary').innerHTML=core.map(([n,ok,d])=>`<div class="block-card"><b>${ok?'✅':'⏳'} ${esc(n)}</b><small>${esc(d)}</small></div>`).join('');
  const all=core.every(x=>x[1]); const badge=$('startBadge'); if(badge){badge.textContent=all?'מוכן להרצה':'ממתין לנתונים';badge.className='badge '+(all?'pass':'question');}
  updateTokenCountdown();
  return all;
}
function copyQuestions(){
  const txt=`היי, עדכון: דרך ההזדהות כבר ברורה — gcloud auth print-identity-token ושליחה ב-X-Serverless-Authorization: Bearer <TOKEN>. כדי להתחיל הרצה אמיתית חסרים לי בעיקר:\n1. ה-TSH Base URL המדויק.\n2. לוודא שהיוזר הענני שלי מורשה להפעיל את ה-Router.\n3. בהמשך walkthrough קצר על State/Delete, 20 messages ו-RBAC כדי לסגור Expected Results.`;
  navigator.clipboard?.writeText(txt).then(()=>{const b=$('copyQuestionsBtn'); const old=b.textContent;b.textContent='הועתק ✓';setTimeout(()=>b.textContent=old,1500)}).catch(()=>alert(txt));
}
function markTokenNow(){ state.tokenMarkedAt=Date.now(); updateTokenCountdown(); readiness(); }
function updateTokenCountdown(){
  const el=$('tokenExpiry'); if(!el) return;
  if(!state.tokenMarkedAt){el.textContent='לא סומן זמן הפקה';el.className='field-help';return;}
  const remain=60*60*1000-(Date.now()-state.tokenMarkedAt);
  if(remain<=0){el.textContent='Token כנראה פג תוקף — הפק חדש';el.className='field-help token-expired';return;}
  const m=Math.floor(remain/60000), sec=Math.floor((remain%60000)/1000);
  el.textContent=`תוקף משוער: עוד ${m}:${String(sec).padStart(2,'0')} דקות`;
  el.className='field-help'+(remain<10*60*1000?' token-warn':'');
}
function renderContract(){
  if(!$('contractTable')) return;
  $('contractTable').innerHTML=`<table class="qa-table"><thead><tr><th>חומרה</th><th>תחום</th><th>פער</th><th>השפעה על QA</th></tr></thead><tbody>${CONTRACT_GAPS.map(g=>`<tr><td class="contract-severity sev-${g.severity.toLowerCase()}">${g.severity}</td><td>${esc(g.area)}</td><td>${esc(g.gap)}</td><td>${esc(g.impact)}</td></tr>`).join('')}</tbody></table>`;
}
function parseSse(text=''){
  const events=[];
  for(const block of String(text).split(/\n\n+/)){
    const data=block.split(/\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
    if(!data) continue;
    try{const obj=JSON.parse(data);events.push(obj)}catch{events.push({type:'raw',data})}
  }
  return events;
}
function renderSseEvents(text){
  const events=parseSse(text); if(!$('aiEvents')) return events;
  $('aiEvents').innerHTML=events.length?events.map(e=>{const warn=String(e.type||'').toLowerCase()==='thought';return `<div class="event-chip ${warn?'warn':''}"><b>${esc(e.type||'unknown')}</b>${warn?' ⚠️ review for reasoning leakage':''}<br>${esc(JSON.stringify(e).slice(0,650))}</div>`}).join(''):'לא זוהו אירועי SSE.';
  return events;
}
function openTest(id){
  const t=state.tests.find(x=>x.ID===id); if(!t)return; state.selectedTestId=id;
  $('dialogTitle').textContent=`${t.ID} — ${t['תרחיש בדיקה']||''}`; $('dialogSubtitle').textContent=`${t.priority} · ${modeLabel(t.mode)} · ${t.Endpoint||''}`;
  $('dialogBody').innerHTML=[['תנאים מקדימים',t['תנאים מקדימים']],['צעדים / קלט',t['צעדים / קלט']],['Expected Result',t['Expected Result']],['שאלה פתוחה',t['שאלה פתוחה / נדרש אישור']],['מקור / הערה',t['מקור / הערה']]].filter(x=>x[1]).map(([a,b])=>`<div class="detail-row"><b>${esc(a)}</b>${esc(b)}</div>`).join('');
  $('manualNote').value=state.results[id]?.details||''; $('dialogRunBtn').style.display=t.mode==='manual'?'none':'inline-block'; $('testDialog').showModal();
}
function saveManual(status){ const id=state.selectedTestId;if(!id)return; result(id,status,'Manual review',$('manualNote').value.trim()||'סומן ידנית');$('testDialog').close(); }


function cfg(){
  return {
    baseUrl:$('baseUrl').value.trim(), token:$('token').value.trim(), appId:$('appId').value.trim(),
    userId:$('userId').value.trim(), caseId:$('caseId').value.trim() || null,
    userIdB:$('userIdB').value.trim(), tokenB:$('tokenB').value.trim(),
    conversationId:$('conversationId').value.trim(), messageId:$('messageId').value.trim(),
    executionMode:$('executionMode')?.value || 'direct', authHeader:$('authHeader')?.value || 'X-Serverless-Authorization', cloudAccessConfirmed:!!$('cloudAccessConfirmed')?.checked
  };
}
function requireFields(names){ const c=cfg(); const missing=names.filter(n=>!c[n]); if(missing.length) throw new Error('חסרים שדות: '+missing.join(', ')); return c; }
function setConn(text,kind='neutral'){ const el=$('connectionBadge'); el.textContent=text; el.className='badge '+kind; }

async function loadData(){
  const [raw,sw,context] = await Promise.all([
    fetch('/data/qa_tests_from_excel.json').then(r=>r.json()),
    fetch('/data/swagger-summary.json').then(r=>r.json()),
    fetch('/data/project-context.json').then(r=>r.json())
  ]);
  state.context=context;
  for(const sheet of ['01_P0_קריטי','02_P1_חשוב','03_P2_משלים']){
    const rows=raw[sheet]; const h=rows[0];
    for(const r of rows.slice(1)){
      const o=Object.fromEntries(h.map((x,i)=>[x,r[i]]));
      o.priority=o.ID.split('-')[0]; o.mode=getMode(o.ID); state.tests.push(o);
    }
  }
  const q=raw['04_שאלות_פתוחות']; const qh=q[0];
  state.questions=q.slice(1).map(r=>Object.fromEntries(qh.map((x,i)=>[x,r[i]])));

  const boundaryTests = [
    ['BND-001','P1','Validation','/v1/conversations/new','App ID ריק (0 תווים)','שלח appId=""','4xx Validation','auto'],
    ['BND-002','P1','Validation','/v1/conversations/new','User ID מעל 128 תווים','שלח email באורך >128','4xx Validation','auto'],
    ['BND-003','P1','Pagination','/v1/conversations/history','limit=1 (מינימום חוקי)','שלח limit=1','2xx','auto'],
    ['BND-004','P1','Pagination','/v1/conversations/history','limit=0 (מתחת למינימום)','שלח limit=0','4xx Validation','auto'],
    ['BND-005','P1','Pagination','/v1/conversations/history','offset=101 (מעל המקסימום)','שלח offset=101','4xx Validation','auto'],
    ['BND-006','P1','Feedback','/v1/messages/send/feedback','feedbackType לא חוקי','שלח feedbackType=invalid','4xx Validation','auto'],
    ['BND-007','P1','Feedback','/v1/messages/send/feedback','feedbackType=text ללא feedbackText','שלח type=text בלי טקסט','4xx Validation','auto'],
    ['BND-008','P1','Feedback','/v1/messages/send/feedback','feedbackText באורך 4001','שלח type=text ו-4001 תווים','4xx Validation','auto'],
    ['BND-009','P1','Chunks','/v1/conversations/fetch/chunks/text','מערך chunks ריק','chunks=[]','4xx Validation','auto'],
    ['BND-010','P1','Chunks','/v1/conversations/fetch/chunks/text','101 chunks (מעל maxItems)','שלח 101 פריטים','4xx Validation','auto'],
    ['BND-011','P1','Chunks','/v1/conversations/fetch/chunks/text','chunkId=-1','ערך מתחת למינימום','4xx Validation','auto'],
    ['BND-012','P1','Chunks','/v1/conversations/fetch/chunks/text','chunkId=10001','ערך מעל המקסימום','4xx Validation','auto'],
    ['BND-013','P1','Files','/v1/files/download','bucketName באורך 223','ערך אחד מעל maxLength=222','4xx Validation','auto'],
    ['BND-014','P1','Files','/v1/files/download','fileName באורך 1025','ערך אחד מעל maxLength=1024','4xx Validation','auto'],
    ['BND-015','P1','Statistics','/v1/statistics/active-users','startDate=endDate','טווח באורך אפס','4xx Validation','auto'],
    ['BND-016','P1','Statistics','/v1/statistics/active-users','Timestamp ללא 3 ספרות מילישניות','שלח ...00Z במקום ...00.000Z','4xx Validation','auto']
  ];
  for (const [ID,priority,domain,Endpoint,scenario,steps,expected,mode] of boundaryTests) {
    state.tests.push({ID,priority,mode,'תחום':domain,Endpoint,'תרחיש בדיקה':scenario,'תנאים מקדימים':'Base URL + Identity Token תקינים','צעדים / קלט':steps,'Expected Result':expected,'שאלה פתוחה / נדרש אישור':'','מקור / הערה':'Boundary Pack v1.3'});
  }
  state.operations=sw.operations;
  renderAll(); populateEndpoints();
}

const AUTO = new Set([
  'P0-001','P0-002','P0-003','P0-004','P0-005','P0-006','P0-007','P0-011','P0-012','P0-013','P0-015','P0-018','P0-019','P0-020','P0-022','P0-023','P0-025',
  'P1-001','P1-002','P1-003','P1-004','P1-005','P1-006','P1-007','P1-008','P1-009','P1-010','P1-012','P1-013','P1-014','P1-019','P1-020','P1-021','P1-024',
  'P2-001','P2-002','P2-003','P2-005','P2-007','P2-011'
]);
const ASSISTED = new Set([
  'P0-008','P0-009','P0-014','P0-016','P0-017','P0-021','P0-024','P0-026','P0-027','P0-028','P0-029','P0-030','P0-031','P0-032','P0-033','P0-034','P0-035','P0-036',
  'P1-011','P1-015','P1-016','P1-017','P1-018','P1-022','P1-023','P1-025','P1-026','P1-027','P1-028','P2-004','P2-014','P2-006','P2-008','P2-009','P2-010','P2-012','P2-013'
]);
function getMode(id){ return AUTO.has(id)?'auto':ASSISTED.has(id)?'assisted':'manual'; }
function modeLabel(m){return m==='auto'?'אוטומטי':m==='assisted'?'מסייע':'ידני';}

function requestBody(path,method,c=cfg()){
  switch(`${method} ${path}`){
    case 'POST /v1/conversations/new': return {appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{})};
    case 'POST /v1/conversations/history': return {appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{}),limit:20,offset:0};
    case 'POST /v1/conversations/id': case 'DELETE /v1/conversations/id': return {conversationId:c.conversationId,userId:c.userId};
    case 'POST /v1/conversations/messages': return {conversationId:c.conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:'בדיקת QA'};
    case 'POST /v1/messages/send/feedback': return {messageId:c.messageId,feedbackType:'thumbs_up'};
    case 'POST /v1/conversations/fetch/chunks/text': return {chunks:[{bucketName:'REPLACE_ME',fileName:'REPLACE_ME.pdf',chunkId:0}]};
    case 'POST /v1/files/download': return {bucketName:'REPLACE_ME',fileName:'REPLACE_ME.pdf'};
    default: if(path.includes('/statistics/')) return {startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date().toISOString()}; return {};
  }
}

function targetUrl(baseUrl,path){
  const b=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';
  const u=new URL(path.replace(/^\//,''),b);
  if(u.protocol!=='https:') throw new Error('TSH Base URL חייב להיות HTTPS');
  return u.toString();
}
async function directRequest({method,path,body,token,stream=false}){
  const c=cfg(); const url=targetUrl(c.baseUrl,path);
  const headers={'Accept':'application/json, text/event-stream, */*'};
  const tok=token===undefined?c.token:token; if(tok) headers[c.authHeader]=tok.startsWith('Bearer ')?tok:`Bearer ${tok}`;
  let payload;
  if(body!==undefined && body!==null && method.toUpperCase()!=='GET'){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const started=Date.now();
  let res;
  try{res=await fetch(url,{method:method.toUpperCase(),headers,body:payload});}
  catch(e){throw new Error('Browser Direct נכשל. ייתכן CORS או שאין גישה מהרשת הנוכחית ל-TSH. נסה Postman מתוך SH/TSH. '+(e.message||''));}
  const ct=res.headers.get('content-type')||'';
  if(stream||ct.includes('text/event-stream')) return {status:res.status,stream:res.body,headers:res.headers,latencyMs:Date.now()-started};
  const txt=await res.text(); let parsed=txt; try{parsed=JSON.parse(txt)}catch{}
  return {status:res.status,body:parsed,raw:txt,latencyMs:Date.now()-started,contentType:ct,isBinary:false};
}
async function proxy({method,path,body,token,stream=false}){
  const c=cfg(); if(state.demo) return demoResponse(method,path,body,stream);
  if(!c.baseUrl) throw new Error('יש להזין TSH Base URL');
  if(c.executionMode==='postman') throw new Error('מצב Postman/cURL אינו מריץ בקשות מהדפדפן. השתמש בכפתור "העתק cURL" והרץ בתוך הסביבה הפנימית.');
  if(c.executionMode==='direct') return directRequest({method,path,body,token,stream});
  const res=await fetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:c.baseUrl,token:token===undefined?c.token:token,authHeader:c.authHeader,method,apiPath:path,body,stream})});
  if(stream){ return {status:res.status,stream:res.body,headers:res.headers}; }
  const wrapper=await res.json();
  if(!res.ok) throw new Error(wrapper.error||'Proxy error');
  let parsed=wrapper.body; try{parsed=JSON.parse(wrapper.body)}catch{}
  return {status:wrapper.upstreamStatus, body:parsed, raw:wrapper.body, latencyMs:wrapper.latencyMs, contentType:wrapper.contentType, isBinary:wrapper.isBinary};
}
function buildCurl(method,path,body){
  const c=cfg(); const base=c.baseUrl||'<TSH_BASE_URL>'; let url;
  try{url=targetUrl(base,path)}catch{url=`${base.replace(/\/$/,'')}${path}`;}
  const parts=[`curl -i -X ${method.toUpperCase()} '${url}'`,`  -H '${c.authHeader}: Bearer <IDENTITY_TOKEN>'`,`  -H 'Accept: application/json, text/event-stream, */*'`];
  if(body!==undefined && body!==null && method.toUpperCase()!=='GET'){
    parts.push(`  -H 'Content-Type: application/json'`);
    const json=JSON.stringify(body).replace(/'/g,"'\\''");
    parts.push(`  --data '${json}'`);
  }
  return parts.join(' \\\n');
}
async function copyCurl(){
  const o=state.operations[+$('endpointSelect').value||0]; if(!o)return;
  let b; try{b=JSON.parse($('apiBody').value||'{}')}catch{alert('Request JSON אינו תקין');return;}
  const txt=buildCurl(o.method,o.path,o.method==='GET'?undefined:b);
  try{await navigator.clipboard.writeText(txt);const btn=$('copyCurlBtn');const old=btn.textContent;btn.textContent='cURL הועתק ✓';setTimeout(()=>btn.textContent=old,1500);}catch{prompt('העתק cURL',txt);}
}
function demoResponse(method,path,body,stream){
  if(stream){
    const lines=[
      'data: {"type":"messageId","messageId":"11111111-1111-4111-8111-111111111111"}\n\n',
      'data: {"type":"content","text":"זוהי תשובת Demo המבוססת על מסמך בדיקה."}\n\n',
      'data: {"type":"sources","sources":[{"fileName":"demo.pdf","chunkIds":[1]}]}\n\n',
      'data: {"type":"done"}\n\n'
    ].join('');
    return Promise.resolve({status:200,stream:new Blob([lines]).stream(),headers:new Headers({'content-type':'text/event-stream'})});
  }
  let status=200, response={ok:true,demo:true};
  if(path==='/v1/conversations/new'&&method==='POST') {status=201;response={conversationId:'00000000-0000-4000-8000-000000000001',...body};}
  if(path==='/v1/conversations/history') response={conversations:[{conversationId:'00000000-0000-4000-8000-000000000001',title:'Demo'}]};
  if(path==='/v1/conversations/id'&&method==='POST') response={conversationId:body?.conversationId,messages:[]};
  if(path==='/v1/conversations/id'&&method==='DELETE') response={conversationId:body?.conversationId};
  if(!body?.appId && path==='/v1/conversations/new') status=400;
  return Promise.resolve({status,body:response,raw:JSON.stringify(response),latencyMs:25,contentType:'application/json'});
}

function extractConversationId(body){ return body?.conversationId || body?.data?.conversationId || body?.conversation?.conversationId || null; }
function extractMessageIdFromText(text){ const m=text.match(/"messageId"\s*:\s*"([0-9a-f-]{36})"/i); return m?.[1]||null; }
async function readStream(stream,onChunk){
  const reader=stream.getReader(); const dec=new TextDecoder(); let full='';
  while(true){ const {done,value}=await reader.read(); if(done)break; const t=dec.decode(value,{stream:true}); full+=t; onChunk?.(t,full); }
  return full;
}

function expectStatus(actual, allowed){ return allowed.includes(actual); }
function result(id,status,actual='',details=''){
  state.results[id]={id,status,actual,details,time:now()}; renderKpis(); renderCatalog(); renderReport();
  return state.results[id];
}
function statusClass(s){return s==='PASS'?'status-pass':s==='FAIL'?'status-fail':s==='BLOCKED'?'status-blocked':'status-question';}

async function runTest(id){
  const t=state.tests.find(x=>x.ID===id); if(!t) return;
  try{
    if(t.mode==='manual') return result(id,'BLOCKED','בדיקה ידנית','אין דרך אוטומטית אמינה ללא מידע/גישה נוספים.');
    const c=cfg(); let r, body, pass, actual='';
    switch(id){
      case 'P0-001':
      case 'P2-001': r=await proxy({method:'GET',path:'/health'}); pass=expectStatus(r.status,[200]); actual=`HTTP ${r.status}`; break;
      case 'P2-002': r=await proxy({method:'GET',path:'/health'}); pass=r.status===200 && !/(password|secret|token|private[_ -]?key)/i.test(JSON.stringify(r.body)); actual=JSON.stringify(r.body).slice(0,400); break;
      case 'P0-002': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body}); pass=r.status>=200&&r.status<300; actual=`HTTP ${r.status}`; break;
      case 'P0-003': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body,token:''}); pass=[401,403].includes(r.status); actual=`HTTP ${r.status}`; break;
      case 'P0-004': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body,token:'definitely-invalid-token'}); pass=[401,403].includes(r.status); actual=`HTTP ${r.status}`; break;
      case 'P0-005': body=requestBody('/v1/conversations/new','POST'); r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status===201; {const x=extractConversationId(r.body); if(x){$('conversationId').value=x;state.createdConversationId=x;}} actual=`HTTP ${r.status} ${JSON.stringify(r.body).slice(0,350)}`; break;
      case 'P0-006': body=requestBody('/v1/conversations/new','POST'); delete body.appId; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P0-007': body=requestBody('/v1/conversations/new','POST'); delete body.userId; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P0-008': body=requestBody('/v1/conversations/new','POST'); delete body.caseId; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); return result(id,'QUESTION',`HTTP ${r.status}`,t['שאלה פתוחה / נדרש אישור']||'Expected פתוח');
      case 'P0-009': body=requestBody('/v1/conversations/new','POST'); body.caseId=null; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); return result(id,'QUESTION',`HTTP ${r.status}`,t['שאלה פתוחה / נדרש אישור']||'Expected פתוח');
      case 'P0-011': case 'P0-012': case 'P0-013':
      case 'P1-007': case 'P1-008': case 'P1-009': case 'P1-010':
        body=requestBody('/v1/conversations/history','POST');
        if(id==='P1-008') body.limit=100; if(id==='P1-009') body.limit=101; if(id==='P1-010') body.offset=100;
        r=await proxy({method:'POST',path:'/v1/conversations/history',body});
        if(id==='P1-009') pass=r.status>=400&&r.status<500; else pass=r.status>=200&&r.status<300;
        actual=`HTTP ${r.status} ${JSON.stringify(r.body).slice(0,350)}`; break;
      case 'P0-014':
        if(!c.userIdB) return result(id,'BLOCKED','חסר User B','הזן User ID B (ורצוי Token B אם נדרש)');
        body=requestBody('/v1/conversations/history','POST'); body.userId=c.userIdB; r=await proxy({method:'POST',path:'/v1/conversations/history',body,token:c.token}); return result(id,'QUESTION',`HTTP ${r.status}`, 'יש לוודא מול האפיון אם body userId חייב להיות קשור לזהות שב-Token.');
      case 'P0-015': case 'P0-018': case 'P1-012': case 'P1-013':
        body=requestBody('/v1/conversations/id','POST');
        if(id==='P0-018'){if(!c.userIdB)return result(id,'BLOCKED','חסר User B','הזן User B');body.userId=c.userIdB;}
        if(id==='P1-012') body.conversationId='11111111-1111-4111-8111-999999999999';
        if(id==='P1-013') body.conversationId='abc';
        r=await proxy({method:'POST',path:'/v1/conversations/id',body});
        pass=id==='P0-015'?r.status===200:id==='P0-018'?r.status===403:id==='P1-012'?r.status===404:(r.status>=400&&r.status<500); actual=`HTTP ${r.status}`; break;
      case 'P0-019': case 'P0-020': case 'P1-014':
        body=requestBody('/v1/conversations/id','DELETE');
        if(id==='P0-020'){if(!c.userIdB)return result(id,'BLOCKED','חסר User B','הזן User B');body.userId=c.userIdB;}
        if(id==='P1-014') body.conversationId='11111111-1111-4111-8111-999999999999';
        r=await proxy({method:'DELETE',path:'/v1/conversations/id',body}); pass=id==='P0-019'?r.status===200:id==='P0-020'?r.status===403:r.status===404; actual=`HTTP ${r.status}`; break;
      case 'P0-022': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body}); return result(id,'QUESTION',`HTTP ${r.status} ${JSON.stringify(r.body).slice(0,300)}`,'יש לבדוק שהשיחה שנמחקה אינה מופיעה; תלוי Hard/Soft Delete.');
      case 'P0-023': case 'P0-025':
        requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='בדיקת QA אוטומטית'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true});
        {const text=await readStream(r.stream); pass=r.status===200 && (id==='P0-025'?/"type"\s*:\s*"done"/.test(text):true); const mid=extractMessageIdFromText(text); if(mid)$('messageId').value=mid; actual=`HTTP ${r.status}\n${text.slice(0,800)}`;} break;
      case 'P0-024': if(!c.userIdB)return result(id,'BLOCKED','חסר User B','הזן User B'); body=requestBody('/v1/conversations/messages','POST'); body.userId=c.userIdB; body.content='cross user auth test'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream); return result(id,'QUESTION',`HTTP ${r.status}\n${text.slice(0,400)}`,'קוד השגיאה המצופה אינו סגור ב-Swagger.');}
      case 'P0-026': return result(id,'QUESTION','הרץ דרך GenAI/RAG Inspector','יש לבצע review לאירועי thought ולוודא שאין Chain-of-Thought/System Prompt.');
      case 'P0-027': return result(id,'QUESTION','מומלץ להריץ ידנית דרך API Runner','פער 32768 מול 8192 דורש החלטת Expected.');
      case 'P0-028': case 'P0-032': case 'P0-033': case 'P0-034': case 'P0-035': case 'P1-025': case 'P1-026': return result(id,'QUESTION','הרץ דרך GenAI/RAG Inspector','נדרש שיפוט איכות/Golden Dataset.');
      case 'P0-029': case 'P0-030': case 'P0-031': case 'P1-023': return result(id,'BLOCKED','נדרש source אמיתי','הזן bucket/file/chunk מתוך תשובת sources והריץ ב-API Runner.');
      case 'P0-036': return result(id,'BLOCKED','נדרש Fault Injection/DB visibility','לא ניתן להסיק State consistency מה-API בלבד.');
      case 'P1-001': body=requestBody('/v1/conversations/new','POST'); body.userId='abc'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-002': body=requestBody('/v1/conversations/new','POST'); body.caseId='12345678'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-003': body=requestBody('/v1/conversations/new','POST'); body.caseId='1234567890'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-004': body=requestBody('/v1/conversations/new','POST'); body.caseId='12345ABCD'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-005': body=requestBody('/v1/conversations/new','POST'); body.appId='A'.repeat(50); r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status===201; actual=`HTTP ${r.status}`; break;
      case 'P1-006': body=requestBody('/v1/conversations/new','POST'); body.appId='A'.repeat(51); r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-019': body=requestBody('/v1/conversations/new','POST'); body.unexpectedField='x'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-020': return result(id,'BLOCKED','ה-Proxy שולח JSON תקין בכוונה','בדיקת Content-Type שגוי עדיף לבצע ב-Postman/curl או להרחיב את ה-Proxy.');
      case 'P1-021': requireFields(['messageId']); body={messageId:c.messageId,feedbackType:'thumbs_up'}; r=await proxy({method:'POST',path:'/v1/messages/send/feedback',body}); pass=r.status===200; actual=`HTTP ${r.status}`; break;
      case 'P1-024': body={bucketName:'qa-nonexistent-bucket',fileName:'missing.pdf'}; r=await proxy({method:'POST',path:'/v1/files/download',body}); pass=r.status===404||r.status===400||r.status===403; actual=`HTTP ${r.status}`; break;
      case 'P2-003': requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='א'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream);pass=r.status===200;actual=`HTTP ${r.status}\n${text.slice(0,300)}`;} break;
      case 'P2-005': requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='א'.repeat(32769); r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream);pass=r.status>=400&&r.status<500;actual=`HTTP ${r.status}\n${text.slice(0,200)}`;} break;
      case 'P2-007': return result(id,'QUESTION','הרץ שאלה בעברית דרך GenAI Inspector ואז Get Conversation','בדיקת Round-trip דורשת תוכן עברי ידוע והשוואה.');
      case 'P2-011': return result(id,'BLOCKED','הזן טווח ללא נתונים דרך API Runner','Endpoint סטטיסטיקה נבחר לפי צורך.');
      case 'BND-001': body=requestBody('/v1/conversations/new','POST'); body.appId=''; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-002': body=requestBody('/v1/conversations/new','POST'); body.userId='a'.repeat(120)+'@taxes.gov.il'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-003': body=requestBody('/v1/conversations/history','POST'); body.limit=1; r=await proxy({method:'POST',path:'/v1/conversations/history',body}); pass=r.status>=200&&r.status<300; actual=`HTTP ${r.status}`; break;
      case 'BND-004': body=requestBody('/v1/conversations/history','POST'); body.limit=0; r=await proxy({method:'POST',path:'/v1/conversations/history',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-005': body=requestBody('/v1/conversations/history','POST'); body.offset=101; r=await proxy({method:'POST',path:'/v1/conversations/history',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-006': requireFields(['messageId']); body={messageId:c.messageId,feedbackType:'invalid'}; r=await proxy({method:'POST',path:'/v1/messages/send/feedback',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-007': requireFields(['messageId']); body={messageId:c.messageId,feedbackType:'text'}; r=await proxy({method:'POST',path:'/v1/messages/send/feedback',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-008': requireFields(['messageId']); body={messageId:c.messageId,feedbackType:'text',feedbackText:'א'.repeat(4001)}; r=await proxy({method:'POST',path:'/v1/messages/send/feedback',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-009': body={chunks:[]}; r=await proxy({method:'POST',path:'/v1/conversations/fetch/chunks/text',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-010': body={chunks:Array.from({length:101},(_,i)=>({documentBucket:'qa-bucket',documentFileName:'qa.pdf',chunkId:i}))}; r=await proxy({method:'POST',path:'/v1/conversations/fetch/chunks/text',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-011': body={chunks:[{documentBucket:'qa-bucket',documentFileName:'qa.pdf',chunkId:-1}]}; r=await proxy({method:'POST',path:'/v1/conversations/fetch/chunks/text',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-012': body={chunks:[{documentBucket:'qa-bucket',documentFileName:'qa.pdf',chunkId:10001}]}; r=await proxy({method:'POST',path:'/v1/conversations/fetch/chunks/text',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-013': body={bucketName:'a'.repeat(223),fileName:'x.pdf'}; r=await proxy({method:'POST',path:'/v1/files/download',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-014': body={bucketName:'qa-bucket',fileName:'a'.repeat(1025)}; r=await proxy({method:'POST',path:'/v1/files/download',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'BND-015': {const dt=new Date().toISOString(); body={startDate:dt,endDate:dt}; r=await proxy({method:'POST',path:'/v1/statistics/active-users',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`;} break;
      case 'BND-016': body={startDate:'2026-09-14T00:00:00Z',endDate:'2026-09-15T00:00:00Z'}; r=await proxy({method:'POST',path:'/v1/statistics/active-users',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      default: return result(id,'BLOCKED','אין אוטומציה ייעודית עדיין','התסריט נשאר זמין לביצוע ידני/דרך API Runner.');
    }
    return result(id,pass?'PASS':'FAIL',actual,t['Expected Result']||'');
  }catch(e){ return result(id,'BLOCKED',e.message,'לא בוצעה קביעה עסקית.'); }
}

async function runSafeP0(){
  const ids=['P0-001','P0-002','P0-003','P0-004','P0-006','P0-007']; $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id); $('runSummary').innerHTML += `<div class="run-item"><b>${id}</b> — <span class="${statusClass(r.status)}">${r.status}</span> — ${esc(r.actual)}</div>`; }
}

async function runBoundaryPack(){
  const ids=state.tests.filter(t=>t.ID.startsWith('BND-')&&t.mode==='auto').map(t=>t.ID); $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id); $('runSummary').innerHTML += `<div class="run-item"><b>${id}</b> — <span class="${statusClass(r.status)}">${r.status}</span> — ${esc(r.actual)}</div>`; }
}

async function happyFlow(){
  const c=requireFields(['baseUrl','appId','userId']);
  const steps=[['Create','POST','/v1/conversations/new'],['History after create','POST','/v1/conversations/history'],['Send Message SSE','POST','/v1/conversations/messages'],['Get Conversation','POST','/v1/conversations/id'],['Delete','DELETE','/v1/conversations/id'],['History after delete','POST','/v1/conversations/history']];
  $('flowSteps').innerHTML=steps.map((s,i)=>`<div class="flow-step" id="flow-${i}"><b>${esc(s[0])}</b><span>WAIT</span><pre>—</pre></div>`).join('');
  let conversationId='';
  for(let i=0;i<steps.length;i++){
    const [name,method,path]=steps[i]; const row=$(`flow-${i}`); const st=row.querySelector('span'), pre=row.querySelector('pre'); st.textContent='RUN';
    try{
      let body=requestBody(path,method,{...cfg(),conversationId});
      if(path==='/v1/conversations/new') body={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{})};
      if(path==='/v1/conversations/history') body={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{}),limit:20,offset:0};
      if(path==='/v1/conversations/messages') body={conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:$('flowQuestion').value.trim()||'בדיקת QA'};
      if(path==='/v1/conversations/id') body={conversationId,userId:c.userId};
      let r;
      if(path==='/v1/conversations/messages'){
        r=await proxy({method,path,body,stream:true}); const txt=await readStream(r.stream,(chunk,full)=>pre.textContent=full.slice(-4000));
        const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; pre.textContent=txt.slice(-4000);
      }else{
        r=await proxy({method,path,body}); pre.textContent=JSON.stringify(r.body,null,2).slice(0,4000);
        if(path==='/v1/conversations/new'){conversationId=extractConversationId(r.body)||''; if(!conversationId)throw new Error('לא התקבל conversationId'); $('conversationId').value=conversationId;}
      }
      const ok = path==='/v1/conversations/new'?r.status===201:r.status>=200&&r.status<300;
      st.textContent=ok?'PASS':`FAIL ${r.status}`; st.className=ok?'status-pass':'status-fail'; if(!ok) break;
    }catch(e){st.textContent='BLOCKED';st.className='status-blocked';pre.textContent=e.message;break;}
  }
}

function renderCatalog(){
  const q=$('searchTests')?.value?.toLowerCase()||'', p=$('priorityFilter')?.value||'', m=$('modeFilter')?.value||'';
  const rows=state.tests.filter(t=>(!p||t.priority===p)&&(!m||t.mode===m)&&(!q||[t.ID,t['תחום'],t.Endpoint,t['תרחיש בדיקה']].join(' ').toLowerCase().includes(q)));
  $('testsTableWrap').innerHTML=`<table class="qa-table"><thead><tr><th>ID</th><th>רמה</th><th>מצב</th><th>תחום</th><th>Endpoint</th><th>תרחיש</th><th>Expected</th><th>שאלה פתוחה</th><th>תוצאה</th><th></th></tr></thead><tbody>${rows.map(t=>{
    const r=state.results[t.ID]; return `<tr><td>${esc(t.ID)}</td><td class="${t.priority.toLowerCase()}">${t.priority}</td><td class="mode-${t.mode}">${modeLabel(t.mode)}</td><td>${esc(t['תחום'])}</td><td dir="ltr">${esc(t.Endpoint)}</td><td>${esc(t['תרחיש בדיקה'])}</td><td>${esc(t['Expected Result'])}</td><td>${esc(t['שאלה פתוחה / נדרש אישור'])}</td><td class="${r?statusClass(r.status):''}">${r?esc(r.status):'Not Run'}</td><td><div class="actions-row"><button class="btn test-run" data-id="${t.ID}">${t.mode==='manual'?'סמן':'Run'}</button><button class="btn ghost test-open" data-id="${t.ID}">פרטים</button></div></td></tr>`}).join('')}</tbody></table>`;
  document.querySelectorAll('.test-run').forEach(b=>b.onclick=()=>{const t=state.tests.find(x=>x.ID===b.dataset.id); if(t?.mode==='manual') openTest(b.dataset.id); else runTest(b.dataset.id);}); document.querySelectorAll('.test-open').forEach(b=>b.onclick=()=>openTest(b.dataset.id));
}
function renderQuestions(){ $('questionsTable').innerHTML=`<table class="qa-table"><thead><tr><th>Test ID</th><th>תחום</th><th>Endpoint</th><th>שאלה</th><th>למה נדרש</th><th>Status</th></tr></thead><tbody>${state.questions.map(q=>{const st=(q.Status||'Open').toLowerCase().replace(/\s+/g,'-');return `<tr><td>${esc(q['Test ID'])}</td><td>${esc(q['תחום'])}</td><td dir="ltr">${esc(q.Endpoint)}</td><td>${esc(q['שאלה פתוחה'])}</td><td>${esc(q['מקור / למה נדרש'])}</td><td class="status-${st}">${esc(q.Status||'Open')}</td></tr>`}).join('')}</tbody></table>`; }
function renderContext(){
  const c=state.context; if(!c)return;
  if($('knownFacts')) $('knownFacts').innerHTML=c.knownFacts.map(x=>`<div class="context-card"><h3>${esc(x.title)}</h3><div class="context-value">${esc(x.value)}</div><p>${esc(x.detail)}</p></div>`).join('');
  if($('pendingFacts')) $('pendingFacts').innerHTML=c.pending.map(x=>`<div class="context-card ${String(x.priority).toLowerCase()}"><h3>${esc(x.priority)} · ${esc(x.title)}</h3><p>${esc(x.detail)}</p></div>`).join('');
  if($('architectureTable')) $('architectureTable').innerHTML=`<table class="qa-table"><thead><tr><th>Component</th><th>תפקיד</th><th>QA Focus</th></tr></thead><tbody>${c.architecture.map(x=>`<tr><td><b>${esc(x.component)}</b></td><td>${esc(x.role)}</td><td>${esc(x.qa)}</td></tr>`).join('')}</tbody></table>`;
  if($('candidateTests')) $('candidateTests').innerHTML=`<table class="qa-table"><thead><tr><th>Priority</th><th>Risk</th><th>Scenario</th><th>Expected</th></tr></thead><tbody>${c.candidateTests.map(x=>`<tr><td class="${x.priority.toLowerCase()}">${esc(x.priority)}</td><td>${esc(x.risk)}</td><td>${esc(x.scenario)}</td><td>${esc(x.expected)}</td></tr>`).join('')}</tbody></table>`;
  if($('referenceLinks')) $('referenceLinks').innerHTML=c.references.map(x=>`<a class="reference-card" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><span><b>${esc(x.label)}</b><br><small>${esc(x.type)}</small></span><span>↗</span></a>`).join('');
}

function renderKpis(){ $('kpiTotal').textContent=state.tests.length; $('kpiAuto').textContent=state.tests.filter(t=>t.mode!=='manual').length; $('kpiPass').textContent=Object.values(state.results).filter(r=>r.status==='PASS').length; $('kpiFail').textContent=Object.values(state.results).filter(r=>r.status==='FAIL').length; $('kpiOpen').textContent=state.questions.filter(q=>(q.Status||'Open')==='Open').length; }
function renderReport(){ const rs=Object.values(state.results); $('reportTable').innerHTML=rs.length?`<table class="qa-table"><thead><tr><th>ID</th><th>Status</th><th>Actual</th><th>Details</th><th>Time</th></tr></thead><tbody>${rs.map(r=>`<tr><td>${r.id}</td><td class="${statusClass(r.status)}">${r.status}</td><td>${esc(r.actual)}</td><td>${esc(r.details)}</td><td dir="ltr">${r.time}</td></tr>`).join('')}</tbody></table>`:'אין תוצאות עדיין.'; }
function renderAll(){renderCatalog();renderQuestions();renderKpis();renderReport();renderContract();renderContext();readiness();}

function populateEndpoints(){ const s=$('endpointSelect'); s.innerHTML=state.operations.map((o,i)=>`<option value="${i}">${o.method} ${o.path} — ${esc(o.operationId)}</option>`).join(''); s.onchange=syncApiTemplate; syncApiTemplate(); }
function syncApiTemplate(){ const o=state.operations[+$('endpointSelect').value||0]; if(!o)return; $('apiMethod').value=o.method; $('apiBody').value=JSON.stringify(requestBody(o.path,o.method),null,2); }
async function apiRun(){ try{const o=state.operations[+$('endpointSelect').value||0]; let b; try{b=JSON.parse($('apiBody').value||'{}')}catch{throw new Error('Request JSON אינו תקין');} if(cfg().executionMode==='postman'){const curl=buildCurl(o.method,o.path,o.method==='GET'?undefined:b);$('apiResponse').textContent=curl;$('apiMeta').textContent='POSTMAN / cURL MODE — לא נשלחה בקשה';return;} const isStream=o.path==='/v1/conversations/messages'; const r=await proxy({method:o.method,path:o.path,body:(o.method==='GET'?undefined:b),stream:isStream}); if(isStream){$('apiResponse').textContent=''; const txt=await readStream(r.stream,(c,f)=>$('apiResponse').textContent=f.slice(-10000)); $('apiMeta').textContent=`HTTP ${r.status}\nSSE`; const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid;} else {$('apiResponse').textContent=typeof r.body==='string'?r.body:JSON.stringify(r.body,null,2);$('apiMeta').textContent=`HTTP ${r.status}\n${r.latencyMs??''} ms\n${r.contentType??''}`;} }catch(e){$('apiResponse').textContent=e.message;$('apiMeta').textContent='BLOCKED';} }
async function aiRun(){ try{const c=requireFields(['conversationId','appId','userId']); const body={conversationId:c.conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:$('aiPrompt').value.trim()}; $('aiStream').textContent=''; const r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); const txt=await readStream(r.stream,(ch,full)=>{$('aiStream').textContent=full.slice(-15000);renderSseEvents(full);}); renderSseEvents(txt); const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; }catch(e){$('aiStream').textContent=e.message;} }

function exportBlob(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJson(){exportBlob(`qa-report-${Date.now()}.json`,'application/json',JSON.stringify({generatedAt:now(),environment:cfg().baseUrl,results:Object.values(state.results),aiRating:state.aiRating},null,2));}
function exportCsv(){const rows=[['ID','Status','Actual','Details','Time'],...Object.values(state.results).map(r=>[r.id,r.status,r.actual,r.details,r.time])];const csv=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');exportBlob(`qa-report-${Date.now()}.csv`,'text/csv;charset=utf-8','\ufeff'+csv);}

async function health(){ if(cfg().executionMode==='postman'){setConn('Postman mode · העתק cURL','question');return;} try{const r=await proxy({method:'GET',path:'/health'}); const ok=r.status===200; state.connectionOk=ok; setConn(ok?`מחובר · HTTP ${r.status}`:`HTTP ${r.status}`,ok?'pass':'fail'); readiness();}catch(e){state.connectionOk=false;setConn(e.message,'fail');readiness();} }
function demo(){state.demo=!state.demo;$('demoBtn').textContent=state.demo?'Demo: ON':'Demo Mode';setConn(state.demo?'Demo Mode':'לא מחובר',state.demo?'question':'neutral');}

function wire(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabpage').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');});
  $('searchTests').oninput=renderCatalog;$('priorityFilter').onchange=renderCatalog;$('modeFilter').onchange=renderCatalog;
  $('demoBtn').onclick=demo;$('healthBtn').onclick=health;$('markTokenBtn').onclick=markTokenNow;$('readinessBtn').onclick=readiness;$('copyQuestionsBtn').onclick=copyQuestions;$('runSafeP0').onclick=runSafeP0;$('runBoundaryPack').onclick=runBoundaryPack;$('runHappyFlow').onclick=happyFlow;$('flowRunBtn').onclick=happyFlow;$('apiRunBtn').onclick=apiRun;$('copyCurlBtn').onclick=copyCurl;$('aiRunBtn').onclick=aiRun;
  $('clearResults').onclick=()=>{state.results={};$('runSummary').innerHTML='';renderAll();};
  $('exportJson').onclick=exportJson;$('exportCsv').onclick=exportCsv;
  ['baseUrl','token','appId','userId','caseId'].forEach(id=>$(id).addEventListener('input',readiness)); $('executionMode').addEventListener('change',readiness); $('authHeader').addEventListener('change',readiness); $('cloudAccessConfirmed').addEventListener('change',readiness); $('dialogRunBtn').onclick=async()=>{const id=state.selectedTestId;if(id){await runTest(id);$('testDialog').close();}}; document.querySelectorAll('[data-manual-status]').forEach(b=>b.onclick=()=>saveManual(b.dataset.manualStatus));
  document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>{state.aiRating={rating:b.dataset.rating,note:$('aiNote').value,time:now()};$('aiRating').textContent=`נבחר: ${b.dataset.rating}`;});
}

setInterval(updateTokenCountdown,1000);
wire(); loadData().catch(e=>document.body.insertAdjacentHTML('beforeend',`<pre>${esc(e.message)}</pre>`));
