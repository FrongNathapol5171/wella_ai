function filter(userId,q) {
  const clauses=['line_user_id = ?'], params=[userId];
  if(q.type) {clauses.push('type = ?');params.push(q.type);}
  if(q.date_from) {clauses.push('entry_date >= ?');params.push(q.date_from);}
  if(q.date_to) {clauses.push('entry_date <= ?');params.push(q.date_to);}
  if(q.category) {clauses.push('category = ?');params.push(q.category);}
  if(q.keyword) {clauses.push('(LOCATE(?, title) > 0 OR LOCATE(?, COALESCE(details, \'\')) > 0)');params.push(q.keyword,q.keyword);}
  return {where:clauses.join(' AND '),params};
}
export async function insertRecords(connection,userId,eventId,records) {
  const fields=['type','title','details','amount','category','quantity','unit','duration_minutes','calories','weight_kg','occurred_at'];
  for(const [index,record] of records.entries()) {
    await connection.execute(`INSERT INTO entries (line_user_id, event_id, item_index, ${fields.join(', ')}) VALUES (${Array(14).fill('?').join(', ')})`,
      [userId,eventId,index,...fields.map(f=>record[f])]);
  }
  return records.length;
}
export async function deleteLatest(connection,userId,{type,count}) {
  const [result]=await connection.execute('DELETE FROM entries WHERE line_user_id = ? AND type = ? ORDER BY id DESC LIMIT '+String(count),[userId,type]);
  return result.affectedRows;
}
export async function queryRecords(connection,userId,q) {
  const {where,params}=filter(userId,q),limit=q.mode==='latest'?1:q.limit;
  const [rows]=await connection.execute(`SELECT id, type, title, details, amount, category, quantity, unit, duration_minutes, calories, weight_kg, occurred_at, entry_date, entry_time, entry_year, entry_month, entry_day, weekday_text FROM entries WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`,params);
  const [summary]=await connection.execute(`SELECT type, COUNT(*) AS count, SUM(amount) AS amount_total,
    SUM(duration_minutes) AS minutes_total, SUM(calories) AS calories_total, COUNT(calories) AS calories_known_count
    FROM entries WHERE ${where} GROUP BY type`,params);
  const [categories]=await connection.execute(`SELECT type, category, COUNT(*) AS count, SUM(amount) AS amount_total
    FROM entries WHERE ${where} AND type IN ('income','expense') GROUP BY type, category`,params);
  const [foodUnits]=await connection.execute(`SELECT unit, SUM(quantity) AS quantity_total FROM entries WHERE ${where} AND type = 'food' GROUP BY unit`,params);
  const total=summary.reduce((n,r)=>n+Number(r.count),0);
  return {rows,summary,categories,food_units:foodUnits,total_count:total,truncated:total>rows.length,filters:q};
}
export async function getAdviceContext(connection,userId,{topic,localNow}) {
  const today=localNow.slice(0,10);
  const start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-29);
  const context={topic,as_of:localNow,finance:null,health:null};
  const base={mode:'list',date_to:today,category:null,keyword:null,limit:10};
  if(topic==='finance' || topic==='all') {
    const monthStart=today.slice(0,7)+'-01';
    const income=await queryRecords(connection,userId,{...base,type:'income',date_from:monthStart});
    const expense=await queryRecords(connection,userId,{...base,type:'expense',date_from:monthStart});
    context.finance={date_from:monthStart,date_to:today,income,expense};
  }
  if(topic!=='finance') {
    const dateFrom=start.toISOString().slice(0,10);
    const food=await queryRecords(connection,userId,{...base,type:'food',date_from:dateFrom});
    const exercise=await queryRecords(connection,userId,{...base,type:'exercise',date_from:dateFrom});
    // Weight samples may be older than the activity window; include their dates
    // so the coach can distinguish recent trends from stale measurements.
    const weight=await queryRecords(connection,userId,{...base,type:'weight',date_from:null});
    const latest=weight.rows[0] ?? null;
    const previous=latest ? weight.rows.find(row=>row.entry_date<latest.entry_date) ?? null : null;
    const change=latest && previous ? Number((Number(latest.weight_kg)-Number(previous.weight_kg)).toFixed(3)) : null;
    context.health={date_from:dateFrom,date_to:today,food,exercise,weight,
      weight_comparison:{latest,previous,change_kg:change}};
  }
  return context;
}
export const repository={insertRecords,deleteLatest,queryRecords,getAdviceContext};
