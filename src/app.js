import express from 'express';
import { verifySignature,LineReplyError } from './line.js';
export function createApp({config,db,service,line,logger=console}) {
  const app=express();app.disable('x-powered-by');
  app.get('/health',(_req,res)=>res.json({ok:true}));
  app.get('/ready',async(_req,res)=>{
    try{await db.ping();res.json({ok:true});}catch{res.status(503).json({ok:false});}
  });
  app.post('/webhook',express.raw({type:'*/*',limit:'256kb'}),async(req,res)=>{
    if(!verifySignature(req.body,req.get('x-line-signature'),config.LINE_CHANNEL_SECRET)) return res.status(401).json({error:'Invalid signature'});
    let payload;
    try{payload=JSON.parse(req.body.toString('utf8'));}catch{return res.status(400).json({error:'Invalid JSON'});}
    if(!payload || !Array.isArray(payload.events)) return res.status(400).json({error:'Invalid events'});
    const groups=new Map();
    for(const event of payload.events) {
      if(!event || event.type!=='message' || !event.replyToken || event.mode==='standby') continue;
      // Personal records are never returned to a shared group/room.
      if(event.source?.type!=='user' || !event.source.userId) continue;
      const events=groups.get(event.source.userId) || [];events.push(event);groups.set(event.source.userId,events);
    }
    let failed=false;
    await Promise.all([...groups.values()].map(async events=>{
      for(const event of events) {
        try {
          if(event.message?.type!=='text') {await line.reply(event.replyToken,'ขอเป็นข้อความนะคะ พิมพ์รายการการเงินหรือสุขภาพที่อยากบันทึกได้เลยค่ะ');continue;}
          if(typeof event.message.text!=='string' || !event.message.text.trim() || event.message.text.length>5000 || !Number.isFinite(event.timestamp) || (!event.webhookEventId && !event.message.id)) {
            await line.reply(event.replyToken,'รบกวนส่งข้อความอีกครั้ง โดยไม่เกิน 5,000 ตัวอักษรนะคะ');continue;
          }
          const result=await service.process(event);
          if(result.shouldReply) {
            try{await line.reply(event.replyToken,result.reply);}
            catch(error){
              if(result.duplicate && error instanceof LineReplyError && error.status===400) continue;
              throw error;
            }
            await db.markReplied(result.eventId,result.userId);
          }
        }catch(error){
          logger.error('Webhook processing failed',{code:error.code || error.name || 'Error'});
          // A failure never claims that a transaction was saved. A committed event
          // remains deduplicated if LINE redelivers it after a reply failure.
          if(!(error instanceof LineReplyError)) {
            try { await line.reply(event.replyToken,'ตอนนี้ประมวลผลไม่สำเร็จค่ะ รบกวนลองใหม่อีกครั้งภายหลังนะคะ'); }
            catch { /* Still request redelivery when either provider is unavailable. */ }
          }
          failed=true;break;
        }
      }
    }));
    // Non-2xx allows LINE to redeliver; transactions commit before replies.
    return res.status(failed?503:200).json({ok:!failed});
  });
  app.use((error,_req,res,_next)=>res.status(error.type==='entity.too.large'?413:500).json({error:'Request failed'}));
  return app;
}
