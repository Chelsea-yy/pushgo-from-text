// Optional local rehearsal checks; not a semantic fact checker or quality scorer.
// This reads private evidence but prints only anonymous counts, never article text or paths.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
try {
  const sources = JSON.parse(await read('.local/private-source-analysis/extractions.json'));
  const ids = ['S01', 'S02', 'S03', 'S04', 'S05'];
  let hashes = 0;
  let artifacts = 0;
  for (const id of ids) {
    const source = sources.find(item => item.id === id);
    if (!source) throw new Error(`${id}: missing extraction record`);
    const current = createHash('sha256').update(await readFile(source.path)).digest('hex');
    if (current !== source.sha256_before || source.sha256_after !== source.sha256_before) {
      throw new Error(`${id}: original source hash changed`);
    }
    hashes++;
    for (const name of ['article.md', 'title-options.md', 'editor-review.md', 'revision-log.md']) {
      const text = await read(`.local/writing-practice/final/${id}/${name}`);
      if (text.trim().length < 40) throw new Error(`${id}: incomplete artifact`);
      if (name === 'article.md') {
        if (!/^# .+/u.test(text)) throw new Error(`${id}: missing final title`);
        for (const marker of ['## 标题备选', '本次材料列出', 'sourceBlockIds', 'page:', 'paragraph:', '编辑审核', '历史试写', '扫描下方二维码']) {
          if (text.includes(marker)) throw new Error(`${id}: editorial or unsupported action marker in article`);
        }
      }
      if (name === 'editor-review.md' && (!text.includes('历史') || !text.includes('阻塞'))) {
        throw new Error(`${id}: missing historical/publication boundary`);
      }
      artifacts++;
    }
    const independent = JSON.parse(await read(`.local/writing-practice/independent-review/${id}.json`));
    if (independent.case_id !== id) throw new Error(`${id}: mismatched first review`);
    JSON.parse(await read(`.local/writing-practice/independent-review/final/${id}.json`));
  }
  const metrics = JSON.parse(await read('.local/writing-study/metrics.json'));
  if (metrics.rows.length !== 9 || new Set(metrics.rows.map(item => item.cell)).size !== 9) {
    throw new Error('Incomplete reference metric ledger');
  }
  const unknownReads = metrics.rows.filter(item => item.read_count === null).length;
  const unknownShares = metrics.rows.filter(item => item.share_forward_count === null).length;
  console.log(JSON.stringify({ source_hashes_unchanged: hashes, final_artifacts_present: artifacts,
    independent_review_pairs_present: ids.length, reference_pages: metrics.rows.length,
    unknown_read_counts: unknownReads, unknown_share_counts: unknownShares,
    scope: 'Structural checks only; human source and editorial review remain required.' }, null, 2));
} catch {
  // File-system exceptions may contain private names; do not forward them to logs.
  console.error('Local writing-practice structural checks failed. Check private evidence locally; no article text or paths logged.');
  process.exitCode = 1;
}
