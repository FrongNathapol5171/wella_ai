const amount=value=>String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1').replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function recordFeedback(records,totals) {
  const lines=[records.length===1?'บันทึกเรียบร้อยค่ะ':`บันทึกเรียบร้อย ${records.length} รายการค่ะ`];
  for(const r of records) {
    if(r.calories_source==='estimated') lines.push(`${r.title}: ประเมิน ${amount(r.calories)} kcal ค่ะ\n${r.calorie_note}`);
    else if(r.type==='exercise' && r.calories===null) lines.push(`${r.title}: ยังประเมินแคลที่เผาผลาญไม่ได้ค่ะ ลองระบุน้ำหนักและความหนักของกิจกรรมเพิ่มนะคะ`);
  }
  if(totals && records.some(r=>r.type==='income' || r.type==='expense'))
    lines.push(`วันนี้ (${totals.date}) ใช้จ่ายจากที่บันทึกรวม ${amount(totals.expense_total)} บาทค่ะ`);
  if(totals && records.some(r=>r.type==='food')) {
    const estimated=totals.food_estimated_count>0?'ประมาณ ':'';
    lines.push(`วันนี้ (${totals.date}) กินจากที่บันทึกรวม ${estimated}${amount(totals.food_calories_total)} kcal ค่ะ`);
    if(totals.food_estimated_count>0) lines.push(`ยอดนี้มีค่าประเมิน ${totals.food_estimated_count} รายการ ปริมาณจริงอาจต่างจากที่ประเมินค่ะ`);
    if(totals.food_unknown_count>0) lines.push(`ยังมีอาหาร ${totals.food_unknown_count} รายการที่ไม่ทราบแคล ยอดรวมจึงยังไม่ครบค่ะ`);
  }
  return lines.join('\n\n');
}
