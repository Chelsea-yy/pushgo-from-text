import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { installWritingSkill, skillSource } from '../scripts/install_writer_skill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function markdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, item.name);
    if (item.isDirectory()) result.push(...await markdownFiles(name));
    else result.push(name);
  }
  return result;
}

test('writer Skill frontmatter and all relative Markdown references are valid', async () => {
  const main = await readFile(path.join(skillSource, 'SKILL.md'), 'utf8');
  assert.match(main, /^---\r?\nname: campus-push-writer\r?\ndescription: .+\r?\n---/u);
  for (const file of await markdownFiles(skillSource)) {
    assert.equal(path.extname(file), '.md');
    const text = await readFile(file, 'utf8');
    for (const link of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/gu)) {
      if (/^https?:/u.test(link[1]!)) continue;
      const resolved = path.resolve(path.dirname(file), link[1]!);
      assert.ok(!path.relative(skillSource, resolved).startsWith('..'), `Reference escapes package: ${file}`);
      assert.ok((await readFile(resolved, 'utf8')).length > 0);
    }
  }
});

test('writer installer copies exact public package and refuses to overwrite local edits', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pushgo-skill-'));
  try {
    const destination = await installWritingSkill(temporary);
    assert.equal(destination, path.join(temporary, '.cursor', 'skills', 'campus-push-writer'));
    const originals = await markdownFiles(skillSource);
    const installed = await markdownFiles(destination);
    assert.equal(installed.length, originals.length);
    for (const original of originals) {
      assert.deepEqual(await readFile(path.join(destination, path.relative(skillSource, original))), await readFile(original));
    }
    const edited = path.join(destination, 'SKILL.md');
    await writeFile(edited, 'local user edits', 'utf8');
    await assert.rejects(installWritingSkill(temporary), /不会自动覆盖/u);
    assert.equal(await readFile(edited, 'utf8'), 'local user edits');
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('writer installer rejects a file used as its parent directory', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pushgo-skill-'));
  try {
    await writeFile(path.join(temporary, '.cursor'), 'not a directory');
    await assert.rejects(installWritingSkill(temporary), /普通目录/u);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('writer installer refuses linked parent directories without writing outside the workspace', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pushgo-skill-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'pushgo-skill-outside-'));
  try {
    await mkdir(path.join(temporary, '.cursor'));
    await symlink(external, path.join(temporary, '.cursor', 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(installWritingSkill(temporary), /普通目录/u);
    assert.deepEqual(await readdir(external), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('writer rules keep history, metrics, review and standalone CLI boundaries explicit', async () => {
  const skill = await readFile(path.join(skillSource, 'SKILL.md'), 'utf8');
  for (const required of ['历史试写', '未知', '独立审稿', 'article.md', 'revision-log.md', '三轮', '不是模型参数训练', '不自动加载']) {
    assert.ok(skill.includes(required), `Missing documented boundary: ${required}`);
  }
  const portable = await readFile(path.join(skillSource, 'references', 'model-instructions.md'), 'utf8');
  assert.match(portable, /当前独立 CLI 未自动加载/u);
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /skill:install/u);
});
