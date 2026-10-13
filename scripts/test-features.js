import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { createLlm } from '../src/llm.js';
import { validatePlan } from '../src/validation.js';
import { formatLineText } from '../src/plain-text.js';
const llm=createLlm(readConfig());
const localNow='2026-10-13 12:00:00';
const text='กินข้าวผัด 2 จาน และวิ่ง 30 นาที';
const p=validatePlan(await llm.plan({text,pending:null,localNow}),text);
assert.equal(p.intent,'record');assert.equal(p.records.length,2);
assert.ok(p.records.every(r=>r.calories===null && r.calories_source===null));
const weight={latest:{weight_kg:'65.200',entry_date:'2026-10-13'},previous:null,change_kg:null,is_stale:false,days_since_update:0};
const estimates=await llm.estimateCalories({records:p.records.map((r,index)=>({...r,index})),weight});
assert.deepEqual(estimates.items.map(r=>r.index).sort(),[0,1]);
for(const item of estimates.items){assert.ok(item.calories>0);assert.ok(item.note?.length>0);}
console.log('PASS: food/exercise extraction and labelled calorie estimates');
const question='สรุปวันนี้';
const overview=validatePlan(await llm.plan({text:question,pending:null,localNow}),question);
assert.equal(overview.intent,'overview');assert.equal(overview.query.type,null);
assert.equal(overview.query.date_from,'2026-10-13');assert.equal(overview.query.date_to,'2026-10-13');
const context={as_of:localNow,period:overview.query,
  result:{total_count:7,rows:[],summary:[
    {type:'income',count:1,amount_total:'1000.00'},
    {type:'expense',count:2,amount_total:'650.00'},
    {type:'food',count:3,calories_total:'1300.00',calories_estimated_count:1,calories_unknown_count:1},
    {type:'exercise',count:1,minutes_total:'30.00',calories_total:'300.00',calories_estimated_count:0,calories_unknown_count:0}
  ],categories:[],food_units:[],truncated:true},samples:[],sample_limit_per_type:5,
  weight_context:{latest:{weight_kg:'65.200',entry_date:'2026-09-01'},previous:null,change_kg:null,days_since_update:42,is_stale:true,stale_after_days:7}};
const reply=formatLineText(await llm.overview({question,context}));
assert.ok(reply.includes('\n\n'));
assert.match(reply.replace(/,/g,''),/1300/);assert.match(reply,/ประมาณ|ประเมิน/);assert.match(reply,/อัปเดต|ชั่ง|วัด/);
assert.ok(!/[#*`|]/.test(reply));
console.log('PASS: all-type overview, approximate food energy, weight-update reminder and LINE layout');
console.log(reply);
console.log('Live feature checks passed (synthetic data only; no database writes or LINE messages)');
