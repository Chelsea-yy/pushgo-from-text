import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script, runInNewContext } from 'node:vm';
import { inflateRawSync } from 'node:zlib';
import test from 'node:test';
import { DraftSchema, type Draft } from '../src/core/schema.js';
import { createDocx, renderArticle, renderMarkdown, renderPreview, renderReview } from '../src/render/index.js';

function draft(overrides: Partial<Draft> = {}): Draft {
  return DraftSchema.parse({
    schemaVersion: '1.0',
    source: { id: 'source-1', name: '活动通知.txt', sha256: 'abc', kind: 'text', blocks: [{ id: 's1', location: '第 1 段', text: '校园春日阅读活动原文' }], warnings: [] },
    facts: { date: { value: '2026年10月25日', sourceBlockIds: ['s1'], status: 'extracted' } },
    title: '校园春日阅读', summary: '一起阅读，分享春日故事。',
    blocks: [
      { id: 'h1', type: 'heading', text: '活动安排', sourceBlockIds: ['s1'] },
      { id: 'p1', type: 'paragraph', text: '保留可编辑的中文段落。\n这是第二行。', sourceBlockIds: ['s1'] },
      { id: 'l1', type: 'list', text: '请提前准备：', items: ['一本喜欢的书', '一段读书感悟'], sourceBlockIds: ['s1'] },
      { id: 'i1', type: 'info', text: '地点：图书馆\n时间：下午两点', sourceBlockIds: ['s1'] },
      { id: 'im1', type: 'image', text: '活动现场配图', image: { src: 'assets/campus.png', alt: '校园阅读照片', caption: '图片说明：同学们一起读书' }, sourceBlockIds: ['s1'] },
      { id: 'c1', type: 'cta', text: 'https://example.com/register?event=1&from=campus', sourceBlockIds: ['s1'] },
    ],
    theme: 'campus', styleKeywords: ['温柔', '春日', '留白'], issues: [], mode: 'offline', reviewStatus: 'needs-review', ...overrides,
  });
}

for (const [theme, color] of [['campus', '#287363'], ['formal', '#294767'], ['vibrant', '#b53d27']] as const) {
  test(`${theme}: clean inline rich text retains paragraphs, lists, images and CTA`, () => {
    const html = renderArticle(draft({ theme }));
    assert.match(html, /^<article\s/);
    assert.match(html, /<section\s/);
    assert.ok(html.includes(color));
    assert.match(html, /校园春日阅读/);
    assert.match(html, /保留可编辑的中文段落/);
    assert.match(html, /<ul style=/);
    assert.match(html, /一本喜欢的书/);
    assert.match(html, /<img src="assets\/campus.png"/);
    assert.match(html, /参与方式/);
    assert.match(html, /href="https:\/\/example.com\/register\?event=1&amp;from=campus"/);
    assert.doesNotMatch(html, /<(?:script|style|button|input|iframe|svg)\b/i);
    assert.doesNotMatch(html, /\b(?:class|contenteditable|on\w+)\s*=/i);
    assert.doesNotMatch(html, /(?:display\s*:\s*(?:flex|grid)|javascript:|data:)/i);
    assert.doesNotMatch(html, /样式标签|温柔|留白|复制正文/);
  });
}

test('all text and image attributes are escaped, including closing script and event payloads', () => {
  const payload = '</script><script>alert(1)</script><img src=x onerror="alert(2)"> & \'quoted\'';
  const item = draft({
    title: payload, summary: payload, styleKeywords: [payload],
    blocks: [
      { id: 'p', type: 'paragraph', text: payload, sourceBlockIds: [] },
      { id: 'list', type: 'list', text: payload, items: [payload], sourceBlockIds: [] },
      { id: 'image', type: 'image', text: payload, image: { src: 'https://example.com/photo.png', alt: payload, caption: payload }, sourceBlockIds: [] },
    ],
  });
  const html = renderArticle(item);
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;'));
  assert.ok(html.includes('&quot;alert(2)&quot;'));
  assert.ok(html.includes('&#39;quoted&#39;'));
  assert.doesNotMatch(html, /<script\b|<img src=x|\sonerror="/i);
  const preview = renderPreview(item);
  assert.equal((preview.match(/<script>/g) ?? []).length, 1);
  assert.doesNotMatch(preview, /<script>alert\(1\)/);
});

test('dangerous, unsupported and traversing image sources become editable placeholders', () => {
  const sources = [
    '', 'javascript:alert(1)', 'data:image/png;base64,abc', 'data:image/svg+xml,<svg/>',
    '//example.com/a.png', 'file:///C:/photo.png', 'C:\\photo.png', '/etc/photo.png',
    'assets/../secret.png', './assets/../../secret.png', 'assets/%2e%2e/a.png',
    'assets/a.svg', 'assets/a.SVG', 'https://example.com/a.svg', 'https://example.com/a%2Esvg',
    'https://user:pass@example.com/a.png', 'https://example.com/\\a.png', 'https://example.com/\na.png',
  ];
  for (const src of sources) {
    const item = draft({ blocks: [{ id: 'image', type: 'image', text: '', image: { src, alt: '人工补图', caption: '保留说明' }, sourceBlockIds: [] }] });
    const html = renderArticle(item);
    assert.doesNotMatch(html, /<img\b/, src);
    assert.match(html, /图片待人工替换/, src);
    assert.match(html, /人工补图/, src);
    assert.match(html, /保留说明/, src);
    assert.doesNotMatch(renderMarkdown(item), /!\[/, src);
  }
});

test('safe HTTP(S) and controlled assets images are retained without network requests', () => {
  for (const src of ['http://example.com/a.jpg', 'https://example.com/a.png?x=1&y=2', './assets/春日 photo.webp']) {
    const html = renderArticle(draft({ blocks: [{ id: 'image', type: 'image', text: '', image: { src, alt: '图', caption: '' }, sourceBlockIds: [] }] }));
    assert.match(html, /<img src="/);
    assert.doesNotMatch(html, /图片待人工替换/);
  }
});

test('missing image metadata is represented by a manual replacement placeholder', () => {
  assert.match(renderArticle(draft({ blocks: [{ id: 'image', type: 'image', text: '', sourceBlockIds: [] }] })), /图片待人工替换/);
});

test('CTA only turns an explicit safe HTTP(S) URL into a link', () => {
  for (const text of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', '点击此处报名 <script>bad</script>']) {
    const html = renderArticle(draft({ blocks: [{ id: 'cta', type: 'cta', text, sourceBlockIds: [] }] }));
    assert.match(html, /参与方式/);
    assert.doesNotMatch(html, /<a\b|<script\b/);
  }
});

test('preview separates controls, editing metadata and compatibility warnings from body', () => {
  const item = draft();
  const preview = renderPreview(item);
  const article = renderArticle(item);
  assert.match(preview, /^<!doctype html>/);
  assert.match(preview, /id="copy-article"/);
  assert.match(preview, /contenteditable="true"/);
  assert.match(preview, /样式标签：温柔、春日、留白/);
  assert.match(preview, /不会自动保存到草稿、页面标题元数据或其他导出文件/);
  assert.match(preview, /尚未实测秀米导入兼容性/);
  assert.match(preview, /图片提示/);
  assert.match(preview, /text\/html/);
  assert.match(preview, /text\/plain/);
  assert.match(preview, /Ctrl\+C/);
  assert.ok(preview.includes(article));
  assert.doesNotMatch(article, /copy-article|contenteditable|样式标签|<button/);
  const script = preview.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
  assert.ok(preview.includes(createHash('sha256').update(script).digest('base64')));
  assert.match(preview, /Content-Security-Policy/);
});

// A small DOM fixture exercises the clipboard logic without claiming real-browser compatibility.
async function runCopy({ clipboardAvailable, clipboardDenied = false }: { clipboardAvailable: boolean; clipboardDenied?: boolean }) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const editor = {
    childNodes: [{ nodeType: 3, textContent: '原始正文' }],
    innerText: '原始正文', textContent: '原始正文',
    addEventListener: (event: string, callback: (...args: unknown[]) => unknown) => handlers.set(`editor:${event}`, callback),
    focus: () => { focused = true; },
  };
  const button = { addEventListener: (event: string, callback: (...args: unknown[]) => unknown) => handlers.set(`button:${event}`, callback) };
  const status = { textContent: '' };
  let copied: Record<string, Blob>[] = [];
  let selected = false;
  let focused = false;
  const document = {
    getElementById: (id: string) => id === 'article-editor' ? editor : id === 'copy-article' ? button : status,
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    createElement: () => {
      const children: { textContent: string }[] = [];
      return { appendChild: (node: { textContent: string }) => children.push(node), get innerHTML() { return children.map((child) => child.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join(''); } };
    },
    createRange: () => ({ selectNodeContents: (target: unknown) => { selected = target === editor; } }),
  };
  const selection = { removeAllRanges() {}, addRange() {} };
  const script = renderPreview(draft()).match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  runInNewContext(script, {
    document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, URL, Blob,
    window: { getSelection: () => selection },
    navigator: clipboardAvailable ? { clipboard: { write: async (items: { data: Record<string, Blob> }[]) => { if (clipboardDenied) throw new Error('Clipboard permission denied'); copied = items.map((item) => item.data); } } } : {},
    ClipboardItem: class { constructor(public data: Record<string, Blob>) {} },
  });
  editor.childNodes[0]!.textContent = '临时修改 <正文>';
  editor.innerText = '临时修改 <正文>';
  await handlers.get('button:click')!();
  return { copied, status: status.textContent, selected, focused };
}

test('copy uses current editable DOM and writes both rich and plain text without controls', async () => {
  const result = await runCopy({ clipboardAvailable: true });
  assert.equal(result.copied.length, 1);
  assert.equal(await result.copied[0]!['text/html']!.text(), '临时修改 &lt;正文>');
  assert.equal(await result.copied[0]!['text/plain']!.text(), '临时修改 <正文>');
  assert.match(result.status, /已复制当前正文/);
  assert.match(result.status, /临时修改未保存/);
});

test('unavailable clipboard selects article and explains manual copy fallback', async () => {
  const result = await runCopy({ clipboardAvailable: false });
  assert.equal(result.selected, true);
  assert.equal(result.focused, true);
  assert.match(result.status, /自动复制失败，已全选正文/);
  assert.match(result.status, /Ctrl\+C/);
});

test('clipboard permission rejection also selects only the article for manual copying', async () => {
  const result = await runCopy({ clipboardAvailable: true, clipboardDenied: true });
  assert.equal(result.copied.length, 0);
  assert.equal(result.selected, true);
  assert.equal(result.focused, true);
  assert.match(result.status, /自动复制失败，已全选正文/);
});

test('Markdown preserves block text, lists, CTA and safe image paths while escaping raw HTML', () => {
  const item = draft();
  const output = renderMarkdown(item);
  assert.match(output, /^# 校园春日阅读/);
  assert.match(output, /请提前准备：/);
  assert.match(output, /- 一本喜欢的书/);
  assert.match(output, /!\[校园阅读照片\]\(<assets\/campus.png>\)/);
  assert.match(output, /## 参与方式/);
  const unsafe = renderMarkdown(draft({ title: '<script>alert(1)</script>', blocks: [{ id: 'p', type: 'paragraph', text: '[bad](javascript:alert(1))', sourceBlockIds: [] }] }));
  assert.doesNotMatch(unsafe, /<script>/);
  assert.ok(unsafe.includes('\\[bad\\]'));
});

test('review includes fact provenance, missing fields, warnings and unverified import limitations', () => {
  const output = renderReview(draft({ issues: [{ code: 'CHECK', severity: 'warning', message: '<script>人工核对</script>', blockId: 'p1' }] }));
  assert.match(output, /2026年10月25日/);
  assert.match(output, /来源：s1/);
  assert.match(output, /地点：未提供/);
  assert.match(output, /校园春日阅读活动原文/);
  assert.match(output, /秀米兼容性尚未实测/);
  assert.match(output, /Word 仅为可编辑文档候选/);
  assert.match(output, /CHECK/);
  assert.doesNotMatch(output, /<script>/);
});

function unzipEntry(buffer: Buffer, wanted: string): string {
  let end = buffer.length - 22;
  for (; end >= Math.max(0, buffer.length - 65557); end--) if (buffer.readUInt32LE(end) === 0x06054b50) break;
  assert.ok(end >= 0, 'ZIP end of central directory exists');
  const entries = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index++) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50);
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    if (name === wanted) {
      const local = buffer.readUInt32LE(position + 42);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const bytes = buffer.subarray(start, start + compressedSize);
      assert.ok(method === 0 || method === 8);
      return (method === 8 ? inflateRawSync(bytes) : bytes).toString('utf8');
    }
    position += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Missing ZIP entry ${wanted}`);
}

for (const theme of ['campus', 'formal', 'vibrant'] as const) {
  test(`Word ${theme}: document.xml contains editable source text, list numbering and image placeholders`, async () => {
    const buffer = await createDocx(draft({ theme }));
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    const xml = unzipEntry(buffer, 'word/document.xml');
    for (const text of ['校园春日阅读', '保留可编辑的中文段落。', '这是第二行。', '请提前准备：', '一本喜欢的书', '一段读书感悟', '地点：图书馆', '活动现场配图', '[图片待人工插入] 校园阅读照片', '图片说明：同学们一起读书', '参与方式', 'https://example.com/register?event=1&amp;from=campus']) assert.ok(xml.includes(text), text);
    assert.match(xml, /<w:t\b/);
    assert.match(xml, /<w:p\b/);
    assert.match(xml, /<w:numPr>/);
    assert.match(xml, /<w:br\s*\/>/);
    assert.doesNotMatch(xml, /<w:drawing\b|<w:pict\b/);
  });
}

test('Word text is XML escaped and dangerous image sources never become external relationships', async () => {
  const xmlText = '<script>alert(1)</script> & "中文"';
  const buffer = await createDocx(draft({ title: xmlText, blocks: [{ id: 'im', type: 'image', text: xmlText, image: { src: 'https://example.com/do-not-fetch.png', alt: '需人工插入', caption: '' }, sourceBlockIds: [] }] }));
  const xml = unzipEntry(buffer, 'word/document.xml');
  assert.match(xml, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp;/);
  assert.match(xml, /图片待人工插入/);
  const relations = unzipEntry(buffer, 'word/_rels/document.xml.rels');
  assert.doesNotMatch(relations, /do-not-fetch|TargetMode="External"/);
});
