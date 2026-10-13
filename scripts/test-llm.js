import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { createLlm } from '../src/llm.js';
import { validatePlan } from '../src/validation.js';
const config=readConfig(),llm=createLlm(config);
const cases=[
  ['จ่ายค่ากาแฟ 60 บาท','record','expense'],['รับเงินเดือน 30000 บาท','record','income'],
  ['กินข้าวผัด','record','food'],['วิ่ง 30 นาที','record','exercise'],['น้ำหนัก 65.2','record','weight'],
  ['วิ่ง','clarify'],['จ่ายค่ากาแฟ','clarify'],['เดือนนี้จ่ายไปเท่าไร','query'],['ลบรายจ่ายล่าสุด 3 แถว','delete'],
  ['พรุ่งนี้จะกินข้าวผัด','chat'],['ไม่ได้กินข้าวผัด','chat'],
  ['แนะนำด้านการเงินหน่อย','advice'],['แนะนำด้านสุขภาพหน่อย','advice'],
  ['ช่วยทำอะไรได้บ้าง','help'],['มีฟังก์ชั่นอะไรบ้าง','help'],['สรุปวันนี้','overview'],['สรุปเดือนนี้','overview']
];
for(const [text,intent,type] of cases) {
  const p=validatePlan(await llm.plan({text,pending:null,localNow:'2026-10-13 12:00:00'}),text);
  assert.equal(p.intent,intent,text);
  if(type) assert.equal(p.records[0].type,type,text);
  if(type==='food'){assert.equal(p.records[0].quantity,1);assert.equal(p.records[0].unit,'หน่วย');assert.equal(p.records[0].details,null);}
  if(type==='exercise') assert.equal(p.records[0].calories,null);
  console.log('PASS:',text);
}
console.log('Live LLM smoke tests passed (no database writes)');
