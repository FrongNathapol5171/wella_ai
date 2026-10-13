import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, InputError } from '../src/validation.js';
import { localTimestamp, validDate } from '../src/time.js';
import { readConfig } from '../src/config.js';
import { plan, record, query } from './helpers.js';

test('Thai timezone handles day rollover and rejects invalid calendar dates',()=>{
  assert.equal(localTimestamp(Date.parse('2026-10-12T18:30:00Z')),'2026-10-13 01:30:00');
  assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2024-02-29'),true);
});
test('food defaults to exactly one generic unit without details or invented calories',()=>{
  const p=validatePlan(plan({records:[record({type:'food',title:'ข้าวผัด',amount:null,category:null,source_quote:'กินข้าวผัด'})]}),'กินข้าวผัด');
  assert.equal(p.records[0].quantity,1);assert.equal(p.records[0].unit,'หน่วย');assert.equal(p.records[0].details,null);
});
test('all five record types and explicit optional fields are accepted',()=>{
  const records=[record(),record({type:'income',title:'เงินเดือน',amount:30000,category:'เงินเดือน',source_quote:'รับเงินเดือน 30,000'}),
    record({type:'food',title:'ส้มตำ',details:'ไม่เผ็ด',amount:null,category:null,quantity:2,unit:'จาน',source_quote:'กินส้มตำ 2 จาน ไม่เผ็ด'}),
    record({type:'exercise',title:'วิ่ง',amount:null,category:null,duration_minutes:60,calories:300,source_quote:'วิ่ง 1 ชั่วโมง 300 แคล'}),
    record({type:'weight',title:'น้ำหนัก',amount:null,category:null,weight_kg:65.2,source_quote:'น้ำหนัก 65.2'})];
  assert.equal(validatePlan(plan({records}),records.map(r=>r.source_quote).join('\n')).records.length,5);
});
test('Thai digits are valid numerical evidence',()=>{
  assert.equal(validatePlan(plan({records:[record({source_quote:'จ่ายค่ากาแฟ ๖๐'})]}),'จ่ายค่ากาแฟ ๖๐').records[0].amount,60);
});
for(const [name,overrides] of [
  ['invented amount',{amount:999}],['invented title',{title:'ชา'}],['invented detail',{details:'เย็น'}],
  ['unsupported source quote',{source_quote:'ซื้อกาแฟ 60'}],['irrelevant calories',{calories:60}],
  ['impossible date',{occurred_at:'2026-02-30 00:00:00'}],['missing amount',{amount:null}]
]) test(`rejects ${name}`,()=>assert.throws(()=>validatePlan(plan({records:[record(overrides)]}),'จ่ายค่ากาแฟ 60'),InputError));
test('rejects mixed actions and missing exercise duration',()=>{
  assert.throws(()=>validatePlan(plan({query:query()}),'จ่ายค่ากาแฟ 60'),InputError);
  assert.throws(()=>validatePlan(plan({records:[record({type:'exercise',title:'วิ่ง',amount:null,category:null,source_quote:'วิ่ง'})]}),'วิ่ง'),InputError);
});
test('only explicit scoped numeric deletion is accepted',()=>{
  const p=plan({intent:'delete',records:[],deletion:{type:'expense',count:3}});
  assert.equal(validatePlan(p,'ลบรายจ่ายล่าสุด 3 แถว').deletion.count,3);
  for(const text of ['ลบล่าสุด 3 แถว','ลบรายรับล่าสุด 3 แถว','ลบรายจ่ายทั้งหมด 3 แถว','รายจ่าย 3 แถว','ลบรายจ่ายล่าสุด'])
    assert.throws(()=>validatePlan(p,text),InputError);
});
test('invalid query ranges are rejected',()=>{
  assert.throws(()=>validatePlan(plan({intent:'query',records:[],query:query({date_from:'2026-10-14',date_to:'2026-10-13'})}),'ดูรายการ'),InputError);
});
test('advice is read-only and cannot be mixed with writes, queries, or deletion',()=>{
  const p=plan({intent:'advice',records:[],advice_topic:'health'});
  assert.equal(validatePlan(p,'แนะนำด้านสุขภาพหน่อย').advice_topic,'health');
  for(const overrides of [{records:[record()]},{query:query()},{deletion:{type:'expense',count:1}},{advice_topic:null}])
    assert.throws(()=>validatePlan({...p,...overrides},'แนะนำหน่อย'),InputError);
});
test('custom URL is validated and defaults correctly',()=>{
  const env={LINE_CHANNEL_SECRET:'s',LINE_CHANNEL_ACCESS_TOKEN:'t',OPENAI_API_KEY:'k',MYSQL_HOST:'localhost',MYSQL_USER:'root',MYSQL_DATABASE:'tracker'};
  assert.equal(readConfig(env).OPENAI_BASE_URL,'https://api.openai.com/v1');
  assert.equal(readConfig({...env,OPENAI_BASE_URL:'https://example.com/v1',OPENAI_API_MODE:'chat'}).OPENAI_API_MODE,'chat');
  assert.equal(readConfig({...env,OPENAI_BASE_URL:''}).OPENAI_BASE_URL,'https://api.openai.com/v1');
  assert.throws(()=>readConfig({...env,OPENAI_BASE_URL:'file:///tmp/api'}));
  assert.throws(()=>readConfig({...env,MYSQL_DATABASE:'a`; DROP DATABASE x'}));
});
