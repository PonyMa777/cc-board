// Codex's official newline-delimited app-server protocol; no database/file edits.
import { spawn } from 'node:child_process';
import path from 'node:path';

export function codexRequest(bin, home, method, params, { timeout = 20000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child, timer, buffer = '', done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer);
      child?.stdin.destroy(); child?.kill();
      error ? reject(error) : resolve(result);
    };
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    try {
      child = spawnProcess(bin, ['app-server', '--stdio'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CODEX_HOME: path.join(home, '.codex') },
      });
      timer = setTimeout(() => finish(new Error('Codex 请求超时；请刷新列表确认存档状态后重试。')), timeout);
      child.on('error', e => finish(e));
      child.on('exit', () => finish(new Error('Codex 存档服务提前退出。')));
      child.stdin.on('error', e => finish(e));
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 8 * 1024 * 1024) return finish(new Error('Codex 响应过大。'));
        let end;
        while (!done && (end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.id !== 1 && message.id !== 2) continue;
          if (message.error) return finish(new Error(message.error.message || 'Codex 请求失败。'));
          if (!Object.hasOwn(message, 'result')) return finish(new Error('Codex 响应缺少结果。'));
          if (message.id === 1) {
            send({ method: 'initialized', params: {} });
            send({ id: 2, method, params });
          } else finish(null, message.result);
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ccboard', version: '0.2.0' }, capabilities: null } });
    } catch (e) { finish(e); }
  });
}
