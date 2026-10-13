const amount=value=>String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1').replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function recordFeedback(records,totals) {
  const confirmation=records.length===1?'บันทึกเรียบร้อยค่ะ':`บันทึกเรียบร้อย ${records.length} รายการค่ะ`;
  const details=[],summary=[];
  for(const r of records) {
    if(r.calories_source==='estimated') details.push(`${r.title}: ประเมิน ${amount(r.calories)} kcal ค่ะ (${r.calorie_note})`);
    else if(r.type==='exercise' && r.calories===null) details.push(`${r.title}: ยังประเมินแคลไม่ได้ ขอข้อมูลน้ำหนักและความหนักของกิจกรรมเพิ่มนะคะ`);
  }
  if(totals && records.some(r=>r.type==='income' || r.type==='expense'))
    summary.push(`วันนี้ (${totals.date}) ใช้จ่ายจากที่บันทึกรวม ${amount(totals.expense_total)} บาทค่ะ`);
  if(totals && records.some(r=>r.type==='food')) {
    const estimated=totals.food_estimated_count>0?'ประมาณ ':'';
    summary.push(`วันนี้ (${totals.date}) กินจากที่บันทึกรวม ${estimated}${amount(totals.food_calories_total)} kcal ค่ะ`);
    if(totals.food_estimated_count>0) summary.push(`มีค่าประเมิน ${totals.food_estimated_count} รายการ อาจต่างจากปริมาณจริงค่ะ`);
    if(totals.food_unknown_count>0) summary.push(`อาหาร ${totals.food_unknown_count} รายการยังไม่ทราบแคล ยอดรวมจึงยังไม่ครบค่ะ`);
  }
  const blocks=[confirmation];
  if(details.length) blocks.push('รายละเอียด\n'+details.map(line=>'• '+line).join('\n'));
  if(summary.length) blocks.push('สรุปวันนี้\n'+summary.map(line=>'• '+line).join('\n'));
  return blocks.join('\n\n');
}
