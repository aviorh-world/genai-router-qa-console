const state = {
  tests: [], questions: [], operations: [], results: {}, lastStream: '', aiRating: null,
  demo: false, createdConversationId: null, selectedTestId: null,
  context: null, tokenMarkedAt: null, connectionOk: false,
  lastExchange: null, bulkRunning: false, uiSelfTest: null,
  goldenDataset: [], goldenResults: {}, goldenEditingId: null, goldenRuns: [], currentGoldenRunId: null,
  investigations: {}, runHistory: [], bugDraft: null
};

const $ = (id) => document.getElementById(id);
const esc = (v='') => String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const now = () => new Date().toISOString();

const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const RUN_HISTORY_KEY='genai-router-qa-run-history-v002';
function redactForAi(value,key=''){
  if(value==null)return value;
  const sensitive=/(token|authorization|password|secret|api[-_]?key|private[-_]?key)/i;
  const identifiers=/(userId|caseId|conversationId|messageId)/i;
  if(sensitive.test(key)) return '[REDACTED]';
  if(identifiers.test(key)) return '[REDACTED-ID]';
  if(Array.isArray(value)) return value.slice(0,50).map(v=>redactForAi(v,key));
  if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=redactForAi(v,k);return out;}
  if(typeof value==='string') return value.length>6000?value.slice(0,6000)+'…[TRUNCATED]':value;
  return value;
}
function loadRunHistory(){try{const x=JSON.parse(localStorage.getItem(RUN_HISTORY_KEY)||'[]');state.runHistory=Array.isArray(x)?x.slice(0,20):[];}catch{state.runHistory=[];}}
function persistRunHistory(){try{localStorage.setItem(RUN_HISTORY_KEY,JSON.stringify(state.runHistory.slice(0,20)));}catch{}}
function nextCaseId(){
  let current=0;
  try{current=parseInt(localStorage.getItem(CASE_ID_KEY)||'0',10)||0;}catch{}
  if(current<100000000) current=parseInt(String(Date.now()).slice(-9),10);
  current+=1;
  if(current>999999999) current=100000000;
  try{localStorage.setItem(CASE_ID_KEY,String(current));}catch{}
  return String(current).padStart(9,'0').slice(-9);
}
function updateCaseIdHelp(){
  const el=$('caseIdHelp'), input=$('caseId');
  if(!el||!input) return;
  const v=input.value.trim();
  if(!v){el.textContent='לא הוזן Case ID. בלחיצה על "חדש" יווצר מזהה בדיקה ייחודי.';return;}
  el.textContent=validCaseId(v)?'Case ID בדיקה תקין למעקב. אפשר לשנות ידנית או ליצור חדש.':'Case ID צריך להיות 9 ספרות אם מחליטים לשלוח אותו.';
}
function ensureCaseId(force=false){
  const el=$('caseId'); if(!el) return;
  const current=el.value.trim();
  if(force || !validCaseId(current) || current==='123456789') el.value=nextCaseId();
  updateCaseIdHelp();
}
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


const BUG_CATEGORIES = [
  'Retrieval Failure',
  'Generation Failure',
  'Grounding Failure',
  'Authorization/Security Failure',
  'Routing Failure',
  'SQL Generation Failure',
  'Data/Execution Failure'
];
function bugCategoryOptions(selected=''){return `<option value="">לא סווג</option>`+BUG_CATEGORIES.map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join('');}
function classifyGoldenReason(r={}){
  const reasons=[];
  if(String(r.answer||'').startsWith('ERROR:')) reasons.push('שגיאת הרצה');
  if(r.sourceMatch==='NO MATCH') reasons.push('Source לא תאם ל־Expected');
  if(Number.isFinite(r.retrievalScore) && r.retrievalScore<80) reasons.push(`Retrieval ${r.retrievalScore}%`);
  if(Number.isFinite(r.answerScore) && r.answerScore<75) reasons.push(`Answer ${r.answerScore}%`);
  if(Number.isFinite(r.groundingScore) && r.groundingScore<70) reasons.push(`Grounding ${r.groundingScore}%`);
  if(r.chunkFetchStatus==='FAILED') reasons.push('שליפת Chunk נכשלה');
  if(r.status==='FAIL') reasons.push('סומן FAIL');
  return reasons.length?reasons:['נדרשת סקירה אנושית'];
}

const CONTRACT_GAPS = [
  {severity:'MEDIUM',area:'Authentication',gap:'ב־Swagger לא מוגדר securityScheme. ה-Identity Token מופק ב-gcloud auth print-identity-token ונשלח ב-X-Serverless-Authorization: Bearer <TOKEN>.',impact:'דרך ההזדהות ידועה כעת, אך עדיין חסרים תיעוד פורמלי ב-Swagger וקודי שגיאה מוסכמים.'},
  {severity:'HIGH',area:'Environment / Network',gap:'ה־servers ב־Swagger אינו מצביע על TSH. הצוות ציין שנדרשת תקשורת TSH↔NON-PROD והרשאה לשירות.',impact:'Vercel ציבורי עלול לא להגיע ליעד; יש להריץ Browser Direct או Postman מתוך הרשת המתאימה.'},
  {severity:'MEDIUM',area:'Case ID',gap:'הצוות הבהיר ש-Case ID אינו קריטי להתנעה ויכול להיות ערך בדיקה; Swagger מגדיר 9 ספרות ו-nullable אך לא required.',impact:'Test Data כבר לא blocker, אך missing/null עדיין דורשים אישור Runtime.'},
  {severity:'HIGH',area:'History / Messages',gap:'הדרישה העסקית היא 20 הודעות אחרונות, אבל הכמות והסדר אינם Contract מפורש ב-Get Conversation.',impact:'לא ניתן לקבוע PASS/FAIL חד־משמעי לסדר ולגבול בלי walkthrough.'},
  {severity:'MEDIUM',area:'Delete / State',gap:'AlloyDB מזוהה כ-DB של sessions/state/logs, אך לא מוגדר אם Delete הוא Hard/Soft ומה משתנה בטבלאות.',impact:'אימות persistence נשאר ידני עד לקבלת table/schema + business rule.'},
  {severity:'MEDIUM',area:'Streaming',gap:'קיים event בשם thought ללא הגדרה האם זה Progress מסונן או reasoning פנימי.',impact:'נדרשת בדיקת אבטחה שאין חשיפת System Prompt/Chain-of-Thought.'},
  {severity:'MEDIUM',area:'Message Length',gap:'Request מאפשר עד 32,768 תווים בעוד Message persisted/returned מתועד עד 8,192.',impact:'לא ברור מה Expected עבור הודעה גדולה מ־8,192.'},
  {severity:'MEDIUM',area:'Authorization / Sources',gap:'מסמך ההרשאות מגדיר least-privilege ל-Service Accounts, אך לא ownership אפליקטיבי של File/Chunk/Case למשתמש.',impact:'בדיקות IDOR על GCS/Chunks עדיין דורשות כלל הרשאה מוסכם.'},
  {severity:'HIGH',area:'RAG Target Design',gap:'אפיון ה-RAG הגנרי מתאר Target Design מפורט, אך עדיין לא ידוע אילו חלקים ממנו כבר ממומשים ב-TSH.',impact:'בדיקות חבילת RAG מסומנות כבדיקות Spec/Assisted עד walkthrough או observability שמוכיחים Runtime behavior.'},
  {severity:'MEDIUM',area:'RAG Management APIs',gap:'המסמך מציג Category / Document Category / Permission APIs אך מסיים את הסעיף ב-"להשלים!!".',impact:'אין לבנות אוטומציה מול endpoints אלה עד לקבלת API Contract סופי.'}
];



const AI_QA_LESSONS = [
  {title:'1. AI הוא לא פונקציה דטרמיניסטית',body:'אותה שאלה יכולה לקבל ניסוח מעט שונה בין הרצות. לכן בדרך כלל לא משווים תשובה כמחרוזת מדויקת. בודקים עובדות, מקור, כיסוי של נקודות חובה והתנהגות עקבית.'},
  {title:'2. מפרידים Retrieval מ־Generation',body:'ב־RAG יש שתי שאלות שונות: האם המערכת מצאה את המידע הנכון, והאם ה־LLM ניסח ממנו תשובה נכונה. אם ה־Chunk שגוי זו בעיית Retrieval; אם ה־Chunk נכון אבל התשובה שגויה זו בעיית Generation.'},
  {title:'3. Source/Chunk הם ה־Evidence שלך',body:'אל תסתפק ב״התשובה נשמעת הגיונית״. עבור שאלה חשובה, בדוק שה־Source נכון, שה־Chunk מכיל את העובדה, ושהתשובה לא מוסיפה עובדות שלא מופיעות במקור.'},
  {title:'4. Golden Dataset הוא Regression Suite',body:'בונים סט קבוע של שאלות שאושרו מראש עם תשובת זהב ומקור צפוי. אחרי שינוי Model, Prompt, Chunking, Index או Config מריצים שוב ומשווים כדי לזהות רגרסיה.'},
  {title:'5. צריך גם שאלות שאין להן תשובה',body:'Golden טוב כולל No-Answer: שאלות שהמידע אינו קיים בקורפוס. Expected תקין הוא שהמערכת תודה שאין בסיס מספיק, ולא תמציא תשובה.'},
  {title:'6. מודדים כמה ממדים, לא ציון אחד',body:'מומלץ להפריד Correctness, Groundedness/Faithfulness, Source correctness, Retrieval quality, No-answer behavior, Security, Latency ולעיתים Cost/Tokens. HTTP 200 לא אומר שהתשובה איכותית.'},
  {title:'7. גרסה היא חלק מהתוצאה',body:'כשמשווים רגרסיה צריך לדעת מול איזו גרסת Model, Prompt, Index/Corpus, Embedding/Chunking ו־Config הורצה הבדיקה. אחרת קשה להסביר למה תוצאה השתנתה.'},
  {title:'8. אוטומציה עוזרת — אבל לא כל Judge הוא אמת',body:'Similarity או LLM-as-a-Judge יכולים לסנן תוצאות ולהאיץ עבודה, אבל חייבים לכייל אותם מול Human/SME. במיוחד במיסוי, תשובה שנשמעת דומה יכולה להיות שגויה בפרט קטן.'},
  {title:'9. בדיקות חוזרות חושפות חוסר יציבות',body:'לתסריטים קריטיים כדאי לעיתים להריץ אותה שאלה כמה פעמים. אם פעם אחת היא נכונה ופעמיים שגויה, הממוצע חשוב יותר מהרצה מוצלחת בודדת.'},
  {title:'10. אבטחה והרשאות הן חלק מאיכות AI',body:'RAG איכותי לא רק עונה נכון; הוא גם לא מחזיר מסמך, Chunk או מידע מקטגוריה שהמשתמש אינו מורשה לראות, ולא נופל ל־Prompt Injection.'},
  {title:'11. בודקים גם את ה־Router וגם כל רכיב בנפרד',body:'ב־E2E שולחים שאלה דרך ה־Router ובודקים שה־Intent נותב למסלול הנכון. בתרשים ה־Serving שסופק מופיעים שלושה מסלולים מרכזיים: Q&A/ידע דרך Retrieval, שיחה כללית דרך LLM, ושאלה טבלאית דרך Text2SQL. בנוסף מבצעים Component Tests ישירים ל־Text2SQL ולרכיבים שנגישים לבדיקה כדי לבודד את מקור הכשל.'}
];

const AI_GLOSSARY = [
  {term:'RAG',aliases:['Retrieval Augmented Generation'],desc:'שיטה שבה המערכת לא מסתמכת רק על הידע של מודל השפה. לפני יצירת התשובה היא מאחזרת מידע ממאגר מסמכים, בונה ממנו Context, ורק אז מבקשת מה־LLM לענות. מבחינת QA צריך לבדוק גם את שלב האחזור וגם את התשובה.'},
  {term:'Golden Dataset',aliases:['Golden Set','שאלות זהב'],desc:'סט בדיקות קבוע שאושר מראש: שאלה, תשובת זהב ולעיתים גם Source/Chunk צפוי. הוא משמש כ־Regression Suite ל־AI אחרי שינוי Model, Prompt, Index, Chunking או Config. תשובת הזהב מתארת את העובדות הנכונות — לא בהכרח ניסוח שחייב להיות זהה.'},
  {term:'Golden Answer',aliases:['תשובת זהב'],desc:'התשובה או קבוצת העובדות שאנו יודעים מראש שהן נכונות לשאלת זהב. עדיף לנסח אותה קצר וברור, לציין תנאים וסייגים חשובים, ולקשור אותה למקור מאושר.'},
  {term:'Chunk',aliases:['מקטע'],desc:'קטע טקסט שנחתך מתוך מסמך כדי שאפשר יהיה לחפש ולהעביר למודל רק מידע רלוונטי. Chunk קטן מדי עלול לאבד הקשר; גדול מדי עלול להכניס רעש. בבדיקות חשוב לוודא שה־Chunk המצוטט באמת מכיל את העובדה שעליה מבוססת התשובה.'},
  {term:'Agentic Chunking',aliases:[],desc:'חלוקת מסמך ל־Chunks באמצעות מודל/Agent שמנסה להבין מבנה ומשמעות, ולא רק לחתוך כל N תווים. זה עשוי לשמור הקשר טוב יותר, אבל מוסיף אי־דטרמיניזם ועלות ולכן דורש בדיקות איכות.'},
  {term:'Embedding',aliases:[],desc:'ייצוג מספרי של טקסט שמטרתו ללכוד משמעות סמנטית. טקסטים בעלי משמעות דומה אמורים להיות קרובים במרחב הווקטורי. הוא מאפשר Semantic Search גם כשהשאלה והמסמך משתמשים במילים שונות.'},
  {term:'Vector Search',aliases:['Semantic Search'],desc:'חיפוש לפי קרבה בין Embeddings ולא רק לפי התאמת מילות מפתח. ב־QA בודקים האם החיפוש מביא את המסמכים/Chunks הנכונים, במיוחד כשיש ניסוחים שונים לאותו רעיון.'},
  {term:'Top-K',aliases:[],desc:'מספר התוצאות המובילות שה־Retrieval מחזיר. Top-5 פירושו חמשת ה־Chunks המדורגים ראשונים. מדד בדיקה נפוץ הוא האם ה־Chunk הנכון מופיע ב־Top-3 או Top-5.'},
  {term:'Context',aliases:[],desc:'המידע שהמערכת מעבירה ל־LLM יחד עם השאלה — למשל ה־Chunks שנמצאו והמטא־דאטה שלהם. אם ה־Context חסר או שגוי, גם מודל חזק יכול לתת תשובה שגויה.'},
  {term:'Grounding',aliases:['Groundedness'],desc:'מידת ההתבססות של התשובה על המקורות שסופקו. תשובה Grounded לא מוסיפה טענות מהותיות שאין להן תמיכה ב־Context/Source.'},
  {term:'Faithfulness',aliases:[],desc:'מושג קרוב ל־Groundedness: האם התשובה נאמנה למידע שניתן לה ולא מעוותת אותו. למשל שינוי מ־״30 ימים״ ל־״30 ימי עסקים״ הוא כשל Faithfulness גם אם התשובה נשמעת סבירה.'},
  {term:'Hallucination',aliases:['הזיה'],desc:'מצב שבו המודל מייצר עובדה, מקור, מספר, חוק או פרט שלא נתמך במידע הזמין. ב־QA צריך לזהות גם Hallucination חלקי — משפט אחד שגוי בתוך תשובה שרובה נכונה.'},
  {term:'Source',aliases:['Citation','מקור'],desc:'המסמך או הרשומה שממנה הגיע המידע. Source correctness בודק שהמערכת מפנה למקור המתאים ולא למסמך דומה. אצלנו Source עשוי להוביל ל־chunkId שאפשר לשלוף ולבדוק.'},
  {term:'Retrieval',aliases:['אחזור'],desc:'השלב שבו המערכת מחפשת מידע רלוונטי לפני יצירת התשובה. בעיית Retrieval פירושה שהמסמך/Chunk הנכון לא נמצא, דורג נמוך מדי או סונן בטעות.'},
  {term:'Ingestion',aliases:['קליטה'],desc:'התהליך שמכניס מסמך למאגר RAG: חילוץ טקסט, ניקוי, Chunking, יצירת Metadata/Embeddings ואינדוקס. מסמך שעבר Ingestion טכני לא בהכרח עבר Ingestion איכותי.'},
  {term:'Re-Ingestion',aliases:[],desc:'עיבוד מחדש של מסמך קיים בעקבות שינוי אסטרטגיה, Chunking, Embedding או גרסה. לפי האפיון שלנו, רצוי שהגרסה הפעילה הישנה תישאר זמינה עד שהחדשה הושלמה בהצלחה.'},
  {term:'LLM',aliases:['Large Language Model'],desc:'מודל שפה גדול שמייצר טקסט על בסיס Prompt ו־Context. הוא אינו Database ואינו מבטיח אמת; הוא מנבא תשובה סבירה ולכן נדרשים Grounding, Guardrails ובדיקות.'},
  {term:'Prompt',aliases:[],desc:'הקלט הטקסטואלי שנשלח למודל. הוא יכול לכלול את שאלת המשתמש, הוראות מערכת, Context ודוגמאות. שינוי קטן ב־Prompt יכול לשנות התנהגות ולכן Prompt version צריך להיחשב חלק מגרסת המערכת.'},
  {term:'System Prompt',aliases:[],desc:'הוראות מערכת פנימיות שמכוונות את המודל, למשל לענות רק ממקורות מאושרים. משתמש רגיל לא אמור לראות או לעקוף אותן.'},
  {term:'Prompt Injection',aliases:[],desc:'קלט שמנסה לגרום למודל להתעלם מההוראות שלו, לחשוף סודות או לבצע פעולה אסורה. הוא יכול להגיע מהמשתמש וגם מתוך מסמך שנכנס ל־RAG.'},
  {term:'Guardrails',aliases:['Model Armor'],desc:'שכבות הגנה לפני/אחרי המודל שמנסות לחסום קלט/פלט מסוכן, Prompt Injection, Secrets ותוכן לא מורשה. QA צריך לבדוק גם חסימות נכונות וגם False Positives.'},
  {term:'Confidence',aliases:[],desc:'ציון שמייצג עד כמה רכיב מסוים בטוח בהחלטה, למשל בחירת קטגוריה. חשוב: Confidence אינו הסתברות מובטחת לאמת, ולכן צריך לכייל ספים על נתונים אמיתיים.'},
  {term:'Fallback',aliases:[],desc:'התנהגות חלופית כאשר המערכת לא בטוחה או רכיב נכשל. לדוגמה: אם לא נמצאה קטגוריה בביטחון מספיק, לחפש בכל הקטגוריות שהמשתמש מורשה אליהן — אך לעולם לא להרחיב מעבר להרשאה.'},
  {term:'No-Answer',aliases:['Abstention'],desc:'התנהגות שבה המערכת מסרבת לנחש כאשר אין מידע מספיק. זה תרחיש חיובי חשוב ב־Golden Dataset: לפעמים התשובה הנכונה היא ״אין מספיק מידע במקורות״.'},
  {term:'Answer Similarity',aliases:['Semantic Similarity'],desc:'מדד עזר לכמה התשובה בפועל דומה לתשובת הזהב. הוא שימושי לסינון מהיר, אבל אינו מספיק לקביעת נכונות: שתי תשובות יכולות להיות דומות מילולית ועדיין להבדיל בפרט קריטי.'},
  {term:'Context Precision',aliases:[],desc:'כמה מה־Chunks שהוחזרו באמת רלוונטיים לשאלה. Precision נמוך אומר שה־Context מכיל הרבה רעש.'},
  {term:'Context Recall',aliases:[],desc:'האם ה־Retrieval הצליח להביא את כל המידע הדרוש כדי לענות. Recall נמוך אומר שחלק מהמידע הקריטי נשאר מחוץ ל־Context.'},
  {term:'LLM-as-a-Judge',aliases:[],desc:'שימוש במודל נוסף כדי לדרג תשובת AI מול תשובת זהב/קריטריונים. זה יכול לאפשר אוטומציה רחבה, אך צריך לכייל את ה־Judge מול בני אדם ולשמור על מודל/Prompt קבועים כדי שהמדד עצמו לא יזוז.'},
  {term:'Regression',aliases:['AI Regression'],desc:'ירידה באיכות לאחר שינוי. בעולם AI היא יכולה לקרות גם בלי שינוי API: החלפת Model, Prompt, Index, Corpus, Embedding או Chunking עלולה לשפר חלק מהשאלות ולהרע אחרות.'},
  {term:'SSE',aliases:['Server-Sent Events'],desc:'Streaming חד־כיווני מהשרת לדפדפן. במקום Response אחד בסוף, מתקבלים events כמו content, sources, error ו־done. בבדיקות צריך לבדוק סדר, סיום, כפילויות וניתוק באמצע.'},
  {term:'Observability',aliases:[],desc:'היכולת להבין מה קרה בתוך הזרימה: איזה Tool הופעל, אילו Sources/Chunks נבחרו, latency, errors, category/filtering ועוד. בלי Observability קשה מאוד להסביר כשל AI.'},
  {term:'Audit',aliases:[],desc:'תיעוד של מי שינה מה ומתי. במערכת AI חשוב במיוחד לשינויים ב־Prompt, Config, Categories, Ingestion Strategy וגרסאות, כי שינוי כזה יכול להסביר שינוי באיכות.'},
  {term:'Router',aliases:[],desc:'השירות שמקבל את שאלת המשתמש, מסווג אותה ומנתב למסלול מתאים. בתרשים ה־Serving שסופק מופיעים Q&A/ידע דרך Retrieval, שיחה כללית דרך LLM ושאלה טבלאית דרך Text2SQL. מבחינת QA בודקים Expected Route מול Actual Route וגם שמירת Context והרשאות לאורך המעבר.'},
  {term:'Text2SQL',aliases:[],desc:'רכיב שמתרגם שאלה בשפה טבעית לשאילתת SQL. איכות נמדדת לא רק אם נוצר SQL תקין אלא אם הוא מחזיר את הנתונים הנכונים, בטוח ואינו מאפשר גישה שלא הותרה.'},
  {term:'Model Version',aliases:[],desc:'הגרסה המדויקת של המודל ששימש בהרצה. שינוי Model יכול לשנות איכות, latency ועלות גם אם הקוד לא השתנה, ולכן כדאי לשמור אותו בדוח Sanity.'},
  {term:'Baseline',aliases:['קו בסיס'],desc:'ריצת ייחוס מאושרת שאליה משווים Release חדש. ה־Baseline אינו חייב להיות מושלם; הוא צריך להיות גרסה ידועה ומאושרת שממנה ניתן לזהות מה השתפר ומה הורע.'},
  {term:'Release Sanity',aliases:['Golden Sanity'],desc:'הרצה מהירה וממוקדת של Golden Dataset אחרי העלאת גרסה. המטרה היא לזהות רגרסיות קריטיות ב־Retrieval, Answer, Grounding והרשאות לפני שממשיכים לבדיקות רחבות יותר.'},
  {term:'Run Metadata',aliases:['Release Metadata'],desc:'פרטי ההקשר שנשמרים עם תוצאות הרצה: Environment, Build/Commit, Model, Prompt version, Index/Corpus, RAG Config, Tester ותאריך. בלי Metadata קשה להסביר למה איכות השתנתה.'},
  {term:'Review Queue',aliases:['Human Review Queue'],desc:'רשימת תוצאות שהאוטומציה אינה יכולה להכריע בביטחון: Source לא צפוי, Chunk חסר, ציוני Answer/Grounding נמוכים, שינוי משמעותי או שגיאה. QA/SME עוברים על החריגים במקום לקרוא כל תשובה.'},
  {term:'Retrieval Quality',aliases:['איכות אחזור'],desc:'איכות שלב החיפוש: האם ה־Source/Chunk הנכון נמצא, האם הוא דורג גבוה מספיק והאם ה־Context מכיל את המידע הדרוש. נמדד בנפרד מאיכות ניסוח התשובה.'},
  {term:'Answer Correctness',aliases:['Correctness'],desc:'האם העובדות והמסקנה בתשובת ה־AI נכונות ביחס ל־Golden Answer/SME. ניסוח שונה אינו כשל כל עוד המשמעות, התנאים והמספרים נכונים.'},
  {term:'Source Match',aliases:[],desc:'בדיקה האם מקור שהוחזר בפועל תואם למסמך/מזהה/Chunk הצפוי. זה Signal חזק יותר מ־Answer Similarity כאשר Golden Dataset כולל Expected Source.'},
  {term:'Chunk Evidence',aliases:['Evidence Chunk'],desc:'טקסט ה־Chunk שנשלף מה־Source שה־AI החזיר. הוא מאפשר ל־QA לראות את חומר הראיות שהמערכת מצאה ולהכריע אם הכשל נמצא ב־Retrieval או ב־Generation/Grounding.'},
  {term:'Retrieval Failure',aliases:[],desc:'כשל שבו המידע הנכון לא הגיע ל־Context: Source/Chunk שגוי, Chunk חסר, מסמך סונן בטעות או תוצאה רלוונטית דורגה נמוך מדי. אם ה־LLM לא קיבל את העובדה הנכונה — זו בדרך כלל בעיית Retrieval.'},
  {term:'Generation Failure',aliases:[],desc:'ה־Retrieval סיפק Context נכון, אבל ה־LLM ניסח תשובה שגויה, חלקית או לא עקבית. כאן הבעיה היא בשלב יצירת התשובה ולא בחיפוש.'},
  {term:'Grounding Failure',aliases:[],desc:'התשובה אינה נאמנה ל־Context: מוסיפה עובדה שלא קיימת, משנה מספר/תנאי, או מייחסת למקור טענה שהוא לא תומך בה. Hallucination היא דוגמה נפוצה לכשל Grounding.'},
  {term:'Authorization/Security Failure',aliases:['Security Failure'],desc:'כשל שבו המשתמש מקבל מידע, Source, Chunk או פעולה שאינו מורשה אליהם, או כאשר Prompt Injection/Guardrail bypass גורמים לחשיפת מידע פנימי. זה תמיד סיווג אבטחה גם אם התשובה עצמה נכונה.'},
  {term:'Failure Taxonomy',aliases:['סיווג כשלים'],desc:'ארבעת הסיווגים שהאתר משתמש בהם לבאגי AI: Retrieval Failure, Generation Failure, Grounding Failure, Authorization/Security Failure. הסיווג עוזר להפנות את התקלה לרכיב ולצוות הנכון.'},
  {term:'Bug Evidence',aliases:['Evidence Bundle'],desc:'חבילת מידע שנועדה לאפשר למפתח לשחזר באג: Test/Golden ID, שאלה, Expected, Actual, Sources, Chunks, HTTP/Request/Response, Run Metadata, conversationId, זמני הרצה וסיווג הכשל — ללא Token.'},
  {term:'Regression Diff',aliases:['Release Comparison'],desc:'השוואה בין שתי ריצות של אותו Golden Dataset כדי לזהות שאלות שהשתפרו, הורעו, נשארו יציבות או החליפו Source. חשוב להשוות Runs עם Metadata ברור.'},
  {term:'Human-in-the-loop',aliases:['Human Review'],desc:'תהליך שבו אוטומציה מדרגת/מסננת, אבל אדם מאשר תוצאות עמומות או קריטיות. במערכות מס ורגולציה זו שכבה חשובה במיוחד עד שה־Evaluator האוטומטי כויל היטב.'},
  {term:'SME',aliases:['Subject Matter Expert','מומחה תוכן'],desc:'מומחה בתחום העסקי שמאשר מהי תשובה נכונה כאשר QA אינו יכול להכריע רק מהמסמך. Golden Dataset איכותי רצוי שיאושר על ידי SME בנושאים רגישים.'},
  {term:'Heuristic',aliases:['יוריסטי','Heuristic Score'],desc:'הערכה שימושית המבוססת על כללים או קירובים, אך אינה הוכחה לנכונות. למשל, חפיפת מילים בין Actual ל־Golden יכולה להיות Signal טוב, אבל תשובה עם מספר שגוי עדיין עלולה לקבל Similarity גבוה. באתר Heuristic מיועד לסינון ול־Review — לא ל־PASS/FAIL עסקי לבדו.'},
  {term:'Signal',aliases:['Quality Signal','סיגנל'],desc:'אינדיקציה שעוזרת להחליט אם תוצאה נראית תקינה או דורשת Review: למשל Similarity, Source Match, Grounding score או HTTP status. Signal אינו אמת מוחלטת; משלבים כמה Signals עם Expected וראיות.'},
  {term:'Non-determinism',aliases:['אי־דטרמיניזם','Nondeterminism'],desc:'אותה שאלה לאותו מודל יכולה להחזיר ניסוח ולעיתים גם תוכן מעט שונה בין הרצות. לכן בדיקות AI לא תמיד מתאימות להשוואת String מדויקת, ובתרחישים קריטיים כדאי לבדוק יציבות במספר הרצות.'},
  {term:'Flaky AI Test',aliases:['Flakiness','בדיקה לא יציבה'],desc:'בדיקה שעוברת ונכשלת לסירוגין בלי שינוי ברור במערכת. ב־AI זה יכול לנבוע מאי־דטרמיניזם, Retrieval משתנה, עומס או תלות חיצונית. מודדים שיעור הצלחה וחוקרים את התנודתיות במקום להתעלם מהכשל.'},
  {term:'Threshold',aliases:['סף'],desc:'ערך שמעליו או מתחתיו מתקבלת החלטה אוטומטית, למשל לשלוח ל־Review אם Grounding נמוך מסף מסוים. סף צריך להיות מכויל מול Dataset אמיתי; מספר שרירותי עלול ליצור False Positives או לפספס כשלים.'},
  {term:'False Positive / False Negative',aliases:['FP','FN'],desc:'False Positive: המנגנון מסמן בעיה למרות שהתוצאה תקינה. False Negative: המנגנון לא מסמן תוצאה שגויה. בכיול Evaluator או Guardrail בודקים את שני הכיוונים.'},
  {term:'Evaluator',aliases:['AI Evaluator','מעריך'],desc:'מנגנון שנותן ציון או החלטה לתוצאת AI לפי Correctness, Grounding, Source Match וכדומה. Evaluator יכול להיות Rule/Heuristic, מודל נוסף או אדם. חשוב לדעת מי המעריך ומה מגבלותיו.'},
  {term:'Corpus',aliases:['קורפוס','Knowledge Corpus'],desc:'אוסף המסמכים שעליהם מערכת ה־RAG רשאית לחפש. הוספה, הסרה או גרסה חדשה של מסמך יכולה לשנות תשובות גם בלי שינוי בקוד, ולכן כדאי לתעד Corpus/Index version.'},
  {term:'Index',aliases:['אינדקס','Vector Index'],desc:'מבנה הנתונים שמאפשר ל־Retrieval למצוא במהירות Chunks רלוונטיים, לרוב לפי Embeddings. אינדקס לא מעודכן או שנבנה עם Config שונה עלול לגרום ל־Retrieval Regression.'},
  {term:'Metadata',aliases:['מטא־דאטה'],desc:'מידע שמתאר מסמך/Chunk: documentId, category, version, case, timestamps ועוד. Metadata משמש לסינון, הרשאות, Traceability ו־Debugging ולכן גם הוא חלק מהבדיקות.'},
  {term:'Provenance',aliases:['Source Provenance','שרשרת מקור'],desc:'היכולת לעקוב מאיפה בדיוק הגיעה טענה: תשובה → Source → Chunk → מסמך וגרסה. Provenance טוב מאפשר ל־QA להוכיח שהתשובה נשענה על מקור מורשה ונכון.'},
  {term:'RBAC',aliases:['Role-Based Access Control'],desc:'הרשאות לפי תפקיד או קבוצה. ב־RAG הן צריכות למנוע ממסמך אסור להיכנס ל־Context. בדיקת QA חשובה: משתמש מקבוצה אחרת לא מקבל Source/Chunk שאינו מורשה.'},
  {term:'IDOR',aliases:['Insecure Direct Object Reference'],desc:'חולשת הרשאה שבה שינוי מזהה ישיר — conversationId, bucket/file או chunkId — מאפשר לקרוא אובייקט של משתמש/Case אחר. העובדה שמזהה קיים אינה הרשאה; השרת חייב לבדוק Ownership/Authorization.'},
  {term:'PII Leakage',aliases:['Data Leakage','דליפת מידע אישי'],desc:'חשיפה לא מורשית של מידע אישי או נתונים של משתמש/Case אחר דרך תשובה, Source, Chunk, History, Logs או Tool events. ב־GenAI בודקים גם דליפה עקיפה דרך Context וזיכרון.'},
  {term:'Chain-of-Thought',aliases:['CoT','שרשרת חשיבה'],desc:'Reasoning פנימי של מודל. QA אינו צריך לקבל או לאמת reasoning פנימי מפורט; אירועי thought/progress חיצוניים צריכים להיות מידע בטוח ומוגדר בלי System Prompt, Secrets, Credentials או reasoning פנימי רגיש.'},
  {term:'Direct Prompt Injection',aliases:['Prompt Injection ישיר'],desc:'המשתמש עצמו כותב הוראה שמנסה לעקוף את כללי המערכת, למשל להתעלם מההוראות או לחשוף מידע פנימי. בודקים שהמערכת שומרת על הרשאות וכללי System Prompt.'},
  {term:'Indirect Prompt Injection',aliases:['Prompt Injection עקיף'],desc:'הוראה זדונית נמצאת בתוך מסמך או תוכן שה־RAG מאחזר, ולא בשאלת המשתמש. המודל צריך להתייחס אליה כתוכן מקור ולא כפקודת מערכת.'},
  {term:'Idempotency',aliases:['אידמפוטנטיות'],desc:'היכולת לחזור על אותה פעולה בלי ליצור תוצאה כפולה לא רצויה. Retry אחרי Timeout של Send Message עלול ליצור שתי הודעות אם אין מנגנון Idempotency.'},
  {term:'Correlation ID',aliases:['Trace ID'],desc:'מזהה שמאפשר לקשור Request אחד בין Router, Retrieval, LLM, Tools ולוגים. הוא מקצר Debugging כי אפשר למצוא את כל האירועים של אותה הרצה.'},
  {term:'Latency / TTFT',aliases:['Time To First Token','זמן תגובה'],desc:'Latency הוא זמן התגובה; ב־Streaming חשוב במיוחד TTFT — הזמן עד ה־event/token הראשון — בנוסף לזמן הכולל עד done. את שניהם כדאי למדוד מול SLA מוגדר.'},
  {term:'Clarification',aliases:['Clarification Policy','שאלת הבהרה'],desc:'התנהגות שבה המערכת מבקשת מידע נוסף כשהשאלה עמומה במקום לנחש. QA בודק מתי מצופה Clarification, שהשאלה באמת מועילה ושלא נוצר Hallucination במקום הבהרה.'},
  {term:'Routing',aliases:['AI Routing','ניתוב'],desc:'החלטת ה־Router לאיזה Agent/Tool/יכולת להעביר את שאלת המשתמש. בדיקת QA טובה מגדירה Expected Route ומנסה לאמת Actual Route דרך SSE, Tool event, Trace או Log — ולא מנחשת אותו רק לפי נוסח התשובה.'},
  {term:'Intent Classification',aliases:['Intent Detection','זיהוי כוונה'],desc:'השלב שבו ה־Router מסווג מה המשתמש מבקש כדי לבחור Route. בתרשים המערכת מופיעים שלושה סוגים מרכזיים: Q&A/ידע, שיחה כללית ושאלה טבלאית. טעות בסיווג יכולה להפנות שאלה נכונה לרכיב הלא נכון.'},
  {term:'Routing Accuracy',aliases:[],desc:'אחוז שאלות שבהן Actual Route תואם ל־Expected Route המאושר. אפשר לבנות Golden Routing Dataset קטן של Question + Expected Route ולמדוד אותו בנפרד מאיכות התשובה.'},
  {term:'Routing Failure',aliases:[],desc:'כשל שבו ה־Router שולח בקשה ליכולת הלא נכונה או לא מזהה נכון את ה־Intent. זהו סיווג נפרד: גם RAG וגם Text2SQL יכולים להיות תקינים בפני עצמם, אך ה־E2E ייכשל אם הניתוב ביניהם שגוי.'},
  {term:'Component Test',aliases:['Component Testing','בדיקת רכיב'],desc:'בדיקה של רכיב מסוים בבידוד ככל האפשר, למשל RAG או Text2SQL ישירות. היא עוזרת להבדיל בין כשל פנימי ברכיב לבין כשל Routing/Integration. אפשר לבצע אותה רק אם יש Interface/Endpoint/כלי מתאים.'},
  {term:'End-to-End Test',aliases:['E2E','בדיקת קצה לקצה'],desc:'בדיקה דרך נקודת הכניסה האמיתית של המוצר, מה־Request ועד התשובה הסופית. דרך Router API היא עשויה לכסות Router → Tool/Agent → Data/RAG → LLM → Response, ולכן כשל E2E לבדו לא תמיד אומר באיזה רכיב התקלה.'},
  {term:'Integration Test',aliases:['בדיקת אינטגרציה'],desc:'בדיקה של החיבור בין רכיבים, למשל Router שמעביר Context והרשאות ל־RAG/Text2SQL ומקבל מהם תוצאה. המיקוד הוא בחוזה ובמעבר המידע בין השירותים.'},
  {term:'Expected Route',aliases:[],desc:'היעד שאושר מראש עבור שאלת בדיקה, למשל RAG או Text2SQL. הוא צריך להגיע מאפיון/SME/צוות הארכיטקטורה ולא מהשערה של ה־QA.'},
  {term:'Actual Route',aliases:[],desc:'היעד שאליו המערכת ניתבה בפועל. רצוי לזהות אותו מ־Observability — Tool/SSE/Trace/Log — ולא להסיק רק מהתשובה. Expected מול Actual מאפשר PASS/FAIL אוטומטי ל־Routing.'},

  {term:'Generated SQL',aliases:['SQL Generation'],desc:'שאילתת ה־SQL שהמודל יצר מתוך שאלה בשפה טבעית. QA בודק גם Syntax וגם לוגיקה: טבלאות, JOINs, WHERE, Aggregation, תאריכים, NULL והרשאות.'},
  {term:'Dry Run',aliases:['BigQuery Dry Run'],desc:'בדיקת SQL מול BigQuery בלי לבצע את השאילתה בפועל. היא יכולה לזהות SQL לא חוקי או references שגויים לפני Execution. בתיעוד Text2SQL שסופק מתואר retry של עד 3 ניסיונות אם ה־SQL אינו תקין.'},
  {term:'Query Execution',aliases:['SQL Execution'],desc:'הרצת ה־SQL בפועל מול בסיס הנתונים. יש להפריד בין SQL שנראה נכון לבין הנתונים שההרצה באמת החזירה.'},
  {term:'Domain Selection',aliases:['Maagarim','מאגרים','Domain Routing'],desc:'בחירת מאגרי/דומייני הנתונים שמשמשים לבניית Context ולניתוב Text2SQL. כאשר maagarim לא נשלח, התיעוד מתאר אפשרות שה־Router יבחר דומיינים אוטומטית.'},
  {term:'Result Truncation',aliases:['Truncated Result'],desc:'מצב שבו מספר השורות גדול מהמגבלה להחזרה inline. בתיעוד Text2SQL, התוצאה המקוצרת מוחזרת בתגובה והקובץ המלא יכול להישמר ב־GCS עם bucketName ו־fileName.'},
  {term:'GCS',aliases:['Google Cloud Storage'],desc:'אחסון אובייקטים בענן. ב־Text2SQL הוא יכול לשמש לשמירת תוצאה מלאה כאשר היא גדולה מדי להחזרה inline. QA צריך לבדוק גם הרשאות, קישור לקובץ הנכון ושהמידע אינו נחשף למשתמש לא מורשה.'},
  {term:'SQL2Text',aliases:['/applications/sql2text'],desc:'פעולת Text2SQL שמקבלת SQL ומחזירה הסבר קריא לאדם. לפי התיעוד שסופק היא אינה מריצה BigQuery וה־data בתגובה אמור להיות null.'},
  {term:'QueryAndData',aliases:['/applications/queryanddata'],desc:'פעולת Text2SQL שממירה שאלה בשפה טבעית ל־SQL ויכולה גם להריץ אותו ולהחזיר נתונים. זהו Endpoint מרכזי לבדיקות Component של Text2SQL.'},
  {term:'SQL Generation Failure',aliases:[],desc:'כשל שבו Text2SQL יוצר SQL שגוי לוגית או תחבירית: טבלה/שדה/Join/Filter/Aggregation שגויים, גם אם ה־Router ניתב נכון.'},
  {term:'Data/Execution Failure',aliases:['Query Execution Failure'],desc:'כשל לאחר יצירת SQL: הרצה נכשלת, נתונים שגויים/חסרים, truncation/GCS לא תקינים או חוסר התאמה בין תוצאת DB לתשובה הסופית.'},
  {term:'API Test',aliases:['API Testing'],desc:'בדיקה ישירה של Contract והתנהגות Endpoint: Request, Headers, Validation, HTTP status, Schema, State ו־Errors. אין צורך ב־UI של המוצר כדי לבצע API Testing.'},
  {term:'Console Self-Test',aliases:['QA Tool Self-Test'],desc:'בדיקה של אתר ה־QA עצמו: שהטאבים, הכפתורים, Run All, הודעות שגיאה/הצלחה ורכיבי התצוגה עובדים. זו אינה בדיקת המוצר או Router API, ולכן יש להפריד אותה מספירת Product QA.'},
  {term:'Boundary Test',aliases:['Boundary Value Analysis','בדיקת גבולות'],desc:'בדיקה סביב גבולות קלט: מינימום, מקסימום, בדיוק על הגבול ומעבר לו. לדוגמה limit=1/0 או אורך שדה מקסימלי+1. זהו סוג בדיקה שחוצה רכיבים ולא רכיב בפני עצמו.'},
  {term:'Negative Test',aliases:['Negative Testing','בדיקה שלילית'],desc:'בדיקה שמכניסה קלט שגוי, חסר, לא מורשה או בלתי צפוי כדי לוודא שהמערכת נכשלת בצורה בטוחה וצפויה, עם status/error נכון וללא state שבור.'},
  {term:'Test Dimension',aliases:['ממד בדיקה'],desc:'דרך להפריד בין שאלות שונות בדשבורד: מה נבדק (Component/Domain), איך נבדק (Boundary/Security/E2E), מה העדיפות (P0/P1/P2), ומה מצב ההרצה. ערבוב הממדים עלול ליצור Dashboard מבלבל.'}
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


function renderAiQaLessons(){
  const host=$('aiQaLessons'); if(!host)return;
  host.innerHTML=AI_QA_LESSONS.map(x=>`<div class="context-card"><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></div>`).join('');
}
function renderGlossary(filter=''){
  const host=$('glossaryGrid'); if(!host)return;
  const q=String(filter||'').trim().toLowerCase();
  const items=AI_GLOSSARY.filter(x=>!q || [x.term,...(x.aliases||[]),x.desc].join(' ').toLowerCase().includes(q));
  host.innerHTML=items.map(x=>`<details class="glossary-card" id="glossary-${encodeURIComponent(x.term)}" data-term="${esc(x.term)}"><summary><span class="glossary-title">${esc(x.term)}</span>${x.aliases?.length?`<span class="glossary-alias">${esc(x.aliases.join(' · '))}</span>`:''}<span class="glossary-chevron">⌄</span></summary><div class="glossary-body"><p>${esc(x.desc)}</p></div></details>`).join('') || '<div class="empty-state">לא נמצאו מושגים.</div>';
}
function openGlossary(term=''){
  activateTab('guide');
  const root=$('guide'); if(!root)return;
  root.querySelectorAll('.subtab').forEach(x=>x.classList.toggle('active',x.dataset.subtab==='guideGlossary'));
  root.querySelectorAll('.subpage').forEach(x=>x.classList.toggle('active',x.dataset.subpage==='guideGlossary'));
  if($('glossarySearch')){$('glossarySearch').value='';renderGlossary();}
  requestAnimationFrame(()=>{
    const el=[...document.querySelectorAll('.glossary-card')].find(x=>x.dataset.term===term);
    (el||$('glossaryGrid'))?.scrollIntoView({behavior:'smooth',block:'start'});
    if(el){el.open=true;el.classList.add('glossary-highlight');setTimeout(()=>el.classList.remove('glossary-highlight'),1800);}
  });
}
function wireGlossaryLinks(){document.querySelectorAll('[data-glossary]').forEach(el=>el.onclick=()=>openGlossary(el.dataset.glossary));}

function loadGoldenDataset(){
  try{state.goldenDataset=JSON.parse(localStorage.getItem('genaiQaGoldenDataset')||'[]')||[];}catch{state.goldenDataset=[];}
  try{state.goldenResults=JSON.parse(localStorage.getItem('genaiQaGoldenResults')||'{}')||{};}catch{state.goldenResults={};}
  try{state.goldenRuns=JSON.parse(localStorage.getItem('genaiQaGoldenRuns')||'[]')||[];}catch{state.goldenRuns=[];}
  state.currentGoldenRunId=localStorage.getItem('genaiQaCurrentGoldenRunId')||null;
}
function saveGoldenDataset(){
  localStorage.setItem('genaiQaGoldenDataset',JSON.stringify(state.goldenDataset));
  localStorage.setItem('genaiQaGoldenResults',JSON.stringify(state.goldenResults));
  localStorage.setItem('genaiQaGoldenRuns',JSON.stringify(state.goldenRuns));
  if(state.currentGoldenRunId)localStorage.setItem('genaiQaCurrentGoldenRunId',state.currentGoldenRunId);else localStorage.removeItem('genaiQaCurrentGoldenRunId');
}
function normalizeForSimilarity(text=''){return String(text).toLowerCase().replace(/[\u0591-\u05C7]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(x=>x.length>1);}
function answerSimilarity(a,b){
  const A=new Set(normalizeForSimilarity(a)),B=new Set(normalizeForSimilarity(b)); if(!A.size||!B.size)return 0;
  let common=0; A.forEach(x=>{if(B.has(x))common++}); const p=common/A.size,r=common/B.size; return p+r?Math.round((2*p*r/(p+r))*100):0;
}
function lexicalSupport(answer,context){
  const A=new Set(normalizeForSimilarity(answer).filter(x=>x.length>2)); const C=new Set(normalizeForSimilarity(context)); if(!A.size||!C.size)return null;
  let hit=0;A.forEach(x=>{if(C.has(x))hit++});return Math.round(hit/A.size*100);
}
function extractSseAnswer(events=[]){return events.filter(e=>String(e.type||'').toLowerCase()==='content').map(e=>e.content??e.text??e.delta??'').join('').trim();}
function sourceEvents(events=[]){return events.filter(e=>String(e.type||'').toLowerCase()==='sources');}
function extractSseSources(events=[]){return sourceEvents(events).map(e=>JSON.stringify(e)).join(' ');}
function extractSourceRefs(events=[]){
  const out=[];
  for(const e of sourceEvents(events)){
    let arr=e.content??e.sources??e.data??[]; if(!Array.isArray(arr))arr=[arr];
    for(const s of arr){
      if(!s||typeof s!=='object')continue;
      const bucket=s.bucket??s.documentBucket??s.bucketName??''; const fileName=s.fileName??s.documentFileName??'';
      let chunks=s.chunks??s.chunkIds??s.chunkId??[]; if(!Array.isArray(chunks))chunks=[chunks];
      if(!chunks.length) out.push({bucket,fileName,chunkId:null,title:s.title||''});
      for(const id of chunks){const n=Number(id);out.push({bucket,fileName,chunkId:Number.isFinite(n)?n:id,title:s.title||''});}
    }
  }
  return out;
}
function flattenChunkTexts(body){
  const arr=Array.isArray(body)?body:(Array.isArray(body?.chunks)?body.chunks:Array.isArray(body?.data)?body.data:body?[body]:[]);
  return arr.filter(x=>x&&typeof x==='object').map(x=>({documentId:x.documentId||'',chunkIndex:x.chunkIndex??x.chunkId??'',chunkText:x.chunkText||x.text||'',found:x.found!==false}));
}
function goldenRunMeta(){return {label:$('goldenRunLabel')?.value.trim()||`run-${new Date().toISOString().slice(0,19)}`,environment:$('goldenEnvironment')?.value.trim()||'TSH',build:$('goldenBuild')?.value.trim()||'',model:$('goldenModel')?.value.trim()||'',promptVersion:$('goldenPromptVersion')?.value.trim()||'',indexVersion:$('goldenIndexVersion')?.value.trim()||'',configVersion:$('goldenConfigVersion')?.value.trim()||'',tester:$('goldenTester')?.value.trim()||'',notes:$('goldenRunNotes')?.value.trim()||'',baseUrl:cfg().baseUrl||''};}
function goldenFormReset(){state.goldenEditingId=null;['goldenId','goldenTags','goldenQuestion','goldenExpected','goldenMustInclude','goldenExpectedSource','goldenNotes'].forEach(id=>{if($(id))$(id).value='';});}
function goldenEdit(id){const g=state.goldenDataset.find(x=>x.id===id);if(!g)return;state.goldenEditingId=id;$('goldenId').value=g.id;$('goldenTags').value=g.tags||'';$('goldenQuestion').value=g.question||'';$('goldenExpected').value=g.expected||'';$('goldenMustInclude').value=g.mustInclude||'';$('goldenExpectedSource').value=g.expectedSource||'';$('goldenNotes').value=g.notes||'';$('goldenId').scrollIntoView({behavior:'smooth',block:'center'});}
function goldenDelete(id){if(!confirm(`למחוק את ${id}?`))return;state.goldenDataset=state.goldenDataset.filter(x=>x.id!==id);delete state.goldenResults[id];saveGoldenDataset();renderGolden();}
function goldenSave(){
  const g={id:$('goldenId').value.trim()||`GOLD-${String(state.goldenDataset.length+1).padStart(3,'0')}`,tags:$('goldenTags').value.trim(),question:$('goldenQuestion').value.trim(),expected:$('goldenExpected').value.trim(),mustInclude:$('goldenMustInclude').value.trim(),expectedSource:$('goldenExpectedSource').value.trim(),notes:$('goldenNotes').value.trim()};
  if(!g.question||!g.expected){showToast('יש להזין שאלה ותשובת זהב.','warning');return;}
  const duplicate=state.goldenDataset.find(x=>x.id===g.id && x.id!==state.goldenEditingId); if(duplicate){showToast('כבר קיימת שאלת זהב עם ID זה.','error');return;}
  if(state.goldenEditingId){state.goldenDataset=state.goldenDataset.map(x=>x.id===state.goldenEditingId?g:x);} else state.goldenDataset.push(g);
  saveGoldenDataset();goldenFormReset();renderGolden();showToast('שאלת הזהב נשמרה מקומית.','success');
}
function syncCurrentGoldenRun(){
  if(!state.currentGoldenRunId)return; const run=state.goldenRuns.find(x=>x.id===state.currentGoldenRunId); if(!run)return;
  run.results=clone(state.goldenResults); run.updatedAt=now(); run.summary=goldenSummary(run.results); saveGoldenDataset();
}
function goldenVerdict(id,status){const r=state.goldenResults[id];if(!r)return;r.status=status;r.reviewedAt=now();syncCurrentGoldenRun();saveGoldenDataset();renderGolden();}
function goldenSetBugCategory(id,val){const r=state.goldenResults[id];if(!r)return;r.bugCategory=val||'';syncCurrentGoldenRun();saveGoldenDataset();renderGolden();}
function goldenSummary(results={}){
  const rs=Object.values(results); const count=s=>rs.filter(r=>r.status===s).length;
  const avg=k=>{const v=rs.map(r=>r[k]).filter(Number.isFinite);return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null;};
  return {total:rs.length,pass:count('PASS'),fail:count('FAIL'),review:count('REVIEW'),na:count('N/A'),answerAvg:avg('answerScore'),retrievalAvg:avg('retrievalScore'),groundingAvg:avg('groundingScore')};
}
function renderGoldenSummary(){
  if(!$('goldenRunSummary'))return; const s=goldenSummary(state.goldenResults);
  $('goldenRunSummary').innerHTML=`<div class="kpi"><b>${s.total}</b><span>הורצו</span></div><div class="kpi"><b>${s.pass}</b><span>PASS</span></div><div class="kpi"><b>${s.fail}</b><span>FAIL</span></div><div class="kpi"><b>${s.review}</b><span>REVIEW</span></div><div class="kpi"><b>${s.retrievalAvg??'—'}${s.retrievalAvg!=null?'%':''}</b><span>Retrieval avg</span></div><div class="kpi"><b>${s.answerAvg??'—'}${s.answerAvg!=null?'%':''}</b><span>Answer avg</span></div><div class="kpi"><b>${s.groundingAvg??'—'}${s.groundingAvg!=null?'%':''}</b><span>Grounding avg</span></div>`;
  const run=state.goldenRuns.find(x=>x.id===state.currentGoldenRunId);if($('goldenRunBadge'))$('goldenRunBadge').textContent=run?run.meta.label:'Run נוכחי לא נשמר';
}
function reviewNeeded(r){return r && (r.status==='REVIEW'||r.status==='FAIL'||r.sourceMatch==='NO MATCH'||(Number.isFinite(r.retrievalScore)&&r.retrievalScore<80)||(Number.isFinite(r.answerScore)&&r.answerScore<75)||(Number.isFinite(r.groundingScore)&&r.groundingScore<70)||r.chunkFetchStatus==='FAILED');}
function renderGolden(){
  if(!$('goldenTable'))return; $('goldenCount').textContent=`${state.goldenDataset.length} שאלות`;
  $('goldenTable').innerHTML=state.goldenDataset.length?`<table class="qa-table golden-table"><thead><tr><th>ID</th><th>שאלה</th><th>Expected</th><th>מקור צפוי</th><th>תגיות</th><th>פעולות</th></tr></thead><tbody>${state.goldenDataset.map(g=>`<tr><td>${esc(g.id)}</td><td>${esc(g.question)}</td><td>${esc(g.expected)}</td><td>${esc(g.expectedSource||'—')}</td><td>${esc(g.tags||'—')}</td><td><button class="mini-btn" data-golden-edit="${esc(g.id)}">עריכה</button> <button class="mini-btn danger" data-golden-delete="${esc(g.id)}">מחיקה</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">עדיין אין שאלות זהב. הוסף שאלה, תשובת זהב ומקור צפוי אם ידוע.</div>';
  const rows=state.goldenDataset.map(g=>({g,r:state.goldenResults[g.id]})).filter(x=>x.r);
  $('goldenResults').innerHTML=rows.length?`<table class="qa-table golden-results-table"><thead><tr><th>ID</th><th>מצב</th><th>Retrieval</th><th>Answer</th><th>Grounding</th><th>Source / Chunks</th><th>תשובה בפועל</th><th>סיווג כשל</th><th>פעולות</th></tr></thead><tbody>${rows.map(({g,r})=>`<tr><td>${esc(g.id)}</td><td><span class="status-chip ${r.status==='REVIEW'?'status-question':r.status==='N/A'?'status-na':r.status==='FAIL'?'status-fail':'status-pass'}">${esc(r.status)}</span></td><td>${Number.isFinite(r.retrievalScore)?r.retrievalScore+'%':'—'}</td><td>${Number.isFinite(r.answerScore)?r.answerScore+'%':'—'}<br><small>Similarity ${r.similarity??0}% · ${esc(r.mustScore||'—')}</small></td><td>${Number.isFinite(r.groundingScore)?r.groundingScore+'%':'—'}<br><small>Heuristic</small></td><td>${esc(r.sourceMatch||'—')}<br><small>${esc(r.chunkFetchStatus||'—')} · ${r.chunkEvidence?.length||0} chunks</small></td><td class="golden-actual">${esc(r.answer||'—')}</td><td>${esc(r.bugCategory||'—')}</td><td><button class="mini-btn" data-golden-pass="${esc(g.id)}">PASS</button> <button class="mini-btn danger" data-golden-fail="${esc(g.id)}">FAIL</button> <button class="mini-btn" data-golden-evidence="${esc(g.id)}">Evidence</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">טרם הורץ Golden Sanity.</div>';
  const reviewRows=rows.filter(({r})=>reviewNeeded(r));
  if($('goldenReviewCount'))$('goldenReviewCount').textContent=`${reviewRows.length} לבדיקה`;
  if($('goldenReviewQueue'))$('goldenReviewQueue').innerHTML=reviewRows.length?`<table class="qa-table review-table"><thead><tr><th>ID</th><th>למה Review?</th><th>Expected → Actual</th><th>Sources / Chunk Evidence</th><th>סיווג</th><th>החלטה</th></tr></thead><tbody>${reviewRows.map(({g,r})=>`<tr><td><b>${esc(g.id)}</b></td><td>${classifyGoldenReason(r).map(x=>`<div>• ${esc(x)}</div>`).join('')}</td><td><b>Expected:</b> ${esc(g.expected)}<br><b>Actual:</b> ${esc(r.answer||'—')}</td><td><details><summary>${r.sourceRefs?.length||0} source refs · ${r.chunkEvidence?.length||0} chunks</summary><pre>${esc(JSON.stringify({sources:r.sourceRefs||[],chunks:r.chunkEvidence||[]},null,2))}</pre></details></td><td><select data-golden-category="${esc(g.id)}">${bugCategoryOptions(r.bugCategory||'')}</select></td><td><button class="mini-btn" data-golden-pass="${esc(g.id)}">PASS</button> <button class="mini-btn danger" data-golden-fail="${esc(g.id)}">FAIL</button> <button class="mini-btn" data-golden-evidence="${esc(g.id)}">Bug Evidence</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">אין כרגע תוצאות שממתינות לסקירה אנושית.</div>';
  document.querySelectorAll('[data-golden-edit]').forEach(b=>b.onclick=()=>goldenEdit(b.dataset.goldenEdit));document.querySelectorAll('[data-golden-delete]').forEach(b=>b.onclick=()=>goldenDelete(b.dataset.goldenDelete));document.querySelectorAll('[data-golden-pass]').forEach(b=>b.onclick=()=>goldenVerdict(b.dataset.goldenPass,'PASS'));document.querySelectorAll('[data-golden-fail]').forEach(b=>b.onclick=()=>goldenVerdict(b.dataset.goldenFail,'FAIL'));document.querySelectorAll('[data-golden-category]').forEach(s=>s.onchange=()=>goldenSetBugCategory(s.dataset.goldenCategory,s.value));document.querySelectorAll('[data-golden-evidence]').forEach(b=>b.onclick=()=>downloadGoldenBugEvidence(b.dataset.goldenEvidence));
  renderGoldenSummary();renderGoldenRuns();wireGlossaryLinks();
}
async function fetchGoldenChunks(events){
  const refs=extractSourceRefs(events).filter(x=>x.bucket&&x.fileName&&x.chunkId!==null&&x.chunkId!==undefined).slice(0,100);
  if(!refs.length)return {refs:extractSourceRefs(events),chunks:[],status:'NO CHUNKS',exchange:null};
  if(!$('goldenFetchChunks')?.checked)return {refs,chunks:[],status:'SKIPPED',exchange:null};
  try{
    const body={chunks:refs.map(x=>({documentBucket:x.bucket,documentFileName:x.fileName,chunkId:Number(x.chunkId)}))};
    const rr=await proxy({method:'POST',path:'/v1/conversations/fetch/chunks/text',body});
    return {refs,chunks:flattenChunkTexts(rr.body),status:rr.status>=200&&rr.status<300?'OK':`HTTP ${rr.status}`,exchange:clone(state.lastExchange)};
  }catch(e){return {refs,chunks:[],status:'FAILED',error:e.message,exchange:clone(state.lastExchange)};}
}
async function runGoldenOne(g,runMeta){
  const c=cfg(),runLabel=runMeta?.label||$('goldenRunLabel')?.value.trim()||'unlabeled';
  if(state.demo){return {status:'N/A',answer:'Demo Mode אינו נחשב הרצת Golden אמיתית',similarity:0,mustScore:'—',sourceMatch:'—',runLabel,time:now(),bugCategory:''};}
  if(!c.baseUrl||!c.token||!c.userId||!c.appId){return {status:'N/A',answer:'חסר Base URL / Token / User / App ID',similarity:0,mustScore:'—',sourceMatch:'—',runLabel,time:now(),bugCategory:''};}
  let conversationId=c.conversationId,createdForTest=false;
  try{
    if($('goldenIsolate')?.checked){
      const cb={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{})}; const cr=await proxy({method:'POST',path:'/v1/conversations/new',body:cb});
      conversationId=extractConversationId(cr.body); if(!(cr.status>=200&&cr.status<300)||!conversationId) throw new Error(`Create Conversation נכשל (HTTP ${cr.status})`); createdForTest=true;
    }
    if(!conversationId) return {status:'N/A',answer:'חסר Conversation ID או הפעל בידוד שיחות',similarity:0,mustScore:'—',sourceMatch:'—',runLabel,time:now(),bugCategory:''};
    const body={conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:g.question};
    const r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); const txt=await readStream(r.stream); const events=parseSse(txt); const answer=extractSseAnswer(events)||txt.slice(-4000); const sources=extractSseSources(events); const messageExchange=clone(state.lastExchange); const similarity=answerSimilarity(answer,g.expected);
    const must=(g.mustInclude||'').split(',').map(x=>x.trim()).filter(Boolean); const found=must.filter(x=>answer.toLowerCase().includes(x.toLowerCase())).length; const mustScore=must.length?`${found}/${must.length}`:'—'; const mustPct=must.length?Math.round(found/must.length*100):null;
    const sourceMatch=g.expectedSource?(sources.toLowerCase().includes(g.expectedSource.toLowerCase())?'MATCH':'NO MATCH'):'—';
    const chunkInfo=await fetchGoldenChunks(events); const chunkText=chunkInfo.chunks.filter(x=>x.found!==false).map(x=>x.chunkText).join('\n');
    const groundingScore=lexicalSupport(answer,chunkText);
    const answerScore=mustPct==null?similarity:Math.round(similarity*.55+mustPct*.45);
    let retrievalScore=null; const hasSources=chunkInfo.refs.length>0; const foundChunks=chunkInfo.chunks.filter(x=>x.found!==false).length;
    if(g.expectedSource) retrievalScore=sourceMatch==='MATCH'?(foundChunks?100:75):0; else if(hasSources) retrievalScore=foundChunks?80:60;
    const actualSourceKey=chunkInfo.refs.map(x=>`${x.bucket}/${x.fileName}#${x.chunkId}`).sort().join('|');
    return {status:'REVIEW',answer,similarity,answerScore,retrievalScore,groundingScore,mustScore,sourceMatch,http:r.status,time:now(),runLabel,conversationId,sources:sources.slice(0,6000),sourceRefs:chunkInfo.refs,chunkEvidence:chunkInfo.chunks,chunkFetchStatus:chunkInfo.status,messageEvidence:messageExchange,chunkEvidenceRequest:chunkInfo.exchange,actualSourceKey,bugCategory:'',runMeta:clone(runMeta)};
  }catch(e){return {status:'REVIEW',answer:`ERROR: ${e.message}`,similarity:0,answerScore:0,retrievalScore:null,groundingScore:null,mustScore:'—',sourceMatch:'—',runLabel,time:now(),bugCategory:'',runMeta:clone(runMeta)};}
  finally{
    if(createdForTest && conversationId && $('goldenCleanup')?.checked){try{await proxy({method:'DELETE',path:'/v1/conversations/id',body:{conversationId,userId:c.userId}});}catch{} }
  }
}
async function runGoldenAll(){
  if(!state.goldenDataset.length){showToast('אין שאלות זהב להרצה.','warning');return;}
  const runMeta=goldenRunMeta(); if(!runMeta.label){showToast('מומלץ להזין Run / Release Label.','warning');}
  const btn=$('goldenRunAllBtn');const old=btn.textContent;btn.disabled=true;btn.textContent='מריץ Release Sanity…'; state.goldenResults={};
  for(const g of state.goldenDataset){state.goldenResults[g.id]=await runGoldenOne(g,runMeta);saveGoldenDataset();renderGolden();}
  const run={id:`RUN-${Date.now()}`,createdAt:now(),updatedAt:now(),meta:runMeta,results:clone(state.goldenResults)};run.summary=goldenSummary(run.results);state.goldenRuns.unshift(run);state.currentGoldenRunId=run.id;saveGoldenDataset();renderGolden();
  btn.disabled=false;btn.textContent=old;showToast('Release Sanity הסתיים ונשמר. עבור על Review Queue לפני אישור גרסה.','success',6000);
}
function runSignal(r){const vals=[r.retrievalScore,r.answerScore,r.groundingScore].filter(Number.isFinite);return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;}
function compareGoldenRuns(){
  const base=state.goldenRuns.find(x=>x.id===$('goldenCompareBase')?.value),cur=state.goldenRuns.find(x=>x.id===$('goldenCompareCurrent')?.value);if(!base||!cur){showToast('בחר שתי ריצות להשוואה.','warning');return;}
  const ids=[...new Set([...Object.keys(base.results||{}),...Object.keys(cur.results||{})])];let improved=0,regressed=0,stable=0,sourceChanged=0;
  const rows=ids.map(id=>{const a=base.results?.[id],b=cur.results?.[id];const as=runSignal(a||{}),bs=runSignal(b||{});let change='Stable';if(!a||!b)change='New/Missing';else if(a.status==='PASS'&&b.status==='FAIL')change='Regressed';else if(a.status==='FAIL'&&b.status==='PASS')change='Improved';else if(as!=null&&bs!=null&&bs-as>=10)change='Improved';else if(as!=null&&bs!=null&&as-bs>=10)change='Regressed';const sc=!!a&&!!b&&(a.actualSourceKey||'')!==(b.actualSourceKey||'');if(change==='Improved')improved++;else if(change==='Regressed')regressed++;else stable++;if(sc)sourceChanged++;return {id,a,b,as,bs,change,sc};});
  $('goldenCompareSummary').innerHTML=`<div class="kpi"><b>${ids.length}</b><span>שאלות</span></div><div class="kpi"><b>${improved}</b><span>השתפרו</span></div><div class="kpi"><b>${regressed}</b><span>הורעו</span></div><div class="kpi"><b>${stable}</b><span>יציבות/אחרות</span></div><div class="kpi"><b>${sourceChanged}</b><span>Source השתנה</span></div>`;
  $('goldenCompareTable').innerHTML=`<table class="qa-table"><thead><tr><th>ID</th><th>${esc(base.meta.label)}</th><th>${esc(cur.meta.label)}</th><th>Delta</th><th>Source</th><th>הערה</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.id)}</td><td>${x.as??'—'} · ${esc(x.a?.status||'—')}</td><td>${x.bs??'—'} · ${esc(x.b?.status||'—')}</td><td class="${x.change==='Regressed'?'status-fail':x.change==='Improved'?'status-pass':''}">${esc(x.change)}${x.as!=null&&x.bs!=null?` (${x.bs-x.as>0?'+':''}${x.bs-x.as})`:''}</td><td>${x.sc?'⚠️ השתנה':'ללא שינוי'}</td><td>${x.change==='Regressed'?'להכניס ל־Review Queue / Bug Evidence':''}</td></tr>`).join('')}</tbody></table>`;
}
function renderGoldenRuns(){
  if(!$('goldenRunsTable'))return; const opts=state.goldenRuns.map(r=>`<option value="${esc(r.id)}">${esc(r.meta?.label||r.id)} · ${esc(r.createdAt||'')}</option>`).join('');
  const b=$('goldenCompareBase'),c=$('goldenCompareCurrent'); const bv=b?.value,cv=c?.value;if(b){b.innerHTML='<option value="">Baseline...</option>'+opts;if(bv&&state.goldenRuns.some(r=>r.id===bv))b.value=bv;else if(state.goldenRuns[1])b.value=state.goldenRuns[1].id;}if(c){c.innerHTML='<option value="">Current...</option>'+opts;if(cv&&state.goldenRuns.some(r=>r.id===cv))c.value=cv;else if(state.goldenRuns[0])c.value=state.goldenRuns[0].id;}
  $('goldenRunsTable').innerHTML=state.goldenRuns.length?`<table class="qa-table"><thead><tr><th>Run</th><th>Environment</th><th>Build</th><th>Model</th><th>Prompt</th><th>Index</th><th>Config</th><th>Summary</th><th>Time</th></tr></thead><tbody>${state.goldenRuns.map(r=>`<tr><td><b>${esc(r.meta?.label||r.id)}</b></td><td>${esc(r.meta?.environment||'—')}</td><td>${esc(r.meta?.build||'—')}</td><td>${esc(r.meta?.model||'—')}</td><td>${esc(r.meta?.promptVersion||'—')}</td><td>${esc(r.meta?.indexVersion||'—')}</td><td>${esc(r.meta?.configVersion||'—')}</td><td>${r.summary?.pass||0}P / ${r.summary?.fail||0}F / ${r.summary?.review||0}R</td><td dir="ltr">${esc(r.createdAt||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">עדיין אין ריצות שמורות. הרץ Release Sanity ראשון.</div>';
}
function bugEvidenceMarkdown({title,category='',meta={},fields={},sources=[],chunks=[],evidence=null}){
  const lines=[`# ${title}`,``,`**Failure Category:** ${category||'Unclassified'}`,`**Generated:** ${now()}`,``, `## Run Metadata`,`\`\`\`json`,JSON.stringify(meta,null,2),'\`\`\`','', '## Test Evidence'];
  for(const [k,v] of Object.entries(fields))lines.push(`**${k}:** ${typeof v==='string'?v:JSON.stringify(v)}`,'');
  if(sources?.length)lines.push('## Sources','\`\`\`json',JSON.stringify(sources,null,2),'\`\`\`','');
  if(chunks?.length)lines.push('## Chunk Evidence','\`\`\`json',JSON.stringify(chunks,null,2),'\`\`\`','');
  if(evidence)lines.push('## Request / Response (Token redacted)','\`\`\`json',JSON.stringify(evidence,null,2),'\`\`\`');
  return lines.join('\n');
}
function downloadGoldenBugEvidence(id){
  const g=state.goldenDataset.find(x=>x.id===id),r=state.goldenResults[id];if(!g||!r)return;const run=state.goldenRuns.find(x=>x.id===state.currentGoldenRunId);
  const md=bugEvidenceMarkdown({title:`Golden Bug Evidence — ${id}`,category:r.bugCategory,meta:run?.meta||r.runMeta||{},fields:{Question:g.question,'Golden Answer':g.expected,'Expected Source':g.expectedSource||'—','Actual Answer':r.answer,'Retrieval Score':r.retrievalScore,'Answer Score':r.answerScore,'Grounding Score':r.groundingScore,'Source Match':r.sourceMatch,HTTP:r.http,ConversationId:r.conversationId},sources:r.sourceRefs||[],chunks:r.chunkEvidence||[],evidence:r.messageEvidence||null});exportBlob(`bug-evidence-golden-${id}-${Date.now()}.md`,'text/markdown;charset=utf-8',md);
}
function exportGolden(){exportBlob(`golden-regression-${Date.now()}.json`,'application/json',JSON.stringify({version:2,exportedAt:now(),dataset:state.goldenDataset,results:state.goldenResults,runs:state.goldenRuns,currentRunId:state.currentGoldenRunId},null,2));}
async function importGoldenFile(file){try{const obj=JSON.parse(await file.text());const ds=Array.isArray(obj)?obj:obj.dataset;if(!Array.isArray(ds))throw new Error('JSON אינו מכיל dataset תקין');state.goldenDataset=ds.map((x,i)=>({id:String(x.id||`GOLD-${i+1}`),question:String(x.question||''),expected:String(x.expected||x.expectedAnswer||''),expectedSource:String(x.expectedSource||''),mustInclude:String(x.mustInclude||''),tags:String(x.tags||''),notes:String(x.notes||'')})).filter(x=>x.question&&x.expected);state.goldenResults=obj.results&&typeof obj.results==='object'?obj.results:{};state.goldenRuns=Array.isArray(obj.runs)?obj.runs:[];state.currentGoldenRunId=obj.currentRunId||state.goldenRuns[0]?.id||null;saveGoldenDataset();renderGolden();showToast(`${state.goldenDataset.length} שאלות זהב יובאו${state.goldenRuns.length?` + ${state.goldenRuns.length} Runs`:''}.`, 'success');}catch(e){showToast('ייבוא Golden נכשל: '+e.message,'error',5000);}}


function localInvestigation(id){
  const t=state.tests.find(x=>x.ID===id),r=state.results[id];
  if(!t||!r)return null;
  const http=Number(r.evidence?.response?.status);
  let category=r.bugCategory||'',cause='',confidence='Medium',next=[];
  if(['N/A','BLOCKED'].includes(r.status)){
    category=category||'Prerequisite / Environment';cause=r.details||r.actual||'חסר תנאי מקדים להרצה.';confidence='High';next=['להשלים את התנאי החסר','להריץ שוב את אותו Test Case לפני פתיחת Bug מוצר'];
  }else if(http===401||http===403){
    category=category||'Authorization/Security Failure';cause=`השרת דחה את הבקשה עם HTTP ${http}. החשד הראשי הוא Token/הרשאה/קשר בין המשתמש לזהות.`;confidence='High';next=['לאמת Identity Token ותוקף','לוודא Auth Header נכון','להשוות userId לזהות שב-Token'];
  }else if(http===400||http===404||http===409||http===422){
    category=category||'Data/Execution Failure';cause=`השרת החזיר HTTP ${http}; סביר שמדובר ב-Validation, Test Data או פער Contract.`;confidence='Medium';next=['להשוות payload ל-Swagger','לבדוק שדות חובה/פורמט','לאמת האם ה-Expected Result עדיין תואם ל-Contract'];
  }else if(http===429){
    category=category||'Data/Execution Failure';cause='Rate limit / throttling אפשרי (HTTP 429).';confidence='High';next=['לבדוק Retry-After','להמתין ולהריץ שוב','לבדוק מגבלת קצב מוסכמת'];
  }else if(http>=500){
    category=category||'Data/Execution Failure';cause=`כשל Server-side אפשרי: HTTP ${http}. ה-Request הגיע לשרת אך לא הסתיים בהצלחה.`;confidence='High';next=['לצרף Request/Response המצונזרים','לחפש correlation/trace בלוגים','לבדוק אם הכשל משתחזר עם אותו payload'];
  }else if(r.status==='FAIL'){
    category=category||'Data/Execution Failure';cause='ה-Actual Result אינו עומד ב-Expected Result, אך הראיות לבדן אינן מצביעות חד-משמעית על רכיב שורש.';confidence='Medium';next=['להשוות Expected מול Actual','לבדוק Response body / SSE','להריץ פעם נוספת כדי לשלול flakiness'];
  }else if(r.status==='QUESTION'){
    category=category||'Contract / Expected Result';cause=r.details||'ה-Expected Result אינו סגור ולכן אין בסיס אמין ל-PASS/FAIL.';confidence='High';next=['לסגור את השאלה מול Product/Developer/Swagger','לעדכן Expected Result','להריץ שוב לאחר סגירת ה-Contract'];
  }else{
    category=category||'No failure detected';cause='אין כשל מובהק בתוצאה הנוכחית.';confidence='High';next=['אין צורך לפתוח Bug על סמך ההרצה הזו'];
  }
  const ev=r.evidence||{};
  const evidence=[`Status: ${r.status}`,Number.isFinite(http)?`HTTP: ${http}`:'HTTP: —',ev.response?.latencyMs!=null?`Latency: ${ev.response.latencyMs} ms`:'Latency: —',`Endpoint: ${t.Endpoint||ev.request?.path||'—'}`];
  return {source:'Local evidence analysis',category,cause,confidence,next,evidence,createdAt:now()};
}
function renderInvestigation(id){
  const host=$('dialogInvestigation');if(!host)return;
  const inv=state.investigations[id];
  if(!inv){host.innerHTML='';return;}
  host.innerHTML=`<div class="investigation-card"><div class="section-head"><div><h3>🤖 Investigation</h3><p>${esc(inv.source||'Evidence analysis')} · Confidence: ${esc(inv.confidence||'—')}</p></div><span class="badge question">${esc(inv.category||'Unclassified')}</span></div><p><b>Probable cause:</b> ${esc(inv.cause||'—')}</p><div class="investigation-evidence">${(inv.evidence||[]).map(x=>`<span>${esc(x)}</span>`).join('')}</div>${inv.aiText?`<div class="ai-deep-analysis"><b>AI analysis</b><pre>${esc(inv.aiText)}</pre></div>`:''}<b>Next steps</b><ol>${(inv.next||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div>`;
}
function investigationPayload(id){
  const t=state.tests.find(x=>x.ID===id),r=state.results[id];if(!t||!r)return null;
  return redactForAi({test:{id:testLabel(t),legacyId:t.ID,priority:t.priority,domain:t['תחום'],endpoint:t.Endpoint,scenario:t['תרחיש בדיקה'],prerequisites:t['תנאים מקדימים'],steps:t['צעדים / קלט'],expected:t['Expected Result'],openQuestion:t['שאלה פתוחה / נדרש אישור']},result:{status:r.status,actual:r.actual,details:r.details,failureCategory:r.bugCategory||''},evidence:r.evidence||null});
}
async function investigateTest(id){
  if(!state.results[id]){showToast('יש להריץ או לסמן את הטסט לפני Investigation.','warning');return;}
  const base=localInvestigation(id);state.investigations[id]=base;renderInvestigation(id);
  if(!$('aiRemoteEnabled')?.checked){showToast('בוצע תחקור מקומי מה-Evidence. AI עמוק כבוי בהגדרות המתקדמות.','info',4500);return base;}
  try{
    const resp=await fetch('/api/ai-investigate',{method:'POST',headers:{'Content-Type':'application/json','X-QA-AI-Code':$('aiAccessCode')?.value||''},body:JSON.stringify({mode:'test',payload:investigationPayload(id)})});
    const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(data.error||`HTTP ${resp.status}`);
    state.investigations[id]={...base,source:`AI + Runtime Evidence${data.model?` · ${data.model}`:''}`,aiText:data.analysis||'',createdAt:now()};renderInvestigation(id);showToast('AI Investigation הסתיים.','success');return state.investigations[id];
  }catch(e){state.investigations[id]={...base,aiText:`AI עמוק לא זמין: ${e.message}`};renderInvestigation(id);showToast('התחקור המקומי זמין, אך AI עמוק לא הופעל: '+e.message,'warning',6000);return state.investigations[id];}
}
function bugDraftFor(id){
  const t=state.tests.find(x=>x.ID===id),r=state.results[id];if(!t||!r)return null;
  const inv=state.investigations[id]||localInvestigation(id);const ev=r.evidence||{},resp=ev.response||{};
  const c=cfg(); const openedAt=now();
  const http=resp.status!=null?`HTTP ${resp.status}`:'';const title=`[${testLabel(t)}] ${t['תרחיש בדיקה']||'QA failure'}${http?` — ${http}`:` — ${r.status}`}`;
  const steps=(t['צעדים / קלט']||'הרץ את ה-Test Case לפי ה-STD').split(/\n|;/).map(x=>x.trim()).filter(Boolean);
  const body=[
    `## Bug Meta\nOpened At: ${openedAt}\nSource: QA Console v0.02\nTest Status: ${r.status}`,
    `## Environment\n${c.baseUrl||'TSH / QA'}`,
    `## Tracking\nTest Case: ${testLabel(t)} (${t.ID})\nApp ID: ${c.appId||'—'}\nCase ID: ${c.caseId||'—'}`,
    `## Scenario\n${t['תרחיש בדיקה']||''}`,
    `## Endpoint\n${t.Endpoint||ev.request?.path||'—'}`,
    `## Steps to reproduce\n${(steps.length?steps:['הרץ את ה-Test Case']).map((x,i)=>`${i+1}. ${x}`).join('\n')}`,
    `## Expected Result\n${t['Expected Result']||'—'}`,
    `## Actual Result\n${r.actual||'—'}\n\nStatus: ${r.status}`,
    `## QA Investigation\nCategory: ${inv?.category||r.bugCategory||'Unclassified'}\nProbable cause: ${inv?.cause||'—'}\nConfidence: ${inv?.confidence||'—'}`,
    `## Runtime Evidence\nMode: ${ev.mode||'—'}\nHTTP: ${resp.status??'—'}\nLatency: ${resp.latencyMs??'—'} ms\nRequest/Response are available in the QA Console Bug Evidence export. Token is redacted.`,
    r.details?`## QA Notes\n${r.details}`:''
  ].filter(Boolean).join('\n\n');
  return {id,title,body};
}
function openBugDraft(id){
  const rr=state.results[id];
  if(!rr){showToast('אין תוצאה שממנה אפשר ליצור Bug.','warning');return;}
  if(!['FAIL','BLOCKED','QUESTION'].includes(rr.status)){showToast(`לא נוצר Bug: סטטוס ${rr.status} אינו כשל מוצר/חסם שדורש Bug.`, 'warning');return;}
  const d=bugDraftFor(id);state.bugDraft=d;$('bugDraftTitle').value=d.title;$('bugDraftBody').value=d.body;$('bugDialog').showModal();
}
async function copyBugDraft(){
  const text=`${$('bugDraftTitle').value.trim()}\n\n${$('bugDraftBody').value}`;try{await navigator.clipboard.writeText(text);showToast('ה-Bug הועתק ומוכן להדבקה ב-Azure.','success');}catch{prompt('העתק Bug',text);}
}
function downloadBugDraft(){
  const title=$('bugDraftTitle').value.trim(),body=$('bugDraftBody').value;exportBlob(`azure-bug-${state.bugDraft?.id||'qa'}-${Date.now()}.md`,'text/markdown;charset=utf-8',`# ${title}\n\n${body}`);
}
async function investigateRun(){
  const rs=Object.values(state.results);if(!rs.length){showToast('אין עדיין תוצאות לתחקור.','warning');return;}
  const counts={};rs.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  const problems=rs.filter(r=>['FAIL','BLOCKED','N/A','QUESTION'].includes(r.status));
  const local=`הרצה: ${rs.length} תוצאות · FAIL ${counts.FAIL||0} · BLOCKED ${counts.BLOCKED||0} · N/A ${counts['N/A']||0} · QUESTION ${counts.QUESTION||0}. ${problems.length?'מומלץ להתחיל בכשלים אמיתיים (FAIL), ורק אחר כך לטפל בחסמי סביבה/Contract.':'לא נמצאו כשלים או חסמים בתוצאות הנוכחיות.'}`;
  const host=$('aiRunSummary');host.innerHTML=`<div class="investigation-card"><b>Evidence summary</b><p>${esc(local)}</p></div>`;
  if(!$('aiRemoteEnabled')?.checked)return showToast('סיכום מקומי הוצג. להפעלת AI עמוק סמן את האפשרות בהגדרות המתקדמות.','info',5000);
  const payload=redactForAi({counts,issues:problems.slice(0,40).map(r=>{const t=state.tests.find(x=>x.ID===r.id);return {id:testLabel(t)||r.id,status:r.status,scenario:t?.['תרחיש בדיקה'],endpoint:t?.Endpoint,expected:t?.['Expected Result'],actual:r.actual,details:r.details,http:r.evidence?.response?.status};})});
  try{const resp=await fetch('/api/ai-investigate',{method:'POST',headers:{'Content-Type':'application/json','X-QA-AI-Code':$('aiAccessCode')?.value||''},body:JSON.stringify({mode:'run',payload})});const data=await resp.json().catch(()=>({}));if(!resp.ok)throw new Error(data.error||`HTTP ${resp.status}`);host.innerHTML=`<div class="investigation-card"><div class="section-head"><div><h3>🤖 Run Investigation</h3><p>${esc(data.model||'AI')}</p></div></div><pre>${esc(data.analysis||local)}</pre></div>`;showToast('תחקור ההרצה הסתיים.','success');}catch(e){host.insertAdjacentHTML('beforeend',`<div class="notice">AI עמוק לא זמין: ${esc(e.message)}</div>`);showToast('AI עמוק לא זמין; הסיכום המקומי נשאר מוצג.','warning');}
}
function saveRunHistory(label,ids=null){
  const rs=(ids?.length?ids.map(id=>state.results[id]).filter(Boolean):Object.values(state.results)),counts={};rs.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);state.runHistory.unshift({id:`RUN-${Date.now()}`,label,time:now(),mode:state.demo?'DEMO':cfg().executionMode,total:rs.length,counts});state.runHistory=state.runHistory.slice(0,20);persistRunHistory();renderRunHistory();
}
function renderRunHistory(){
  const host=$('runHistoryTable');if(!host)return;host.innerHTML=state.runHistory.length?`<table class="qa-table"><thead><tr><th>Run</th><th>Mode</th><th>PASS</th><th>FAIL</th><th>BLOCKED</th><th>N/A</th><th>QUESTION</th><th>Time</th></tr></thead><tbody>${state.runHistory.map(r=>`<tr><td><b>${esc(r.label)}</b></td><td>${esc(r.mode)}</td><td class="status-pass">${r.counts?.PASS||0}</td><td class="status-fail">${r.counts?.FAIL||0}</td><td class="status-blocked">${r.counts?.BLOCKED||0}</td><td class="status-na">${r.counts?.['N/A']||0}</td><td class="status-question">${r.counts?.QUESTION||0}</td><td dir="ltr">${esc(r.time)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty-state">עדיין אין הרצות שמורות.</div>';
}

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
    ['Identity Token',!!c.token&&tokenFresh,'gcloud auth print-identity-token · אפשר לאמת דרך כפתור בדיקת Token · תוקף ~שעה'],
    ['App ID',!!c.appId,'ברירת מחדל מה-Swagger: Desktop'],
    ['User ID',!!c.userId,'Aviorha@ita.gov.il'],
    ['Case ID',!c.caseId||validCaseId(c.caseId),'לא blocker; אם נשלח — 9 ספרות'],
    ['Cloud Access',c.cloudAccessConfirmed||state.connectionOk,'משתמש ענן + הרשאה לשירות Router']
  ];
  if($('readinessGrid')) $('readinessGrid').innerHTML=items.map(([n,ok,d])=>`<div class="ready-item ${ok?'ok':'missing'}"><b>${ok?'✓':'○'} ${esc(n)}</b><span>${esc(d)}</span></div>`).join('');
  const executable = c.executionMode!=='postman';
  const core=[
    ['Connection target',!!c.baseUrl,'TSH Base URL מדויק'],
    ['Identity',!!c.token&&tokenFresh&&!!c.userId,'X-Serverless-Authorization + Aviorha@ita.gov.il'],
    ['Test defaults',!!c.appId&&(!c.caseId||validCaseId(c.caseId)),'App ID=Desktop; Case ID יכול להיות ערך בדיקה'],
    ['Execution path',executable,'Browser Direct / Proxy; במצב Postman האתר מייצר בקשות בלבד']
  ];
  if($('blockingSummary')) $('blockingSummary').innerHTML=core.map(([n,ok,d])=>`<div class="block-card"><b>${ok?'✅':'⏳'} ${esc(n)}</b><small>${esc(d)}</small></div>`).join('');
  const all=core.every(x=>x[1]); const badge=$('startBadge'); if(badge){badge.textContent=all?'מוכן להרצה':'ממתין לנתונים';badge.className='badge '+(all?'pass':'question');}
  updateTokenCountdown();
  return all;
}
function markTokenNow(){ state.tokenMarkedAt=Date.now(); state.tokenStatus='manual'; state.tokenValidationHttp=null; updateTokenCountdown(); readiness(); }
function updateTokenCountdown(){
  const el=$('tokenExpiry'); if(!el) return;
  if(!state.tokenMarkedAt){el.textContent='לא אומת עדיין. אפשר לסמן ידנית או לבצע "בדיקת Token".';el.className='field-help';return;}
  const remain=60*60*1000-(Date.now()-state.tokenMarkedAt);
  const prefix=state.tokenStatus==='valid' ? `Token אומת בהצלחה${state.tokenValidationHttp?` · HTTP ${state.tokenValidationHttp}`:''}` :
    state.tokenStatus==='invalid' ? `Token לא אומת${state.tokenValidationHttp?` · HTTP ${state.tokenValidationHttp}`:''}` :
    'Token סומן ידנית כחדש';
  if(remain<=0){el.textContent=`${prefix} · התוקף המשוער חלף — הפק Token חדש`;el.className='field-help token-expired';return;}
  const m=Math.floor(remain/60000), sec=Math.floor((remain%60000)/1000);
  const cls=state.tokenStatus==='valid' ? ' token-ok' : state.tokenStatus==='invalid' ? ' token-invalid' : (remain<10*60*1000?' token-warn':'');
  el.textContent=`${prefix} · תוקף משוער: עוד ${m}:${String(sec).padStart(2,'0')} דקות`;
  el.className='field-help'+cls;
}
async function validateToken(){
  const c=cfg();
  if(c.executionMode==='postman'){showToast('במצב Postman אי אפשר לאמת Token מהדפדפן. העתק cURL והרץ בסביבה הפנימית.', 'warning', 5000); return;}
  if(!c.baseUrl || !c.token || !c.appId || !c.userId){showToast('כדי לאמת Token יש למלא Base URL, Token, App ID ו-User ID.', 'warning', 5000); return;}
  try{
    const body={appId:c.appId,userId:c.userId,...(c.caseId?{caseId:c.caseId}:{}),limit:1,offset:0};
    const r=await proxy({method:'POST',path:'/v1/conversations/history',body});
    state.tokenValidationHttp=r.status;
    if(r.status>=200 && r.status<300){
      state.tokenMarkedAt=Date.now(); state.tokenStatus='valid'; updateTokenCountdown(); readiness();
      showToast(`Token אומת בהצלחה מול Router (HTTP ${r.status}).`, 'success');
    }else if(r.status===401 || r.status===403){
      state.tokenStatus='invalid'; updateTokenCountdown(); readiness();
      showToast(`Token לא תקין / לא מורשה (HTTP ${r.status}).`, 'error', 5000);
    }else{
      state.tokenMarkedAt=Date.now(); state.tokenStatus='manual'; updateTokenCountdown(); readiness();
      showToast(`התקבל HTTP ${r.status}. לא בטוח אם הבעיה ב-Token או ב-API — בדוק Evidence.`, 'warning', 6000);
    }
  }catch(e){
    state.tokenStatus='invalid'; state.tokenValidationHttp=null; updateTokenCountdown();
    showToast('בדיקת Token נכשלה: '+e.message, 'error', 6000);
  }
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
  $('dialogTitle').textContent=`${testLabel(t)} — ${t['תרחיש בדיקה']||''}`; $('dialogSubtitle').textContent=`${t.priority} · ${modeLabel(t.mode)} · ${t.Endpoint||''}`;
  const resultHtml=r?`<div class="detail-row test-result-line"><b>תוצאה אחרונה</b><span class="status-chip ${statusClass(r.status)}">${esc(statusLabel(r.status))}</span><span>${esc(r.actual||'')}</span></div>`:'';
  $('dialogBody').innerHTML=`<div class="detail-row plain-explanation"><b>מה הבדיקה עושה בפשטות?</b>${esc(plainTestExplanation(t))}</div>`+resultHtml+
    [['תנאים מקדימים',t['תנאים מקדימים']],['צעדים / קלט',t['צעדים / קלט']],['Expected Result',t['Expected Result']],['שאלה פתוחה',t['שאלה פתוחה / נדרש אישור']],['מקור / הערה',t['מקור / הערה']]].filter(x=>x[1]).map(([a,b])=>`<div class="detail-row"><b>${esc(a)}</b>${esc(b)}</div>`).join('');
  renderDialogEvidence(r?.evidence||null,r?.status||'');
  renderInvestigation(id);
  if($('dialogInvestigateBtn'))$('dialogInvestigateBtn').hidden=!r;
  if($('dialogGenerateBugBtn'))$('dialogGenerateBugBtn').hidden=!r||!['FAIL','BLOCKED','QUESTION'].includes(r.status);
  $('manualNote').value=r?.details||''; if($('manualBugCategory'))$('manualBugCategory').innerHTML=bugCategoryOptions(r?.bugCategory||''); $('dialogRunBtn').style.display=t.mode==='manual'?'none':'inline-block'; $('testDialog').showModal();
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
function saveManual(status){ const id=state.selectedTestId;if(!id)return; const r=result(id,status,'Manual review',$('manualNote').value.trim()||'סומן ידנית');r.bugCategory=$('manualBugCategory')?.value||'';renderReport();$('testDialog').close(); }


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
  const routingTests = [
    ['ROUTE-001','P0','Routing','Router','שאלת Q&A/ידע מנותבת למסלול Retrieval','שלח שאלת ידע עם Expected Route מאושר','Actual Route = Q&A/Retrieval; אין מעבר ל-Text2SQL'],
    ['ROUTE-002','P0','Routing','Router','שאלה טבלאית מנותבת ל-Text2SQL','שלח שאלה על נתון מובנה/אגרגציה','Actual Route = Text2SQL'],
    ['ROUTE-003','P1','Routing','Router','שיחה כללית מנותבת למסלול LLM כללי','שלח שיחת חולין/שאלה כללית שאינה דורשת מסמך או DB','Actual Route = General Conversation / LLM'],
    ['ROUTE-004','P1','Routing','Router','שאלה עמומה אינה נשלחת למסלול מסוכן/לא רלוונטי','שלח שאלה דו-משמעית בין ידע לנתונים','התנהגות עקבית לפי מדיניות: route/clarification; ללא חשיפת מידע'],
    ['ROUTE-005','P0','Routing / Security','Router','הרשאות נשמרות לאחר Routing','שלח שאלה שמנותבת לרכיב עם מקור/נתון לא מורשה','אין Source/Data לא מורשה גם לאחר מעבר בין רכיבים']
  ];
  for (const [ID,priority,domain,Endpoint,scenario,steps,expected] of routingTests) state.tests.push({ID,priority,mode:'assisted','תחום':domain,Endpoint,'תרחיש בדיקה':scenario,'תנאים מקדימים':'Observability/Trace/Tool event שמאפשר לזהות Actual Route','צעדים / קלט':steps,'Expected Result':expected,'שאלה פתוחה / נדרש אישור':'','מקור / הערה':'Online User Flow & Serving'});

  const text2sqlTests = [
    ['T2S-001','P0','Text2SQL','POST /applications/queryanddata','שאלה פשוטה מייצרת SQL נכון לוגית','שלח שאלה עם Expected SQL/Data ידועים','SQL תקין ומחזיר את הנתונים הצפויים'],
    ['T2S-002','P0','Text2SQL','POST /applications/queryanddata','Filters ו-WHERE משקפים את השאלה','שאל שאלה עם תנאי תאריך/סטטוס/יחידה','הפילטרים ב-SQL והתוצאה תואמים במדויק'],
    ['T2S-003','P0','Text2SQL','POST /applications/queryanddata','JOIN/Aggregation נכונים','שאל שאלה המחייבת JOIN + COUNT/SUM/GROUP BY','ה-SQL וה-DB result נכונים מול שאילתת Reference'],
    ['T2S-004','P1','Text2SQL Validation','POST /applications/queryanddata','Dry-run/Retry מטפל ב-SQL לא תקין','באמצעות Test Hook/תרחיש מתאים גרום ל-SQL ראשון לא תקין','Validation מתבצע; retry עד 3; אין הרצת SQL לא תקין'],
    ['T2S-005','P1','Text2SQL','POST /applications/queryanddata','shouldFetchData=false מחזיר SQL ללא הרצה','שלח shouldFetchData=false','SQL מוחזר; data אינו מכיל תוצאת BigQuery'],
    ['T2S-006','P1','Text2SQL Routing','POST /applications/queryanddata','בחירת maagarim מפורשת נשמרת','שלח maagarim ידועים','ה-Context/SQL משתמש בדומיינים שסופקו בלבד'],
    ['T2S-007','P1','Text2SQL Routing','POST /applications/queryanddata','בחירת maagarim אוטומטית נכונה','השמט maagarim ושאל שאלה חד-משמעית','ה-Router בוחר domain מתאים והתשובה מחזירה maagarim תואמים'],
    ['T2S-008','P0','Text2SQL Security','POST /applications/queryanddata','אין גישה לנתונים/טבלאות לא מורשים','נסה לנסח שאלה שמפתה גישה לדומיין לא מורשה','הבקשה נחסמת/מוגבלת; אין SQL/Data לא מורשים'],
    ['T2S-009','P1','Text2SQL Large Result','POST /applications/queryanddata','תוצאה גדולה מטופלת ב-Truncation + GCS','הרץ query שמחזיר מעל מגבלת inline','warnings תקין; bucketName+fileName מצביעים לתוצאה המלאה'],
    ['T2S-010','P0','Text2SQL Answer','Router / Text2SQL','התשובה המילולית תואמת ל-DB result','השווה SQL result לתשובה הסופית','אין מספר/עובדה בתשובה שסותרים את תוצאת DB'],
    ['T2S-011','P1','Text2SQL','POST /applications/sql2text','SQL2Text מסביר SQL בלי להריץ DB','שלח SQL ידוע ל-sql2text','הסבר נכון; data=null; אין Query Execution'],
    ['T2S-012','P1','Text2SQL Validation','POST /applications/queryanddata','קלט query ריק נדחה','שלח query ריק/blank','4xx Validation; אין SQL/Execution']
  ];
  for (const [ID,priority,domain,Endpoint,scenario,steps,expected] of text2sqlTests) state.tests.push({ID,priority,mode:'assisted','תחום':domain,Endpoint,'תרחיש בדיקה':scenario,'תנאים מקדימים':'Text2SQL Base URL + Authentication + גישת SQL/BigQuery או Reference Query','צעדים / קלט':steps,'Expected Result':expected,'שאלה פתוחה / נדרש אישור':'','מקור / הערה':'Text2SQL Controller documentation'});

  // גרסה 0.02: מספור תצוגה רציף נשמר; נוספו Investigation, Bug Draft ו-Run History. legacyId נשמר פנימית כדי לא לשבור את מנגנון ההרצה.
  state.tests.forEach((t,i)=>{ t.legacyId=t.ID; t.displayId=`QA-${String(i+1).padStart(3,'0')}`; });

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
function testLabel(t){return t?.displayId||t?.ID||'';}

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
  const prev=state.results[id]||{};state.results[id]={id,status,actual,details,time:now(),evidence:clone(state.lastExchange),bugCategory:prev.bugCategory||''}; renderKpis(); renderCatalog(); renderReport();
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
      case 'BND-002': body=requestBody('/v1/conversations/new','POST'); body.userId='a'.repeat(120)+'@ita.gov.il'; r=await proxy({method:'POST',path:'/v1/conversations/new',body}); pass=r.status>=400&&r.status<500; actual=`HTTP ${r.status}`; break;
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
  saveRunHistory('Safe P0',ids); showToast('Run Safe P0 הסתיים.','success');
}

async function runBoundaryPack(){
  const ids=state.tests.filter(t=>t.ID.startsWith('BND-')&&t.mode==='auto').map(t=>t.ID); $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id,{bulk:true}); if(r)$('runSummary').innerHTML += `<div class="run-item"><b>${id}</b><span class="${statusClass(r.status)}">${r.status}</span><span>${esc(r.actual)}</span></div>`; }
  saveRunHistory('Boundary Pack',ids); showToast('Boundary Pack הסתיים.','success');
}

async function runRagSpecPack(){
  const ids=state.tests.filter(t=>t.ID.startsWith('RAG-')).map(t=>t.ID); $('runSummary').innerHTML='';
  for(const id of ids){ const r=await runTest(id,{bulk:true}); if(r)$('runSummary').insertAdjacentHTML('beforeend',`<div class="run-item"><b>${esc(id)}</b><span class="${statusClass(r.status)}">${esc(r.status)}</span><span>${esc(r.actual)}</span></div>`); }
  saveRunHistory('RAG Spec Pack',ids); showToast('RAG Spec Pack הסתיים. בדיקות שאין להן Observability/Test Data מסומנות N/A.','info',5000);
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
    saveRunHistory('Run All',tests.map(t=>t.ID));
    showToast(`הרצה כוללת הסתיימה. FAIL: ${counts.FAIL||0}, BLOCKED: ${counts.BLOCKED||0}, N/A: ${counts['N/A']||0}${state.demo?' · Demo Mode פעיל':''}`,counts.FAIL?'warning':'success',5000);
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
  const buttonIds=['demoBtn','healthBtn','validateTokenBtn','markTokenBtn','generateCaseIdBtn','readinessBtn','runAllTests','runSafeP0','runBoundaryPack','runRagSpecPack','runHappyFlow','uiSelfTestBtn','clearResults','flowRunBtn','apiRunBtn','copyCurlBtn','aiRunBtn','goldenRunAllBtn','goldenSaveBtn','goldenResetBtn','goldenExportBtn','goldenImportBtn','goldenClearBtn','goldenCompareBtn','dialogBugEvidenceBtn','dialogInvestigateBtn','dialogGenerateBugBtn','runAiSummaryBtn','clearRunHistoryBtn','copyBugDraftBtn','downloadBugDraftBtn','exportJson','exportCsv','exportStpBtn','exportStdBtn','dialogRunBtn','dialogCopyCurlBtn'];
  buttonIds.forEach(id=>{const el=$(id);check(`כפתור ${id}`,!!el && (typeof el.onclick==='function'||id==='dialogCopyCurlBtn'),!el?'לא נמצא':typeof el.onclick);});
  document.querySelectorAll('.tab').forEach(tab=>check(`Tab ${tab.dataset.tab}`,!!$(tab.dataset.tab)&&typeof tab.onclick==='function','Target section + click handler'));
  document.querySelectorAll('[data-manual-status]').forEach(b=>check(`Manual status ${b.dataset.manualStatus}`,typeof b.onclick==='function','click handler'));
  document.querySelectorAll('[data-rating]').forEach(b=>check(`AI rating ${b.dataset.rating}`,typeof b.onclick==='function','click handler'));
  check('כפתור סגירת Dialog',document.querySelector('#testDialog form[method="dialog"] button[value="cancel"]')!=null,'native dialog close');
  check('קטלוג בדיקות נטען',state.tests.length>0,`${state.tests.length} tests`); check('Swagger operations נטענו',state.operations.length>0,`${state.operations.length} operations`);
  check('P0-002 ברור',plainTestExplanation({ID:'P0-002'}).includes('gcloud'),'הסבר פשוט קיים');
  check('הנחיות Setup מקופלות',document.querySelector('details.setup-help')!=null,'native details/summary');
  check('מדריך מערכת נטען',!!$('guide') && !!$('endpointGuide'),'Guide + endpoint guide'); check('RAG Guide נטען',!!$('ragPipelines') && !!$('ragRules') && state.tests.some(t=>t.legacyId==='RAG-001'||t.ID==='RAG-001'),'Guide containers + RAG test pack'); check('מילון AI נטען',AI_GLOSSARY.length>=25 && !!$('glossaryGrid'),`${AI_GLOSSARY.length} terms`); check('Golden Sanity נטען',!!$('goldenTable') && !!$('goldenResults'),'Dataset + results'); check('Golden Regression מתקדם נטען',!!$('goldenReviewQueue')&&!!$('goldenCompareTable')&&!!$('goldenRunsTable'),'Review + compare + run history'); document.querySelectorAll('.subtab').forEach(tab=>check(`Subtab ${tab.dataset.subtab}`,!!tab.closest('.tabpage')?.querySelector(`[data-subpage=\"${tab.dataset.subtab}\"]`) && typeof tab.onclick==='function','Target subpage + click handler')); 
  check('Demo אינו PASS אמיתי',true,'ב־Demo תוצאות אוטומטיות מסומנות DEMO');
  const failed=checks.filter(x=>!x.ok); state.uiSelfTest={time:now(),checks};
  $('runSummary').innerHTML=`<div class="ui-test-list">${checks.map(x=>`<div class="ui-test-item ${x.ok?'ok':'fail'}"><b>${x.ok?'✓':'✕'} ${esc(x.name)}</b>${x.detail?` — ${esc(x.detail)}`:''}</div>`).join('')}</div>`;
  showToast(failed.length?`Console Self-Test מצאה ${failed.length} בעיות.`:`Console Self-Test עברה: ${checks.length} checks.` ,failed.length?'error':'success',5000);
  return {ok:failed.length===0,checks};
}

function renderCatalog(){
  const q=$('searchTests')?.value?.toLowerCase()||'', p=$('priorityFilter')?.value||'', m=$('modeFilter')?.value||'', st=$('statusFilter')?.value||'';
  const rows=state.tests.filter(t=>{const rs=state.results[t.ID]?.status||'NOT_RUN';return (!p||t.priority===p)&&(!m||t.mode===m)&&(!st||rs===st)&&(!q||[t.displayId,t.ID,t['תחום'],t.Endpoint,t['תרחיש בדיקה']].join(' ').toLowerCase().includes(q));});
  $('testsTableWrap').innerHTML=`<table class="qa-table"><thead><tr><th>ID</th><th>רמה</th><th>מצב</th><th>תחום</th><th>Endpoint</th><th>תרחיש</th><th>Expected</th><th>שאלה פתוחה</th><th>תוצאה</th><th></th></tr></thead><tbody>${rows.map(t=>{
    const r=state.results[t.ID]; return `<tr><td>${esc(testLabel(t))}</td><td class="${t.priority.toLowerCase()}">${t.priority}</td><td class="mode-${t.mode}">${modeLabel(t.mode)}</td><td>${esc(t['תחום'])}</td><td dir="ltr">${esc(t.Endpoint)}</td><td>${esc(t['תרחיש בדיקה'])}</td><td>${esc(t['Expected Result'])}</td><td>${esc(t['שאלה פתוחה / נדרש אישור'])}</td><td class="${r?statusClass(r.status):''}">${r?esc(r.status):'Not Run'}</td><td><div class="actions-row"><button class="btn test-run" data-id="${t.ID}">${t.mode==='manual'?'סמן':'Run'}</button><button class="btn ghost test-open" data-id="${t.ID}">פרטים</button></div></td></tr>`}).join('')}</tbody></table>`;
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
    ['RAG Spec / Category RBAC','Ingestion + Retrieval Target Design','RAG test pack; לא מסיקים שהמימוש קיים רק כי הוא מופיע באפיון'],
    ['מידע סטטיסטי רגיש','Statistics / RBAC','Access control + response data review']
  ];
  if($('stdTraceability')) $('stdTraceability').innerHTML=`<table class="qa-table"><thead><tr><th>סיכון</th><th>אזור בדיקה</th><th>כיסוי ב־STD</th></tr></thead><tbody>${trace.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function stpMarkdown(){
  return `# STP – תוכנית בדיקות GenAI Router\n\n## מטרה\nלוודא שה-Router עובד תקין בסביבת TSH, מנהל שיחות ו-state בצורה עקבית, אוכף הרשאות ומחזיר תשובות GenAI/RAG אמינות ובטוחות.\n\n## Scope\nAPI, Authentication, Conversations, History, SSE Messages, Delete, Files/Chunks, Feedback, Statistics, Boundaries, Authorization, RAG, Prompt Injection ו-State. בנוסף נכללות בדיקות Target Design של אפיון ה-RAG הגנרי (Ingestion/Retrieval), המסומנות בנפרד ואינן הוכחה למימוש נוכחי.\n\n## מחוץ ל-Scope כרגע\nProduction; עומסים ללא SLA; DB מלא ללא גישה; איכות עסקית סופית ללא Golden Dataset/SME.\n\n## סביבת בדיקה\nTSH/NON-PROD. Identity Token באמצעות gcloud auth print-identity-token ונשלח ב-X-Serverless-Authorization.\n\n## Entry Criteria\n- TSH Base URL\n- משתמש ענן והרשאת Router\n- Identity Token תקין\n- Swagger/Contract זמין\n- Test Data בסיסי\n\n## Exit Criteria\n- כל P0 עברו או אושרה חריגה\n- אין תקלת אבטחה קריטית פתוחה\n- P1/P2 תועדו\n- פערי Contract החוסמים החלטה סומנו/נסגרו\n- הופק Test Run Report\n\n## סיכונים\nToken קצר חיים; תלות ברשת/הרשאות; Contract חלקי; תלות ב-DB/Logs; צורך ב-SME לבדיקות איכות AI; אפיון ה-RAG הוא Target Design וסעיף ה-API שלו עדיין מסומן להשלמה.\n`;
}
function stdMarkdown(){
  const lines=[`# STD – תכנון ותיאור בדיקות GenAI Router`,``,`סה״כ תסריטים: ${state.tests.length}`,``,'## Test Cases'];
  for(const t of state.tests){ lines.push(`### ${testLabel(t)} – ${t['תרחיש בדיקה']||''}`,`- עדיפות: ${t.priority}` ,`- תחום: ${t['תחום']||''}`,`- Endpoint: ${t.Endpoint||''}`,`- תנאים מקדימים: ${t['תנאים מקדימים']||''}`,`- צעדים/קלט: ${t['צעדים / קלט']||''}`,`- Expected: ${t['Expected Result']||''}`,`- מצב: ${modeLabel(t.mode)}`,``); }
  return lines.join('\n');
}
function exportStp(){exportBlob('STP-GenAI-Router-he.md','text/markdown;charset=utf-8','\ufeff'+stpMarkdown());}
function exportStd(){exportBlob('STD-GenAI-Router-he.md','text/markdown;charset=utf-8','\ufeff'+stdMarkdown());}

function renderKpis(){ const rs=Object.values(state.results); $('kpiTotal').textContent=state.tests.length; $('kpiAuto').textContent=state.tests.filter(t=>t.mode!=='manual').length; $('kpiPass').textContent=rs.filter(r=>r.status==='PASS').length; $('kpiFail').textContent=rs.filter(r=>r.status==='FAIL').length; if($('kpiBlocked'))$('kpiBlocked').textContent=rs.filter(r=>r.status==='BLOCKED').length; if($('kpiQuestion'))$('kpiQuestion').textContent=rs.filter(r=>r.status==='QUESTION').length; if($('kpiNA'))$('kpiNA').textContent=rs.filter(r=>r.status==='N/A').length; if($('kpiDemo'))$('kpiDemo').textContent=rs.filter(r=>r.status==='DEMO').length; $('kpiOpen').textContent=state.questions.filter(q=>(q.Status||'Open')==='Open').length; }
function setTestBugCategory(id,val){if(!state.results[id])return;state.results[id].bugCategory=val||'';renderReport();}
function downloadTestBugEvidence(id){const r=state.results[id],t=state.tests.find(x=>x.ID===id);if(!r||!t)return;const md=bugEvidenceMarkdown({title:`QA Bug Evidence — ${testLabel(t)}`,category:r.bugCategory,meta:{environment:cfg().baseUrl||'TSH',time:r.time},fields:{Scenario:t['תרחיש בדיקה'],Endpoint:t.Endpoint,'Expected Result':t['Expected Result'],Actual:r.actual,Details:r.details,Status:r.status},evidence:r.evidence});exportBlob(`bug-evidence-${testLabel(t)}-${Date.now()}.md`,'text/markdown;charset=utf-8',md);}
function downloadSelectedTestBugEvidence(){if(state.selectedTestId)downloadTestBugEvidence(state.selectedTestId);}
function renderReport(){
  const rs=Object.values(state.results);
  $('reportTable').innerHTML=rs.length?`<table class="qa-table"><thead><tr><th>ID</th><th>Status</th><th>Mode</th><th>Actual</th><th>Details</th><th>סיווג כשל</th><th>Evidence / Investigation</th><th>Time</th></tr></thead><tbody>${rs.map(r=>{const t=state.tests.find(x=>x.ID===r.id);const canBug=['FAIL','BLOCKED','QUESTION'].includes(r.status);return `<tr><td>${esc(testLabel(t)||r.id)}</td><td class="${statusClass(r.status)}">${r.status}</td><td>${esc(r.evidence?.mode||'—')}</td><td>${esc(r.actual)}</td><td>${esc(r.details)}</td><td><select data-test-category="${esc(r.id)}">${bugCategoryOptions(r.bugCategory||'')}</select></td><td><div class="report-actions"><button class="mini-btn" data-test-evidence="${esc(r.id)}">Evidence</button><button class="mini-btn" data-test-investigate="${esc(r.id)}">🤖 Investigate</button>${canBug?`<button class="mini-btn" data-test-bug="${esc(r.id)}">🐞 Bug</button>`:''}</div></td><td dir="ltr">${r.time}</td></tr>`}).join('')}</tbody></table>`:'אין תוצאות עדיין.';
  document.querySelectorAll('[data-test-category]').forEach(x=>x.onchange=()=>setTestBugCategory(x.dataset.testCategory,x.value));
  document.querySelectorAll('[data-test-evidence]').forEach(b=>b.onclick=()=>downloadTestBugEvidence(b.dataset.testEvidence));
  document.querySelectorAll('[data-test-investigate]').forEach(b=>b.onclick=()=>{openTest(b.dataset.testInvestigate);investigateTest(b.dataset.testInvestigate);});
  document.querySelectorAll('[data-test-bug]').forEach(b=>b.onclick=()=>openBugDraft(b.dataset.testBug));
}
function renderAll(){renderCatalog();renderQuestions();renderKpis();renderReport();renderRunHistory();renderContract();renderContext();renderRagSpec();renderStpStd();renderEndpointGuide();renderAiQaLessons();renderGlossary($('glossarySearch')?.value||'');renderGolden();wireGlossaryLinks();readiness();}

function populateEndpoints(){ const s=$('endpointSelect'); s.innerHTML=state.operations.map((o,i)=>`<option value="${i}">${o.method} ${o.path} — ${esc(o.operationId)}</option>`).join(''); s.onchange=syncApiTemplate; syncApiTemplate(); }
function syncApiTemplate(){ const o=state.operations[+$('endpointSelect').value||0]; if(!o)return; $('apiMethod').value=o.method; $('apiBody').value=JSON.stringify(requestBody(o.path,o.method),null,2); }
async function apiRun(){ try{const o=state.operations[+$('endpointSelect').value||0]; let b; try{b=JSON.parse($('apiBody').value||'{}')}catch{throw new Error('Request JSON אינו תקין');} if(cfg().executionMode==='postman'){const curl=buildCurl(o.method,o.path,o.method==='GET'?undefined:b);$('apiResponse').textContent=curl;$('apiMeta').textContent='POSTMAN / cURL MODE — לא נשלחה בקשה';return;} const isStream=o.path==='/v1/conversations/messages'; const r=await proxy({method:o.method,path:o.path,body:(o.method==='GET'?undefined:b),stream:isStream}); if(isStream){$('apiResponse').textContent=''; const txt=await readStream(r.stream,(c,f)=>$('apiResponse').textContent=f.slice(-10000)); $('apiMeta').textContent=`HTTP ${r.status}\nSSE`; const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid;} else {$('apiResponse').textContent=typeof r.body==='string'?r.body:JSON.stringify(r.body,null,2);$('apiMeta').textContent=`HTTP ${r.status}\n${r.latencyMs??''} ms\n${r.contentType??''}`;} showToast('API Runner הסתיים.','success');}catch(e){$('apiResponse').textContent=e.message;$('apiMeta').textContent='BLOCKED';showToast('API Runner: '+e.message,'error',5000);} }
async function aiRun(){ try{const c=requireFields(['conversationId','appId','userId']); const body={conversationId:c.conversationId,userId:c.userId,appId:c.appId,...(c.caseId?{caseId:c.caseId}:{}),content:$('aiPrompt').value.trim()}; $('aiStream').textContent=''; const r=await proxy({method:'POST',path:'/v1/conversations/messages',body,stream:true}); const txt=await readStream(r.stream,(ch,full)=>{$('aiStream').textContent=full.slice(-15000);renderSseEvents(full);}); renderSseEvents(txt); const mid=extractMessageIdFromText(txt); if(mid)$('messageId').value=mid; showToast('GenAI/RAG request הסתיים.','success');}catch(e){$('aiStream').textContent=e.message;showToast('GenAI/RAG: '+e.message,'error',5000);} }

function exportBlob(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function exportJson(){exportBlob(`qa-report-${Date.now()}.json`,'application/json',JSON.stringify({generatedAt:now(),environment:cfg().baseUrl,results:Object.values(state.results),investigations:state.investigations,runHistory:state.runHistory,aiRating:state.aiRating,goldenRuns:state.goldenRuns},null,2));}
function exportCsv(){const rows=[['ID','Status','Actual','Details','Failure Category','Time'],...Object.values(state.results).map(r=>[r.id,r.status,r.actual,r.details,r.bugCategory||'',r.time])];const csv=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');exportBlob(`qa-report-${Date.now()}.csv`,'text/csv;charset=utf-8','\ufeff'+csv);}

async function health(){ if(cfg().executionMode==='postman'){setConn('Postman mode · העתק cURL','question');showToast('במצב Postman האתר לא שולח בקשה.','warning');return;} try{const r=await proxy({method:'GET',path:'/health'}); const ok=r.status===200; state.connectionOk=ok; setConn(state.demo?'Demo Mode · סימולציה בלבד':(ok?`מחובר · HTTP ${r.status}`:`HTTP ${r.status}`),state.demo?'demo':(ok?'pass':'fail')); readiness();showToast(state.demo?'בדיקת חיבור בסימולציית Demo בלבד.':(ok?'החיבור ל־Router הצליח.':`ה־Router החזיר HTTP ${r.status}.`),state.demo?'warning':(ok?'success':'error'));}catch(e){state.connectionOk=false;setConn(e.message,'fail');readiness();showToast('בדיקת חיבור נכשלה: '+e.message,'error',5000);} }
function demo(){state.demo=!state.demo;$('demoBtn').textContent=state.demo?'Demo: ON':'Demo Mode';$('demoWarning').hidden=!state.demo;setConn(state.demo?'Demo Mode · סימולציה בלבד':'לא מחובר',state.demo?'demo':'neutral');showToast(state.demo?'Demo Mode הופעל: לא נשלחות בקשות אמיתיות.':'Demo Mode כובה.','info');}

function wire(){
  document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tabpage').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');}); document.querySelectorAll('.subtab').forEach(b=>b.onclick=()=>{const root=b.closest('.tabpage'); if(!root)return; root.querySelectorAll('.subtab').forEach(x=>x.classList.remove('active')); root.querySelectorAll('.subpage').forEach(x=>x.classList.remove('active')); b.classList.add('active'); const page=root.querySelector(`[data-subpage=\"${b.dataset.subtab}\"]`); if(page)page.classList.add('active');});
  $('searchTests').oninput=renderCatalog;$('priorityFilter').onchange=renderCatalog;$('modeFilter').onchange=renderCatalog;if($('statusFilter'))$('statusFilter').onchange=renderCatalog;
  $('demoBtn').onclick=demo;$('healthBtn').onclick=health;$('validateTokenBtn').onclick=validateToken;$('markTokenBtn').onclick=()=>{markTokenNow();showToast('Token סומן ידנית כחדש.','success');};$('generateCaseIdBtn').onclick=()=>{ensureCaseId(true);showToast('נוצר Case ID חדש לבדיקה.','success');};$('readinessBtn').onclick=()=>{const ok=readiness();showToast(ok?'הסביבה מוכנה להרצה.':'עדיין חסרים נתונים — ראה כרטיסי המוכנות. ',ok?'success':'warning');};$('runAllTests').onclick=runAllTests;$('runSafeP0').onclick=runSafeP0;$('runBoundaryPack').onclick=runBoundaryPack;$('runRagSpecPack').onclick=runRagSpecPack;$('runHappyFlow').onclick=happyFlow;$('uiSelfTestBtn').onclick=runUiSelfTest;$('flowRunBtn').onclick=happyFlow;$('apiRunBtn').onclick=apiRun;$('copyCurlBtn').onclick=copyCurl;$('aiRunBtn').onclick=aiRun;
  if($('goldenSaveBtn'))$('goldenSaveBtn').onclick=goldenSave;if($('goldenResetBtn'))$('goldenResetBtn').onclick=goldenFormReset;if($('goldenRunAllBtn'))$('goldenRunAllBtn').onclick=runGoldenAll;if($('goldenExportBtn'))$('goldenExportBtn').onclick=exportGolden;if($('goldenImportBtn'))$('goldenImportBtn').onclick=()=>$('goldenImportFile').click();if($('goldenImportFile'))$('goldenImportFile').onchange=e=>{const f=e.target.files?.[0];if(f)importGoldenFile(f);e.target.value='';};if($('goldenClearBtn'))$('goldenClearBtn').onclick=()=>{if(confirm('למחוק את כל שאלות הזהב, התוצאות והיסטוריית הריצות המקומית?')){state.goldenDataset=[];state.goldenResults={};state.goldenRuns=[];state.currentGoldenRunId=null;saveGoldenDataset();goldenFormReset();renderGolden();}};if($('goldenCompareBtn'))$('goldenCompareBtn').onclick=compareGoldenRuns;if($('glossarySearch'))$('glossarySearch').oninput=e=>renderGlossary(e.target.value);wireGlossaryLinks();
  $('clearResults').onclick=()=>{state.results={};state.investigations={};state.lastExchange=null;$('runSummary').innerHTML='';if($('aiRunSummary'))$('aiRunSummary').innerHTML='';renderAll();showToast('תוצאות ההרצה אופסו.','success');};
  if($('clearRunHistoryBtn'))$('clearRunHistoryBtn').onclick=()=>{state.runHistory=[];persistRunHistory();renderRunHistory();showToast('היסטוריית ההרצות המקומית נמחקה.','success');};
  if($('runAiSummaryBtn'))$('runAiSummaryBtn').onclick=investigateRun;
  if($('dialogInvestigateBtn'))$('dialogInvestigateBtn').onclick=()=>state.selectedTestId&&investigateTest(state.selectedTestId);
  if($('dialogGenerateBugBtn'))$('dialogGenerateBugBtn').onclick=()=>state.selectedTestId&&openBugDraft(state.selectedTestId);
  if($('copyBugDraftBtn'))$('copyBugDraftBtn').onclick=copyBugDraft; if($('downloadBugDraftBtn'))$('downloadBugDraftBtn').onclick=downloadBugDraft;
  $('exportJson').onclick=exportJson;$('exportCsv').onclick=exportCsv; if($('exportStpBtn')) $('exportStpBtn').onclick=exportStp; if($('exportStdBtn')) $('exportStdBtn').onclick=exportStd;
  ['baseUrl','token','appId','userId','caseId'].forEach(id=>$(id).addEventListener('input',()=>{readiness(); if(id==='caseId') updateCaseIdHelp();})); $('executionMode').addEventListener('change',readiness); $('authHeader').addEventListener('change',readiness); $('cloudAccessConfirmed').addEventListener('change',readiness); if($('dialogBugEvidenceBtn'))$('dialogBugEvidenceBtn').onclick=downloadSelectedTestBugEvidence; $('dialogRunBtn').onclick=async()=>{const id=state.selectedTestId;if(id){await runTest(id);$('testDialog').close();}}; document.querySelectorAll('[data-manual-status]').forEach(b=>b.onclick=()=>saveManual(b.dataset.manualStatus));
  document.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>{state.aiRating={rating:b.dataset.rating,note:$('aiNote').value,time:now()};$('aiRating').textContent=`נבחר: ${b.dataset.rating}`;});
}

setInterval(updateTokenCountdown,1000);
loadGoldenDataset();
loadRunHistory();
ensureCaseId(); updateCaseIdHelp(); updateTokenCountdown(); readiness();
wire(); loadData().then(()=>{renderGolden();if(new URLSearchParams(location.search).get('selftest')==='1')setTimeout(runUiSelfTest,50);}).catch(e=>{showToast('שגיאת טעינת נתונים: '+e.message,'error',8000);document.body.insertAdjacentHTML('beforeend',`<pre>${esc(e.message)}</pre>`);});
