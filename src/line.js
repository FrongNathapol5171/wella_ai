import { createHmac,timingSafeEqual } from 'node:crypto';
import { formatLineText } from './plain-text.js';
export function verifySignature(body,signature,secret) {
  if(!Buffer.isBuffer(body) || typeof signature!=='string') return false;
  const expected=Buffer.from(createHmac('sha256',secret).update(body).digest('base64'));
  const actual=Buffer.from(signature);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export class LineReplyError extends Error {
  constructor(status) {super(`LINE reply failed (${status})`);this.status=status;}
}
export function splitLineMessages(text) {
  const formatted=formatLineText(text),parts=[];
  let offset=0;
  while(offset<formatted.length) {
    let end=Math.min(offset+4500,formatted.length);
    if(end<formatted.length) {
      const paragraph=formatted.lastIndexOf('\n\n',end-2);
      const line=formatted.lastIndexOf('\n',end-1);
      if(paragraph>=offset+2250) end=paragraph+2;
      else if(line>=offset+2250) end=line+1;
      // LINE counts UTF-16 units; keep emoji surrogate pairs together.
      if(/[\uD800-\uDBFF]/.test(formatted[end-1])) end--;
    }
    parts.push({type:'text',text:formatted.slice(offset,end)});offset=end;
  }
  if(!parts.length || parts.length>5) throw new Error('LINE reply exceeds message limits');
  return parts;
}
export function createLineClient(token,fetchImpl=fetch) {
  return {
    async reply(replyToken,text) {
      const messages=splitLineMessages(text);
      const response=await fetchImpl('https://api.line.me/v2/bot/message/reply',{
        method:'POST',signal:AbortSignal.timeout(8000),
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({replyToken,messages})
      });
      if(!response.ok) throw new LineReplyError(response.status);
    }
  };
}
