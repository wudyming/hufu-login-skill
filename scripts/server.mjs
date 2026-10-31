import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { saveSession } from './core.mjs';

export async function startLogin({ config, output, timeoutMs = 300000, exchange, assets }) {
  const secret = randomBytes(32).toString('hex');
  let origin, busy = false, finished = false, timer;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const finish = (result) => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    server.close(); server.closeIdleConnections();
    resolveDone(result);
  };
  const server = createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== new URL(origin).host) return json(403, { error: 'Host 不匹配' });
    if (finished) return json(410, { error: '登录已结束' });
    try {
      if (req.method === 'GET' && ['/', '/login.js'].includes(req.url)) {
        const content = await readFile(new URL(req.url === '/' ? 'assets/index.html' : 'dist/login.js', assets));
        res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); res.end(content); return;
      }
      if (req.method !== 'POST' || req.headers['x-login-session'] !== secret || req.headers.origin !== origin) return json(403, { error: '无效本地会话' });
      if (req.url === '/config') return json(200, { chainId: config.chainId, nodeUrl: config.nodeUrl, service: config.service, scope: config.scope });
      if (req.url === '/cancel') { json(200, {}); finish({ ok: false, error: '登录已取消' }); return; }
      if (req.url !== '/complete') return json(404, { error: '未知接口' });
      if (busy) return json(409, { error: '正在处理登录' });
      busy = true;
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new Error('请求过大'); }
      const { proof } = JSON.parse(body);
      if (typeof proof !== 'string' || !proof) throw new Error('缺少身份凭证');
      const session = await exchange(proof, config);
      if (finished) return json(410, { error: '登录已结束' });
      await saveSession(output, session);
      json(200, { account: session.account }); finish({ ok: true, account: session.account, output });
    } catch {
      json(400, { error: '身份验证或认证请求失败，请检查配置和网络后重试' });
      finish({ ok: false, error: '身份验证或认证请求失败（凭证无效、认证服务或网络异常）' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  timer = setTimeout(() => finish({ ok: false, error: '等待扫码超时' }), timeoutMs);
  return { url: `${origin}/#${secret}`, done, cancel: () => finish({ ok: false, error: '登录已取消' }) };
}
