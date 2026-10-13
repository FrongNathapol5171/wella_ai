import { createRuntime } from './runtime.js';
let runtime;
export function vercelHandler(path) {
  return async function handler(req,res) {
    try {
      runtime??=createRuntime();
      if(path==='/webhook') {
        // Read the stream before touching Vercel's lazy req.body JSON parser.
        const chunks=[];let length=0;
        for await(const chunk of req) {
          length+=chunk.length;
          if(length>256*1024) return res.status(413).json({error:'Request too large'});
          chunks.push(chunk);
        }
        Object.defineProperty(req,'body',{value:Buffer.concat(chunks),writable:true,configurable:true});
      }
      req.url=path;
      return runtime.app(req,res);
    }catch{return res.status(503).json({error:'Application unavailable'});}
  };
}
