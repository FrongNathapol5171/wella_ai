import { InputError, validatePlan } from './validation.js';
import { localTimestamp, typeLabels } from './time.js';
import { repository } from './repository.js';
import { HELP_REPLY } from './help.js';
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
              const count=await repo.insertRecords(connection,userId,eventId,plan.records);
              reply=count===1?'บันทึกเรียบร้อยค่ะ':`บันทึกเรียบร้อย ${count} รายการค่ะ`; break;
            }
            case 'delete': {
              const count=await repo.deleteLatest(connection,userId,plan.deletion);
              reply=`ลบ${typeLabels[plan.deletion.type]}ล่าสุด ${count} แถว จากตาราง entries (ประเภท ${plan.deletion.type}) เรียบร้อยค่ะ`;break;
            }
            case 'query': {
              const result=await repo.queryRecords(connection,userId,plan.query);
              reply=result.total_count===0?'ยังไม่มีข้อมูลในช่วงที่ถามค่ะ':await llm.answer({question:text,result,signal});break;
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
