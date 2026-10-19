export { readSource, textSource } from './ingest/index.js';
export { extractFacts, createOfflineDraft, validateDraft } from './core/draft.js';
export { generateWithModel, type ModelOptions } from './generation/index.js';
export { renderArticle, renderPreview, renderMarkdown, renderReview, createDocx } from './render/index.js';
export { DraftSchema, SourceSchema, factKeys, factLabels } from './core/schema.js';
export type { Draft, SourceDocument, SourceBlock, Facts, Fact, FactKey, ArticleBlock, Issue, ThemeId } from './core/schema.js';
