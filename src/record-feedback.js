const amount=value=>String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1').replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function recordFeedback(records,totals,weightContext=null) {
  const confirmation=records.length===1?'บันทึกเรียบร้อยค่ะ':`บันทึกเรียบร้อย ${records.length} รายการค่ะ`;
  const details=[],summary=[];
  for(const r of records) {
    if(r.calories_source==='estimated') details.push(`${r.title}: ประเมิน ${amount(r.calories)} kcal ค่ะ (${r.calorie_note})`);
    else if(r.type==='exercise' && r.calories===null) details.push(`${r.title}: ยังประเมินแคลไม่ได้ ขอข้อมูลน้ำหนักและความหนักของกิจกรรมเพิ่มนะคะ`);
    if(r.type==='food' && r.protein_grams!==null) details.push(`${r.title}: โปรตีน${r.protein_source==='estimated'?'ประมาณ ': ' '}${amount(r.protein_grams)} กรัมค่ะ${r.protein_source==='estimated'?' ('+r.protein_note+')':''}`);
  }
  if(totals && records.some(r=>r.type==='income' || r.type==='expense'))
    summary.push(`วันนี้ (${totals.date}) ใช้จ่ายจากที่บันทึกรวม ${amount(totals.expense_total)} บาทค่ะ`);
  if(totals && records.some(r=>r.type==='food')) {
    const estimated=totals.food_estimated_count>0?'ประมาณ ':'';
    summary.push(`วันนี้ (${totals.date}) กินจากที่บันทึกรวม ${estimated}${amount(totals.food_calories_total)} kcal ค่ะ`);
    if(totals.food_estimated_count>0) summary.push(`มีค่าประเมิน ${totals.food_estimated_count} รายการ อาจต่างจากปริมาณจริงค่ะ`);
    if(totals.food_unknown_count>0) summary.push(`อาหาร ${totals.food_unknown_count} รายการยังไม่ทราบแคล ยอดรวมจึงยังไม่ครบค่ะ`);
  }
  if(totals && records.some(r=>['food','weight'].includes(r.type))) {
    const protein=Number(totals.food_protein_total_g ?? 0),estimated=(totals.food_protein_estimated_count ?? 0)>0;
    summary.push(`โปรตีนวันนี้${estimated?'ประมาณ ': ' '}${amount(protein)} กรัม จากที่บันทึกค่ะ`);
    if((totals.food_protein_unknown_count ?? 0)>0) summary.push(`ยังไม่ทราบโปรตีน ${totals.food_protein_unknown_count} รายการ ยอดรวมยังไม่ครบค่ะ`);
    const target=weightContext?.protein_target_g;
    if(target!==null && target!==undefined) {
      summary.push(`เป้าโปรตีนที่ตั้งไว้ ${amount(target)} กรัม/วัน (1.5 × ${amount(weightContext.latest.weight_kg)} กก.) ค่ะ`);
      const remaining=Math.max(0,Math.round((target-protein)*100)/100);
      summary.push(remaining>0?`จากที่บันทึก ยังเหลือ${estimated?'ประมาณ ': ' '}${amount(remaining)} กรัมถึงเป้าค่ะ`:'ยอดที่บันทึกถึงเป้าแล้วค่ะ');
      if(weightContext.is_stale) summary.push(`ใช้น้ำหนักวันที่ ${weightContext.latest.entry_date} ลองอัปเดตน้ำหนักเพื่อปรับเป้าให้ตรงนะคะ`);
    } else summary.push('บอกน้ำหนักล่าสุดเพื่อคำนวณเป้าโปรตีน 1.5 กรัม/กก. ได้เลยค่ะ');
  }
  const blocks=[confirmation];
  if(details.length) blocks.push('รายละเอียด\n'+details.map(line=>'• '+line).join('\n'));
  if(summary.length) blocks.push('สรุปวันนี้\n'+summary.map(line=>'• '+line).join('\n'));
  return blocks.join('\n\n');
}
