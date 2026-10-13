import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { vercelHandler } from '../src/vercel.js';
test('Vercel adapter retains exact signed request bytes before Express parsing',async t=>{
  Object.assign(process.env,{LINE_CHANNEL_SECRET:'adapter-secret',LINE_CHANNEL_ACCESS_TOKEN:'test',OPENAI_API_KEY:'test',
    MYSQL_HOST:'127.0.0.1',MYSQL_USER:'test',MYSQL_DATABASE:'test'});
  const handler=vercelHandler('/webhook');
  const server=createServer((req,res)=>{
    res.status=function(status){this.statusCode=status;return this;};
    res.json=function(body){this.setHeader('content-type','application/json');this.end(JSON.stringify(body));return this;};
    // Vercel exposes a lazy body property. Accessing it would lose the raw bytes.
    Object.defineProperty(req,'body',{configurable:true,get(){throw new Error('lazy parser accessed');}});
    handler(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const body='{ "events" : [] }';
  const signature=createHmac('sha256','adapter-secret').update(body).digest('base64');
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/webhook`,{
    method:'POST',headers:{'content-type':'application/json','x-line-signature':signature},body});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
});
