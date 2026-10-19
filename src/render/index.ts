import { createHash } from 'node:crypto';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { factKeys, factLabels, type ArticleBlock, type Draft, type ThemeId } from '../core/schema.js';

interface Theme {
  name: string;
  accent: string;
  ink: string;
  muted: string;
  surface: string;
  border: string;
}

const themes: Record<ThemeId, Theme> = {
  campus: { name: '校园清新', accent: '#287363', ink: '#243b35', muted: '#61766d', surface: '#f1f7f2', border: '#cbded3' },
  formal: { name: '正式简洁', accent: '#294767', ink: '#243347', muted: '#667487', surface: '#f2f5f8', border: '#d3dce6' },
  vibrant: { name: '明亮活力', accent: '#b53d27', ink: '#452e29', muted: '#81665c', surface: '#fff4e8', border: '#edcfb2' },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Only explicit HTTP(S) URLs; control characters, credentials and backslashes are rejected. */
function safeWebUrl(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeImageSource(value: string): string | undefined {
  const web = safeWebUrl(value);
  if (web) {
    const pathname = new URL(web).pathname;
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
    return /\.svgz?(?:$|\/)/i.test(decoded) ? undefined : web;
  }
  // Local image references stay inside the generated output's assets directory.
  const local = value.startsWith('./') ? value.slice(2) : value;
  if (!local.startsWith('assets/') || !/^[\p{L}\p{N} _./()\-]+$/u.test(local)) return undefined;
  if (local.split('/').some((part) => !part || part === '.' || part === '..')) return undefined;
  return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(local) ? local : undefined;
}

function paragraph(text: string, theme: Theme, extraStyle = ''): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:${theme.ink};white-space:pre-wrap;overflow-wrap:anywhere;${extraStyle}">${escapeHtml(text)}</p>`;
}

function renderBlock(block: ArticleBlock, theme: Theme): string {
  switch (block.type) {
    case 'heading':
      return `<section style="margin:30px 0 16px;border-left:4px solid ${theme.accent};padding:0 0 0 12px;"><h2 style="margin:0;font-size:21px;line-height:1.6;color:${theme.accent};white-space:pre-wrap;">${escapeHtml(block.text)}</h2></section>`;
    case 'list':
      return `<section style="margin:16px 0;">${block.text ? paragraph(block.text, theme) : ''}<ul style="margin:0 0 16px;padding-left:26px;color:${theme.ink};font-size:16px;line-height:1.9;">${(block.items ?? []).map((item) => `<li style="margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(item)}</li>`).join('')}</ul></section>`;
    case 'info':
      return `<section style="margin:20px 0;padding:18px;background-color:${theme.surface};border:1px solid ${theme.border};">${paragraph(block.text, theme, 'margin-bottom:0;')}</section>`;
    case 'image': {
      const src = block.image && safeImageSource(block.image.src);
      const alt = block.image?.alt || '待补充活动图片';
      const image = src
        ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;" />`
        : `<p style="margin:0;padding:32px 16px;text-align:center;border:1px dashed ${theme.border};color:${theme.muted};font-size:14px;line-height:1.8;white-space:pre-wrap;">[图片待人工替换] ${escapeHtml(alt)}</p>`;
      return `<section style="margin:24px 0;">${block.text ? paragraph(block.text, theme) : ''}${image}${block.image?.caption ? paragraph(block.image.caption, theme, `font-size:13px;text-align:center;color:${theme.muted};margin-top:8px;`) : ''}</section>`;
    }
    case 'cta': {
      const url = safeWebUrl(block.text.trim());
      const content = url
        ? `<p style="margin:0;font-size:16px;line-height:1.9;overflow-wrap:anywhere;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:${theme.accent};text-decoration:underline;">${escapeHtml(block.text)}</a></p>`
        : paragraph(block.text, theme, 'margin-bottom:0;');
      return `<section style="margin:28px 0;padding:20px;border:2px solid ${theme.accent};background-color:${theme.surface};"><h2 style="margin:0 0 10px;font-size:19px;line-height:1.6;color:${theme.accent};">参与方式</h2>${content}</section>`;
    }
    default:
      return paragraph(block.text, theme);
  }
}

/** Portable, script-free rich text. Controls and style-keyword metadata never enter this fragment. */
export function renderArticle(draft: Draft): string {
  const theme = themes[draft.theme];
  return `<article style="max-width:720px;margin:0 auto;padding:28px 20px;background-color:#ffffff;color:${theme.ink};font-family:Arial,'Microsoft YaHei',sans-serif;word-break:normal;overflow-wrap:anywhere;"><section style="margin:0 0 28px;padding:0 0 20px;border-bottom:2px solid ${theme.border};"><h1 style="margin:0 0 14px;font-size:30px;line-height:1.5;color:${theme.accent};white-space:pre-wrap;">${escapeHtml(draft.title)}</h1>${draft.summary ? paragraph(draft.summary, theme, `font-size:15px;color:${theme.muted};margin-bottom:0;`) : ''}</section>${draft.blocks.map((block) => renderBlock(block, theme)).join('')}</article>`;
}

// This is constant executable code, never interpolated with draft text.
const previewScript = String.raw`(() => {
  'use strict';
  const editor = document.getElementById('article-editor');
  const button = document.getElementById('copy-article');
  const status = document.getElementById('copy-status');
  function webUrl(value) {
    if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
    try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.hostname && !u.username && !u.password ? u.href : null; } catch { return null; }
  }
  function imageUrl(value) {
    const web = webUrl(value);
    if (web) { try { return /\.svgz?(?:$|\/)/i.test(decodeURIComponent(new URL(web).pathname)) ? null : web; } catch { return null; } }
    const local = value.startsWith('./') ? value.slice(2) : value;
    return local.startsWith('assets/') && /^[\p{L}\p{N} _./()\-]+$/u.test(local) && !local.split('/').some(p => !p || p === '.' || p === '..') && /\.(png|jpe?g|gif|webp|avif)$/i.test(local) ? local : null;
  }
  const allowed = new Set(['ARTICLE', 'SECTION', 'H1', 'H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'SPAN', 'BLOCKQUOTE', 'A', 'IMG', 'BR', 'HR']);
  const discard = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'FORM']);
  const styleProperties = new Set(['max-width', 'width', 'height', 'margin', 'margin-top', 'margin-bottom', 'padding', 'padding-left', 'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'text-align', 'text-decoration', 'white-space', 'overflow-wrap', 'word-break', 'border', 'border-left', 'border-bottom', 'display']);
  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE || discard.has(node.tagName)) return document.createDocumentFragment();
    const output = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
    if (output.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'IMG') {
        const src = imageUrl(node.getAttribute('src') || '');
        if (!src) return document.createTextNode('[图片待人工替换] ' + (node.getAttribute('alt') || ''));
        output.setAttribute('src', src); output.setAttribute('alt', node.getAttribute('alt') || '');
      }
      if (node.tagName === 'A') {
        const href = webUrl(node.getAttribute('href') || '');
        if (href) { output.setAttribute('href', href); output.setAttribute('rel', 'noopener noreferrer'); output.setAttribute('target', '_blank'); }
      }
      for (const property of node.style) {
        const value = node.style.getPropertyValue(property);
        if (styleProperties.has(property) && !/url\s*\(|expression|javascript|[<>\\@]/i.test(value)) output.style.setProperty(property, value);
      }
    }
    for (const child of node.childNodes) output.appendChild(clean(child));
    return output;
  }
  function selectArticle() {
    editor.focus();
    const selection = window.getSelection();
    if (selection) { const range = document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range); }
  }
  function insertPlainText(text) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
  }
  editor.addEventListener('paste', event => { event.preventDefault(); insertPlainText(event.clipboardData ? event.clipboardData.getData('text/plain') : ''); });
  editor.addEventListener('drop', event => { event.preventDefault(); status.textContent = '请用粘贴纯文本修改文字；图片请在目标平台上传替换。'; });
  button.addEventListener('click', async () => {
    const container = document.createElement('div');
    for (const node of editor.childNodes) container.appendChild(clean(node));
    const html = container.innerHTML;
    const text = editor.innerText || editor.textContent || '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard unavailable');
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      status.textContent = '已复制当前正文（富文本和纯文本）。图片仍需在目标平台上传或替换；临时修改未保存到草稿及其他导出。';
    } catch {
      selectArticle();
      status.textContent = '自动复制失败，已全选正文。请按 Ctrl+C（Mac：Command+C）手动复制，再粘贴到目标平台。图片需上传或替换；临时修改未保存。';
    }
  });
})();`;

/** A local editing shell; the copied fragment is read from the current editable DOM. */
export function renderPreview(draft: Draft): string {
  const scriptHash = createHash('sha256').update(previewScript).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'self' https: http:; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'none'`;
  const keywords = draft.styleKeywords.length ? draft.styleKeywords.join('、') : '未指定';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><title>${escapeHtml(draft.title)} — 本地编辑预览</title><style>body{margin:0;background:#edf0f3;font-family:Arial,'Microsoft YaHei',sans-serif;color:#253344} .preview-controls{max-width:720px;margin:20px auto;padding:18px;background:#fff;border:1px solid #ccd3dd;line-height:1.7} button{padding:10px 18px;font:inherit;cursor:pointer} #article-editor{max-width:760px;margin:20px auto;background:#fff;outline-offset:4px} #copy-status{white-space:pre-wrap} @media print{.preview-controls{display:none}body{background:#fff}}</style></head>
<body><section class="preview-controls" aria-label="预览操作"><h2>本地编辑预览</h2><p>主题：${escapeHtml(themes[draft.theme].name)} · 样式标签：${escapeHtml(keywords)}</p><p>可直接修改下方正文，再复制当前内容。这里的修改仅用于临时预览，不会自动保存到草稿、页面标题元数据或其他导出文件。刷新页面会丢失修改。</p><p><strong>图片提示：</strong>外链或本地 assets 路径不会自动变成平台图片，复制后请在目标平台上传或替换。缺图位置需要人工补图。</p><p>这是可编辑富文本候选；尚未实测秀米导入兼容性，粘贴效果需人工检查。Word 文件是单独的可编辑候选，不保证可导入秀米。</p><button id="copy-article" type="button">复制正文（富文本 + 纯文本）</button><p id="copy-status" role="status" aria-live="polite">复制只包含下方正文，不包含本操作区。</p><noscript>当前浏览器禁用了脚本。请手动选中下方正文并复制；图片需要在目标平台上传或替换。</noscript></section>
<div id="article-editor" contenteditable="true" role="textbox" aria-label="可临时编辑的文章正文" aria-multiline="true" spellcheck="false">${renderArticle(draft)}</div>
<script>${previewScript}</script></body></html>`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+\-.!|~]/g, '\\$&');
}

export function renderMarkdown(draft: Draft): string {
  const pieces = [`# ${escapeMarkdown(draft.title)}`, ...(draft.summary ? [escapeMarkdown(draft.summary)] : [])];
  for (const block of draft.blocks) {
    const text = escapeMarkdown(block.text);
    if (block.type === 'heading') pieces.push(`## ${text}`);
    else if (block.type === 'list') {
      if (text) pieces.push(text);
      pieces.push((block.items ?? []).map((item) => `- ${escapeMarkdown(item).replace(/\n/g, '\n  ')}`).join('\n'));
    } else if (block.type === 'image') {
      if (text) pieces.push(text);
      const src = block.image && safeImageSource(block.image.src);
      const label = escapeMarkdown(block.image?.alt || '待补充活动图片');
      pieces.push(src ? `![${label}](<${src.replace(/[<>"\s]/g, (character) => encodeURIComponent(character))}>)` : `[图片待人工替换] ${label}`);
      if (block.image?.caption) pieces.push(escapeMarkdown(block.image.caption));
    } else if (block.type === 'cta') pieces.push(`## 参与方式\n\n${text}`);
    else pieces.push(text);
  }
  return `${pieces.filter(Boolean).join('\n\n')}\n`;
}

export function renderReview(draft: Draft): string {
  const md = escapeMarkdown;
  const lines = [
    '# 人工审阅清单', '', `文章：${md(draft.title)}`, '',
    `状态：${draft.reviewStatus === 'confirmed' ? '已确认' : '待人工确认'}；生成模式：${draft.mode === 'offline' ? '离线' : '模型辅助'}`, '',
    '## 发布与导入检查', '',
    '- [ ] 对照原文核对活动信息与报名方式。',
    '- [ ] 逐段核对正文，确认没有遗漏、编造或误解。',
    '- [ ] 在目标平台上传或替换图片，检查链接、版权与排版。',
    '- [ ] 实测富文本复制粘贴效果；秀米兼容性尚未实测，不保证导入。',
    '- [ ] Word 仅为可编辑文档候选，不保证可导入秀米。',
    '- [ ] 预览中的临时编辑不会保存到草稿或同步其他导出。', '',
    '## 事实与来源', '',
  ];
  for (const key of factKeys) {
    const fact = draft.facts[key];
    lines.push(fact ? `- ${factLabels[key]}：${md(fact.value)}（${fact.status === 'confirmed' ? '已确认' : '待确认'}；来源：${fact.sourceBlockIds.map(md).join('、')}）` : `- ${factLabels[key]}：未提供，请人工确认。`);
  }
  lines.push('', '## 检查提示', '');
  if (!draft.issues.length && !draft.source.warnings.length) lines.push('当前没有自动检查提示，仍需人工审阅。');
  for (const issue of draft.issues) lines.push(`- ${issue.severity === 'error' ? '错误' : '警告'} [${md(issue.code)}]：${md(issue.message)}${issue.blockId ? `（段落 ${md(issue.blockId)}）` : ''}`);
  for (const warning of draft.source.warnings) lines.push(`- 来源提示：${md(warning)}`);
  lines.push('', '## 正文来源定位', '');
  for (const block of draft.blocks) lines.push(`- ${md(block.id)}：${block.sourceBlockIds.length ? block.sourceBlockIds.map(md).join('、') : '未标注来源，需人工核对'}`);
  lines.push('', '## 原文摘录', '', `来源文件：${md(draft.source.name)}`, '');
  for (const block of draft.source.blocks) lines.push(`### ${md(block.id)} · ${md(block.location)}`, '', md(block.text), '');
  return `${lines.join('\n')}\n`;
}

/** Editable text paragraphs, never screenshots; images are intentionally manual-upload placeholders. */
export async function createDocx(draft: Draft): Promise<Buffer> {
  const theme = themes[draft.theme];
  const paragraphs: Paragraph[] = [];
  const textRuns = (text: string): TextRun[] => text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) }));
  const addText = (text: string, options: { heading?: typeof HeadingLevel[keyof typeof HeadingLevel]; bullet?: { level: number } } = {}) => {
    paragraphs.push(new Paragraph({ children: textRuns(text), spacing: { after: 200, line: 320 }, ...options }));
  };
  addText(draft.title, { heading: HeadingLevel.TITLE });
  if (draft.summary) addText(draft.summary);
  for (const block of draft.blocks) {
    if (block.type === 'heading') addText(block.text, { heading: HeadingLevel.HEADING_1 });
    else if (block.type === 'list') {
      if (block.text) addText(block.text);
      for (const item of block.items ?? []) addText(item, { bullet: { level: 0 } });
    } else if (block.type === 'image') {
      if (block.text) addText(block.text);
      addText(`[图片待人工插入] ${block.image?.alt || '待补充活动图片'}`);
      if (block.image?.caption) addText(block.image.caption);
    } else if (block.type === 'cta') {
      addText('参与方式', { heading: HeadingLevel.HEADING_1 });
      addText(block.text);
    } else addText(block.text);
  }
  const doc = new Document({
    title: draft.title,
    description: '可编辑 Word 文档候选；图片需人工插入。未实测秀米导入，不保证兼容。',
    styles: {
      default: { document: { run: { font: 'Microsoft YaHei', size: 22, color: theme.ink.slice(1) }, paragraph: { spacing: { after: 200 } } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 40, bold: true, color: theme.accent.slice(1) } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 30, bold: true, color: theme.accent.slice(1) } },
      ],
    },
    sections: [{ properties: {}, children: paragraphs }],
  });
  return Packer.toBuffer(doc);
}
