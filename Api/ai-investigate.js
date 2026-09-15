const MAX_BODY = 64_000;

function extractText(data){
  if(typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const parts=[];
  for(const item of data?.output || []){
    for(const c of item?.content || []){
      if(typeof c?.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

export default async function handler(req,res){
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try{
    if(process.env.AI_INVESTIGATE_ENABLED !== 'true') return res.status(503).json({error:'AI investigation is disabled on the server'});
    const accessCode=process.env.AI_INVESTIGATE_ACCESS_CODE || '';
    if(!accessCode || req.headers['x-qa-ai-code'] !== accessCode) return res.status(401).json({error:'AI investigation access code is missing or invalid'});
    const apiKey=process.env.OPENAI_API_KEY;
    const model=process.env.OPENAI_MODEL || 'gpt-5.6-luna';
    if(!apiKey) return res.status(503).json({error:'OPENAI_API_KEY is not configured on the server'});
    const raw=JSON.stringify(req.body||{});
    if(raw.length>MAX_BODY) return res.status(413).json({error:'Investigation payload is too large'});
    const {mode='test',payload}=req.body||{};
    if(!payload) return res.status(400).json({error:'payload is required'});
    const instructions = mode==='run'
      ? 'You are a senior QA investigator for a GenAI Router. Analyze only the supplied redacted run evidence. Reply in concise Hebrew. Separate: תמונת מצב, כשלים אמיתיים, חסמי סביבה/Contract, דפוס משותף אפשרי, סדר פעולות מומלץ. Never claim a root cause as certain unless the evidence proves it. Do not invent logs, requirements, or implementation details.'
      : 'You are a senior QA investigator for a GenAI Router. Analyze only the supplied redacted test case and runtime evidence. Reply in concise Hebrew. Include: סיכום הכשל, הראיה המרכזית, Root cause סביר עם רמת ביטחון, האם זה Product Bug / Environment / Test Data / Contract, ו-3 צעדי חקירה הבאים. Never invent missing evidence and never treat an AI guess as PASS/FAIL proof.';
    const upstream=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,instructions,input:JSON.stringify(payload),reasoning:{effort:'low'}})
    });
    const data=await upstream.json().catch(()=>({}));
    if(!upstream.ok) return res.status(502).json({error:data?.error?.message||`OpenAI API returned ${upstream.status}`});
    const analysis=extractText(data);
    if(!analysis) return res.status(502).json({error:'The model returned no text analysis'});
    return res.status(200).json({analysis,model});
  }catch(e){
    return res.status(500).json({error:e.message||String(e)});
  }
}
