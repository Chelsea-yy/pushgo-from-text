import { DraftSchema, factKeys, factLabels, type Draft, type Facts, type Issue, type SourceDocument, type ThemeId } from './schema.js';

const aliases: Record<string, keyof Facts> = {
  活动名称: 'eventName', 活动主题: 'eventName', 主题: 'eventName',
  日期: 'date', 活动日期: 'date', 时间: 'time', 活动时间: 'time',
  地点: 'venue', 活动地点: 'venue', 场地: 'venue',
  参与对象: 'audience', 活动对象: 'audience', 面向对象: 'audience',
  主办方: 'organizer', 主办单位: 'organizer', 报名方式: 'registration', 报名链接: 'registration',
  报名截止: 'deadline', 截止时间: 'deadline', 费用: 'fee', 活动费用: 'fee',
  联系方式: 'contact', 联系人: 'contact',
};
const normalized = (value: string) => value.replace(/\s+/gu, '').normalize('NFKC');

export function extractFacts(source: SourceDocument): { facts: Facts; issues: Issue[] } {
  const facts: Facts = {};
  const issues: Issue[] = [];
  const add = (key: keyof Facts, value: string, ids: string[]) => {
    if (!value.trim()) return;
    const previous = facts[key];
    if (previous && normalized(previous.value) !== normalized(value)) {
      issues.push({ code: 'FACT_CONFLICT', severity: 'error', message: `${factLabels[key]}存在多个候选：“${previous.value}”与“${value}”；请对照 ${[...previous.sourceBlockIds, ...ids].join('、')} 确认。` });
      return;
    }
    facts[key] = { value: value.trim(), sourceBlockIds: [...new Set([...(previous?.sourceBlockIds ?? []), ...ids])], status: 'extracted' };
  };
  for (const [index, block] of source.blocks.entries()) {
    const fieldText = block.text.replace(/^\s*(?:#{1,6}\s+|[-*]\s+)?(?:[（(]?[一二三四五六七八九十\d]+[、.．）)]\s*)?/u, '');
    const match = fieldText.match(/^\s*([^：:]{1,12})[：:]\s*(.*)$/u);
    if (match) {
      const label = match[1]!.trim();
      const key = Object.hasOwn(aliases, label) ? aliases[label] : undefined;
      if (key) {
        const next = source.blocks[index + 1];
        if (match[2]!.trim()) add(key, match[2]!, [block.id]);
        else if (next && !/^[^：:]{1,12}[：:]/u.test(next.text)) add(key, next.text, [block.id, next.id]);
      }
    }
  }
  // A combined explicit time field can also contain a literal date. Free narrative,
  // past-event anecdotes and agenda rows are deliberately not used as fallback.
  if (!facts.date && facts.time) {
    for (const match of facts.time.value.matchAll(/(?:20\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号]/gu)) {
      add('date', match[0], facts.time.sourceBlockIds);
    }
  }
  return { facts, issues };
}

/** Cheap literal guard, not a semantic truth checker. Human review is always required. */
function criticalTokens(text: string): string[] {
  return text.normalize('NFKC').match(/https?:\/\/[^\s<>"）)]+|(?<!\d)(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?%?)(?!\d)|[一二三四五六七八九十百千万]+元/gu) ?? [];
}
function supportsTokens(text: string, evidence: string): boolean {
  const supported = new Set(criticalTokens(evidence));
  return criticalTokens(text).every(token => supported.has(token));
}

export function validateDraft(input: Draft): Draft {
  const draft = DraftSchema.parse(input);
  const sourceMap = new Map(draft.source.blocks.map(block => [block.id, block.text]));
  const conflicts = [...extractFacts(draft.source).issues, ...draft.issues.filter(issue => issue.code === 'FACT_CONFLICT')];
  const issues: Issue[] = [...new Map(conflicts.map(issue => [issue.message, issue])).values()];
  if (sourceMap.size !== draft.source.blocks.length) issues.push({ code: 'DUPLICATE_SOURCE_ID', severity: 'error', message: '来源段落编号重复。' });
  if (new Set(draft.blocks.map(block => block.id)).size !== draft.blocks.length) issues.push({ code: 'DUPLICATE_BLOCK_ID', severity: 'error', message: '正文段落编号重复。' });
  const evidence = (ids: string[], blockId?: string) => {
    for (const id of ids) if (!sourceMap.has(id)) issues.push({ code: 'UNKNOWN_SOURCE', severity: 'error', message: `来源编号 ${id} 不存在。`, ...(blockId ? { blockId } : {}) });
    return ids.map(id => sourceMap.get(id) ?? '').join('\n');
  };
  for (const key of factKeys) {
    const fact = draft.facts[key];
    if (fact) {
      const cited = evidence(fact.sourceBlockIds);
      if (!normalized(cited).includes(normalized(fact.value)) || !supportsTokens(fact.value, cited)) issues.push({ code: 'UNSUPPORTED_FACT', severity: 'error', message: `${factLabels[key]}无法在所引用的原文中找到，请核对。` });
    } else if (['date', 'time', 'venue', 'registration'].includes(key)) {
      issues.push({ code: 'MISSING_FACT', severity: 'warning', message: `${factLabels[key]}未可靠提取；请补充有来源的信息，或明确待定。` });
    }
  }
  for (const block of draft.blocks) {
    const cited = evidence(block.sourceBlockIds, block.id);
    const text = [block.text, ...(block.items ?? []), block.image?.caption ?? '', block.image?.alt ?? ''].join('\n');
    if (!block.sourceBlockIds.length && text.trim()) issues.push({ code: 'UNSOURCED_BLOCK', severity: 'warning', message: '本段缺少来源引用，需人工核对。', blockId: block.id });
    for (const token of new Set(criticalTokens(text))) {
      if (!new Set(criticalTokens(cited)).has(token)) issues.push({ code: 'UNSUPPORTED_TOKEN', severity: 'error', message: `本段的关键字面信息“${token}”未见于引用原文。`, blockId: block.id });
    }
    if (block.type === 'image') issues.push({ code: 'IMAGE_REVIEW', severity: 'warning', message: '图片和二维码需人工核对版权、内容及目标，并在秀米重新上传或替换。', blockId: block.id });
  }
  const allEvidence = draft.source.blocks.map(block => block.text).join('\n');
  for (const token of new Set(criticalTokens(`${draft.title}\n${draft.summary}`))) {
    if (!new Set(criticalTokens(allEvidence)).has(token)) issues.push({ code: 'UNSUPPORTED_TITLE_TOKEN', severity: 'error', message: `标题或摘要中的“${token}”没有来源支持。` });
  }
  issues.push({ code: 'MANUAL_REVIEW', severity: 'warning', message: '字面检查无法保证语义正确。请逐项确认拟邀/待定、时间、场地公开范围和报名信息；不得把计划写成已发生事实。' });
  return { ...draft, issues, reviewStatus: 'needs-review' };
}

export function createOfflineDraft(source: SourceDocument, theme: ThemeId = 'campus', styleKeywords: string[] = []): Draft {
  const { facts, issues } = extractFacts(source);
  const title = facts.eventName?.value.slice(0, 200) ?? '活动推送草稿（请补充标题）';
  const info = factKeys.filter(key => key !== 'eventName' && facts[key]).map(key => `${factLabels[key]}：${facts[key]!.value}`);
  const ids = [...new Set(factKeys.flatMap(key => facts[key]?.sourceBlockIds ?? []))];
  return validateDraft({
    schemaVersion: '1.0', source, facts, title,
    summary: '根据提供材料整理的待审核草稿；未提供的信息不会自动补造。',
    blocks: [
      ...(info.length ? [{ id: 'activity-info', type: 'info' as const, text: info.join('\n'), sourceBlockIds: ids }] : []),
      ...source.blocks.map((block, index) => ({ id: `source-${index + 1}`, type: 'paragraph' as const, text: block.text, sourceBlockIds: [block.id] })),
    ], theme, styleKeywords, issues, mode: 'offline', reviewStatus: 'needs-review',
  });
}
