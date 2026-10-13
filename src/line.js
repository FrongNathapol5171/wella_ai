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
export function createLineClient(token,fetchImpl=fetch) {
  return {
    async reply(replyToken,text) {
      const response=await fetchImpl('https://api.line.me/v2/bot/message/reply',{
        method:'POST',signal:AbortSignal.timeout(8000),
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({replyToken,messages:[{type:'text',text:formatLineText(text).slice(0,4500)}]})
      });
      if(!response.ok) throw new LineReplyError(response.status);
    }
  };
}
