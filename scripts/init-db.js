import { readConfig } from '../src/config.js';
import { createDatabase } from '../src/database.js';
const db=createDatabase(readConfig());
try{await db.init();console.log('Database and 3 tables are ready');}finally{await db.close();}
