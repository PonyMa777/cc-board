// A bounded, hashed copy for independent validation. Never executes project code.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const TEMP_ROOT = 'D:/ChatGPT-Temp';
const MAX_FILES = 2000, MAX_TOTAL = 50 * 1024 * 1024, MAX_FILE = 2 * 1024 * 1024;
const EXCLUDED = /^(?:\.|node_modules$|windows-data$|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$))|(?:auth|credential|secret|token|password|private[._-]?key)|\.(?:key|pem|p12|pfx)$/i;
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root, value) => {
  const relative = path.relative(key(root), key(value));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const inventorySignature = listed => JSON.stringify({
  entries: listed.entries.map(item => [item.path, item.directory]).sort((a, b) => a[0].localeCompare(b[0])),
  skipped: listed.skipped.map(item => [item.path, item.reason]).sort((a, b) => a[0].localeCompare(b[0])),
});

// Node does not expose every Windows reparse/hidden attribute. Enumerate with
// FileAttributes, refusing to descend into those entries. Input is JSON on stdin,
// never shell interpolation; no helper script is written to disk.
const INVENTORY = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$entries = [Collections.Generic.List[object]]::new()
$skipped = [Collections.Generic.List[object]]::new()
$pending = [Collections.Generic.Stack[string]]::new()
$pending.Push([string]$request.source)
$count = 0; $bytes = 0L; $directories = 0
while ($pending.Count -gt 0) {
  $directory = $pending.Pop()
  $attributes = [IO.File]::GetAttributes($directory)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Source directory became a reparse point.' }
  $directories++
  if ($directories -gt 10000) { throw 'Validation source exceeds 10000 directories.' }
  foreach ($entry in [IO.DirectoryInfo]::new($directory).GetFileSystemInfos()) {
    $relative = $entry.FullName.Substring($request.source.Length).TrimStart([char[]]'\\/')
    $reason = $null
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $reason = '链接或重解析点' }
    elseif (($entry.Attributes -band [IO.FileAttributes]::Hidden) -ne 0 -or $entry.Name -match $request.excluded) { $reason = '隐藏、依赖、运行数据或敏感命名' }
    $isDirectory = ($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0
    if (!$reason -and !$isDirectory -and $entry.Length -gt $request.maxFile) { $reason = '超过单文件 2MB 限制' }
    if ($reason) { $skipped.Add(@{path=$relative;reason=$reason}); if ($skipped.Count -gt 10000) { throw 'Too many excluded entries.' }; continue }
    if ($isDirectory) { $entries.Add(@{path=$relative;directory=$true}); $pending.Push($entry.FullName) }
    else {
      $count++; $bytes += $entry.Length
      if ($count -gt $request.maxFiles -or $bytes -gt $request.maxTotal) { throw 'Validation source exceeds 2000 files or 50MB; no complete workspace was created.' }
      $entries.Add(@{path=$relative;directory=$false})
    }
  }
}
@{entries=$entries.ToArray();skipped=$skipped.ToArray()} | ConvertTo-Json -Depth 5 -Compress
`;

async function inventory(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(INVENTORY, 'utf16le').toString('base64')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', error = '', settled = false;
    const finish = (failure, value) => { if (settled) return; settled = true; clearTimeout(timer); if (failure) child.kill(); failure ? reject(failure) : resolve(value); };
    const timer = setTimeout(() => finish(new Error('验证副本目录扫描超时，未创建可用副本。')), 60000);
    child.on('error', e => finish(e)); child.stdin.on('error', e => finish(e));
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 8 * 1024 * 1024) finish(new Error('验证目录清单过大，已中止。')); });
    child.stderr.on('data', chunk => { error = (error + chunk).slice(0, 4000); });
    child.on('close', code => {
      if (code !== 0) return finish(new Error('验证副本扫描失败：' + error.replace(/\s+/g, ' ').trim()));
      try { finish(null, JSON.parse(output.replace(/^\uFEFF/, ''))); } catch { finish(new Error('验证目录清单无效，未创建可用副本。')); }
    });
    child.stdin.end(JSON.stringify({ source, excluded: EXCLUDED.source, maxFile: MAX_FILE, maxFiles: MAX_FILES, maxTotal: MAX_TOTAL }));
  });
}

async function canonicalDirectory(value) {
  const resolved = path.resolve(value), stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('验证源必须是普通目录，不能是链接。');
  const canonical = await fs.realpath(resolved);
  if (key(canonical) !== key(resolved)) throw new Error('验证目录路径包含链接或重解析跳转。');
  return canonical;
}

async function hashedInventory(source) {
  const canonical = await canonicalDirectory(source), listed = await inventory(canonical);
  const signature = inventorySignature(listed);
  const manifest = [];
  for (const entry of listed.entries) {
    if (entry.directory) continue;
    const full = path.resolve(canonical, entry.path);
    if (!within(canonical, full) || key(await fs.realpath(full)) !== key(full)) throw new Error('验证文件路径越界或包含链接。');
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('验证文件类型发生变化。');
    if (stat.nlink > 1) { listed.skipped.push({ path: entry.path, reason: '硬链接文件' }); continue; }
    if (stat.size > MAX_FILE) throw new Error('验证文件超过大小限制。');
    const handle = await fs.open(full, 'r');
    let bytes;
    try {
      if (!same(stat, await handle.stat())) throw new Error('验证读取期间文件发生变化。');
      bytes = await handle.readFile();
      if (bytes.length !== stat.size || !same(stat, await handle.stat()) || !same(stat, await fs.lstat(full))) throw new Error('验证读取期间文件发生变化。');
    } finally { await handle.close(); }
    manifest.push({ path: entry.path.split(path.sep).join('/'), size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  if (inventorySignature(await inventory(canonical)) !== signature) throw new Error('验证读取期间源清单发生变化。');
  return { canonical, listed, manifest: manifest.sort((a, b) => a.path.localeCompare(b.path)) };
}

/** Fail closed when any allowed source file was added, removed or changed. */
export async function verifyValidationSources(source, manifest) {
  const actual = await hashedInventory(source);
  const expected = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actual.manifest) !== JSON.stringify(expected)) throw new Error('受测源文件已新增、删除或改变，旧测试证据不能验收当前版本。');
  return true;
}

/** Capture new test/config artifacts for independent QA; omissions never imply completeness. */
export async function collectValidationEvidence(cwd, manifest) {
  const { canonical, listed, manifest: actual } = await hashedInventory(cwd);
  const originals = new Set(manifest.map(file => key(file.path)));
  const files = [], runtimeArtifacts = [], limitations = listed.skipped.map(item => '未读取 ' + item.path + '：' + item.reason);
  let complete = limitations.length === 0;
  let remaining = 64 * 1024;
  for (const file of actual) {
    if (originals.has(key(file.path))) continue;
    const full = path.resolve(canonical, file.path);
    if (!within(canonical, full) || key(await fs.realpath(full)) !== key(full)) throw new Error('新增验证文件路径越界。');
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size !== file.size) throw new Error('新增验证文件在读取前发生变化。');
    const bytes = await fs.readFile(full);
    if (!same(stat, await fs.lstat(full)) || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('新增验证文件在读取期间发生变化。');
    if (/^AppData\/Local\/Microsoft\/PowerShell\/(?:StartupProfileData-NonInteractive|telemetry\.uuid)$/i.test(file.path)) {
      runtimeArtifacts.push({ ...file, classification: 'powershell-runtime-cache' });
      limitations.push('PowerShell运行缓存非测试脚本，未作为测试证据读取内容：' + file.path);
      continue;
    }
    const limit = Math.min(12 * 1024, remaining), truncated = bytes.length > limit;
    const binary = bytes.includes(0);
    const content = binary ? '' : bytes.subarray(0, limit).toString('utf8');
    remaining -= binary ? 0 : Math.min(bytes.length, limit);
    if (truncated || binary) { complete = false; limitations.push('新增文件未完整读取：' + file.path + (binary ? '（二进制）' : '（内容上限）')); }
    files.push({ ...file, content, truncated: truncated || binary });
  }
  return { files, runtimeArtifacts, complete, limitations };
}

/** Copy allowed files; skipped entries are explicit limitations, never a complete-project claim. */
export async function createValidationWorkspace(source) {
  if (process.platform !== 'win32') throw new Error('受控验证副本目前仅支持 Windows，不能改用其他临时位置。');
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('验证源目录必须是绝对路径。');
  const canonical = await canonicalDirectory(source);
  const homes = [os.homedir()];
  try { homes.push(os.userInfo().homedir); } catch {}
  if (canonical === path.parse(canonical).root || within(canonical, path.resolve(TEMP_ROOT)) || homes.some(home => within(canonical, path.resolve(home)))) {
    throw new Error('验证源范围过宽：不能复制磁盘根、用户主目录或临时目标的祖先目录。');
  }
  // Do not silently create a different location if D: is absent or restricted.
  const temporaryRoot = await canonicalDirectory(TEMP_ROOT);
  if (within(canonical, temporaryRoot)) throw new Error('验证源不能包含临时目标目录。');
  const sourceStat = await fs.lstat(canonical);
  const listed = await inventory(canonical);
  if (!Array.isArray(listed.entries) || !Array.isArray(listed.skipped)) throw new Error('验证目录清单格式无效。');
  const originalInventorySignature = inventorySignature(listed);
  const entries = [], names = new Set(); let count = 0, total = 0;
  for (const entry of listed.entries) {
    if (typeof entry.path !== 'string' || typeof entry.directory !== 'boolean') throw new Error('验证目录清单项无效。');
    const full = path.resolve(canonical, entry.path), relative = path.relative(canonical, full);
    if (!relative || !within(canonical, full) || path.isAbsolute(entry.path) || names.has(key(relative)) || relative.split(path.sep).some(name => EXCLUDED.test(name))) throw new Error('验证清单包含不安全或重复路径。');
    names.add(key(relative));
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isDirectory() !== entry.directory || key(await fs.realpath(full)) !== key(full)) throw new Error('验证源包含链接、特殊文件或扫描期间发生变化。');
    if (stat.isFile() && stat.nlink > 1) { listed.skipped.push({ path: relative, reason: '硬链接文件' }); continue; }
    if (stat.isFile() && (++count > MAX_FILES || stat.size > MAX_FILE || (total += stat.size) > MAX_TOTAL)) throw new Error('验证源超过 2000 文件、50MB 总量或单文件 2MB 限制。');
    entries.push({ full, relative, directory: entry.directory, stat });
  }
  const taskRoot = await fs.mkdtemp(path.join(temporaryRoot, 'ccboard-validation-'));
  if (!within(temporaryRoot, await canonicalDirectory(taskRoot))) throw new Error('临时验证副本路径不在指定目录内。');
  const cwd = path.join(taskRoot, 'project'), tempDir = path.join(taskRoot, 'temp');
  await fs.mkdir(cwd); await fs.mkdir(tempDir);
  const manifest = [], limitations = ['此副本仅包含允许的文件；未复制依赖目录、隐藏项、敏感命名文件及链接。准备副本时未执行项目代码；实际执行见命令记录。'];
  for (const skipped of listed.skipped) limitations.push('已跳过 ' + skipped.path + '：' + skipped.reason);
  try {
    for (const entry of entries.sort((a, b) => a.relative.split(path.sep).length - b.relative.split(path.sep).length || a.relative.localeCompare(b.relative))) {
      const destination = path.resolve(cwd, entry.relative);
      if (!within(cwd, destination) || key(await fs.realpath(entry.full)) !== key(entry.full)) throw new Error('复制期间出现路径越界或链接。');
      if (key(await fs.realpath(path.dirname(destination))) !== key(path.dirname(destination))) throw new Error('验证目标目录包含链接或发生变化。');
      const current = await fs.lstat(entry.full);
      if (current.isSymbolicLink() || current.ino !== entry.stat.ino || current.dev !== entry.stat.dev || current.isDirectory() !== entry.directory) throw new Error('复制期间源路径发生变化。');
      if (entry.directory) { await fs.mkdir(destination); continue; }
      const handle = await fs.open(entry.full, 'r');
      let bytes;
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink > 1 || !same(before, entry.stat)) throw new Error('复制期间源文件发生变化。');
        bytes = await handle.readFile();
        if (!same(before, await handle.stat()) || bytes.length !== before.size || bytes.length > MAX_FILE) throw new Error('复制期间源文件发生变化。');
      } finally { await handle.close(); }
      await fs.writeFile(destination, bytes, { flag: 'wx' });
      manifest.push({ path: entry.relative.split(path.sep).join('/'), size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
    // A concurrent edit after its own file copy must not be presented as a single verified revision.
    if (!same(await fs.lstat(canonical), sourceStat)) throw new Error('复制期间源目录发生变化，副本未确认完整。');
    for (const entry of entries) if (!same(await fs.lstat(entry.full), entry.stat)) throw new Error('复制期间源目录或文件发生变化，副本未确认完整。');
    manifest.sort((a, b) => a.path.localeCompare(b.path));
    const rescanned = await inventory(canonical);
    if (inventorySignature(rescanned) !== originalInventorySignature) throw new Error('复制期间源清单发生变化，副本未确认完整。');
    await verifyValidationSources(canonical, manifest);
    await fs.writeFile(path.join(taskRoot, 'manifest.json'), JSON.stringify({ source: canonical, manifest, limitations }, null, 2), { flag: 'wx' });
    return { cwd, manifest, limitations, tempDir, env: { TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir } };
  } catch (error) {
    // Retain diagnostic artifacts, never delete user files or return a partial copy as usable.
    throw new Error('验证副本创建失败；残留副本不可用于验收：' + taskRoot + '。' + error.message, { cause: error });
  }
}
