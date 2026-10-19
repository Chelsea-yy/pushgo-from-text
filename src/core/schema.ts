import { z } from 'zod';

export const SourceBlockSchema = z.object({
  id: z.string().min(1),
  location: z.string().min(1),
  text: z.string().min(1),
});
export const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  sha256: z.string(),
  kind: z.enum(['text', 'markdown', 'docx', 'pdf']),
  blocks: z.array(SourceBlockSchema).min(1),
  warnings: z.array(z.string()).default([]),
});
export const factKeys = ['eventName', 'date', 'time', 'venue', 'audience', 'organizer', 'registration', 'deadline', 'fee', 'contact'] as const;
export const FactSchema = z.object({
  value: z.string().min(1),
  sourceBlockIds: z.array(z.string()).min(1),
  status: z.enum(['extracted', 'confirmed']).default('extracted'),
});
export const FactsSchema = z.object({
  eventName: FactSchema.optional(), date: FactSchema.optional(), time: FactSchema.optional(),
  venue: FactSchema.optional(), audience: FactSchema.optional(), organizer: FactSchema.optional(),
  registration: FactSchema.optional(), deadline: FactSchema.optional(), fee: FactSchema.optional(), contact: FactSchema.optional(),
});
export const ArticleBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['paragraph', 'heading', 'list', 'info', 'image', 'cta']),
  text: z.string().default(''),
  items: z.array(z.string()).optional(),
  sourceBlockIds: z.array(z.string()).default([]),
  image: z.object({ src: z.string(), alt: z.string(), caption: z.string().default('') }).optional(),
});
export const IssueSchema = z.object({
  code: z.string(), severity: z.enum(['warning', 'error']), message: z.string(),
  blockId: z.string().optional(),
});
export const DraftSchema = z.object({
  schemaVersion: z.literal('1.0'),
  source: SourceSchema,
  facts: FactsSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(1000),
  blocks: z.array(ArticleBlockSchema).min(1),
  theme: z.enum(['campus', 'formal', 'vibrant']),
  styleKeywords: z.array(z.string()),
  issues: z.array(IssueSchema),
  mode: z.enum(['offline', 'model']),
  reviewStatus: z.enum(['needs-review', 'confirmed']),
});

export type SourceBlock = z.infer<typeof SourceBlockSchema>;
export type SourceDocument = z.infer<typeof SourceSchema>;
export type FactKey = typeof factKeys[number];
export type Facts = z.infer<typeof FactsSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type ArticleBlock = z.infer<typeof ArticleBlockSchema>;
export type Issue = z.infer<typeof IssueSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type ThemeId = Draft['theme'];

export const factLabels: Record<FactKey, string> = {
  eventName: '活动名称', date: '日期', time: '时间', venue: '地点', audience: '参与对象',
  organizer: '主办方', registration: '报名方式', deadline: '报名截止', fee: '费用', contact: '联系方式',
};
