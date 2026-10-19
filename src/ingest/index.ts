import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import mammoth from 'mammoth';
import type { SourceBlock, SourceDocument } from '../core/schema.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_CHARS = 150_000;
const MAX_PAGES = 100;

export function textSource(text: string, name = '文字描述', kind: SourceDocument['kind'] = 'text'): SourceDocument {
  if (text.length > MAX_CHARS) throw new Error(`材料超过 ${MAX_CHARS} 字符，请拆分后重试。`);
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('材料为空，或没有可提取文字；扫描 PDF 需要先进行本地 OCR。');
  const sha256 = createHash('sha256').update(normalized).digest('hex');
  const blocks: SourceBlock[] = normalized.split(/\n+/).map((text, index) => ({
    id: `b${index + 1}`, location: `段落 ${index + 1}`, text: text.trim(),
  })).filter(block => block.text);
  return { id: sha256.slice(0, 16), name, sha256, kind, blocks, warnings: [] };
}

export async function readSource(path: string): Promise<SourceDocument> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('输入必须是小于 20 MB 的普通文件。');
  const bytes = await readFile(path);
  const extension = extname(path).toLowerCase();
  let source: SourceDocument;
  if (['.txt', '.md', '.markdown'].includes(extension)) {
    source = textSource(new TextDecoder('utf-8', { fatal: true }).decode(bytes), basename(path), extension === '.txt' ? 'text' : 'markdown');
  } else if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: bytes });
    source = textSource(result.value, basename(path), 'docx');
    source.warnings.push(...result.messages.map(message => message.message));
    source.warnings.push('DOCX 仅提取正文与表格可读文字，段落编号为提取后位置；图片、批注和复杂布局需人工核对。');
  } else if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > MAX_PAGES) throw new Error(`PDF 超过 ${MAX_PAGES} 页，请拆分。`);
      const blocks: SourceBlock[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        let text = '';
        for (const item of content.items) {
          if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
        }
        for (const [index, line] of text.split(/\n+/).entries()) {
          if (line.trim()) blocks.push({ id: `p${pageNumber}b${index + 1}`, location: `第 ${pageNumber} 页，提取行 ${index + 1}`, text: line.trim() });
        }
        if (blocks.reduce((length, block) => length + block.text.length, 0) > MAX_CHARS) throw new Error('PDF 文字过长，请拆分。');
      }
      if (!blocks.length) throw new Error('PDF 未提取到文字；可能是扫描件，请先本地 OCR。');
      source = { ...textSource(blocks.map(block => block.text).join('\n'), basename(path), 'pdf'), blocks };
      source.warnings.push('PDF 按页提取，表格列、阅读顺序和图片中文字可能缺失；必须人工核对。');
    } finally {
      await task.destroy();
    }
  } else {
    throw new Error('支持 .txt、.md、.docx 和文字型 .pdf；暂不支持旧版 .doc 或扫描件 OCR。');
  }
  source.sha256 = createHash('sha256').update(bytes).digest('hex');
  source.id = source.sha256.slice(0, 16);
  return source;
}
