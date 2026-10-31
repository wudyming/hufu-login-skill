import { readFile, open, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function readConfig(path = fileURLToPath(new URL('../config.json', import.meta.url))) {
  const raw = await readFile(path, 'utf8');
  const data = path.endsWith('.json') ? JSON.parse(raw) : Object.fromEntries(
    raw.split(/\r?\n/).filter(line => /^\s*(?:export\s+)?[A-Z_]+=/.test(line))
      .map(line => { const [, key, value] = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/); return [key, value.trim().replace(/^(['"])(.*)\1$/, '$2')]; })
  );
  const config = {
    chainId: data.chainId ?? data.VITE_APP_CHAIN_ID,
    nodeUrl: data.nodeUrl ?? data.VITE_APP_CHAIN_NETWORK,
    authUrl: data.authUrl ?? data.VITE_APP_AUTH,
    service: data.service ?? 'https://fwd.hufu.io', scope: 'cisumAdmin',
  };
  if (!/^[a-f0-9]{64}$/i.test(config.chainId ?? '')) throw new Error('配置缺少有效的 chainId');
  for (const key of ['nodeUrl', 'authUrl', 'service']) {
    const url = new URL(config[key]);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`无效配置: ${key}`);
  }
  return config;
}

export function proofPayload(proof, config) {
  if (proof.chainId.toString() !== config.chainId) throw new Error('证明链 ID 不匹配');
  return { signature: proof.signature.toString(), message: '', address: proof.signer.actor.toString(),
    authority: proof.signer.permission.toString(), scope: config.scope, expiration: proof.expiration.toString() };
}

export async function verifyAndExchange(identityProof, config, sdk, fetchImpl = fetch) {
  const proof = sdk.IdentityProof.from(identityProof);
  const payload = proofPayload(proof, config);
  if (proof.scope.toString() !== sdk.Name.from(config.scope).toString()) throw new Error('证明 scope 不匹配');
  const client = new sdk.APIClient({ url: config.nodeUrl });
  const account = await client.v1.chain.get_account(proof.signer.actor);
  const auth = account.getPermission(proof.signer.permission).required_auth;
  if (!proof.verify(auth, account.head_block_time)) throw new Error('证明无效或已过期');
  const response = await fetchImpl(`${config.authUrl.replace(/\/$/, '')}/sign/api/v1/anchor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`认证服务返回 HTTP ${response.status}`);
  const result = await response.json();
  if (typeof result.data !== 'string' || !result.data.trim()) throw new Error('认证响应缺少 token');
  return { token: result.data, account: payload.address, authority: payload.authority,
    chainId: config.chainId, authUrl: config.authUrl, obtainedAt: new Date().toISOString() };
}

export async function saveSession(path, session) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(session, null, 2) + '\n'); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}
