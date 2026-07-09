import { z } from "zod";

const extraction = z.object({
  variable: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  source: z.enum(["jsonpath", "header", "cookie", "regex"]),
  expression: z.string().min(1).max(500),
  secret: z.boolean().optional(),
});
const step = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().min(1).max(2_000),
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().max(2_000_000).optional(),
  assertions: z.object({
    status: z.array(z.number().int().min(100).max(599)).max(20).optional(),
    includes: z.array(z.string().max(500)).max(20).optional(),
    excludes: z.array(z.string().max(500)).max(20).optional(),
  }).optional(),
  extracts: z.array(extraction).max(30).optional(),
});
export const httpFlowTemplateSchema = z.object({
  version: z.literal(1), kind: z.literal("http_flow"), steps: z.array(step).min(1).max(50),
}).strict();
