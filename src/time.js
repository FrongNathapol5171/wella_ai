export function localTimestamp(timestamp, timeZone = 'Asia/Bangkok') {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date(timestamp)).map(v => [v.type,v.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export function validLocalDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const d = new Date(value.replace(' ','T') + 'Z');
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0,19).replace('T',' ') === value;
}
export const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && validLocalDateTime(value + ' 00:00:00');
export const typeLabels = {income:'รายรับ',expense:'รายจ่าย',food:'อาหาร',exercise:'ออกกำลังกาย',weight:'น้ำหนัก'};
