import { planSchema } from './schema.js';
import { validDate, validLocalDateTime } from './time.js';
export class InputError extends Error {}
export const normalizeDigits = value => value.replace(/[๐-๙]/g,ch=>String('๐๑๒๓๔๕๖๗๘๙'.indexOf(ch)));
function numbers(text) {
  return [...normalizeDigits(text).replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'').matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
}
function hasNumber(value,evidence,factor=1) { return numbers(evidence).some(n=>Math.abs(n*factor-value)<1e-8); }
function positive(value,name,max=999999999) {
  if (value===null || value<=0 || value>max) throw new InputError(`กรุณาระบุ${name}เป็นตัวเลขมากกว่า 0 และไม่เกิน ${max}`);
}
export function validatePlan(input,text) {
  const plan=planSchema.parse(input);
  if(plan.intent!=='advice' && plan.advice_topic!==null) throw new InputError('กรุณาแยกคำขอคำแนะนำจากคำสั่งบันทึกหรือค้นข้อมูล');
  if(plan.intent==='advice' && (!plan.advice_topic || plan.query || plan.deletion)) throw new InputError('กรุณาระบุด้านที่ต้องการคำแนะนำ เช่น การเงิน การกิน หรือสุขภาพ');
  if(plan.intent==='help' && (plan.query || plan.deletion)) throw new InputError('กรุณาแยกคำถามเกี่ยวกับฟังก์ชันจากคำสั่งค้นหาหรือลบข้อมูล');
  if (plan.intent!=='record' && plan.records.length) throw new InputError('ข้อความมีหลายคำสั่ง กรุณาแยกส่งทีละคำสั่ง');
  if (plan.intent==='record') {
    if (!plan.records.length || plan.query || plan.deletion) throw new InputError('กรุณาระบุรายการที่จะบันทึก');
    for (const r of plan.records) {
      if (!validLocalDateTime(r.occurred_at)) throw new InputError('กรุณาระบุวันและเวลาที่ถูกต้อง');
      if (!text.includes(r.source_quote)) throw new InputError('ข้อมูลไม่ตรงข้อความ กรุณาระบุรายการอีกครั้ง');
      if (r.type!=='weight' && !r.source_quote.includes(r.title)) throw new InputError('กรุณาระบุชื่อรายการให้ชัดเจน');
      if (r.details!==null && !r.source_quote.includes(r.details)) throw new InputError('รายละเอียดไม่ตรงข้อความ กรุณาส่งใหม่');
      const allowed={income:['amount','category'],expense:['amount','category'],food:['quantity','unit'],exercise:['duration_minutes','calories'],weight:['weight_kg']}[r.type];
      for (const field of ['amount','category','quantity','unit','duration_minutes','calories','weight_kg']) {
        if (!allowed.includes(field) && r[field]!==null) throw new InputError('พบข้อมูลผิดประเภท กรุณาส่งรายการอีกครั้ง');
      }
      if (['income','expense'].includes(r.type)) {
        positive(r.amount,'จำนวนเงิน');
        if (!hasNumber(r.amount,r.source_quote)) throw new InputError('กรุณาระบุจำนวนเงินเป็นตัวเลข');
        if (!r.category?.trim()) r.category='อื่นๆ';
      }
      if (r.type==='food') {
        r.quantity??=1; r.unit??='หน่วย'; positive(r.quantity,'จำนวนอาหาร');
        if (r.quantity!==1 && !hasNumber(r.quantity,r.source_quote)) throw new InputError('กรุณาระบุจำนวนอาหาร');
        if (r.unit!=='หน่วย' && !r.source_quote.includes(r.unit)) throw new InputError('กรุณาระบุหน่วยอาหาร');
      }
      if (r.type==='exercise') {
        positive(r.duration_minutes,'เวลาออกกำลังกาย (นาที)');
        if (!hasNumber(r.duration_minutes,r.source_quote) && !(/ชั่วโมง|hours?/.test(r.source_quote) && hasNumber(r.duration_minutes,r.source_quote,60))) throw new InputError('กรุณาระบุเวลาออกกำลังกาย');
        if (r.calories!==null && (r.calories<0 || !hasNumber(r.calories,r.source_quote))) throw new InputError('กรุณาระบุแคลอรี หรือไม่ระบุก็ได้');
      }
      if (r.type==='weight') {
        positive(r.weight_kg,'น้ำหนัก (กิโลกรัม)',9999999.999);
        if (!hasNumber(r.weight_kg,r.source_quote) && !(/(?<!กิโล)กรัม|grams?/.test(r.source_quote) && hasNumber(r.weight_kg,r.source_quote,0.001))) throw new InputError('กรุณาระบุน้ำหนักเป็นตัวเลข');
      }
    }
  }
  if (plan.intent==='query') {
    if (!plan.query || plan.deletion) throw new InputError('กรุณาระบุข้อมูลที่ต้องการดู');
    const q=plan.query;
    for (const d of [q.date_from,q.date_to]) if (d!==null && !validDate(d)) throw new InputError('กรุณาระบุวันที่ให้ถูกต้อง');
    if (q.date_from && q.date_to && q.date_from>q.date_to) throw new InputError('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  }
  if (plan.intent==='delete') {
    if (!plan.deletion || plan.query || !/ลบ|\bdelete\b/i.test(text) || !hasNumber(plan.deletion.count,text)) throw new InputError('กรุณาบอกประเภทและจำนวนที่จะลบ เช่น ลบรายจ่ายล่าสุด 3 แถว');
    const aliases={income:/รายรับ|income/i,expense:/รายจ่าย|expense/i,food:/อาหาร|food/i,exercise:/ออกกำลัง|exercise/i,weight:/น้ำหนัก|weight/i};
    if (!aliases[plan.deletion.type].test(text) || /ทั้งหมด|ทุกแถว|ทุกประเภท|all\b/i.test(text)) throw new InputError('กรุณาบอกประเภทและจำนวนล่าสุดที่จะลบให้ชัดเจน');
  }
  return plan;
}
