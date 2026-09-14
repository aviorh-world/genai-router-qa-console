const state = {
  tests: [], questions: [], operations: [], results: {}, lastStream: '', aiRating: null,
  demo: false, createdConversationId: null
};

const $ = (id) => document.getElementById(id);
const esc = (v='') => String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const now = () => new Date().toISOString();

function cfg(){
  return {
    baseUrl:$('baseUrl').value.trim(), token:$('token').value.trim(), appId:$('appId').value.trim(),
    userId:$('userId').value.trim(), caseId:$('caseId').value.trim() || null,
    userIdB:$('userIdB').value.trim(), tokenB:$('tokenB').value.trim(),
    conversationId:$('conversationId').value.trim(), messageId:$('messageId').value.trim()
  };
}
function requireFields(names){ const c=cfg(); const missing=names.filter(n=>!c[n]); if(missing.length) throw new Error('חסרים שדות: '+missing.join(', ')); return c; }
function setConn(text,kind='neutral'){ const el=$('connectionBadge'); el.textContent=text; el.className='badge '+kind; }

async function loadData(){
  const [raw,sw] = await Promise.all([fetch('/data/qa_tests_from_excel.json').then(r=>r.json()), fetch('/data/swagger-summary.json').then(r=>r.json())]);
  for(const sheet of ['01_P0_קריטי','02_P1_חשוב','03_P2_משלים']){
    const rows=raw[sheet]; const h=rows[0];
    for(const r of rows.slice(1)){
      const o=Object.fromEntries(h.map((x,i)=>[x,r[i]]));
      o.priority=o.ID.split('-')[0]; o.mode=getMode(o.ID); state.tests.push(o);
    }
  }
  const q=raw['04_שאלות_פתוחות']; const qh=q[0];
  state.questions=q.slice(1).map(r=>Object.fromEntries(qh.map((x,i)=>[x,r[i]])));
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
    case 'POST /v1/conversations/messages': return {conversationId:c.conversationId,userId:c.userId,appId:c.appId,caseId:c.caseId,content:'בדיקת QA'};
    case 'POST /v1/messages/send/feedback': return {messageId:c.messageId,feedbackType:'thumbs_up'};
    case 'POST /v1/conversations/fetch/chunks/text': return {chunks:[{bucketName:'REPLACE_ME',fileName:'REPLACE_ME.pdf',chunkId:0}]};
    case 'POST /v1/files/download': return {bucketName:'REPLACE_ME',fileName:'REPLACE_ME.pdf'};
    default: if(path.includes('/statistics/')) return {startDate:new Date(Date.now()-86400000).toISOString(),endDate:new Date().toISOString()}; return {};
  }
}

async function proxy({method,path,body,token,stream=false}){
  const c=cfg(); if(state.demo) return demoResponse(method,path,body,stream);
  if(!c.baseUrl) throw new Error('יש להזין TSH Base URL');
  const res=await fetch('/api/proxy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseUrl:c.baseUrl,token:token===undefined?c.token:token,method,apiPath:path,body,stream})});
  if(stream){ return {status:res.status,stream:res.body,headers:res.headers}; }
  const wrapper=await res.json();
  if(!res.ok) throw new Error(wrapper.error||'Proxy error');
  let parsed=wrapper.body; try{parsed=JSON.parse(wrapper.body)}catch{}
  return {status:wrapper.upstreamStatus, body:parsed, raw:wrapper.body, latencyMs:wrapper.latencyMs, contentType:wrapper.contentType, isBinary:wrapper.isBinary};
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
      default: return result(id,'BLOCKED','אין אוטומציה ייעודית עדיין','התסריט נשאר זמין לביצוע ידני/דרך API Runner.');
    }
    return result(id,pass?'PASS':'FAIL',actual,t['Expected Result']||'');
  }catch(e){ return result(id,'BLOCKED',e.message,'לא בוצעה קביעה עסקית.'); }
}

async function runSafeP0(){
  const ids=['P0-001','P0-002','P0-003','P0-004','P0-006','P0-007']; $('runSummary').innerHTML='';
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
      if(path==='/v1/conversations/messages') body={conversationId,userId:c.userId,appId:c.appId,caseId:c.caseId,content:$('flowQuestion').value.trim()||'בדיקת QA'};
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
    const r=state.results[t.ID]; return `<tr><td>${esc(t.ID)}</td><td class="${t.priority.toLowerCase()}">${t.priority}</td><td class="mode-${t.mode}">${modeLabel(t.mode)}</td><td>${esc(t['תחום'])}</td><td dir="ltr">${esc(t.Endpoint)}</td><td>${esc(t['תרחיש בדיקה'])}</td><td>${esc(t['Expected Result'])}</td><td>${esc(t['שאלה פתוחה / נדרש אישור'])}</td><td class="${r?statusClass(r.status):''}">${r?esc(r.status):'Not Run'}</td><td><button class="btn test-run" data-id="${t.ID}">${t.mode==='manual'?'סמן/פתח':'Run'}</button></td></tr>`}).join('')}</tbody></table>`;
  document.querySelectorAll('.test-run').forEach(b=>b.onclick=()=>runTest(b.dataset.id));
}
function renderQuestions(){ $('questionsTable').innerHTML=`<table class="qa-table"><thead><tr><th>Test ID</th><th>תחום</th><th>Endpoint</th><th>שאלה</th><th>למה נדרש</th></tr></thead><tbody>${state.questions.map(q=>`<tr><td>${esc(q['Test ID'])}</td><td>${esc(q['תחום'])}</td><td dir="ltr">${esc(q.Endpoint)}</td><td>${esc(q['שאלה פתוחה'])}</td><td>${esc(q['מקור / למה נדרש'])}</td></tr>`).join('')}</tbody></table>`; }
function renderKpis(){ $('kpiTotal').textContent=state.tests.length; $('kpiAuto').textContent=state.tests.filter(t=>t.mode!=='manual').length; $('kpiPass').textContent=Object.values(state.results).filter(r=>r.status==='PASS').length; $('kpiFail').textContent=Object.values(state.results).filter(r=>r.status==='FAIL').length; $('kpiOpen').textContent=state.questions.length; }
function renderReport(){ const rs=Object.values(state.results); $('reportTable').innerHTML=rs.length?`<table class="qa-table"><thead><tr><th>ID</th><th>Status</th><th>Actual</th><th>Details</th><th>Time</th></tr></thead><tbody>${rs.map(r=>`<tr><td>${r.id}</td><td class="${statusClass(r.status)}">${r.status}</td><td>${esc(r.actual)}</td><td>${esc(r.details)}</td><td dir="ltr">${r.time}</td></tr>`).join('')}</tbody></table>`:'אין תוצאות עדיין.'; }
function renderAll(){renderCatalog();renderQuestions();renderKpis();renderReport();}

function populateEndpoints(){ const s=$('endpointSelect'); s.innerHTML=state.operations.map((o,i)=>`<option value="${i}">${o.method} ${o.path} — ${esc(o.operationId)}</option>`).join(''); s.onchange=syncApiTemplate; syncApiTemplate(); }
function syncApiTemplate(){ const o=state.operations[+$('endpointSelect').value||0]; if(!o)return; $('apiMethod').value=o.method; $('apiBody').value=JSON.stringify(requestBody(o.path,o.method),null,2); }
async function apiRun(){ try{const o=state.operations[+$('endpointSelect').value||0]; let b; try{b=JSON.parse($('apiBody').value||'{}')}catch{throw new Error('Request JSON אינו תקין');} const isStream=o.path==='/v1/conversations/messages'; const r=await proxy({method:o.method,path:o.path,body:(o.method==='GET'?undefined:b),stream:isStream}); if(isStream){$('apiResponse').textContent=''; const txt=await readStream(r.stream,(c,f)=>$('apiResponse').textContent=f.slice(-10000)); $('apiMeta').textContent=`HTTP ${r.status}\nSSE`; const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid;} else {$('apiResponse').textContent=typeof r.body==='string'?r.body:JSON.stringify(r.body,null,2);$('apiMeta').textContent=`HTTP ${r.status}\n${r.latencyMs??''} ms\n${r.contentType??''}`;} }catch(e){$('apiResponse').textContent=e.message;$('apiMeta').textContent='BLOCKED';} }
async function aiRun(){ try{const c=requireFields(['conversationId','appId','userId']); const body={conversationId:c.conversationId,userId:c.userId,appId:c.appId,caseId:c.caseId,content:$('aiPrompt').value.trim()}; $('aiStream').textContent=''; const r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); const txt=await readStream(r.stream,(ch,full)=>$('aiStream').textContent=full.slice(-15000)); const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; }catch(e){$('aiStream').textContent=e.message;} }

function exportBlob(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJson(){exportBlob(`qa-report-${Date.now()}.json`,'application/json',JSON.stringify({generatedAt:now(),environment:cfg().baseUrl,results:Object.values(state.results),aiRating:state.aiRating},null,2));}
function exportCsv(){const rows=[['ID','Status','Actual','Details','Time'],...Object.values(state.results).map(r=>[r.id,r.status,r.actual,r.details,r.time])];const csv=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');exportBlob(`qa-report-${Date.now()}.csv`,'text/csv;charset=utf-8','\ufeff'+csv);}

async function health(){ try{const r=await proxy({method:'GET',path:'/health'}); const ok=r.status===200; setConn(ok?`מחובר · HTTP ${r.status}`:`HTTP ${r.status}`,ok?'pass':'fail');}catch(e){setConn(e.message,'fail');} }
function demo(){state.demo=!state.demo;$('demoBtn').textContent=state.demo?'Demo: ON':'Demo Mode';setConn(state.demo?'Demo Mode':'לא מחובר',state.demo?'question':'neutral');}

function wire(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabpage').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');});
  $('searchTests').oninput=renderCatalog;$('priorityFilter').onchange=renderCatalog;$('modeFilter').onchange=renderCatalog;
  $('demoBtn').onclick=demo;$('healthBtn').onclick=health;$('runSafeP0').onclick=runSafeP0;$('runHappyFlow').onclick=happyFlow;$('flowRunBtn').onclick=happyFlow;$('apiRunBtn').onclick=apiRun;$('aiRunBtn').onclick=aiRun;
  $('clearResults').onclick=()=>{state.results={};$('runSummary').innerHTML='';renderAll();};
  $('exportJson').onclick=exportJson;$('exportCsv').onclick=exportCsv;
  document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>{state.aiRating={rating:b.dataset.rating,note:$('aiNote').value,time:now()};$('aiRating').textContent=`נבחר: ${b.dataset.rating}`;});
}

wire(); loadData().catch(e=>document.body.insertAdjacentHTML('beforeend',`<pre>${esc(e.message)}</pre>`));
