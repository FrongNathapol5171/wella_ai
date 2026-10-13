export const record = (overrides={}) => ({type:'expense',occurred_at:'2026-10-13 12:00:00',title:'กาแฟ',details:null,amount:60,
  category:'อาหาร',quantity:null,unit:null,duration_minutes:null,calories:null,weight_kg:null,source_quote:'จ่ายค่ากาแฟ 60',
  calories_source:overrides.calories!=null?'provided':null,calorie_note:null,
  protein_grams:null,protein_source:overrides.protein_grams!=null?'provided':null,protein_note:null,...overrides});
export const plan = (overrides={}) => ({intent:'record',records:[record()],query:null,advice_topic:null,deletion:null,reply:'',...overrides});
export const query = (overrides={}) => ({type:null,mode:'list',date_from:null,date_to:null,category:null,keyword:null,limit:10,...overrides});
export const event = (overrides={}) => ({type:'message',timestamp:Date.parse('2026-10-13T05:00:00Z'),webhookEventId:'event-1',replyToken:'reply-1',
  source:{type:'user',userId:'user-A'},message:{type:'text',id:'message-1',text:'จ่ายค่ากาแฟ 60'},...overrides});
