import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { textSource, createOfflineDraft, validateDraft, renderArticle, renderPreview, renderMarkdown, renderReview, createDocx } from '../src/index.js';

// Entirely synthetic, original geometric test cards. No download or private material.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(color: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  };
  const width = 320, height = 120;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const border = x < 8 || y < 8 || x >= width - 8 || y >= height - 8;
    for (let c = 0; c < 3; c++) pixels[offset + c] = border ? 255 : color[c]!;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const output = resolve('.local/xiumi-editable-fixture');
await mkdir(output); // Exclusive: never replace an earlier acceptance fixture.
await mkdir(join(output, 'assets'));
for (const [name, color] of [['test-a.png', [40, 115, 99]], ['test-b.png', [181, 61, 39]], ['test-c.png', [41, 71, 103]]] as const) {
  await writeFile(join(output, 'assets', name), png([...color]), { flag: 'wx' });
}
const source = textSource('活动名称：虚构阅读交流测试\n日期：2026年11月8日\n时间：14:00—16:00\n地点：虚构校园交流室\n报名方式：仅为测试，无真实报名\n一起分享阅读体验。XIUMI-EDIT-001 是需要在秀米修改的虚构标记。\n这段文字应与前文及两张独立图片一起保留。\n准备一本书、一段笔记和一个问题。\n配图为工具本地生成的纯色几何卡片，无人物或第三方素材。');
const draft = createOfflineDraft(source);
draft.blocks = [
  { id: 'intro', type: 'paragraph', text: source.blocks[5]!.text, sourceBlockIds: ['b6'] },
  { id: 'second', type: 'paragraph', text: source.blocks[6]!.text, sourceBlockIds: ['b7'] },
  draft.blocks[0]!,
  { id: 'list', type: 'list', text: '参与准备', items: ['一本书', '一段笔记', '一个问题'], sourceBlockIds: ['b8'] },
  { id: 'image-a', type: 'image', text: '', image: { src: 'assets/test-a.png', alt: '绿色测试卡片', caption: '测试图甲：应单独替换为暖色卡片' }, sourceBlockIds: ['b9'] },
  { id: 'image-c', type: 'image', text: '', image: { src: 'assets/test-c.png', alt: '蓝色测试卡片', caption: '测试图丙：替换另一张图时应保持不变' }, sourceBlockIds: ['b9'] },
];
const checked = validateDraft(draft);
const files: Record<string, string | Buffer> = {
  'article.json': JSON.stringify(checked, null, 2), 'article.html': renderArticle(checked),
  'preview.html': renderPreview(checked), 'article.md': renderMarkdown(checked),
  'review.md': renderReview(checked), 'article.docx': await createDocx(checked),
  'TEST-README.txt': '纯虚构秀米编辑验收样例。图甲绿色，替换图乙暖色，图丙蓝色。图形由本脚本生成，无第三方素材。\n先阅读 docs/acceptance/xiumi-editable.md。未经用户授权，不上传/保存/发布。\n本地 assets 图片不会自动进入秀米，请人工上传图甲与图丙，再单独用图乙替换图甲，记录人工操作。\n将正文 XIUMI-EDIT-001 改成 XIUMI-EDIT-002 后，授权保存并重开核对。\nWord 中图片是占位文字，非嵌入图。不能用本地生成成功冒充平台导入成功。\n',
};
for (const [name, bytes] of Object.entries(files)) await writeFile(join(output, name), bytes, { flag: 'wx' });
console.log(`虚构验收样例：${output}。尚未上传秀米；图片需人工上传替换。`);
