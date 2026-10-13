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
  const fields=['type','title','details','amount','category','quantity','unit','duration_minutes','calories','calories_source','calorie_note','weight_kg','occurred_at'];
  for(const [index,record] of records.entries()) {
    await connection.execute(`INSERT INTO entries (line_user_id, event_id, item_index, ${fields.join(', ')}) VALUES (${Array(fields.length+3).fill('?').join(', ')})`,
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
  const [rows]=await connection.execute(`SELECT id, type, title, details, amount, category, quantity, unit, duration_minutes, calories, calories_source, calorie_note, weight_kg, occurred_at, entry_date, entry_time, entry_year, entry_month, entry_day, weekday_text FROM entries WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`,params);
  const [summary]=await connection.execute(`SELECT type, COUNT(*) AS count, SUM(amount) AS amount_total,
    SUM(duration_minutes) AS minutes_total, SUM(calories) AS calories_total, COUNT(calories) AS calories_known_count,
    SUM(calories_source = 'estimated') AS calories_estimated_count, SUM(calories IS NULL) AS calories_unknown_count
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
    context.health={date_from:dateFrom,date_to:today,food,exercise,weight,
      weight_comparison:compareWeights(weight.rows,localNow)};
  }
  return context;
}
export async function getDailyTotals(connection,userId,date) {
  const [rows]=await connection.execute(`SELECT type, SUM(amount) AS amount_total, SUM(calories) AS calories_total,
    SUM(calories_source = 'estimated') AS estimated_count, SUM(calories IS NULL) AS unknown_count
    FROM entries WHERE line_user_id = ? AND entry_date = ? AND type IN ('income','expense','food') GROUP BY type`,[userId,date]);
  const expense=rows.find(r=>r.type==='expense'),food=rows.find(r=>r.type==='food');
  return {date,expense_total:expense?.amount_total ?? '0.00',food_calories_total:food?.calories_total ?? '0.00',
    food_estimated_count:Number(food?.estimated_count ?? 0),food_unknown_count:Number(food?.unknown_count ?? 0)};
}

export function compareWeights(rows,localNow) {
  const latest=rows[0] ?? null;
  const previous=latest ? rows.find(r=>r.entry_date<latest.entry_date) ?? null : null;
  const age=latest ? Math.max(0,Math.floor((Date.parse(localNow.slice(0,10)+'T00:00:00Z')-Date.parse(latest.entry_date+'T00:00:00Z'))/86400000)) : null;
  return {latest,previous,change_kg:previous?Number((Number(latest.weight_kg)-Number(previous.weight_kg)).toFixed(3)):null,
    days_since_update:age,is_stale:age!==null && age>=7,stale_after_days:7};
}

export async function getWeightContext(connection,userId,localNow) {
  const [rows]=await connection.execute(`SELECT weight_kg, occurred_at, entry_date FROM entries
    WHERE line_user_id = ? AND type = 'weight' AND occurred_at <= ? ORDER BY occurred_at DESC, id DESC LIMIT 10`,[userId,localNow]);
  return compareWeights(rows,localNow);
}

export async function getOverviewContext(connection,userId,q,localNow) {
  const filters={...q,type:null,mode:'summary',category:null,keyword:null};
  const result=await queryRecords(connection,userId,filters);
  const {where,params}=filter(userId,filters);
  // Sample each type separately so many expense records cannot hide food/weight.
  const [samples]=await connection.execute(`SELECT type, title, details, amount, category, quantity, unit,
    duration_minutes, calories, calories_source, calorie_note, weight_kg, occurred_at, entry_date FROM (
    SELECT entries.*, ROW_NUMBER() OVER (PARTITION BY type ORDER BY occurred_at DESC, id DESC) AS sample_number
    FROM entries WHERE ${where}) AS ranked WHERE sample_number <= 5 ORDER BY type, occurred_at DESC`,params);
  return {as_of:localNow,period:filters,result,samples,sample_limit_per_type:5,
    weight_context:await getWeightContext(connection,userId,localNow)};
}
export const repository={insertRecords,deleteLatest,queryRecords,getAdviceContext,getDailyTotals,getWeightContext,getOverviewContext};
