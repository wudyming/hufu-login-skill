import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readConfig, verifyAndExchange } from './core.mjs';
import { startLogin } from './server.mjs';
const { values } = parseArgs({ options: { config: { type: 'string' }, output: { type: 'string' }, 'output-dir': { type: 'string', default: 'sessions' }, timeout: { type: 'string', default: '300' }, help: { type: 'boolean' } } });
if (values.help) { console.log('node scripts/login.mjs [--config config.local.json] [--output-dir sessions] [--output custom.local.json] [--timeout 300]'); process.exit(0); }
try {
  const timeoutMs = Number(values.timeout) * 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) throw new Error('timeout 应为 1–3600 秒');
  const config = await readConfig(values.config ? resolve(values.config) : undefined);
  const { default: sdk } = await import('@fullon/anchor-link');
  const app = await startLogin({ config, output: values.output ? resolve(values.output) : undefined, outputDir: resolve(values['output-dir']), timeoutMs,
    assets: new URL('../', import.meta.url), exchange: (proof, cfg) => verifyAndExchange(proof, cfg, sdk) });
  console.log(`请打开本机登录页面并点击“显示登录二维码”：\n${app.url}`);
  process.once('SIGINT', app.cancel); process.once('SIGTERM', app.cancel);
  const result = await app.done;
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
} catch (error) { console.error(`启动失败：${error.code ?? error.message}`); process.exitCode = 1; }
