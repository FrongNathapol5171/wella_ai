import { InputError, validatePlan } from './validation.js';
import { localTimestamp, typeLabels } from './time.js';
import { repository } from './repository.js';
import { HELP_REPLY } from './help.js';
import { recordFeedback } from './record-feedback.js';
import { calorieEstimateSchema } from './schema.js';
export function createService({db,llm,timeZone='Asia/Bangkok',repo=repository}) {
  return {
    async process(event) {
      const userId=event.source.userId,eventId=event.webhookEventId || `message:${event.message.id}`,text=event.message.text;
      const signal=AbortSignal.timeout(45000);
      return db.transaction(async connection=>{
        // Serialize each user's events across all serverless instances using a row lock.
        await connection.execute('INSERT IGNORE INTO user_state (line_user_id) VALUES (?)',[userId]);
        const [[state]]=await connection.execute('SELECT pending_text, pending_at FROM user_state WHERE line_user_id = ? FOR UPDATE',[userId]);
        const [[existing]]=await connection.execute('SELECT reply_text, replied_at FROM webhook_events WHERE event_id = ? AND line_user_id = ?',[eventId,userId]);
        if(existing) return {eventId,userId,reply:existing.reply_text,shouldReply:!existing.replied_at,duplicate:true};
        const age=state.pending_at ? Date.now()-new Date(state.pending_at.replace(' ','T')+'Z').valueOf() : Infinity;
        const pending=age>=0 && age<30*60000 ? state.pending_text : null;
        let reply,nextPending=null;
        try {
          const plan=validatePlan(await llm.plan({text,pending,localNow:localTimestamp(event.timestamp,timeZone),signal}),pending?pending+'\n'+text:text);
          switch(plan.intent) {
            case 'help': reply=HELP_REPLY;nextPending=pending;break;
            case 'record': {
              const localNow=localTimestamp(event.timestamp,timeZone);
              const missing=plan.records.map((r,index)=>({...r,index})).filter(r=>(['food','exercise'].includes(r.type) && r.calories===null) || (r.type==='food' && r.protein_grams===null));
              if(missing.length && llm.estimateCalories) {
                const weight=missing.some(r=>r.type==='exercise')?await repo.getWeightContext(connection,userId,localNow):null;
                try {
                  const estimates=calorieEstimateSchema.parse(await llm.estimateCalories({records:missing,weight,signal}));
                  const seen=new Set();
                  for(const item of estimates.items) {
                    if(seen.has(item.index) || !missing.some(r=>r.index===item.index)) throw new Error('Invalid estimate index');
                    seen.add(item.index);
                    if(item.calories!==null && !item.note?.trim()) throw new Error('Missing calorie assumptions');
                    const record=plan.records[item.index];
                    if(item.protein_grams!==null && (record.type!=='food' || !item.protein_note?.trim())) throw new Error('Invalid protein estimate');
                  }
                  for(const item of estimates.items) {
                    const record=plan.records[item.index];
                    if(item.calories!==null && record.calories===null) Object.assign(record,{calories:Math.round(item.calories),calories_source:'estimated',calorie_note:item.note});
                    if(item.protein_grams!==null && record.protein_grams===null) Object.assign(record,{protein_grams:Math.round(item.protein_grams*100)/100,protein_source:'estimated',protein_note:item.protein_note});
                  }
                } catch { /* Save the actual record even if optional estimation fails; never store zero as unknown. */ }
              }
              await repo.insertRecords(connection,userId,eventId,plan.records);
              const needsTotals=plan.records.some(r=>['income','expense','food','weight'].includes(r.type));
              const totals=needsTotals?await repo.getDailyTotals(connection,userId,localNow.slice(0,10)):null;
              const weightContext=plan.records.some(r=>['food','weight'].includes(r.type))?await repo.getWeightContext(connection,userId,localNow):null;
              reply=recordFeedback(plan.records,totals,weightContext); break;
            }
            case 'delete': {
              const count=await repo.deleteLatest(connection,userId,plan.deletion);
              reply=`ลบ${typeLabels[plan.deletion.type]}ล่าสุด ${count} แถว จากตาราง entries (ประเภท ${plan.deletion.type}) เรียบร้อยค่ะ`;break;
            }
            case 'query': {
              const result=await repo.queryRecords(connection,userId,plan.query);
              reply=result.total_count===0?'ยังไม่มีข้อมูลในช่วงที่ถามค่ะ':await llm.answer({question:text,result,signal});break;
            }
            case 'overview': {
              const context=await repo.getOverviewContext(connection,userId,plan.query,localTimestamp(event.timestamp,timeZone));
              reply=await llm.overview({question:text,context,signal});break;
            }
            case 'advice': {
              const localNow=localTimestamp(event.timestamp,timeZone);
              const context=await repo.getAdviceContext(connection,userId,{topic:plan.advice_topic,localNow});
              reply=await llm.advise({question:text,context,signal});break;
            }
            case 'cancel': reply='ยกเลิกข้อความที่รอข้อมูลเพิ่มแล้วค่ะ';break;
            case 'clarify': nextPending=((pending?pending+'\n':'')+text).slice(-10000);reply=plan.reply || 'ขอรายละเอียดรายการที่จะบันทึกเพิ่มอีกนิดได้ไหมคะ';break;
            case 'chat': reply=plan.reply || 'Wella ช่วยดูแลเรื่องการเงินและสุขภาพให้ค่ะ พิมพ์รายรับ รายจ่าย อาหาร การออกกำลังกาย หรือน้ำหนักได้เลยนะคะ';break;
          }
        } catch(error) {
          if(!(error instanceof InputError)) throw error;
          reply=error.message+'ค่ะ';nextPending=((pending?pending+'\n':'')+text).slice(-10000);
        }
        await connection.execute('UPDATE user_state SET pending_text = ?, pending_at = IF(? IS NULL, NULL, UTC_TIMESTAMP()) WHERE line_user_id = ?',[nextPending,nextPending,userId]);
        await connection.execute('INSERT INTO webhook_events (event_id, line_user_id, reply_text) VALUES (?, ?, ?)',[eventId,userId,reply]);
        return {eventId,userId,reply,shouldReply:true,duplicate:false};
      });
    }
  };
}
