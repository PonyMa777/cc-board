// Synthetic projects only; no real project copies, models, or project command execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createValidationWorkspace, verifyValidationSources, collectValidationEvidence } from '../validation-workspace.mjs';

if (process.platform !== 'win32') throw new Error('Windows-only validation-copy test; never fall back to a different temporary root.');
const root = await fs.mkdtemp('D:/ChatGPT-Temp/ccboard-validation-tests-');
process.env.TEMP = process.env.TMP = process.env.TMPDIR = root;
let passed = 0;
async function test(label, fn) { await fn(); console.log('ok ' + label); passed++; }
async function project(name) { const source = path.join(root, name); await fs.mkdir(source); return source; }

await test('copies ordinary files including Unicode and records exact hashes and isolated temp paths', async () => {
  const source = await project('ordinary 项目');
  await fs.mkdir(path.join(source, 'src'));
  await fs.mkdir(path.join(source, 'empty'));
  const bytes = Buffer.from('export const greeting = "你好";\n');
  await fs.writeFile(path.join(source, 'src', '中文 name.mjs'), bytes);
  await fs.writeFile(path.join(source, 'package.json'), '{"scripts":{"test":"DO NOT EXECUTE"}}');
  const before = await fs.readFile(path.join(source, 'src', '中文 name.mjs'));
  const copy = await createValidationWorkspace(source);
  assert.match(copy.cwd, /ccboard-validation-[^\\/]+[\\/]project$/);
  assert.deepEqual(await fs.readFile(path.join(copy.cwd, 'src', '中文 name.mjs')), bytes);
  assert.equal(copy.manifest.find(m => m.path === 'src/中文 name.mjs').sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(copy.manifest.length, 2);
  assert.ok((await fs.stat(path.join(copy.cwd, 'empty'))).isDirectory());
  assert.deepEqual(await fs.readFile(path.join(source, 'src', '中文 name.mjs')), before);
  assert.deepEqual(copy.env, { TEMP: copy.tempDir, TMP: copy.tempDir, TMPDIR: copy.tempDir });
  assert.ok(copy.tempDir.startsWith(path.dirname(copy.cwd) + path.sep));
  assert.ok((await fs.stat(path.join(path.dirname(copy.cwd), 'manifest.json'))).isFile());
  assert.notEqual((await createValidationWorkspace(source)).cwd, copy.cwd);
});

await test('excludes hidden files, credentials, dependencies, runtime data and oversized files explicitly', async () => {
  const source = await project('excluded');
  for (const name of ['.git', 'node_modules', 'windows-data', 'credentials', '.hidden']) {
    await fs.mkdir(path.join(source, name)); await fs.writeFile(path.join(source, name, 'sensitive.txt'), 'NEVER COPY');
  }
  for (const name of ['.env', 'auth.json', 'secrets.txt', 'token.txt', 'password.txt', 'private-key.pem', 'id_rsa', 'id_ed25519', 'server.key', 'server.pem', 'client.p12', 'client.pfx']) await fs.writeFile(path.join(source, name), 'NEVER COPY');
  await fs.writeFile(path.join(source, 'hidden-by-attribute.txt'), 'NEVER COPY');
  await promisify(execFile)('attrib.exe', ['+H', path.join(source, 'hidden-by-attribute.txt')], { windowsHide: true });
  await fs.writeFile(path.join(source, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(source, 'safe.md'), 'allowed');
  const copy = await createValidationWorkspace(source);
  assert.deepEqual(copy.manifest.map(m => m.path), ['safe.md']);
  assert.deepEqual(await fs.readdir(copy.cwd), ['safe.md']);
  assert.ok(copy.limitations.some(x => x.includes('large.bin') && x.includes('2MB')));
  assert.ok(copy.limitations.some(x => x.includes('hidden-by-attribute.txt')));
});

await test('does not follow junctions and does not copy hardlinked files', async () => {
  const source = await project('links'), outside = await project('outside');
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside fixture');
  await fs.symlink(outside, path.join(source, 'jump'), 'junction');
  await fs.link(path.join(outside, 'private.txt'), path.join(source, 'hard.txt'));
  await fs.writeFile(path.join(source, 'safe.txt'), 'safe');
  const copy = await createValidationWorkspace(source);
  assert.deepEqual(copy.manifest.map(m => m.path), ['safe.txt']);
  assert.ok(copy.limitations.some(x => x.includes('重解析')));
  assert.ok(copy.limitations.some(x => x.includes('硬链接')));
  await assert.rejects(createValidationWorkspace(path.join(source, 'jump')), /链接|跳转/);
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside fixture');
});

await test('rejects broad, relative, missing and non-directory sources', async () => {
  for (const source of [path.parse(root).root, 'D:/ChatGPT-Temp', os.homedir(), path.dirname(os.homedir())]) {
    await assert.rejects(createValidationWorkspace(source), /范围过宽/);
  }
  await assert.rejects(createValidationWorkspace('relative/path'), /绝对路径/);
  await assert.rejects(createValidationWorkspace(path.join(root, 'missing')));
  const source = path.join(root, 'not-directory.txt'); await fs.writeFile(source, 'fixture');
  await assert.rejects(createValidationWorkspace(source), /普通目录/);
});

await test('fails instead of returning a partial copy when the file count exceeds 2000', async () => {
  const source = await project('too-many');
  for (let i = 0; i < 2001; i++) await fs.writeFile(path.join(source, `file-${i}.txt`), 'x');
  await assert.rejects(createValidationWorkspace(source), /2000/);
});

await test('fails instead of returning a partial copy when the total exceeds 50MB', async () => {
  const source = await project('too-large');
  for (let i = 0; i < 26; i++) await fs.writeFile(path.join(source, `file-${i}.bin`), Buffer.alloc(2 * 1024 * 1024));
  await assert.rejects(createValidationWorkspace(source), /50MB/);
});

await test('does not accept a source that changes while being copied', async () => {
  const source = await project('changing'); await fs.writeFile(path.join(source, 'sample.txt'), 'old');
  const originalOpen = fs.open; let changed = false;
  fs.open = async (...args) => {
    if (args[0] === path.join(source, 'sample.txt') && !changed) { changed = true; await fs.appendFile(args[0], ' changed'); }
    return originalOpen(...args);
  };
  try { await assert.rejects(createValidationWorkspace(source), /副本创建失败.*源文件发生变化/); }
  finally { fs.open = originalOpen; }
});

await test('rescan rejects a file introduced between inventory and directory stat', async () => {
  const source = await project('inventory-race'); await fs.mkdir(path.join(source, 'nested'));
  await fs.writeFile(path.join(source, 'nested', 'old.txt'), 'old');
  const original = fs.lstat; let changed = false;
  fs.lstat = async (...args) => {
    if (args[0] === path.join(source, 'nested') && !changed) { changed = true; await fs.writeFile(path.join(source, 'nested', 'new-critical.test.mjs'), 'new'); }
    return original(...args);
  };
  try { await assert.rejects(createValidationWorkspace(source), /清单发生变化/); }
  finally { fs.lstat = original; }
});

await test('source verification rejects added, removed and changed allowed files', async () => {
  const source = await project('verify'); const file = path.join(source, 'one.txt'); await fs.writeFile(file, 'one');
  const copy = await createValidationWorkspace(source); assert.equal(await verifyValidationSources(source, copy.manifest), true);
  await fs.writeFile(path.join(source, 'added.txt'), 'two'); await assert.rejects(verifyValidationSources(source, copy.manifest), /新增、删除或改变/);
  await fs.unlink(path.join(source, 'added.txt')); await fs.writeFile(file, 'changed'); await assert.rejects(verifyValidationSources(source, copy.manifest));
  await fs.unlink(file); await assert.rejects(verifyValidationSources(source, copy.manifest));
});

await test('new test artifacts expose contents and explicitly flag omitted sensitive or truncated files', async () => {
  const source = await project('evidence'); await fs.writeFile(path.join(source, 'one.txt'), 'one');
  const copy = await createValidationWorkspace(source);
  await fs.writeFile(path.join(copy.cwd, 'checks.mjs'), 'assert.equal(actual, expected);');
  let evidence = await collectValidationEvidence(copy.cwd, copy.manifest);
  assert.equal(evidence.complete, true); assert.equal(evidence.files.length, 1); assert.match(evidence.files[0].content, /assert.equal/);
  await fs.writeFile(path.join(copy.cwd, 'server.key'), 'DO NOT SEND');
  await fs.writeFile(path.join(copy.cwd, 'long.txt'), 'x'.repeat(13000));
  evidence = await collectValidationEvidence(copy.cwd, copy.manifest);
  assert.equal(evidence.complete, false); assert.ok(!JSON.stringify(evidence).includes('DO NOT SEND'));
  assert.ok(evidence.files.find(file => file.path === 'long.txt').truncated);
});

await test('classifies only two exact PowerShell runtime paths without hiding other binary or hidden artifacts', async () => {
  const source = await project('runtime-evidence'); await fs.writeFile(path.join(source, 'one.txt'), 'one');
  const copy = await createValidationWorkspace(source);
  const runtime = path.join(copy.cwd, 'AppData', 'Local', 'Microsoft', 'PowerShell'); await fs.mkdir(runtime, { recursive: true });
  for (const name of ['StartupProfileData-NonInteractive', 'telemetry.uuid']) await fs.writeFile(path.join(runtime, name), Buffer.from([0, 1, 2, 3]));
  let evidence = await collectValidationEvidence(copy.cwd, copy.manifest);
  assert.equal(evidence.complete, true); assert.equal(evidence.files.length, 0); assert.equal(evidence.runtimeArtifacts.length, 2);
  assert.ok(evidence.runtimeArtifacts.every(file => file.size === 4 && /^[a-f0-9]{64}$/.test(file.sha256) && !Object.hasOwn(file, 'content')));
  assert.ok(evidence.limitations.every(note => note.includes('PowerShell运行缓存非测试脚本')));
  await fs.writeFile(path.join(runtime, 'other-cache.bin'), Buffer.from([0, 9]));
  evidence = await collectValidationEvidence(copy.cwd, copy.manifest); assert.equal(evidence.complete, false);
  await fs.unlink(path.join(runtime, 'other-cache.bin'));
  await fs.writeFile(path.join(copy.cwd, 'telemetry.uuid'), Buffer.from([0, 9]));
  evidence = await collectValidationEvidence(copy.cwd, copy.manifest); assert.equal(evidence.complete, false);
  await fs.unlink(path.join(copy.cwd, 'telemetry.uuid'));
  await fs.writeFile(path.join(runtime, '.hidden'), 'omitted');
  evidence = await collectValidationEvidence(copy.cwd, copy.manifest); assert.equal(evidence.complete, false);
});

console.log(`PASS ${passed} validation-workspace tests. Synthetic artifacts retained: ${root}`);
