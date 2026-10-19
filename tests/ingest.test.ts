import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Document, Packer, Paragraph } from 'docx';
import { readSource, textSource } from '../src/ingest/index.js';

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'pushgo-ingest-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('BOM/CRLF text normalizes, hashes bytes, and remains unchanged', async () => fixture(async directory => {
  const path = join(directory, 'sample.md');
  const bytes = Buffer.from('\uFEFF活动名称：星河\r\n地点：待定\r\n');
  await writeFile(path, bytes);
  const source = await readSource(path);
  assert.equal(source.kind, 'markdown');
  assert.equal(source.blocks.length, 2);
  assert.equal(source.blocks[0]?.text, '活动名称：星河');
  assert.equal(source.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readFile(path), bytes);
}));

test('synthetic DOCX is locally extracted as editable paragraph text', async () => fixture(async directory => {
  const path = join(directory, 'synthetic.docx');
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('活动名称：虚构分享会'), new Paragraph('地点：待定')] }] }));
  await writeFile(path, bytes);
  const source = await readSource(path);
  assert.equal(source.kind, 'docx');
  assert.ok(source.blocks.some(block => block.text.includes('虚构分享会')));
  assert.ok(source.warnings.length);
  assert.deepEqual(await readFile(path), bytes);
}));

function simplePdf(text?: string): Buffer {
  const stream = text ? `BT /F1 12 Tf 30 60 Td (${text}) Tj ET` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('text PDF carries page provenance; empty PDF reports OCR limit honestly', async () => fixture(async directory => {
  const path = join(directory, 'synthetic.pdf');
  await writeFile(path, simplePdf('Synthetic campus article'));
  const source = await readSource(path);
  assert.equal(source.kind, 'pdf');
  assert.match(source.blocks[0]!.location, /第 1 页/);
  assert.match(source.blocks[0]!.text, /Synthetic campus article/);
  await writeFile(path, simplePdf());
  await assert.rejects(readSource(path), /OCR/);
}));

test('empty, invalid UTF8, unsupported format and oversized sources fail clearly', async () => fixture(async directory => {
  assert.throws(() => textSource('   '), /为空/);
  assert.throws(() => textSource('a'.repeat(150_001)), /超过/);
  const path = join(directory, 'bad.txt');
  await writeFile(path, Buffer.from([0xff, 0xfe]));
  await assert.rejects(readSource(path));
  const doc = join(directory, 'old.doc');
  await writeFile(doc, 'not an accepted format');
  await assert.rejects(readSource(doc), /支持/);
  await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1));
  await assert.rejects(readSource(path), /20 MB/);
}));
