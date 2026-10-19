import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillSource = path.join(repositoryRoot, 'skills', 'campus-push-writer');

// Copies only the public Skill package, never inputs, outputs, credentials or node_modules.
async function copyPackage(source, destination) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Skill 包中含符号链接，安装已停止。');
    if (entry.isDirectory()) {
      await mkdir(to);
      await copyPackage(from, to);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      await copyFile(from, to);
    } else {
      throw new Error('Skill 包中含非预期文件，安装已停止。');
    }
  }
}

export async function installWritingSkill(workspaceRoot = repositoryRoot) {
  const root = await realpath(workspaceRoot);
  let parent = root;
  for (const segment of ['.cursor', 'skills']) {
    parent = path.join(parent, segment);
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('安装父路径必须是普通目录。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(parent);
    }
  }
  const destination = path.join(parent, 'campus-push-writer');
  try {
    // Atomic directory creation refuses existing packages, including links.
    await mkdir(destination);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('写作 Skill 已存在；请先比较本地修改，不会自动覆盖。');
    throw error;
  }
  await copyPackage(skillSource, destination);
  return destination;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length > 2) {
    console.error('用法：npm run skill:install（安装到当前项目的 .cursor/skills，不接受额外参数）');
    process.exitCode = 1;
  } else {
    installWritingSkill().then(() => {
      console.log('写作 Skill 已复制到项目 .cursor/skills/campus-push-writer；请在 Cursor 中检查发现状态。');
    }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
