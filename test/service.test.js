import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/service.js';
import { event, plan, query, record } from './helpers.js';
import { HELP_REPLY } from '../src/help.js';
function setup({state={pending_text:null,pending_at:null},existing,planner=async()=>plan(),result={total_count:1},advisor}={}) {
  const calls=[];let saves=0,answers=0;
  const connection={execute:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT pending_text')) return [[state]];
    if(sql.startsWith('SELECT reply_text')) return [existing?[existing]:[]];
    return [{}];
  }};
  const repo={insertRecords:async(_c,u,_e,r)=>{assert.equal(u,'user-A');saves+=r.length;return r.length;},
    deleteLatest:async(_c,u)=>{assert.equal(u,'user-A');return 2;},queryRecords:async(_c,u)=>{assert.equal(u,'user-A');return result;},
    getAdviceContext:async(_c,u,options)=>{assert.equal(u,'user-A');return {topic:options.topic,as_of:options.localNow,records:result};}};
  const service=createService({db:{transaction:async work=>work(connection)},repo,llm:{plan:planner,advise:advisor,answer:async()=>{answers++;return 'รวม 60 บาท';}}});
  return {service,calls,get saves(){return saves;},get answers(){return answers;}};
}
test('save confirms only after repository success',async()=>{
  const s=setup();const r=await s.service.process(event());assert.equal(r.reply,'บันทึกเรียบร้อยค่ะ');assert.equal(s.saves,1);
  assert.ok(s.calls.some(c=>c.sql.startsWith('INSERT INTO webhook_events')));
});
test('replayed webhook does not call LLM or save again',async()=>{
  const s=setup({existing:{reply_text:'บันทึกเรียบร้อย',replied_at:'2026-10-13 05:00:01'},planner:()=>assert.fail('duplicate called LLM')});
  const r=await s.service.process(event());assert.equal(r.duplicate,true);assert.equal(r.shouldReply,false);assert.equal(s.saves,0);
});
test('unreplied committed event retries the cached reply without saving',async()=>{
  const s=setup({existing:{reply_text:'บันทึกเรียบร้อย',replied_at:null},planner:()=>assert.fail('duplicate called LLM')});
  assert.equal((await s.service.process(event())).shouldReply,true);assert.equal(s.saves,0);
});
test('clarification persists context and a follow-up can complete it',async()=>{
  const s=setup({planner:async()=>plan({intent:'clarify',records:[],reply:'กาแฟราคาเท่าไรคะ'})});
  assert.equal((await s.service.process(event())).reply,'กาแฟราคาเท่าไรคะ');assert.equal(s.saves,0);
  assert.equal(s.calls.find(c=>c.sql.startsWith('UPDATE user_state')).params[0],'จ่ายค่ากาแฟ 60');
  const followup=setup({state:{pending_text:'จ่ายค่ากาแฟ',pending_at:new Date().toISOString().slice(0,19).replace('T',' ')},planner:async input=>{
    assert.equal(input.pending,'จ่ายค่ากาแฟ');return plan({records:[record({source_quote:'จ่ายค่ากาแฟ\n60'})]});
  }});
  assert.equal((await followup.service.process(event({message:{type:'text',id:'m2',text:'60'}}))).reply,'บันทึกเรียบร้อยค่ะ');
});
test('validation prevents invented records and asks for input',async()=>{
  const s=setup({planner:async()=>plan({records:[record({amount:100})]})});
  const r=await s.service.process(event());assert.match(r.reply,/จำนวนเงิน/);assert.equal(s.saves,0);
});
test('queries answer from data and empty results skip LLM answering',async()=>{
  const planner=async()=>plan({intent:'query',records:[],query:query()});
  const s=setup({planner});assert.equal((await s.service.process(event())).reply,'รวม 60 บาท');assert.equal(s.answers,1);
  const empty=setup({planner,result:{total_count:0}});assert.match((await empty.service.process(event())).reply,/ไม่มีข้อมูล/);assert.equal(empty.answers,0);
});
test('deletion reply reports actual count and physical table',async()=>{
  const s=setup({planner:async()=>plan({intent:'delete',records:[],deletion:{type:'expense',count:3}})});
  const r=await s.service.process(event({message:{type:'text',id:'m1',text:'ลบรายจ่ายล่าสุด 3 แถว'}}));
  assert.match(r.reply,/2 แถว/);assert.match(r.reply,/entries/);assert.match(r.reply,/expense/);
});
test('provider failures abort processing before event success is stored',async()=>{
  const s=setup({planner:async()=>{throw new Error('provider unavailable');}});
  await assert.rejects(s.service.process(event()),/provider unavailable/);
  assert.ok(!s.calls.some(c=>c.sql.startsWith('INSERT INTO webhook_events')));
});
for(const topic of ['finance','health']) test(`requested ${topic} advice fetches trusted user context before answering`,async()=>{
  let advised=false;
  const s=setup({planner:async()=>plan({intent:'advice',records:[],advice_topic:topic}),advisor:async({question,context})=>{
    advised=true;assert.equal(context.topic,topic);assert.equal(context.as_of,'2026-10-13 12:00:00');
    assert.equal(context.records.total_count,1);assert.match(question,/แนะนำ/);return 'จากข้อมูลที่บันทึก ลองตั้งเป้าหมายเล็ก ๆ ที่ทำได้ต่อเนื่องนะคะ';
  }});
  const result=await s.service.process(event({message:{type:'text',id:'advice',text:'แนะนำหน่อย'}}));
  assert.equal(advised,true);assert.match(result.reply,/ตั้งเป้าหมาย/);assert.equal(s.saves,0);
});
test('coaching with empty history still reaches adviser without inventing records',async()=>{
  const s=setup({result:{total_count:0},planner:async()=>plan({intent:'advice',records:[],advice_topic:'health'}),advisor:async({context})=>{
    assert.equal(context.records.total_count,0);return 'ยังไม่มีประวัติสุขภาพค่ะ อยากดูแลสุขภาพด้านไหนเป็นหลักคะ';
  }});
  assert.match((await s.service.process(event())).reply,/ยังไม่มีประวัติ/);assert.equal(s.saves,0);
});
test('capabilities question returns the complete plain-text menu and preserves pending input',async()=>{
  const s=setup({state:{pending_text:'จ่ายค่ากาแฟ',pending_at:new Date().toISOString().slice(0,19).replace('T',' ')},
    planner:async()=>plan({intent:'help',records:[]})});
  const result=await s.service.process(event({message:{type:'text',id:'help',text:'ช่วยทำอะไรได้บ้าง'}}));
  assert.equal(result.reply,HELP_REPLY);assert.equal(s.saves,0);assert.equal(s.answers,0);
  assert.equal(s.calls.find(c=>c.sql.startsWith('UPDATE user_state')).params[0],'จ่ายค่ากาแฟ');
});
