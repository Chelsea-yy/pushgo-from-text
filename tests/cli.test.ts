import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import test from 'node:test';

const cli = resolve('src/cli/index.ts');
function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], { encoding: 'utf8', timeout: 30_000 });
}
async function fixture(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'pushgo-cli-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('CLI drafts and re-renders three themes with editable exports and provenance', async () => fixture(async dir => {
  const source = join(dir, 'input.md');
  const text = '活动名称：虚构校园读书会\n日期：2026年11月8日\n时间：14:00-16:00\n地点：审核后通知\n报名方式：https://example.com/register';
  await writeFile(source, text);
  const output = join(dir, 'campus');
  const first = run('draft', '--input', source, '--out', output, '--style', '温暖,简洁');
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual((await readdir(output)).sort(), ['article.docx', 'article.html', 'article.json', 'article.md', 'preview.html', 'review.md']);
  const draft = JSON.parse(await readFile(join(output, 'article.json'), 'utf8'));
  assert.equal(draft.facts.venue.value, '审核后通知');
  assert.deepEqual(draft.styleKeywords, ['温暖', '简洁']);
  assert.equal(draft.reviewStatus, 'needs-review');
  for (const theme of ['formal', 'vibrant']) {
    const target = join(dir, theme);
    const result = run('render', '--draft', join(output, 'article.json'), '--out', target, '--theme', theme);
    assert.equal(result.status, 0, result.stderr);
    const rendered = JSON.parse(await readFile(join(target, 'article.json'), 'utf8'));
    assert.equal(rendered.theme, theme);
    assert.deepEqual(rendered.facts, draft.facts);
    assert.deepEqual(rendered.source, draft.source);
    assert.match(await readFile(join(target, 'preview.html'), 'utf8'), /contenteditable="true"/);
  }
  const again = run('draft', '--input', source, '--out', output);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /已存在/);
  assert.equal(await readFile(source, 'utf8'), text);
}));

test('project raw_data remains protected when CLI is called from a different directory', async () => fixture(async dir => {
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, cli, 'draft', '--text', 'Synthetic event', '--provider', 'openai', '--out', resolve('raw_data', 'must-not-create')], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /raw_data/);
  assert.doesNotMatch(result.stdout, /显式模型模式/);
}));

test('CLI help, inspect, invalid arguments and protected raw_data output', async () => fixture(async dir => {
  assert.equal(run('--help').status, 0);
  const source = join(dir, 'input.txt');
  await writeFile(source, '只有一段描述。');
  const inspected = run('inspect', '--input', source);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).blocks[0].text, '只有一段描述。');
  for (const args of [
    ['draft', '--text', 'abc', '--input', source, '--out', join(dir, 'bad')],
    ['draft', '--text', 'abc', '--theme', 'bad', '--out', join(dir, 'bad')],
    ['draft', '--text', 'abc', '--provider', 'bad', '--out', join(dir, 'bad')],
    ['render', '--draft', source, '--out', join(dir, 'bad')],
    ['draft', '--text', 'abc', '--out', resolve('raw_data', 'pushgo-test-protected')],
  ]) assert.equal(run(...args).status, 1, args.join(' '));
}));
