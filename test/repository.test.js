import test from 'node:test';
import assert from 'node:assert/strict';
import { queryRecords, deleteLatest, insertRecords, getAdviceContext, getDailyTotals, compareWeights } from '../src/repository.js';
import { query, record } from './helpers.js';
test('every query is parameterized and user-scoped including all aggregates',async()=>{
  const calls=[];
  const connection={execute:async(sql,params)=>{calls.push({sql,params});return [[]];}};
  const keyword="' OR 1=1 --";
  const result=await queryRecords(connection,'user-A',query({keyword,date_from:'2026-10-01',type:'expense'}));
  assert.equal(result.total_count,0);assert.equal(calls.length,4);
  for(const {sql,params} of calls){assert.match(sql,/WHERE line_user_id = \?/);assert.equal(params[0],'user-A');assert.ok(!sql.includes(keyword));assert.ok(params.includes(keyword));}
});
test('latest deletion scopes user and type and returns actual row count',async()=>{
  let call;
  const connection={execute:async(sql,params)=>{call={sql,params};return [{affectedRows:2}];}};
  assert.equal(await deleteLatest(connection,'user-A',{type:'expense',count:3}),2);
  assert.match(call.sql,/WHERE line_user_id = \? AND type = \? ORDER BY id DESC LIMIT 3/);
  assert.deepEqual(call.params,['user-A','expense']);
});
test('all inserts include trusted user and event IDs',async()=>{
  const calls=[];const connection={execute:async(sql,params)=>{calls.push({sql,params});return [{}];}};
  assert.equal(await insertRecords(connection,'user-A','event-1',[record(),record()]),2);
  assert.equal(calls[0].params.length,19);assert.deepEqual(calls[1].params.slice(0,3),['user-A','event-1',1]);
});
test('finance context scopes only income and expenses to the current calendar month',async()=>{
  const calls=[];const connection={execute:async(sql,params)=>{calls.push({sql,params});return [[]];}};
  const context=await getAdviceContext(connection,'user-A',{topic:'finance',localNow:'2026-10-13 12:00:00'});
  assert.equal(context.health,null);assert.equal(context.finance.date_from,'2026-10-01');assert.equal(context.finance.date_to,'2026-10-13');
  for(const {sql,params} of calls){assert.match(sql,/WHERE line_user_id = \?/);assert.equal(params[0],'user-A');assert.ok(['income','expense'].includes(params[1]));assert.deepEqual(params.slice(2,4),['2026-10-01','2026-10-13']);}
});
test('health context includes a 30-day window and compares weights on different dates',async()=>{
  const calls=[];const weights=[
    {weight_kg:'65.200',entry_date:'2026-10-13'},
    {weight_kg:'65.400',entry_date:'2026-10-13'},
    {weight_kg:'66.000',entry_date:'2026-10-06'}
  ];
  const connection={execute:async(sql,params)=>{calls.push({sql,params});return [sql.startsWith('SELECT id') && params[1]==='weight'?weights:[]];}};
  const context=await getAdviceContext(connection,'user-A',{topic:'health',localNow:'2026-10-13 12:00:00'});
  assert.equal(context.finance,null);assert.equal(context.health.date_from,'2026-09-14');
  assert.equal(context.health.weight_comparison.change_kg,-0.8);assert.equal(context.health.weight_comparison.previous.entry_date,'2026-10-06');
  for(const {sql,params} of calls){assert.match(sql,/WHERE line_user_id = \?/);assert.equal(params[0],'user-A');assert.ok(['food','exercise','weight','2026-10-13'].includes(params[1]));}
});
test('single weight record does not invent a trend',async()=>{
  const connection={execute:async(sql,params)=>[sql.startsWith('SELECT id') && params[1]==='weight'?[{weight_kg:'65.200',entry_date:'2026-10-13'}]:[]]};
  const result=await getAdviceContext(connection,'user-A',{topic:'weight',localNow:'2026-10-13 12:00:00'});
  assert.equal(result.health.weight_comparison.previous,null);assert.equal(result.health.weight_comparison.change_kg,null);
});
test('daily totals include all matching rows and filter trusted user and local date',async()=>{
  let call;const connection={execute:async(sql,params)=>{call={sql,params};return [[
    {type:'expense',amount_total:'1234.56'}, {type:'food',calories_total:'1800.00',estimated_count:'2',unknown_count:'1'}
  ]];}};
  const totals=await getDailyTotals(connection,'user-A','2026-10-13');
  assert.deepEqual(call.params,['user-A','2026-10-13']);assert.match(call.sql,/line_user_id = \? AND entry_date = \?/);assert.ok(!call.sql.includes('LIMIT'));
  assert.equal(totals.food_calories_total,'1800.00');assert.equal(totals.expense_total,'1234.56');assert.equal(totals.food_estimated_count,2);
});
test('weight staleness means missing progress evidence, not a fabricated lack of progress',()=>{
  const result=compareWeights([{entry_date:'2026-10-01',weight_kg:'65.2'}],'2026-10-13 12:00:00');
  assert.equal(result.days_since_update,12);assert.equal(result.is_stale,true);assert.equal(result.change_kg,null);
  assert.equal(result.protein_target_g,97.8);assert.equal(compareWeights([],'2026-10-13 12:00:00').protein_target_g,null);
  assert.equal(compareWeights([],'2026-10-13 12:00:00').days_since_update,null);
});
