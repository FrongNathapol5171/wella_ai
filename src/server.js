import { createRuntime } from './runtime.js';
try {
  const {app,db,config}=createRuntime();await db.init();
  const server=app.listen(config.PORT,()=>console.log(`LINE webhook ready on port ${config.PORT}`));
  const stop=()=>server.close(async()=>{await db.close();process.exit(0);});
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}catch(error){
  console.error('Startup failed:',error.message.startsWith('Invalid or missing env:')?error.message:(error.code || error.name));
  process.exitCode=1;
}
