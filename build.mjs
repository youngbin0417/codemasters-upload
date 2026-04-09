import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const rootDir = process.cwd();
const outDir = join(rootDir, 'dist');
const githubClientId = process.env.GITHUB_CLIENT_ID;
const includeFiles = new Set([
  'background.js',
  'content.js',
  'manifest.json',
  'popup',
  'icons',
]);

if (!githubClientId) {
  throw new Error('GITHUB_CLIENT_ID environment variable is required.');
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await copyTree(rootDir, outDir);
await injectGithubClientId(join(outDir, 'background.js'), githubClientId);

console.log(`Built extension to ${outDir}`);

async function copyTree(srcDir, destDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    if (srcDir === rootDir && !includeFiles.has(entry.name)) {
      continue;
    }

    if (entry.name.endsWith(':Zone.Identifier')) {
      continue;
    }

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyTree(srcPath, destPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function copyFile(srcPath, destPath) {
  const content = await readFile(srcPath);
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, content);
}

async function injectGithubClientId(filePath, value) {
  let content = await readFile(filePath, 'utf8');
  const pattern = /const GITHUB_CLIENT_ID = '';/;

  if (!pattern.test(content)) {
    throw new Error('Could not find GITHUB_CLIENT_ID placeholder in background.js');
  }

  content = content.replace(pattern, `const GITHUB_CLIENT_ID = ${JSON.stringify(value)};`);
  await writeFile(filePath, content, 'utf8');
}
