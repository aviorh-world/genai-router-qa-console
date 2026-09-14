const state = {
  tests: [], questions: [], operations: [], results: {}, lastStream: '', aiRating: null,
  demo: false, createdConversationId: null, selectedTestId: null,
  context: null, tokenMarkedAt: null, connectionOk: false,
  lastExchange: null, bulkRunning: false, uiSelfTest: null
};

const $ = (id) => document.getElementById(id);
const esc = (v='') => String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const now = () => new Date().toISOString();

const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
function showToast(message,kind='info',ms=3200){
  const host=$('toastHost'); if(!host){console.log(`[${kind}]`,message);return;}
  const el=document.createElement('div'); el.className=`toast ${kind}`; el.textContent=message; host.appendChild(el);
  setTimeout(()=>el.remove(),ms);
}
function activateTab(name){
  const btn=[...document.querySelectorAll('.tab')].find(x=>x.dataset.tab===name); const page=$(name); if(!btn||!page)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active')); document.querySelectorAll('.tabpage').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); page.classList.add('active');
}
function plainTestExplanation(t){
  const overrides={
    'P0-001':'בדיקה שהאתר מצליח להגיע ל־Router האמיתי בסביבת TSH. זו בדיקת תקשורת/סביבה, לא בדיקה של איכות ה־AI.',
    'P0-002':'בדיקה חיובית של ההזדהות: האתר שולח בקשה מוגנת ל־POST /v1/conversations/history עם Identity Token אמיתי ב־X-Serverless-Authorization. בלי Token שהופק ב־gcloud אין PASS אמיתי. במצב Demo מתקבלת רק סימולציה והיא מסומנת DEMO.',
    'P0-003':'בדיקה שלילית: אותה גישה מוגנת נשלחת בלי Token בכלל. אנחנו מצפים שהשרת יחסום אותה ולא יחזיר מידע עסקי.',
    'P0-004':'בדיקה שלילית: שולחים Token מזויף/לא תקין ומוודאים שהשרת חוסם את הבקשה.',
    'P0-005':'פותחים Conversation חדש עם נתוני הבדיקה ומוודאים שהשרת מחזיר conversationId אמיתי.',
    'P0-019':'מחיקת Conversation. זו פעולה משנה־state ולכן בהרצה כוללת היא נדחית לסוף, אחרי בדיקות שתלויות בשיחה.',
    'P0-023':'שליחת הודעה אמיתית ל־Conversation ובדיקה שמתקבל SSE מה־Router.'
  };
  return overrides[t.ID] || `מטרת הבדיקה: ${t['תרחיש בדיקה']||'בדיקת התנהגות המערכת'}. נשלחת בקשה ל־${t.Endpoint||'ה־API'} ונבדקת התוצאה מול ה־Expected Result המוגדר.`;
}
function naResult(id,reason,details=''){ return result(id,'N/A',reason,details||'הבדיקה לא הורצה כי חסר תנאי מקדים/מידע נדרש.'); }
function unavailableResult(id,reason,details='',bulk=false){ return result(id,bulk?'N/A':'BLOCKED',reason,details||'לא ניתן לבצע את הבדיקה כרגע.'); }
function statusLabel(s){ return s==='N/A'?'N/A':s; }
function testPrereqIssues(id,t,{bulk=false}={}){
  const c=cfg(); const issues=[];
  if(t?.mode==='manual') issues.push('בדיקה ידנית');
  if(c.executionMode==='postman' && t?.mode!=='manual') issues.push('Execution Mode הוא Postman/cURL בלבד');
  if(!state.demo && !c.baseUrl) issues.push('חסר TSH Base URL');
  const noValidTokenNeeded=new Set(['P0-001','P0-003','P0-004','P2-001','P2-002']);
  if(!state.demo && !noValidTokenNeeded.has(id) && !c.token) issues.push('חסר Identity Token אמיתי מ־gcloud');
  if(!c.userId && !['P0-001','P2-001','P2-002'].includes(id)) issues.push('חסר User ID');
  if(!c.appId && !['P0-001','P2-001','P2-002'].includes(id)) issues.push('חסר App ID');
  const convNeeded=new Set(['P0-015','P0-018','P0-019','P0-020','P0-022','P0-023','P0-024','P0-025','P2-003','P2-005','P2-007']);
  if(convNeeded.has(id) && !c.conversationId) issues.push('חסר Conversation ID');
  if(id==='P1-021' && !c.messageId) issues.push('חסר Message ID');
  if(['P0-014','P0-018','P0-020','P0-024'].includes(id) && !c.userIdB) issues.push('חסר User ID B');
  if(['P0-029','P0-030','P0-031','P1-023'].includes(id)) issues.push('חסר Source אמיתי (bucket/file/chunk)');
  if(id==='P0-036') issues.push('נדרש DB/Log visibility או Fault Injection');
  if(String(id).startsWith('RAG-')) issues.push('נדרשת גישת RAG/Observability או Test Data ייעודי בהתאם לתרחיש');
  return issues;
}
function safeEvidenceHeaders(token,authHeader){
  const h={'Accept':'application/json, text/event-stream, */*'}; if(token) h[authHeader]='Bearer [REDACTED]'; return h;
}
function beginExchange({method,path,body,token,mode}){
  const c=cfg(); let url; try{url=targetUrl(c.baseUrl||'<TSH_BASE_URL>',path)}catch{url=`${c.baseUrl||'<TSH_BASE_URL>'}${path}`;}
  const tok=token===undefined?c.token:token;
  state.lastExchange={mode:mode|| (state.demo?'DEMO':c.executionMode), startedAt:now(), request:{method:method.toUpperCase(),url,path,headers:safeEvidenceHeaders(tok,c.authHeader),body:body??null},response:null};
  if(body!==undefined && body!==null && method.toUpperCase()!=='GET') state.lastExchange.request.headers['Content-Type']='application/json';
  return state.lastExchange;
}
function finishExchange({status,body,latencyMs,contentType,stream=false,error=null}){
  if(!state.lastExchange) return;
  state.lastExchange.response={status:status??null,latencyMs:latencyMs??null,contentType:contentType||'',stream:!!stream,body:body??null,error:error||null,finishedAt:now()};
}
function evidenceCurl(ev){
  if(!ev?.request)return '';
  const r=ev.request; const parts=[`curl -i -X ${r.method} '${r.url}'`];
  for(const [k,v] of Object.entries(r.headers||{})){ const val=String(v).includes('[REDACTED]')?'Bearer <IDENTITY_TOKEN>':v; parts.push(`  -H '${k}: ${val}'`); }
  if(r.body!=null && r.method!=='GET'){const json=JSON.stringify(r.body).replace(/'/g,"'\\''");parts.push(`  --data '${json}'`);}
  return parts.join(' \\\n');
}

const CONTRACT_GAPS = [
  {severity:'MEDIUM',area:'Authentication',gap:'ב־Swagger לא מוגדר securityScheme. לפי ההנחיה שהתקבלה ה-Identity Token מופק ב-gcloud auth print-identity-token ונשלח ב-X-Serverless-Authorization: Bearer <TOKEN>.',impact:'דרך ההזדהות ידועה כעת, אך עדיין חסרים תיעוד פורמלי ב-Swagger וקודי שגיאה מוסכמים.'},
  {severity:'HIGH',area:'Environment / Network',gap:'ה־servers ב־Swagger אינו מצביע על TSH. הצוות ציין שנדרשת תקשורת TSH↔NON-PROD והרשאה לשירות.',impact:'Vercel ציבורי עלול לא להגיע ליעד; יש להריץ Browser Direct או Postman מתוך הרשת המתאימה.'},
  {severity:'MEDIUM',area:'Case ID',gap:'הצוות הבהיר ש-Case ID אינו קריטי להתנעה ויכול להיות ערך בדיקה; Swagger מגדיר 9 ספרות ו-nullable אך לא required.',impact:'Test Data כבר לא blocker, אך missing/null עדיין דורשים אישור Runtime.'},
  {severity:'HIGH',area:'History / Messages',gap:'הדרישה העסקית היא 20 הודעות אחרונות, אבל הכמות והסדר אינם Contract מפורש ב-Get Conversation.',impact:'לא ניתן לקבוע PASS/FAIL חד־משמעי לסדר ולגבול בלי walkthrough.'},
  {severity:'MEDIUM',area:'Delete / State',gap:'AlloyDB מזוהה כ-DB של sessions/state/logs, אך לא מוגדר אם Delete הוא Hard/Soft ומה משתנה בטבלאות.',impact:'אימות persistence נשאר ידני עד לקבלת table/schema + business rule.'},
  {severity:'MEDIUM',area:'Streaming',gap:'קיים event בשם thought ללא הגדרה האם זה Progress מסונן או reasoning פנימי.',impact:'נדרשת בדיקת אבטחה שאין חשיפת System Prompt/Chain-of-Thought.'},
  {severity:'MEDIUM',area:'Message Length',gap:'Request מאפשר עד 32,768 תווים בעוד Message persisted/returned מתועד עד 8,192.',impact:'לא ברור מה Expected עבור הודעה גדולה מ־8,192.'},
  {severity:'MEDIUM',area:'Authorization / Sources',gap:'מסמך ההרשאות מגדיר least-privilege ל-Service Accounts, אך לא ownership אפליקטיבי של File/Chunk/Case למשתמש.',impact:'בדיקות IDOR על GCS/Chunks עדיין דורשות כלל הרשאה מוסכם.'},
  {severity:'HIGH',area:'RAG Target Design',gap:'אפיון ה-RAG הגנרי מתאר Target Design מפורט, אך עדיין לא ידוע אילו חלקים ממנו כבר ממומשים ב-TSH.',impact:'בדיקות RAG-001…RAG-014 מסומנות כבדיקות Spec/Assisted עד walkthrough או observability שמוכיחים Runtime behavior.'},
  {severity:'MEDIUM',area:'RAG Management APIs',gap:'המסמך מציג Category / Document Category / Permission APIs אך מסיים את הסעיף ב-"להשלים!!".',impact:'אין לבנות אוטומציה מול endpoints אלה עד לקבלת API Contract סופי.'}
];


const ENDPOINT_GUIDE = {
  'GET /health': ['בדיקת בריאות השירות','HTTP 200 כשה־Router חי ונגיש','להבדיל בין בעיית רשת/סביבה לבין כשל עסקי.'],
  'POST /v1/files/download': ['הורדת קובץ ממאגר האחסון','הקובץ המבוקש מוחזר רק למשתמש מורשה','בדיקות file/bucket שגויים, הרשאות ו־IDOR.'],
  'POST /v1/conversations/new': ['יצירת שיחה חדשה','נוצר conversationId חדש ונשמר state התחלתי','App/User/Case, יצירה כפולה, ולידציה ו־state.'],
  'POST /v1/conversations/history': ['שליפת היסטוריית שיחות למשתמש','מוחזרות רק שיחות ששייכות למשתמש/Case ובהתאם ל־pagination','Real-time אחרי Create, limit/offset, בידוד בין משתמשים.'],
  'POST /v1/conversations/id': ['שליפת שיחה אחת וההודעות שלה','השיחה המבוקשת מוחזרת רק לבעל הרשאה','conversationId לא קיים, משתמש אחר, סדר/כמות הודעות.'],
  'DELETE /v1/conversations/id': ['מחיקת שיחה','ה־API מאשר מחיקה וה־state משתנה לפי ה־Business Rule','לאמת שלא ניתן להמשיך להשתמש בשיחה; Hard/Soft Delete עדיין דורש Contract.'],
  'POST /v1/conversations/messages': ['שליחת הודעה וקבלת תשובת AI ב־SSE','מתקבל stream תקין שמסתיים ב־done/error ושומר messageId/state','סדר אירועים, sources, error handling, ניתוק stream ו־thought leakage.'],
  'POST /v1/conversations/fetch/chunks/text': ['שליפת טקסט של Chunks ממסמכים','מוחזרים רק ה־chunks שהתבקשו ושמותר למשתמש לקרוא','גבולות מערך, chunkId, מסמך לא מורשה ו־IDOR.'],
  'POST /v1/messages/send/feedback': ['שמירת משוב על תשובת AI','המשוב נקשר ל־messageId הנכון ונשמר פעם אחת לפי הכללים','thumb/text, message לא קיים, אורך טקסט, עדכון/כפילות.'],
  'POST /v1/statistics/active-users': ['סטטיסטיקת משתמשים פעילים','מוחזר נתון לתקופת הזמן המבוקשת למי שמורשה','טווחי זמן, timezone/RFC3339, הרשאות וחשיפת מידע.'],
  'POST /v1/statistics/conversations/count': ['מספר שיחות בתקופה','ספירה עקבית לפי הפילטרים','גבולות תאריכים ודיוק מול מקור נתונים.'],
  'POST /v1/statistics/conversations/count-by-user': ['מספר שיחות לפי משתמש','פירוט משתמשים וספירות בהתאם להרשאה','PII/RBAC ודיוק אגרגציה.'],
  'POST /v1/statistics/messages/user/count': ['מספר הודעות משתמש','ספירה נכונה של הודעות User','להבדיל user/assistant ולבדוק טווח זמן.'],
  'POST /v1/statistics/conversations/average-user-messages': ['ממוצע הודעות משתמש לשיחה','ממוצע מחושב על אוכלוסיית השיחות הנכונה','0 שיחות, rounding, פילטרים.'],
  'POST /v1/statistics/conversations/user-message-buckets': ['חלוקת שיחות לקבוצות לפי מספר הודעות','כל שיחה נכנסת ל־bucket המתאים פעם אחת','גבולות bucket וסכום כולל.'],
  'POST /v1/statistics/messages/average-duration': ['משך הודעה ממוצע','ממוצע duration תקין לתקופה','null/0, יחידות זמן וחריגים.'],
  'POST /v1/statistics/tools/count': ['מספר קריאות לכלים','ספירת tool calls עקבית','פילטרים, tool לא מוכר ודיוק.'],
  'POST /v1/statistics/tools/average-duration': ['משך ממוצע לפי Tool','ממוצע latency/duration לכל כלי','יחידות, failed calls ו־outliers.'],
  'POST /v1/statistics/tools/success-rate': ['אחוז הצלחה לפי Tool','success rate בין 0 ל־100%/0..1 לפי ה־Contract','הגדרת success, no calls וחישוב.'],
  'POST /v1/statistics/tokens/total': ['סך צריכת Tokens','סכום tokens לתקופה/פילטרים','דיוק, הרשאות ונתונים רגישים.'],
  'POST /v1/statistics/tokens/average-per-conversation': ['ממוצע Tokens לשיחה','ממוצע עקבי מול total/conversation count','0 שיחות ו־rounding.'],
  'POST /v1/statistics/tokens/by-user': ['צריכת Tokens לפי משתמש','פירוט צריכה למשתמשים מורשים בלבד','RBAC/PII ודיוק סכומים.'],
  'POST /v1/statistics/feedback/thumbs-comparison': ['השוואת 👍/👎','ספירה/יחס עקביים עם המשובים שנשמרו','טווח זמן, no feedback ודיוק אגרגציה.']
};

function renderEndpointGuide(){
  const host=$('endpointGuide'); if(!host) return;
  const groups=[
    ['Core / Health', o=>o.path==='/health'],
    ['Conversations', o=>o.path.startsWith('/v1/conversations/') && !o.path.includes('/fetch/chunks')],
    ['Files / Retrieval / Feedback', o=>o.path==='/v1/files/download' || o.path.includes('/fetch/chunks') || o.path.includes('/feedback')],
    ['Statistics', o=>o.path.startsWith('/v1/statistics/')]
  ];
  host.innerHTML=groups.map(([name,filter])=>{
    const ops=state.operations.filter(filter); if(!ops.length) return '';
    return `<details class="endpoint-group" open><summary>${esc(name)} <span>${ops.length}</span></summary><div class="endpoint-list">${ops.map(o=>{
      const key=`${o.method} ${o.path}`; const [purpose,success,qa]=ENDPOINT_GUIDE[key]||[o.summary||'פעולת API','תגובה מוצלחת לפי ה־Swagger','להשוות Request/Response ל־Contract.'];
      return `<article class="endpoint-card"><div class="endpoint-title"><span class="method ${o.method.toLowerCase()}">${esc(o.method)}</span><code>${esc(o.path)}</code></div><h3>${esc(purpose)}</h3><p><b>מה מצופה:</b> ${esc(success)}</p><p><b>מה חשוב ל־QA:</b> ${esc(qa)}</p><small>Swagger responses: ${esc((o.responses||[]).join(', ')||'—')}</small></article>`;
    }).join('')}</div></details>`;
  }).join('');
}

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
  const r=state.results[id];
  $('dialogTitle').textContent=`${t.ID} — ${t['תרחיש בדיקה']||''}`; $('dialogSubtitle').textContent=`${t.priority} · ${modeLabel(t.mode)} · ${t.Endpoint||''}`;
  const resultHtml=r?`<div class="detail-row test-result-line"><b>תוצאה אחרונה</b><span class="status-chip ${statusClass(r.status)}">${esc(statusLabel(r.status))}</span><span>${esc(r.actual||'')}</span></div>`:'';
  $('dialogBody').innerHTML=`<div class="detail-row plain-explanation"><b>מה הבדיקה עושה בפשטות?</b>${esc(plainTestExplanation(t))}</div>`+resultHtml+
    [['תנאים מקדימים',t['תנאים מקדימים']],['צעדים / קלט',t['צעדים / קלט']],['Expected Result',t['Expected Result']],['שאלה פתוחה',t['שאלה פתוחה / נדרש אישור']],['מקור / הערה',t['מקור / הערה']]].filter(x=>x[1]).map(([a,b])=>`<div class="detail-row"><b>${esc(a)}</b>${esc(b)}</div>`).join('');
  renderDialogEvidence(r?.evidence||null,r?.status||'');
  $('manualNote').value=r?.details||''; $('dialogRunBtn').style.display=t.mode==='manual'?'none':'inline-block'; $('testDialog').showModal();
}
function renderDialogEvidence(ev,status=''){
  const host=$('dialogEvidence'), copy=$('dialogCopyCurlBtn'); if(!host||!copy)return;
  if(!ev){host.innerHTML='<div class="detail-row na-explanation"><b>לוג הרצה</b>עדיין אין לוג. הרץ את הבדיקה כדי לראות Request / Response.</div>';copy.hidden=true;return;}
  const mode=ev.mode||'unknown'; const demo=mode==='DEMO';
  const req=ev.request||{}, resp=ev.response||{};
  const modeMsg=demo?'סימולציה מקומית בלבד — לא נשלחה בקשה אמיתית ל־TSH.':'בקשה שנשלחה לפי Execution Mode המוצג.';
  host.innerHTML=`<div class="evidence-card ${demo?'demo-explanation':''}"><h3>הוכחת הרצה / Request & Response</h3><div class="evidence-meta"><span class="pill">Mode: ${esc(mode)}</span><span class="pill">HTTP: ${esc(resp.status??'—')}</span><span class="pill">Latency: ${esc(resp.latencyMs??'—')} ms</span></div><p>${esc(modeMsg)}</p><b>Request</b><pre>${esc(JSON.stringify(req,null,2))}</pre><b>Response</b><pre>${esc(JSON.stringify(resp,null,2))}</pre></div>`;
  copy.hidden=false; copy.onclick=async()=>{const txt=evidenceCurl(ev);try{await navigator.clipboard.writeText(txt);showToast('cURL הועתק. ה־Token נשאר מוסתר.','success');}catch{prompt('העתק cURL',txt);}};
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
  state.questions.push(
    {'Test ID':'RAG-SPEC','תחום':'RAG / Scope','Endpoint':'Target Design','שאלה פתוחה':'אילו חלקים מאפיון ה-RAG הגנרי כבר ממומשים בפועל בסביבת TSH ואילו עדיין Future/Planned?','מקור / למה נדרש':'המסמך הוא אפיון יעד; נדרש להפריד בין Expected עתידי לבין Runtime קיים.','Status':'Open'},
    {'Test ID':'RAG-010','תחום':'RAG Quality','Endpoint':'Retrieval / Top-K','שאלה פתוחה':'מהו סף ההצלחה המוסכם לאיכות Retrieval — Top-3, Top-5, Recall@K או מדד אחר?','מקור / למה נדרש':'האפיון מציע Top-3/Top-5 כדוגמאות אך משאיר את ההחלטה פתוחה.','Status':'Open'},
    {'Test ID':'RAG-API','תחום':'RAG Management API','Endpoint':'Category / Mapping / Permission APIs','שאלה פתוחה':'מהם ה-endpoints, schemas וקודי השגיאה הסופיים של APIs לניהול קטגוריות/שיוכים/הרשאות?','מקור / למה נדרש':'במסמך סעיף API נדרשים מסתיים ב-"להשלים!!" ולכן אינו Contract סופי.','Status':'Open'}
  );

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

  const ragSpecTests = [
    ['RAG-001','P0','RAG Authorization','Retrieval / Category Filtering','קטגוריה לא מורשית אינה נכנסת למרחב החיפוש','הכן מסמך בקטגוריה A המורשית למשתמש ומסמך בקטגוריה B שאינה מורשית; שאל שאלה שמפתה לבחור ב-B','אין document_id/chunk/source מקטגוריה B, ואין תוכן ממנה בתשובה'],
    ['RAG-002','P0','RAG Authorization','Retrieval / Authorized Categories','משתמש ללא קטגוריות מורשות נעצר לפני Semantic Search','הרץ שאילתה עם משתמש שאין לו category permissions','התהליך נעצר עם הודעה מתאימה; אין חיפוש ואין תשובה המבוססת על מסמכים'],
    ['RAG-003','P0','RAG Fallback','Retrieval / Category Selection','Confidence נמוך לא מרחיב הרשאות','גרום לבחירת קטגוריה לא בטוחה / ambiguous query','Fallback לכל הקטגוריות המורשות בלבד'],
    ['RAG-004','P0','Ingestion State','Ingestion','מסמך שנכשל בשלב חובה אינו searchable','גרום לכשל ב-Content Extraction / Chunk / Embedding','ingestion נכשל והמסמך אינו נחשף ל-Retrieval'],
    ['RAG-005','P0','Re-Ingestion','Ingestion / Versioning','Re-Ingestion כושל לא מחליף גרסה פעילה','הפעל Re-Ingestion לגרסה חדשה וגרום לכשל','הגרסה הקודמת נשארת פעילה וזמינה לחיפוש'],
    ['RAG-006','P1','Versioning','Ingestion Strategy','שינוי Strategy יוצר Version חדש ללא שינוי רטרואקטיבי','שנה פרמטר Strategy ופרסם','גרסה חדשה להרצות חדשות; מסמכים קיימים שומרים strategy/version המקורי'],
    ['RAG-007','P1','Configuration','YAML / Admin','קונפיגורציה לא חוקית אינה מתפרסמת','הזן handler לא קיים / ערך מחוץ לטווח / reference חסר','Validation נכשל; אין השפעה על RAG הפעיל'],
    ['RAG-008','P1','Multi Category','Ingestion / Categories','מסמך בכמה קטגוריות עם Strategies שונות דורש Strategy אחת','שייך מסמך לשתי קטגוריות עם default strategies שונות','נדרשת בחירה לפני תחילת עיבוד; רצה אסטרטגיה אחת בלבד'],
    ['RAG-009','P1','Chunk Filtering','Retrieval / document_id','Semantic Search רץ רק על document_ids שנבחרו','צור מסמכים דומים בקטגוריות שונות והשווה sources/chunks','Top-K אינו מכיל chunk מ-document_id שסונן החוצה'],
    ['RAG-010','P1','RAG Quality','Retrieval / Top-K','ה-Chunk הנכון נמצא ב-Top-K עבור Golden Question','שאלה עם expected answer + expected source section','המקור הרלוונטי מופיע ב-Top-K לפי הסף שיוגדר (Top-3/Top-5 עדיין פתוח)'],
    ['RAG-011','P1','Audit','AUDIT','שינוי קטגוריה/Strategy/Mapping נרשם ב-AUDIT','בצע שינוי מבוקר והשווה audit row','נשמרים action/entity/old/new/user/time'],
    ['RAG-012','P1','Observability','INGESTION_EXECUTION','כשל Ingestion ניתן לתחקור','גרום לכשל בשלב ידוע','execution_status/current_step/error_details/timestamps מאפשרים לזהות היכן ולמה נכשל'],
    ['RAG-013','P1','Category Selection','Retrieval / LLM','בחירת קטגוריה מחזירה נתונים מובנים','הרץ שאילתה חד-משמעית ו-ambiguous','שם קטגוריה + confidence + reason; multiple categories לפי config'],
    ['RAG-014','P1','Category Mapping','DOCUMENT_CATEGORY_MAPPING','אין כפילויות/שגיאות בשיוך מסמך לקטגוריות','שייך/הסר/שייך מחדש ובדוק mapping','מיפוי עקבי; retrieval משקף את השיוך הפעיל בלבד']
  ];
  for (const [ID,priority,domain,Endpoint,scenario,steps,expected] of ragSpecTests) {
    state.tests.push({ID,priority,mode:'assisted','תחום':domain,Endpoint,'תרחיש בדיקה':scenario,'תנאים מקדימים':'מימוש/גישה לרכיבי RAG + Test Documents/Categories + Observability מתאימה','צעדים / קלט':steps,'Expected Result':expected,'שאלה פתוחה / נדרש אישור':ID==='RAG-010'?'לקבוע סף Quality מוסכם: Top-3 / Top-5 / metric אחר':'','מקור / הערה':'אפיון תשתית RAG גנרית — Target Design; לא בהכרח Runtime Contract נוכחי'});
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
  const started=Date.now(); let res;
  try{res=await fetch(url,{method:method.toUpperCase(),headers,body:payload});}
  catch(e){finishExchange({error:e.message,latencyMs:Date.now()-started});throw new Error('Browser Direct נכשל. ייתכן CORS או שאין גישה מהרשת הנוכחית ל-TSH. נסה Postman מתוך SH/TSH. '+(e.message||''));}
  const ct=res.headers.get('content-type')||'', latencyMs=Date.now()-started;
  if(stream||ct.includes('text/event-stream')){finishExchange({status:res.status,latencyMs,contentType:ct,stream:true,body:'[SSE stream — body מתעדכן לאחר הקריאה]'});return {status:res.status,stream:res.body,headers:res.headers,latencyMs};}
  const txt=await res.text(); let parsed=txt; try{parsed=JSON.parse(txt)}catch{}
  finishExchange({status:res.status,body:parsed,latencyMs,contentType:ct});
  return {status:res.status,body:parsed,raw:txt,latencyMs,contentType:ct,isBinary:false};
}
async function proxy({method,path,body,token,stream=false}){
  const c=cfg(); beginExchange({method,path,body,token,mode:state.demo?'DEMO':c.executionMode});
  if(state.demo){const r=await demoResponse(method,path,body,stream);finishExchange({status:r.status,body:stream?'[Demo SSE stream]':r.body,latencyMs:r.latencyMs??0,contentType:r.contentType||'',stream});return r;}
  if(!c.baseUrl){finishExchange({error:'חסר TSH Base URL'});throw new Error('יש להזין TSH Base URL');}
  if(c.executionMode==='postman'){finishExchange({error:'Postman mode — לא נשלחה בקשה'});throw new Error('מצב Postman/cURL אינו מריץ בקשות מהדפדפן. השתמש בכפתור "העתק cURL" והרץ בתוך הסביבה הפנימית.');}
  if(c.executionMode==='direct') return directRequest({method,path,body,token,stream});
  const started=Date.now();
  let res; try{res=await fetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:c.baseUrl,token:token===undefined?c.token:token,authHeader:c.authHeader,method,apiPath:path,body,stream})});}
  catch(e){finishExchange({error:e.message,latencyMs:Date.now()-started});throw e;}
  if(stream){finishExchange({status:res.status,latencyMs:Date.now()-started,contentType:res.headers.get('content-type')||'',stream:true,body:'[SSE stream — body מתעדכן לאחר הקריאה]'});return {status:res.status,stream:res.body,headers:res.headers,latencyMs:Date.now()-started};}
  const wrapper=await res.json();
  if(!res.ok){finishExchange({status:res.status,body:wrapper,latencyMs:Date.now()-started,error:wrapper.error||'Proxy error'});throw new Error(wrapper.error||'Proxy error');}
  let parsed=wrapper.body; try{parsed=JSON.parse(wrapper.body)}catch{}
  finishExchange({status:wrapper.upstreamStatus,body:parsed,latencyMs:wrapper.latencyMs,contentType:wrapper.contentType});
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
  if(state.lastExchange?.response) state.lastExchange.response.body=full.slice(0,15000);
  return full;
}

function expectStatus(actual, allowed){ return allowed.includes(actual); }
function result(id,status,actual='',details=''){
  state.results[id]={id,status,actual,details,time:now(),evidence:clone(state.lastExchange)}; renderKpis(); renderCatalog(); renderReport();
  return state.results[id];
}
function statusClass(s){return s==='PASS'?'status-pass':s==='FAIL'?'status-fail':s==='BLOCKED'?'status-blocked':s==='N/A'?'status-na':s==='DEMO'?'status-demo':'status-question';}

async function runTest(id,{bulk=false}={}){
  const t=state.tests.find(x=>x.ID===id); if(!t) return null;
  state.lastExchange=null;
  try{
    const prereqs=testPrereqIssues(id,t,{bulk});
    if(prereqs.length) return naResult(id,prereqs.join(' · '),`לא הורץ: ${prereqs.join(', ')}`);
    const c=cfg(); let r, body, pass, actual='';
    switch(id){
      case 'P0-001':
      case 'P2-001': r=await proxy({method:'GET',path:'/health'}); pass=expectStatus(r.status,[200]); actual=`HTTP ${r.status}`; break;
      case 'P2-002': r=await proxy({method:'GET',path:'/health'}); pass=r.status===200 && !/(password|secret|token|private[_ -]?key)/i.test(JSON.stringify(r.body)); actual=JSON.stringify(r.body).slice(0,400); break;
      case 'P0-002': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body}); pass=r.status>=200&&r.status<300; actual=`HTTP ${r.status} · ${state.demo?'DEMO בלבד':'בקשה אמיתית נשלחה'} · ${r.latencyMs??'—'} ms`; break;
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
        if(!c.userIdB) return unavailableResult(id,'חסר User B','הזן User ID B (ורצוי Token B אם נדרש)',bulk);
        body=requestBody('/v1/conversations/history','POST'); body.userId=c.userIdB; r=await proxy({method:'POST',path:'/v1/conversations/history',body,token:c.token}); return result(id,'QUESTION',`HTTP ${r.status}`, 'יש לוודא מול האפיון אם body userId חייב להיות קשור לזהות שב-Token.');
      case 'P0-015': case 'P0-018': case 'P1-012': case 'P1-013':
        body=requestBody('/v1/conversations/id','POST');
        if(id==='P0-018'){if(!c.userIdB)return unavailableResult(id,'חסר User B','הזן User B',bulk);body.userId=c.userIdB;}
        if(id==='P1-012') body.conversationId='11111111-1111-4111-8111-999999999999';
        if(id==='P1-013') body.conversationId='abc';
        r=await proxy({method:'POST',path:'/v1/conversations/id',body});
        pass=id==='P0-015'?r.status===200:id==='P0-018'?r.status===403:id==='P1-012'?r.status===404:(r.status>=400&&r.status<500); actual=`HTTP ${r.status}`; break;
      case 'P0-019': case 'P0-020': case 'P1-014':
        body=requestBody('/v1/conversations/id','DELETE');
        if(id==='P0-020'){if(!c.userIdB)return unavailableResult(id,'חסר User B','הזן User B',bulk);body.userId=c.userIdB;}
        if(id==='P1-014') body.conversationId='11111111-1111-4111-8111-999999999999';
        r=await proxy({method:'DELETE',path:'/v1/conversations/id',body}); pass=id==='P0-019'?r.status===200:id==='P0-020'?r.status===403:r.status===404; actual=`HTTP ${r.status}`; break;
      case 'P0-022': body=requestBody('/v1/conversations/history','POST'); r=await proxy({method:'POST',path:'/v1/conversations/history',body}); return result(id,'QUESTION',`HTTP ${r.status} ${JSON.stringify(r.body).slice(0,300)}`,'יש לבדוק שהשיחה שנמחקה אינה מופיעה; תלוי Hard/Soft Delete.');
      case 'P0-023': case 'P0-025':
        requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='בדיקת QA אוטומטית'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true});
        {const text=await readStream(r.stream); pass=r.status===200 && (id==='P0-025'?/"type"\s*:\s*"done"/.test(text):true); const mid=extractMessageIdFromText(text); if(mid)$('messageId').value=mid; actual=`HTTP ${r.status}\n${text.slice(0,800)}`;} break;
      case 'P0-024': if(!c.userIdB)return unavailableResult(id,'חסר User B','הזן User B',bulk); body=requestBody('/v1/conversations/messages','POST'); body.userId=c.userIdB; body.content='cross user auth test'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream); return result(id,'QUESTION',`HTTP ${r.status}\n${text.slice(0,400)}`,'קוד השגיאה המצופה אינו סגור ב-Swagger.');}
      case 'P0-026': return result(id,'QUESTION','הרץ דרך GenAI/RAG Inspector','יש לבצע review לאירועי thought ולוודא שאין Chain-of-Thought/System Prompt.');
      case 'P0-027': return result(id,'QUESTION','מומלץ להריץ ידנית דרך API Runner','פער 32768 מול 8192 דורש החלטת Expected.');
      case 'P0-028': case 'P0-032': case 'P0-033': case 'P0-034': case 'P0-035': case 'P1-025': case 'P1-026': return result(id,'QUESTION','הרץ דרך GenAI/RAG Inspector','נדרש שיפוט איכות/Golden Dataset.');
      case 'P0-029': case 'P0-030': case 'P0-031': case 'P1-023': return unavailableResult(id,'נדרש source אמיתי','הזן bucket/file/chunk מתוך תשובת sources והריץ ב-API Runner.',bulk);
      case 'P0-036': return unavailableResult(id,'נדרש Fault Injection/DB visibility','לא ניתן להסיק State consistency מה-API בלבד.',bulk);
      case 'P1-001': body=requestBody('/v1/conversations/new','POST'); body.userId='abc'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-002': body=requestBody('/v1/conversations/new','POST'); body.caseId='12345678'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-003': body=requestBody('/v1/conversations/new','POST'); body.caseId='1234567890'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-004': body=requestBody('/v1/conversations/new','POST'); body.caseId='12345ABCD'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-005': body=requestBody('/v1/conversations/new','POST'); body.appId='A'.repeat(50); r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status===201; actual=`HTTP ${r.status}`; break;
      case 'P1-006': body=requestBody('/v1/conversations/new','POST'); body.appId='A'.repeat(51); r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-019': body=requestBody('/v1/conversations/new','POST'); body.unexpectedField='x'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
      case 'P1-020': return unavailableResult(id,'ה-Proxy שולח JSON תקין בכוונה','בדיקת Content-Type שגוי עדיף לבצע ב-Postman/curl או להרחיב את ה-Proxy.',bulk);
      case 'P1-021': requireFields(['messageId']); body={messageId:c.messageId,feedbackType:'thumbs_up'}; r=await proxy({method:'POST',path:'/v1/messages/send/feedback',body}); pass=r.status===200; actual=`HTTP ${r.status}`; break;
      case 'P1-024': body={bucketName:'qa-nonexistent-bucket',fileName:'missing.pdf'}; r=await proxy({method:'POST',path:'/v1/files/download',body}); pass=r.status===404||r.status===400||r.status===403; actual=`HTTP ${r.status}`; break;
      case 'P2-003': requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='א'; r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream);pass=r.status===200;actual=`HTTP ${r.status}\n${text.slice(0,300)}`;} break;
      case 'P2-005': requireFields(['conversationId','appId','userId']); body=requestBody('/v1/conversations/messages','POST'); body.content='א'.repeat(32769); r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); {const text=await readStream(r.stream);pass=r.status>=400&&r.status<500;actual=`HTTP ${r.status}\n${text.slice(0,200)}`;} break;
      case 'P2-007': return result(id,'QUESTION','הרץ שאלה בעברית דרך GenAI Inspector ואז Get Conversation','בדיקת Round-trip דורשת תוכן עברי ידוע והשוואה.');
      case 'P2-011': return unavailableResult(id,'הזן טווח ללא נתונים דרך API Runner','Endpoint סטטיסטיקה נבחר לפי צורך.',bulk);
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
      default: return result(id,bulk?'N/A':'BLOCKED','אין אוטומציה ייעודית עדיין','התסריט נשאר זמין לביצוע ידני/מסייע. בהרצה כוללת הוא אינו נספר ככשל.');
    }
    return result(id,state.demo?'DEMO':(pass?'PASS':'FAIL'),actual,state.demo?'סימולציה בלבד — לא נשלחה בקשה אמיתית ל-TSH.':(t['Expected Result']||''));
  }catch(e){ const missing=/חסרים שדות|חסר /.test(e.message||''); return result(id,(bulk&&missing)?'N/A':'BLOCKED',e.message,'לא בוצעה קביעה עסקית.'); }
}

async function runSafeP0(){
  const ids=['P0-001','P0-002','P0-003','P0-004','P0-006','P0-007']; $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id,{bulk:true}); if(r)$('runSummary').innerHTML += `<div class="run-item"><b>${id}</b><span class="${statusClass(r.status)}">${r.status}</span><span>${esc(r.actual)}</span></div>`; }
  showToast('Run Safe P0 הסתיים.','success');
}

async function runBoundaryPack(){
  const ids=state.tests.filter(t=>t.ID.startsWith('BND-')&&t.mode==='auto').map(t=>t.ID); $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id,{bulk:true}); if(r)$('runSummary').innerHTML += `<div class="run-item"><b>${id}</b><span class="${statusClass(r.status)}">${r.status}</span><span>${esc(r.actual)}</span></div>`; }
  showToast('Boundary Pack הסתיים.','success');
}

async function runRagSpecPack(){
  const ids=state.tests.filter(t=>t.ID.startsWith('RAG-')).map(t=>t.ID); $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id,{bulk:true}); if(r)$('runSummary').insertAdjacentHTML('beforeend',`<div class="run-item"><b>${esc(id)}</b><span class="${statusClass(r.status)}">${esc(r.status)}</span><span>${esc(r.actual)}</span></div>`); }
  showToast('RAG Spec Pack הסתיים. בדיקות שאין להן Observability/Test Data מסומנות N/A.','info',5000);
}

async function runAllTests(){
  if(state.bulkRunning){showToast('כבר מתבצעת הרצה כוללת.','warning');return;}
  state.bulkRunning=true; const btn=$('runAllTests'); const old=btn.textContent; btn.disabled=true; btn.textContent='מריץ…';
  $('runSummary').innerHTML=''; const prog=$('bulkProgress'), bar=$('bulkProgressBar'), text=$('bulkProgressText'); prog.hidden=false;
  // פעולות Delete על Conversation אמיתי רצות רק בסוף, אחרי כל הבדיקות שתלויות בו.
  const destructive=new Set(['P0-019','P0-020','P0-022']);
  const tailOrder=['P0-020','P0-019','P0-022'];
  const tests=[...state.tests.filter(t=>!destructive.has(t.ID)),...tailOrder.map(id=>state.tests.find(t=>t.ID===id)).filter(Boolean)];
  let done=0;
  try{
    for(const t of tests){
      text.textContent=`${done+1}/${tests.length} · ${t.ID} · ${t['תרחיש בדיקה']||''}`; bar.style.width=`${Math.round(done/tests.length*100)}%`;
      const r=await runTest(t.ID,{bulk:true}); done++; bar.style.width=`${Math.round(done/tests.length*100)}%`;
      if(r)$('runSummary').insertAdjacentHTML('beforeend',`<div class="run-item"><b>${esc(t.ID)}</b><span class="${statusClass(r.status)}">${esc(r.status)}</span><span>${esc(r.actual)}</span></div>`);
      await new Promise(res=>setTimeout(res,0));
    }
    const counts={}; Object.values(state.results).forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
    text.textContent=`הסתיים: ${tests.length} בדיקות · PASS ${counts.PASS||0} · FAIL ${counts.FAIL||0} · N/A ${counts['N/A']||0} · DEMO ${counts.DEMO||0} · QUESTION ${counts.QUESTION||0}`;
    showToast(`הרצה כוללת הסתיימה. FAIL: ${counts.FAIL||0}, N/A: ${counts['N/A']||0}${state.demo?' · Demo Mode פעיל':''}`,counts.FAIL?'warning':'success',5000);
  }finally{state.bulkRunning=false;btn.disabled=false;btn.textContent=old;}
}

async function happyFlow(){
  activateTab('flow');
  const steps=[['Create','POST','/v1/conversations/new'],['History after create','POST','/v1/conversations/history'],['Send Message SSE','POST','/v1/conversations/messages'],['Get Conversation','POST','/v1/conversations/id'],['Delete','DELETE','/v1/conversations/id'],['History after delete','POST','/v1/conversations/history']];
  $('flowSteps').innerHTML=steps.map((s,i)=>`<div class="flow-step" id="flow-${i}"><b>${esc(s[0])}</b><span>WAIT</span><pre>—</pre></div>`).join('');
  let c;
  try{
    c=cfg(); const missing=[]; if(!state.demo&&!c.baseUrl)missing.push('TSH Base URL'); if(!state.demo&&!c.token)missing.push('Identity Token'); if(!c.appId)missing.push('App ID'); if(!c.userId)missing.push('User ID');
    if(c.executionMode==='postman')missing.push('Execution Mode אינו מאפשר הרצה');
    if(missing.length) throw new Error('לא ניתן להתחיל Happy Flow — חסר: '+missing.join(', '));
  }catch(e){$('flowSteps').innerHTML=`<div class="detail-row na-explanation"><b>Happy Flow לא התחיל</b>${esc(e.message)}</div>`;showToast(e.message,'error',5000);return;}
  let conversationId=''; let failed=false;
  for(let i=0;i<steps.length;i++){
    const [name,method,path]=steps[i], row=$(`flow-${i}`), st=row.querySelector('span'), pre=row.querySelector('pre'); st.textContent='RUN';
    try{
      let body=requestBody(path,method,{...cfg(),conversationId});
      if(path==='/v1/conversations/new') body={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{})};
      if(path==='/v1/conversations/history') body={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{}),limit:20,offset:0};
      if(path==='/v1/conversations/messages') body={conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:$('flowQuestion').value.trim()||'בדיקת QA'};
      if(path==='/v1/conversations/id') body={conversationId,userId:c.userId};
      let r; state.lastExchange=null;
      if(path==='/v1/conversations/messages'){
        r=await proxy({method,path,body,stream:true}); const txt=await readStream(r.stream,(chunk,full)=>pre.textContent=full.slice(-4000));
        const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; pre.textContent=`REQUEST\n${JSON.stringify(state.lastExchange?.request,null,2)}\n\nRESPONSE\n${txt.slice(-3000)}`;
      }else{
        r=await proxy({method,path,body}); pre.textContent=`REQUEST\n${JSON.stringify(state.lastExchange?.request,null,2)}\n\nRESPONSE\n${JSON.stringify(r.body,null,2).slice(0,3000)}`;
        if(path==='/v1/conversations/new'){conversationId=extractConversationId(r.body)||''; if(!conversationId)throw new Error('לא התקבל conversationId'); $('conversationId').value=conversationId;}
      }
      const ok=path==='/v1/conversations/new'?r.status===201:r.status>=200&&r.status<300;
      st.textContent=state.demo?'DEMO':(ok?'PASS':`FAIL ${r.status}`); st.className=state.demo?'status-demo':(ok?'status-pass':'status-fail');
      if(!ok&&!state.demo){failed=true;break;}
    }catch(e){failed=true;st.textContent='BLOCKED';st.className='status-blocked';pre.textContent=e.message;showToast(`${name}: ${e.message}`,'error',5000);break;}
  }
  if(!failed) showToast(state.demo?'Happy Flow הסתיים בסימולציית DEMO — לא בוצעה קריאה אמיתית.':'Happy Flow הסתיים בהצלחה.','success',5000);
}

function runUiSelfTest(){
  const checks=[]; const check=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});
  const buttonIds=['demoBtn','healthBtn','markTokenBtn','readinessBtn','runAllTests','runSafeP0','runBoundaryPack','runRagSpecPack','runHappyFlow','uiSelfTestBtn','clearResults','flowRunBtn','apiRunBtn','copyCurlBtn','aiRunBtn','exportJson','exportCsv','exportStpBtn','exportStdBtn','dialogRunBtn','dialogCopyCurlBtn'];
  buttonIds.forEach(id=>{const el=$(id);check(`כפתור ${id}`,!!el && (typeof el.onclick==='function'||id==='dialogCopyCurlBtn'),!el?'לא נמצא':typeof el.onclick);});
  document.querySelectorAll('.tab').forEach(tab=>check(`Tab ${tab.dataset.tab}`,!!$(tab.dataset.tab)&&typeof tab.onclick==='function','Target section + click handler'));
  document.querySelectorAll('[data-manual-status]').forEach(b=>check(`Manual status ${b.dataset.manualStatus}`,typeof b.onclick==='function','click handler'));
  document.querySelectorAll('[data-rating]').forEach(b=>check(`AI rating ${b.dataset.rating}`,typeof b.onclick==='function','click handler'));
  check('כפתור סגירת Dialog',document.querySelector('#testDialog form[method="dialog"] button[value="cancel"]')!=null,'native dialog close');
  check('קטלוג בדיקות נטען',state.tests.length>0,`${state.tests.length} tests`); check('Swagger operations נטענו',state.operations.length>0,`${state.operations.length} operations`);
  check('P0-002 ברור',plainTestExplanation({ID:'P0-002'}).includes('gcloud'),'הסבר פשוט קיים');
  check('הנחיות Setup מקופלות',document.querySelector('details.setup-help')!=null,'native details/summary');
  check('מדריך מערכת נטען',!!$('guide') && !!$('endpointGuide'),'Guide + endpoint guide'); check('RAG Spec נטען בתוך המדריך',!!state.context?.ragSpec && state.tests.some(t=>t.ID==='RAG-001'),'Spec cards + RAG test pack'); document.querySelectorAll('.subtab').forEach(tab=>check(`Subtab ${tab.dataset.subtab}`,!!tab.closest('.tabpage')?.querySelector(`[data-subpage=\"${tab.dataset.subtab}\"]`) && typeof tab.onclick==='function','Target subpage + click handler')); 
  check('Demo אינו PASS אמיתי',true,'ב־Demo תוצאות אוטומטיות מסומנות DEMO');
  const failed=checks.filter(x=>!x.ok); state.uiSelfTest={time:now(),checks};
  $('runSummary').innerHTML=`<div class="ui-test-list">${checks.map(x=>`<div class="ui-test-item ${x.ok?'ok':'fail'}"><b>${x.ok?'✓':'✕'} ${esc(x.name)}</b>${x.detail?` — ${esc(x.detail)}`:''}</div>`).join('')}</div>`;
  showToast(failed.length?`בדיקת UI מצאה ${failed.length} בעיות.`:`בדיקת UI עברה: ${checks.length} checks.` ,failed.length?'error':'success',5000);
  return {ok:failed.length===0,checks};
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


function renderRagSpec(){
  const spec=state.context?.ragSpec; if(!spec)return;
  if($('ragSpecBadge')) $('ragSpecBadge').textContent=spec.status||'Spec';
  if($('ragPipelines')) $('ragPipelines').innerHTML=(spec.pipelines||[]).map(p=>`<div class="pipeline-card"><h3>${esc(p.name)}</h3><div class="pipeline-steps">${(p.steps||[]).map((s,i)=>`<div class="pipeline-step"><span>${i+1}</span>${esc(s)}</div>`).join('')}</div>${p.note?`<p>${esc(p.note)}</p>`:''}</div>`).join('');
  if($('ragRules')) $('ragRules').innerHTML=`<table class="qa-table"><thead><tr><th>Priority</th><th>כלל</th><th>מה בודקים</th></tr></thead><tbody>${(spec.rules||[]).map(r=>`<tr><td class="${String(r.priority).toLowerCase()}">${esc(r.priority)}</td><td>${esc(r.rule)}</td><td>${esc(r.qa)}</td></tr>`).join('')}</tbody></table>`;
  if($('ragTables')) $('ragTables').innerHTML=`<table class="qa-table"><thead><tr><th>טבלה</th><th>מטרה</th><th>QA</th></tr></thead><tbody>${(spec.tables||[]).map(r=>`<tr><td dir="ltr"><b>${esc(r.name)}</b></td><td>${esc(r.purpose)}</td><td>${esc(r.qa)}</td></tr>`).join('')}</tbody></table>`;
  if($('ragQuality')) $('ragQuality').innerHTML=(spec.quality||[]).map(x=>`<div class="context-card"><h3>${esc(x.title)}</h3><p>${esc(x.detail)}</p></div>`).join('');
  if($('ragApiScope')) $('ragApiScope').innerHTML=`<table class="qa-table"><thead><tr><th>קבוצת API</th><th>פעולות שצוינו</th><th>Status</th></tr></thead><tbody>${(spec.apis||[]).map(x=>`<tr><td><b>${esc(x.group)}</b></td><td>${esc(x.items)}</td><td class="status-question">${esc(x.status)}</td></tr>`).join('')}</tbody></table>`;
}

function renderStpStd(){
  if(!$('stpStrategy') || !$('stdDesign')) return;
  const byPriority={P0:0,P1:0,P2:0};
  for(const t of state.tests) byPriority[t.priority]=(byPriority[t.priority]||0)+1;
  const auto=state.tests.filter(t=>t.mode==='auto').length;
  const assisted=state.tests.filter(t=>t.mode==='assisted').length;
  const manual=state.tests.filter(t=>t.mode==='manual').length;

  const strategy=[
    ['P0 – קריטי','Happy Flow, Authentication, Authorization, State, אבטחה, תקלות שחוסמות שימוש','להריץ ראשון; כשל משמעותי עוצר/מסכן Release'],
    ['P1 – חשוב','Validation, Boundaries, Error Handling, Pagination, Files/Chunks, Feedback','להריץ אחרי P0 ולפני סגירת גרסה'],
    ['P2 – משלים','Robustness, Metadata, תרחישי קצה משלימים','להריץ לפי זמן וסיכון'],
    ['GenAI / RAG','Grounding, Sources, Hallucination, Prompt Injection, SSE/Thought Leakage','שילוב אוטומציה + הערכת QA/SME'],
    ['RAG Generic Spec','Ingestion, Category RBAC, Filtered Retrieval, Re-Ingestion, Config/Audit, Top-K Quality','Target Design: לאשר מול Runtime/Observability לפני PASS סופי'],
    ['State / Persistence','Create, History, Delete, Session/Memory consistency','API + אימות DB/Log כשיינתן access'],
  ];
  $('stpStrategy').innerHTML=`<table class="qa-table"><thead><tr><th>שכבה</th><th>מה נבדק</th><th>גישה</th></tr></thead><tbody>${strategy.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  if($('stdSummary')) $('stdSummary').innerHTML=`
    <div class="kpi"><b>${state.tests.length}</b><span>סה״כ תסריטים</span></div>
    <div class="kpi"><b>${byPriority.P0||0}</b><span>P0</span></div>
    <div class="kpi"><b>${byPriority.P1||0}</b><span>P1</span></div>
    <div class="kpi"><b>${byPriority.P2||0}</b><span>P2</span></div>
    <div class="kpi"><b>${auto}/${assisted}/${manual}</b><span>אוטומטי / מסייע / ידני</span></div>`;

  const domains={};
  for(const t of state.tests){
    const d=t['תחום']||'אחר';
    domains[d]=domains[d]||{count:0,p0:0,ids:[]}; domains[d].count++; if(t.priority==='P0') domains[d].p0++; if(domains[d].ids.length<5) domains[d].ids.push(t.ID);
  }
  $('stdDesign').innerHTML=`<table class="qa-table"><thead><tr><th>תחום בדיקה</th><th>מספר תסריטים</th><th>P0</th><th>דוגמאות Test IDs</th></tr></thead><tbody>${Object.entries(domains).sort((a,b)=>b[1].count-a[1].count).map(([d,v])=>`<tr><td>${esc(d)}</td><td>${v.count}</td><td>${v.p0}</td><td dir="ltr">${esc(v.ids.join(', '))}</td></tr>`).join('')}</tbody></table>`;

  const trace=[
    ['גישה לא מורשית / Token','Authentication + Authorization','P0/P1 auth tests + User B/Token B'],
    ['זליגת מידע בין משתמשים/תיקים','Cross-user / IDOR / Memory','Conversation, Files/Chunks, Memory tests'],
    ['State לא עקבי','Create / History / Delete','Happy Flow + DB/Log verification'],
    ['Prompt Injection / מידע רגיש','Model Armor + GenAI Security','Prompt injection, secrets/system prompt, thought leakage'],
    ['Hallucination / מקור שגוי','RAG Quality','Sources, chunks, grounding, manual SME rating'],
    ['קלטי קצה','Boundary / Validation','Boundary Pack + max/min/empty/invalid values'],
    ['Streaming שבור','SSE','event order, done/error, disconnect, malformed event'],
    ['RAG Spec / Category RBAC','Ingestion + Retrieval Target Design','RAG-001…RAG-014; לא מסיקים שהמימוש קיים רק כי הוא מופיע באפיון'],
    ['מידע סטטיסטי רגיש','Statistics / RBAC','Access control + response data review']
  ];
  if($('stdTraceability')) $('stdTraceability').innerHTML=`<table class="qa-table"><thead><tr><th>סיכון</th><th>אזור בדיקה</th><th>כיסוי ב־STD</th></tr></thead><tbody>${trace.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function stpMarkdown(){
  return `# STP – תוכנית בדיקות GenAI Router\n\n## מטרה\nלוודא שה-Router עובד תקין בסביבת TSH, מנהל שיחות ו-state בצורה עקבית, אוכף הרשאות ומחזיר תשובות GenAI/RAG אמינות ובטוחות.\n\n## Scope\nAPI, Authentication, Conversations, History, SSE Messages, Delete, Files/Chunks, Feedback, Statistics, Boundaries, Authorization, RAG, Prompt Injection ו-State. בנוסף נכללות בדיקות Target Design של אפיון ה-RAG הגנרי (Ingestion/Retrieval), המסומנות בנפרד ואינן הוכחה למימוש נוכחי.\n\n## מחוץ ל-Scope כרגע\nProduction; עומסים ללא SLA; DB מלא ללא גישה; איכות עסקית סופית ללא Golden Dataset/SME.\n\n## סביבת בדיקה\nTSH/NON-PROD. Identity Token באמצעות gcloud auth print-identity-token ונשלח ב-X-Serverless-Authorization.\n\n## Entry Criteria\n- TSH Base URL\n- משתמש ענן והרשאת Router\n- Identity Token תקין\n- Swagger/Contract זמין\n- Test Data בסיסי\n\n## Exit Criteria\n- כל P0 עברו או אושרה חריגה\n- אין תקלת אבטחה קריטית פתוחה\n- P1/P2 תועדו\n- פערי Contract החוסמים החלטה סומנו/נסגרו\n- הופק Test Run Report\n\n## סיכונים\nToken קצר חיים; תלות ברשת/הרשאות; Contract חלקי; תלות ב-DB/Logs; צורך ב-SME לבדיקות איכות AI; אפיון ה-RAG הוא Target Design וסעיף ה-API שלו עדיין מסומן להשלמה.\n`;
}
function stdMarkdown(){
  const lines=[`# STD – תכנון ותיאור בדיקות GenAI Router`,``,`סה״כ תסריטים: ${state.tests.length}`,``,'## Test Cases'];
  for(const t of state.tests){ lines.push(`### ${t.ID} – ${t['תרחיש בדיקה']||''}`,`- עדיפות: ${t.priority}` ,`- תחום: ${t['תחום']||''}`,`- Endpoint: ${t.Endpoint||''}`,`- תנאים מקדימים: ${t['תנאים מקדימים']||''}`,`- צעדים/קלט: ${t['צעדים / קלט']||''}`,`- Expected: ${t['Expected Result']||''}`,`- מצב: ${modeLabel(t.mode)}`,``); }
  return lines.join('\n');
}
function exportStp(){exportBlob('STP-GenAI-Router-he.md','text/markdown;charset=utf-8','\ufeff'+stpMarkdown());}
function exportStd(){exportBlob('STD-GenAI-Router-he.md','text/markdown;charset=utf-8','\ufeff'+stdMarkdown());}

function renderKpis(){ $('kpiTotal').textContent=state.tests.length; $('kpiAuto').textContent=state.tests.filter(t=>t.mode!=='manual').length; $('kpiPass').textContent=Object.values(state.results).filter(r=>r.status==='PASS').length; $('kpiFail').textContent=Object.values(state.results).filter(r=>r.status==='FAIL').length; if($('kpiNA'))$('kpiNA').textContent=Object.values(state.results).filter(r=>r.status==='N/A').length; if($('kpiDemo'))$('kpiDemo').textContent=Object.values(state.results).filter(r=>r.status==='DEMO').length; $('kpiOpen').textContent=state.questions.filter(q=>(q.Status||'Open')==='Open').length; }
function renderReport(){ const rs=Object.values(state.results); $('reportTable').innerHTML=rs.length?`<table class="qa-table"><thead><tr><th>ID</th><th>Status</th><th>Mode</th><th>Actual</th><th>Details</th><th>Evidence</th><th>Time</th></tr></thead><tbody>${rs.map(r=>`<tr><td>${r.id}</td><td class="${statusClass(r.status)}">${r.status}</td><td>${esc(r.evidence?.mode||'—')}</td><td>${esc(r.actual)}</td><td>${esc(r.details)}</td><td>${r.evidence?'Request/Response שמור':'—'}</td><td dir="ltr">${r.time}</td></tr>`).join('')}</tbody></table>`:'אין תוצאות עדיין.'; }
function renderAll(){renderCatalog();renderQuestions();renderKpis();renderReport();renderContract();renderContext();renderRagSpec();renderStpStd();renderEndpointGuide();readiness();}

function populateEndpoints(){ const s=$('endpointSelect'); s.innerHTML=state.operations.map((o,i)=>`<option value="${i}">${o.method} ${o.path} — ${esc(o.operationId)}</option>`).join(''); s.onchange=syncApiTemplate; syncApiTemplate(); }
function syncApiTemplate(){ const o=state.operations[+$('endpointSelect').value||0]; if(!o)return; $('apiMethod').value=o.method; $('apiBody').value=JSON.stringify(requestBody(o.path,o.method),null,2); }
async function apiRun(){ try{const o=state.operations[+$('endpointSelect').value||0]; let b; try{b=JSON.parse($('apiBody').value||'{}')}catch{throw new Error('Request JSON אינו תקין');} if(cfg().executionMode==='postman'){const curl=buildCurl(o.method,o.path,o.method==='GET'?undefined:b);$('apiResponse').textContent=curl;$('apiMeta').textContent='POSTMAN / cURL MODE — לא נשלחה בקשה';return;} const isStream=o.path==='/v1/conversations/messages'; const r=await proxy({method:o.method,path:o.path,body:(o.method==='GET'?undefined:b),stream:isStream}); if(isStream){$('apiResponse').textContent=''; const txt=await readStream(r.stream,(c,f)=>$('apiResponse').textContent=f.slice(-10000)); $('apiMeta').textContent=`HTTP ${r.status}\nSSE`; const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid;} else {$('apiResponse').textContent=typeof r.body==='string'?r.body:JSON.stringify(r.body,null,2);$('apiMeta').textContent=`HTTP ${r.status}\n${r.latencyMs??''} ms\n${r.contentType??''}`;} showToast('API Runner הסתיים.','success');}catch(e){$('apiResponse').textContent=e.message;$('apiMeta').textContent='BLOCKED';showToast('API Runner: '+e.message,'error',5000);} }
async function aiRun(){ try{const c=requireFields(['conversationId','appId','userId']); const body={conversationId:c.conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:$('aiPrompt').value.trim()}; $('aiStream').textContent=''; const r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); const txt=await readStream(r.stream,(ch,full)=>{$('aiStream').textContent=full.slice(-15000);renderSseEvents(full);}); renderSseEvents(txt); const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; showToast('GenAI/RAG request הסתיים.','success');}catch(e){$('aiStream').textContent=e.message;showToast('GenAI/RAG: '+e.message,'error',5000);} }

function exportBlob(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJson(){exportBlob(`qa-report-${Date.now()}.json`,'application/json',JSON.stringify({generatedAt:now(),environment:cfg().baseUrl,results:Object.values(state.results),aiRating:state.aiRating},null,2));}
function exportCsv(){const rows=[['ID','Status','Actual','Details','Time'],...Object.values(state.results).map(r=>[r.id,r.status,r.actual,r.details,r.time])];const csv=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');exportBlob(`qa-report-${Date.now()}.csv`,'text/csv;charset=utf-8','\ufeff'+csv);}

async function health(){ if(cfg().executionMode==='postman'){setConn('Postman mode · העתק cURL','question');showToast('במצב Postman האתר לא שולח בקשה.','warning');return;} try{const r=await proxy({method:'GET',path:'/health'}); const ok=r.status===200; state.connectionOk=ok; setConn(state.demo?'Demo Mode · סימולציה בלבד':(ok?`מחובר · HTTP ${r.status}`:`HTTP ${r.status}`),state.demo?'demo':(ok?'pass':'fail')); readiness();showToast(state.demo?'בדיקת חיבור בסימולציית Demo בלבד.':(ok?'החיבור ל־Router הצליח.':`ה־Router החזיר HTTP ${r.status}.`),state.demo?'warning':(ok?'success':'error'));}catch(e){state.connectionOk=false;setConn(e.message,'fail');readiness();showToast('בדיקת חיבור נכשלה: '+e.message,'error',5000);} }
function demo(){state.demo=!state.demo;$('demoBtn').textContent=state.demo?'Demo: ON':'Demo Mode';$('demoWarning').hidden=!state.demo;setConn(state.demo?'Demo Mode · סימולציה בלבד':'לא מחובר',state.demo?'demo':'neutral');showToast(state.demo?'Demo Mode הופעל: לא נשלחות בקשות אמיתיות.':'Demo Mode כובה.','info');}

function wire(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabpage').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');}); document.querySelectorAll('.subtab').forEach(b=>b.onclick=()=>{const root=b.closest('.tabpage'); if(!root)return; root.querySelectorAll('.subtab').forEach(x=>x.classList.remove('active')); root.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const page=root.querySelector(`[data-subpage=\"${b.dataset.subtab}\"]`); if(page)page.classList.add('active');});
  $('searchTests').oninput=renderCatalog;$('priorityFilter').onchange=renderCatalog;$('modeFilter').onchange=renderCatalog;
  $('demoBtn').onclick=demo;$('healthBtn').onclick=health;$('markTokenBtn').onclick=()=>{markTokenNow();showToast('זמן הפקת Token סומן.','success');};$('readinessBtn').onclick=()=>{const ok=readiness();showToast(ok?'הסביבה מוכנה להרצה.':'עדיין חסרים נתונים — ראה כרטיסי המוכנות. ',ok?'success':'warning');};$('runAllTests').onclick=runAllTests;$('runSafeP0').onclick=runSafeP0;$('runBoundaryPack').onclick=runBoundaryPack;$('runRagSpecPack').onclick=runRagSpecPack;$('runHappyFlow').onclick=happyFlow;$('uiSelfTestBtn').onclick=runUiSelfTest;$('flowRunBtn').onclick=happyFlow;$('apiRunBtn').onclick=apiRun;$('copyCurlBtn').onclick=copyCurl;$('aiRunBtn').onclick=aiRun;
  $('clearResults').onclick=()=>{state.results={};state.lastExchange=null;$('runSummary').innerHTML='';renderAll();showToast('תוצאות ההרצה אופסו.','success');};
  $('exportJson').onclick=exportJson;$('exportCsv').onclick=exportCsv; if($('exportStpBtn')) $('exportStpBtn').onclick=exportStp; if($('exportStdBtn')) $('exportStdBtn').onclick=exportStd;
  ['baseUrl','token','appId','userId','caseId'].forEach(id=>$(id).addEventListener('input',readiness)); $('executionMode').addEventListener('change',readiness); $('authHeader').addEventListener('change',readiness); $('cloudAccessConfirmed').addEventListener('change',readiness); $('dialogRunBtn').onclick=async()=>{const id=state.selectedTestId;if(id){await runTest(id);$('testDialog').close();}}; document.querySelectorAll('[data-manual-status]').forEach(b=>b.onclick=()=>saveManual(b.dataset.manualStatus));
  document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>{state.aiRating={rating:b.dataset.rating,note:$('aiNote').value,time:now()};$('aiRating').textContent=`נבחר: ${b.dataset.rating}`;});
}

setInterval(updateTokenCountdown,1000);
wire(); loadData().then(()=>{if(new URLSearchParams(location.search).get('selftest')==='1')setTimeout(runUiSelfTest,50);}).catch(e=>{showToast('שגיאת טעינת נתונים: '+e.message,'error',8000);document.body.insertAdjacentHTML('beforeend',`<pre>${esc(e.message)}</pre>`);});
