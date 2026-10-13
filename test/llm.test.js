import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLlm, SYSTEM_PROMPT, ANSWER_PROMPT, ADVICE_PROMPT } from '../src/llm.js';
import { plan } from './helpers.js';
test('both system prompts are English and require Thai responses',()=>{
  for(const prompt of [SYSTEM_PROMPT,ANSWER_PROMPT,ADVICE_PROMPT]){assert.ok(!/[\u0E00-\u0E7F]/.test(prompt));assert.match(prompt,/Thai/);}
});
for(const mode of ['responses','chat']) test(`SDK uses custom base URL and structured ${mode} output`,async t=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req) body+=chunk;
    const json=JSON.parse(body);requests.push({url:req.url,body:json});
    const structured=Boolean(json.text?.format || json.response_format);
    const text=structured?JSON.stringify(plan()):'รายจ่ายรวม 60 บาท';
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(mode==='responses'?{
      id:'resp_test',object:'response',status:'completed',output:[{type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]
    }:{id:'chat_test',object:'chat.completion',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:text,refusal:null}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const llm=createLlm({OPENAI_API_KEY:'test-key',OPENAI_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,OPENAI_API_MODE:mode,OPENAI_MODEL:'test-model'});
  assert.equal((await llm.plan({text:'จ่ายค่ากาแฟ 60',localNow:'2026-10-13 12:00:00',pending:null})).intent,'record');
  assert.equal(await llm.answer({question:'รวมเท่าไร',result:{total_count:1}}),'รายจ่ายรวม 60 บาท');
  const context={topic:'health',health:{weight_comparison:{latest:{weight_kg:'65.200'},previous:null,change_kg:null}}};
  await llm.advise({question:'แนะนำด้านสุขภาพหน่อย',context});
  const advice=requests[2].body.messages ?? requests[2].body.input;
  assert.equal(advice[0].content,ADVICE_PROMPT);
  assert.deepEqual(JSON.parse(advice[1].content).context,context);
  assert.equal(requests[0].url,mode==='responses'?'/v1/responses':'/v1/chat/completions');
  assert.equal(requests[0].body.store,false);
});
