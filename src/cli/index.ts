import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, basename } from 'node:path';
import { DraftSchema, type Draft, type ThemeId } from '../core/schema.js';
import { createOfflineDraft, validateDraft } from '../core/draft.js';
import { readSource, textSource } from '../ingest/index.js';
import { generateWithModel } from '../generation/index.js';
import { createDocx, renderArticle, renderMarkdown, renderPreview, renderReview } from '../render/index.js';

const help = `PushGo — 本地活动推送草稿与可编辑富文本导出

npm run pushgo -- draft --input <文件> --out <新目录> [--theme campus|formal|vibrant] [--style "简洁,温暖"]
npm run pushgo -- draft --text "简短描述" --out <新目录> [--provider offline|openai]
npm run pushgo -- render --draft <article.json> --out <新目录> [--theme formal]
npm run pushgo -- inspect --input <文件>

输入：UTF-8 文本、Markdown、DOCX、文字型 PDF。默认离线，仅摘录整理，不是 AI 润色。
模型模式必须显式 --provider openai，并配置 OPENAI_API_KEY、OPENAI_MODEL；
可选 OPENAI_BASE_URL（默认 https://api.openai.com/v1）。材料将发送至该接口，可能收费。
风格词：模型模式影响表达；离线模式只保留为风格记录，视觉主题由 --theme 控制。
输出：article.json、article.html、preview.html、article.md、article.docx、review.md。
输出包含原材料和摘录，请只保存在本地私有目录。输出目录必须不存在，不会覆盖。
秀米导入需要单独验证；富文本/Word 是候选，非平台兼容性承诺。
`;

function themeValue(value?: string): ThemeId {
  if (!value) return 'campus';
  if (!['campus', 'formal', 'vibrant'].includes(value)) throw new Error('theme 必须是 campus、formal 或 vibrant。');
  return value as ThemeId;
}
function within(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function assertNewDirectory(path: string): Promise<void> {
  try { await lstat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('输出目录已存在。请选择新目录；为防止覆盖，此工具不提供 --force。');
}
async function checkOutput(output: string, input?: string): Promise<string> {
  const target = resolve(output);
  // Resolve existing parents to prevent symlink/junction aliases entering the raw source directory.
  await assertNewDirectory(target);
  let ancestor = dirname(target);
  const missing: string[] = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
  const canonicalTarget = join(ancestor, ...missing, basename(target));
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  for (const rawPath of [resolve(projectRoot, 'raw_data'), resolve('raw_data')]) {
    const protectedRoot = await realpath(rawPath).catch(() => rawPath);
    if (within(canonicalTarget, protectedRoot)) throw new Error('输出目录不能放在 raw_data 原材料目录中。');
  }
  if (input && within(await realpath(input), canonicalTarget)) throw new Error('输出目录不能包含输入原文件。');
  return target;
}
async function exportDraft(draft: Draft, output: string, input?: string): Promise<void> {
  const target = await checkOutput(output, input);
  await mkdir(dirname(target), { recursive: true });
  const temporary = await mkdtemp(join(dirname(target), '.pushgo-'));
  try {
    const files: Record<string, string | Buffer> = {
      'article.json': `${JSON.stringify(draft, null, 2)}\n`,
      'article.html': renderArticle(draft), 'preview.html': renderPreview(draft),
      'article.md': renderMarkdown(draft), 'review.md': renderReview(draft),
      'article.docx': await createDocx(draft),
    };
    for (const [name, data] of Object.entries(files)) await writeFile(join(temporary, name), data, { flag: 'wx' });
    // Reserve output exclusively. Copy-by-rename of each file happens only inside our reserved directory.
    await mkdir(target);
    try {
      for (const name of Object.keys(files)) await rename(join(temporary, name), join(target, name));
    } catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`已导出到 ${target}`);
  console.log(`模式：${draft.mode}；${draft.issues.filter(issue => issue.severity === 'error').length} 项错误，${draft.issues.filter(issue => issue.severity === 'warning').length} 项提醒。请先阅读 review.md，再打开 preview.html。`);
  console.log('秀米可编辑导入尚待平台实测。输出包含原文，请勿直接上传到公开仓库。');
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, text: { type: 'string' }, out: { type: 'string' }, draft: { type: 'string' },
    theme: { type: 'string' }, style: { type: 'string' }, provider: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0];
  if (values.help || !command) { console.log(help); return; }
  if (positionals.length !== 1) throw new Error('只能指定一个命令；带空格的文件路径请用引号。');
  if (command === 'inspect') {
    if (!values.input || values.text || values.draft || values.out) throw new Error('inspect 只接受 --input 文件。');
    console.log(JSON.stringify(await readSource(resolve(values.input)), null, 2));
    return;
  }
  if (!['draft', 'render'].includes(command)) throw new Error('未知命令。请使用 --help。');
  if (!values.out) throw new Error('请用 --out 指定新的本地输出目录。');
  await checkOutput(values.out, values.input ? resolve(values.input) : values.draft ? resolve(values.draft) : undefined);
  const keywords = values.style?.split(/[,，、]/u).map(value => value.trim()).filter(Boolean) ?? [];
  let draft: Draft;
  if (command === 'render') {
    if (!values.draft || values.input || values.text || values.provider) throw new Error('render 需要 --draft，不能同时指定输入或模型接口。');
    draft = validateDraft(DraftSchema.parse(JSON.parse(await readFile(resolve(values.draft), 'utf8'))));
    if (values.theme) draft.theme = themeValue(values.theme);
    if (values.style) draft.styleKeywords = keywords;
    await exportDraft(draft, values.out, resolve(values.draft));
  } else {
    if (Boolean(values.input) === (values.text !== undefined) || values.draft) throw new Error('draft 需要且只能指定 --input 或 --text 其中一个。');
    const theme = themeValue(values.theme);
    const provider = values.provider ?? 'offline';
    if (!['offline', 'openai'].includes(provider)) throw new Error('provider 必须为 offline 或 openai。');
    const source = values.input ? await readSource(resolve(values.input)) : textSource(values.text!);
    if (provider === 'openai') {
      console.log('显式模型模式：将材料发送至配置的接口；仅发起一次请求，可能产生费用。');
      draft = await generateWithModel(source, theme, keywords, {
        apiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? '',
        baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      });
    } else draft = createOfflineDraft(source, theme, keywords);
    await exportDraft(draft, values.out, values.input ? resolve(values.input) : undefined);
  }
}

main().catch((error: unknown) => {
  // Validation errors may include submitted values: keep diagnostics private and brief.
  console.error(error instanceof Error && error.name !== 'ZodError' ? error.message : '草稿结构无效，请根据 schema 检查本地文件。');
  process.exitCode = 1;
});
