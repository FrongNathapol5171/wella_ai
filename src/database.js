import mysql from 'mysql2/promise';
export const DDL=[
  `CREATE TABLE IF NOT EXISTS user_state (
    line_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    pending_text TEXT NULL, pending_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    line_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reply_text TEXT NOT NULL, replied_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_events_user (line_user_id,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    line_user_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, item_index SMALLINT UNSIGNED NOT NULL,
    type ENUM('income','expense','food','exercise','weight') NOT NULL,
    title VARCHAR(255) NOT NULL, details TEXT NULL, amount DECIMAL(15,2) NULL, category VARCHAR(100) NULL,
    quantity DECIMAL(12,3) NULL, unit VARCHAR(50) NULL, duration_minutes DECIMAL(12,2) NULL,
    calories DECIMAL(12,2) NULL, calories_source ENUM('provided','estimated') NULL, calorie_note VARCHAR(500) NULL,
    protein_grams DECIMAL(12,2) NULL, protein_source ENUM('provided','estimated') NULL, protein_note VARCHAR(500) NULL,
    weight_kg DECIMAL(10,3) NULL, occurred_at DATETIME NOT NULL,
    entry_date DATE GENERATED ALWAYS AS (DATE(occurred_at)) STORED,
    entry_time TIME GENERATED ALWAYS AS (TIME(occurred_at)) STORED,
    entry_year SMALLINT GENERATED ALWAYS AS (YEAR(occurred_at)) STORED,
    entry_month TINYINT GENERATED ALWAYS AS (MONTH(occurred_at)) STORED,
    entry_day TINYINT GENERATED ALWAYS AS (DAYOFMONTH(occurred_at)) STORED,
    weekday_text VARCHAR(20) GENERATED ALWAYS AS (
      CASE DAYOFWEEK(occurred_at) WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร'
      WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์' WHEN 7 THEN 'เสาร์' END
    ) STORED,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event_item (event_id,item_index),
    INDEX idx_user_type_date (line_user_id,type,occurred_at,id), INDEX idx_user_date (line_user_id,occurred_at,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];
export function mysqlOptions(config) {
  return {
    host:config.MYSQL_HOST,port:config.MYSQL_PORT,user:config.MYSQL_USER,password:config.MYSQL_PASSWORD,
    charset:'utf8mb4',timezone:'Z',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,connectTimeout:10000,
    ...(config.MYSQL_SSL ? {ssl:{rejectUnauthorized:true,...(config.MYSQL_SSL_CA ? {ca:config.MYSQL_SSL_CA.replace(/\\n/g,'\n')} : {})}} : {})
  };
}
export function createDatabase(config) {
  let pool, initialization;
  async function init() {
    if (!initialization) initialization=(async()=>{
      if (config.MYSQL_CREATE_DATABASE) {
        const bootstrap=await mysql.createConnection(mysqlOptions(config));
        try { await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
        finally { await bootstrap.end(); }
      }
      pool??=mysql.createPool({...mysqlOptions(config),database:config.MYSQL_DATABASE,connectionLimit:config.MYSQL_POOL_SIZE,
        waitForConnections:true,queueLimit:20,enableKeepAlive:true,maxIdle:config.MYSQL_POOL_SIZE,idleTimeout:60000});
      for (const ddl of DDL) await pool.query(ddl);
      await migrateCalories(pool);
    })().catch(error=>{initialization=undefined;throw error;});
    return initialization;
  }
  return {
    init,
    async transaction(work) {
      await init(); const connection=await pool.getConnection();
      try {
        await connection.query('SET SESSION innodb_lock_wait_timeout = 5');
        await connection.beginTransaction(); const result=await work(connection); await connection.commit(); return result;
      } catch(error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async ping() { await init(); await pool.query('SELECT 1'); },
    async markReplied(eventId,userId) {
      await init(); await pool.execute('UPDATE webhook_events SET replied_at = UTC_TIMESTAMP() WHERE event_id = ? AND line_user_id = ?',[eventId,userId]);
    },
    async close() { if(pool) await pool.end(); pool=undefined; initialization=undefined; }
  };
}

export async function migrateCalories(pool) {
  const [columns]=await pool.query('SHOW COLUMNS FROM entries');
  const names=new Set(columns.map(c=>c.Field));
  for(const [name,definition] of [['calories_source',"ENUM('provided','estimated') NULL"],['calorie_note','VARCHAR(500) NULL'],
    ['protein_grams','DECIMAL(12,2) NULL'],['protein_source',"ENUM('provided','estimated') NULL"],['protein_note','VARCHAR(500) NULL']]) {
    if(names.has(name)) continue;
    try{await pool.query(`ALTER TABLE entries ADD COLUMN ${name} ${definition}`);}
    catch(error){if(error.code!=='ER_DUP_FIELDNAME') throw error;}
  }
  // Previous versions only accepted explicitly supplied exercise calories.
  await pool.query("UPDATE entries SET calories_source = 'provided' WHERE calories IS NOT NULL AND calories_source IS NULL");
}
