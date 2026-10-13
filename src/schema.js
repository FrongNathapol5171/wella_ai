import { z } from 'zod';
export const typeSchema = z.enum(['income','expense','food','exercise','weight']);
const text = z.string().max(1000).nullable();
const number = z.number().finite().nullable();
export const recordSchema = z.object({
  type:typeSchema, occurred_at:z.string(), title:z.string().min(1).max(255), details:text,
  amount:number, category:z.string().max(100).nullable(), quantity:number, unit:z.string().max(50).nullable(),
  duration_minutes:number, calories:number, weight_kg:number, source_quote:z.string().min(1).max(5000)
}).strict();
export const querySchema = z.object({
  type:typeSchema.nullable(), mode:z.enum(['list','summary','latest']), date_from:z.string().nullable(), date_to:z.string().nullable(),
  category:z.string().max(100).nullable(), keyword:z.string().max(100).nullable(), limit:z.number().int().min(1).max(50)
}).strict();
export const planSchema = z.object({
  intent:z.enum(['record','query','advice','help','delete','clarify','chat','cancel']), records:z.array(recordSchema).max(20), query:querySchema.nullable(),
  advice_topic:z.enum(['finance','health','nutrition','exercise','weight','all']).nullable(),
  deletion:z.object({type:typeSchema,count:z.number().int().min(1).max(100)}).strict().nullable(), reply:z.string().max(500)
}).strict();
