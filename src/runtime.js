import { readConfig } from './config.js';
import { createDatabase } from './database.js';
import { createLlm } from './llm.js';
import { createLineClient } from './line.js';
import { createService } from './service.js';
import { createApp } from './app.js';
export function createRuntime() {
  const config=readConfig(),db=createDatabase(config);
  const service=createService({db,llm:createLlm(config),timeZone:config.APP_TIMEZONE});
  return {config,db,app:createApp({config,db,service,line:createLineClient(config.LINE_CHANNEL_ACCESS_TOKEN)})};
}
