import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createLineClient, verifySignature } from '../src/line.js';
import { event } from './helpers.js';
const secret='test-secret';
const signature=body=>createHmac('sha256',secret).update(body).digest('base64');
async function appFor(t,overrides={}) {
  const seen=[],replies=[],marked=[];
  const app=createApp({config:{LINE_CHANNEL_SECRET:secret},db:{ping:async()=>{},markReplied:async(...args)=>marked.push(args)},
    service:{process:async e=>{seen.push(e);return {eventId:e.webhookEventId,userId:e.source.userId,reply:'บันทึกเรียบร้อย',shouldReply:true};}},
    line:{reply:async(...args)=>replies.push(args)},logger:{error(){}},...overrides});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}`;
  return {seen,replies,marked,url,post:async(events,signed=true)=>{
    const body=JSON.stringify({events});return fetch(url+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-line-signature':signed?signature(body):'invalid'},body});
  }};
}
test('signature authenticates exact bytes and rejects changes',()=>{
  const body=Buffer.from('{"events":[]}');assert.equal(verifySignature(body,signature(body),secret),true);
  assert.equal(verifySignature(Buffer.from('{ "events":[]}'),signature(body),secret),false);
});
test('valid empty verification request works and invalid signature cannot process',async t=>{
  const a=await appFor(t);assert.equal((await a.post([])).status,200);assert.equal((await a.post([event()],false)).status,401);assert.equal(a.seen.length,0);
  assert.equal((await fetch(a.url+'/health')).status,200);assert.equal((await fetch(a.url+'/ready')).status,200);
});
test('personal text processes and marks reply; group and room cannot access data',async t=>{
  const a=await appFor(t);
  assert.equal((await a.post([event(),event({source:{type:'group',userId:'user-A'}}),event({source:{type:'room',userId:'user-A'}})])).status,200);
  assert.equal(a.seen.length,1);assert.equal(a.replies.length,1);assert.deepEqual(a.marked[0],['event-1','user-A']);
});
test('unsupported non-text input receives guidance without saving',async t=>{
  const a=await appFor(t);await a.post([event({message:{type:'image',id:'m'}})]);assert.equal(a.seen.length,0);assert.match(a.replies[0][1],/ข้อความ/);
});
test('provider errors report failure and request webhook redelivery',async t=>{
  const a=await appFor(t,{service:{process:async()=>{throw new Error('DB offline');}}});
  assert.equal((await a.post([event()])).status,503);assert.equal(a.marked.length,0);assert.match(a.replies[0][1],/ไม่สำเร็จ/);
});
test('LINE client emits Thai text with bounded length',async()=>{
  let request;
  const client=createLineClient('token',async(url,options)=>{request={url,...options};return {ok:true};});
  await client.reply('reply','ก'.repeat(5000));const body=JSON.parse(request.body);
  assert.equal(body.messages[0].text.length,4500);assert.equal(request.headers.Authorization,'Bearer token');
});
test('LINE client sends plain text even if model returns Markdown',async()=>{
  let text;
  const client=createLineClient('token',async(_url,options)=>{text=JSON.parse(options.body).messages[0].text;return {ok:true};});
  await client.reply('reply','# สุขภาพ\n**น้ำหนัก** 65.2 กก.\n- ลองเพิ่มผักนะคะ\n1. เดินสบาย ๆ\n| รายการ | ค่า |\n| --- | --- |\n| น้ำหนัก | 65.2 |\n`บันทึก`');
  assert.ok(!/[#*`|]/.test(text));assert.ok(!/^\s*[-]|^\d+\.\s/m.test(text));assert.match(text,/65\.2 กก\./);assert.match(text,/น้ำหนัก \/ 65\.2/);
});
