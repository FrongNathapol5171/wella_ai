import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/config.js';
import { createDatabase, mysqlOptions, migrateCalories } from '../src/database.js';
import { insertRecords, queryRecords, deleteLatest, getAdviceContext, getDailyTotals, getOverviewContext } from '../src/repository.js';
import { createService } from '../src/service.js';
import { record, query, event, plan } from './helpers.js';

test('real MySQL: automatic schema, dates, isolation, deletion, rollback and deduplication',async()=>{
  // Always create an isolated test database; never delete or modify the configured app database.
  const database='line_tracker_test_'+randomBytes(8).toString('hex');
  const config=readConfig({...process.env,LINE_CHANNEL_SECRET:'test',LINE_CHANNEL_ACCESS_TOKEN:'test',OPENAI_API_KEY:'test',
    MYSQL_DATABASE:database,MYSQL_CREATE_DATABASE:'true'});
  const db=createDatabase(config);let admin,created=false;
  try {
    await db.init();created=true;await db.init();
    await db.transaction(async c=>{
      await c.query('ALTER TABLE entries DROP COLUMN calories_source, DROP COLUMN calorie_note');
      await c.execute("INSERT INTO entries (line_user_id,event_id,item_index,type,title,duration_minutes,calories,occurred_at) VALUES ('legacy-user','legacy',0,'exercise','walk',30,100,'2026-10-13 12:00:00')");
      await migrateCalories(c);await migrateCalories(c);
      const [[legacy]]=await c.execute("SELECT calories,calories_source FROM entries WHERE line_user_id = 'legacy-user'");
      assert.equal(legacy.calories,'100.00');assert.equal(legacy.calories_source,'provided');
    });
    await db.transaction(async c=>{
      await insertRecords(c,'user-A','expense-A',[record(),record({amount:90})]);
      await insertRecords(c,'user-B','expense-B',[record({amount:100})]);
      await insertRecords(c,'user-A','food-A',[record({type:'food',title:'ข้าวผัด',amount:null,category:null,quantity:1,unit:'หน่วย'})]);
      await insertRecords(c,'user-A','exercise-A',[record({type:'exercise',title:'วิ่ง',amount:null,category:null,duration_minutes:30})]);
      await insertRecords(c,'user-A','weight-A',[record({type:'weight',title:'น้ำหนัก',amount:null,category:null,weight_kg:65.2})]);
      await insertRecords(c,'user-A','weight-previous',[record({type:'weight',title:'น้ำหนัก',amount:null,category:null,weight_kg:66,occurred_at:'2026-10-06 12:00:00'})]);
      await insertRecords(c,'user-B','weight-B',[record({type:'weight',title:'น้ำหนัก',amount:null,category:null,weight_kg:80})]);
      const result=await queryRecords(c,'user-A',query({type:'expense'}));
      assert.equal(result.total_count,2);assert.equal(Number(result.summary[0].amount_total),150);
      assert.equal(result.rows[0].weekday_text,'อังคาร');assert.equal(result.rows[0].entry_date,'2026-10-13');
      assert.equal(result.rows[0].entry_month,10);assert.equal(result.rows[0].entry_day,13);assert.equal(result.rows[0].entry_time,'12:00:00');
      assert.equal(await deleteLatest(c,'user-A',{type:'expense',count:1}),1);
      assert.equal((await queryRecords(c,'user-B',query({type:'expense'}))).total_count,1);
      assert.equal((await queryRecords(c,'user-A',query({type:'expense'}))).rows[0].amount,'60.00');
    });
    await assert.rejects(db.transaction(async c=>{await insertRecords(c,'user-A','rollback',[record()]);throw new Error('rollback');}),/rollback/);
    await db.transaction(async c=>assert.equal((await queryRecords(c,'user-A',query({type:'expense'}))).total_count,1));
    let llmCalls=0;
    const service=createService({db,llm:{plan:async()=>{llmCalls++;return plan();}}});
    const incoming=event({webhookEventId:'dedupe-event'});
    const results=await Promise.all([service.process(incoming),service.process(incoming)]);
    assert.equal(llmCalls,1);assert.equal(results.filter(r=>r.duplicate).length,1);
    await db.markReplied('dedupe-event','user-A');assert.equal((await service.process(incoming)).shouldReply,false);
    await db.transaction(async c=>assert.equal((await queryRecords(c,'user-A',query({type:'expense'}))).total_count,2));
    const clarify=createService({db,llm:{plan:async()=>plan({intent:'clarify',records:[],reply:'กาแฟราคาเท่าไรคะ'})}});
    await clarify.process(event({webhookEventId:'clarify',message:{id:'c1',type:'text',text:'จ่ายค่ากาแฟ'}}));
    const complete=createService({db,llm:{plan:async input=>{
      assert.equal(input.pending,'จ่ายค่ากาแฟ');return plan({records:[record({source_quote:'จ่ายค่ากาแฟ\n60'})]});
    }}});
    assert.match((await complete.process(event({webhookEventId:'complete',message:{id:'c2',type:'text',text:'60'}}))).reply,/บันทึกเรียบร้อยค่ะ/);
    let before;
    await db.transaction(async c=>{
      const context=await getAdviceContext(c,'user-A',{topic:'all',localNow:'2026-10-13 12:00:00'});
      assert.equal(context.finance.income.total_count,0);
      assert.equal(Number(context.finance.expense.summary[0].amount_total),180);
      assert.equal(context.health.weight.total_count,2);
      assert.equal(context.health.weight_comparison.change_kg,-0.8);
      before=(await queryRecords(c,'user-A',query())).total_count;
    });
    const adviser=createService({db,llm:{
      plan:async()=>plan({intent:'advice',records:[],advice_topic:'health'}),
      advise:async({context})=>{
        assert.equal(context.finance,null);assert.equal(context.health.weight_comparison.change_kg,-0.8);
        assert.equal(context.health.food.total_count,1);assert.equal(context.health.exercise.total_count,1);
        return 'น้ำหนักที่บันทึกล่าสุด 65.2 กก. ค่ะ อยากเน้นดูแลสุขภาพด้านไหนคะ';
      }
    }});
    assert.match((await adviser.process(event({webhookEventId:'advice',message:{id:'a1',type:'text',text:'แนะนำด้านสุขภาพหน่อย'}}))).reply,/65\.2/);
    await db.transaction(async c=>assert.equal((await queryRecords(c,'user-A',query())).total_count,before));
    await db.transaction(async c=>{
      await insertRecords(c,'overview-user','many-expenses',Array.from({length:65},()=>record({amount:10})));
      await insertRecords(c,'overview-user','income',[record({type:'income',amount:1000})]);
      await insertRecords(c,'overview-user','foods',[
        record({type:'food',title:'ข้าวผัด',amount:null,category:null,quantity:2,unit:'จาน',calories:1200,calories_source:'estimated',calorie_note:'ขนาดทั่วไป 2 จาน'}),
        record({type:'food',title:'นม',amount:null,category:null,quantity:1,unit:'กล่อง',calories:100}),
        record({type:'food',title:'อาหาร',amount:null,category:null,quantity:1,unit:'หน่วย'})
      ]);
      await insertRecords(c,'overview-user','exercise',[record({type:'exercise',title:'วิ่ง',amount:null,category:null,duration_minutes:30,calories:300})]);
      await insertRecords(c,'overview-user','old-weight',[record({type:'weight',title:'น้ำหนัก',amount:null,category:null,weight_kg:65.2,occurred_at:'2026-09-01 12:00:00'})]);
      const totals=await getDailyTotals(c,'overview-user','2026-10-13');
      assert.equal(totals.expense_total,'650.00');assert.equal(totals.food_calories_total,'1300.00');assert.equal(totals.food_estimated_count,1);assert.equal(totals.food_unknown_count,1);
      const other=await getDailyTotals(c,'user-B','2026-10-13');assert.equal(other.expense_total,'100.00');assert.equal(other.food_calories_total,'0.00');
      const overview=await getOverviewContext(c,'overview-user',query({mode:'summary',date_from:'2026-10-13',date_to:'2026-10-13'}),'2026-10-13 12:00:00');
      assert.equal(overview.result.total_count,70);assert.equal(overview.result.summary.find(r=>r.type==='expense').amount_total,'650.00');
      assert.ok(overview.samples.some(r=>r.type==='food'));assert.equal(overview.samples.filter(r=>r.type==='expense').length,5);
      assert.equal(overview.weight_context.days_since_update,42);assert.equal(overview.weight_context.is_stale,true);
      assert.equal(overview.result.summary.some(r=>r.type==='weight'),false);
      await migrateCalories(c);
      assert.equal((await queryRecords(c,'overview-user',query({type:'food'}))).rows.find(r=>r.title==='ข้าวผัด').calories_source,'estimated');
    });
    const foodService=createService({db,llm:{
      plan:async()=>plan({records:[record({type:'food',title:'ข้าวผัด',amount:null,category:null,source_quote:'กินข้าวผัด'})]}),
      estimateCalories:async()=>({items:[{index:0,calories:600,note:'สมมติขนาดทั่วไป 1 ที่ค่ะ'}]})
    }});
    const foodEvent=event({webhookEventId:'food-feedback',message:{id:'ff1',type:'text',text:'กินข้าวผัด'}});
    assert.match((await foodService.process(foodEvent)).reply,/กินจากที่บันทึกรวม ประมาณ 600 kcal/);
    await foodService.process(foodEvent);
    await db.transaction(async c=>assert.equal((await getDailyTotals(c,'user-A','2026-10-13')).food_calories_total,'600.00'));
  } finally {
    await db.close();
    if(created) {
      assert.match(database,/^line_tracker_test_[a-f0-9]{16}$/);
      admin=await mysql.createConnection(mysqlOptions(config));
      try{await admin.query(`DROP DATABASE \`${database}\``);}finally{await admin.end();}
    }
  }
});
