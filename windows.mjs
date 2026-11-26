// Windows integration: transcript discovery and explicit interactive CLI launch.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function discoverCodex(home, limit = 60) {
  const root = path.join(home, '.codex', 'sessions');
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
        try { files.push({ file: p, mtime: fs.statSync(p).mtimeMs }); } catch {}
      }
    }
  };
  walk(root);
  const names = new Map();
  try { for (const line of fs.readFileSync(path.join(home, '.codex', 'session_index.jsonl'), 'utf8').split('\n')) {
    try { const j = JSON.parse(line); if (j.id && j.thread_name) names.set(j.id, j.thread_name); } catch {}
  } } catch {}
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit).flatMap(({ file, mtime }) => {
    let fd;
    try {
      fd = fs.openSync(file, 'r'); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, b.length, 0);
      const meta = JSON.parse(b.subarray(0, n).toString('utf8').split('\n')[0]).payload;
      if (!meta?.id || !meta.cwd || meta.source?.subagent) return [];
      return [{ sid: meta.id, cwd: meta.cwd, file, mtime, at: Date.parse(meta.timestamp) || mtime, title: names.get(meta.id) }];
    } catch { return []; } finally { if (fd !== undefined) fs.closeSync(fd); }
  });
}

export const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'";
export function launchCodex(bin, cwd, args = []) {
  if (!bin || !fs.existsSync(bin)) return Promise.resolve({ ok: false, error: '未找到 Codex CLI' });
  if (!fs.existsSync(cwd)) return Promise.resolve({ ok: false, error: '工作目录已不存在：' + cwd });
  const command = `$Host.UI.RawUI.WindowTitle = 'cc-board · Codex'; $env:TERM = 'xterm-256color'; Set-Location -LiteralPath ${psQuote(cwd)}; & ${psQuote(bin)} --no-daemon ${args.map(psQuote).join(' ')}`;
  // A hidden server's detached child is not proof of a visible console. Ask
  // Windows explicitly for a new interactive window and await launcher errors.
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  const launcher = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath powershell.exe -WorkingDirectory ${psQuote(cwd)} -WindowStyle Normal -ArgumentList '-NoLogo -NoProfile -NoExit -EncodedCommand ${encoded}' -ErrorAction Stop | Out-Null`;
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(launcher, 'utf16le').toString('base64')], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let error = '';
    child.stderr.on('data', chunk => { error = (error + chunk).slice(-4000); });
    child.once('error', e => resolve({ ok: false, error: e.message }));
    child.once('close', code => resolve(code === 0 ? { ok: true, name: 'windows-' + child.pid } : { ok: false, error: error.trim() || '无法打开终端窗口' }));
  });
}
