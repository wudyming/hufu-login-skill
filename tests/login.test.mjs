import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAndExchange, saveSession } from '../scripts/core.mjs';
import { startLogin } from '../scripts/server.mjs';
const config = { chainId: 'a'.repeat(64), scope: 'cisumAdmin', nodeUrl: 'https://rpc.example', authUrl: 'https://auth.example' };
function sdk(valid = true, overrides = {}) {
  return { Name: { from: value => value }, IdentityProof: { from: () => ({ chainId: config.chainId, scope: config.scope, signer: { actor: 'alice', permission: 'owner' }, signature: 'SIG_TEST', expiration: '2030-01-01', verify: () => valid, ...overrides }) },
    APIClient: class { v1 = { chain: { get_account: async () => ({ getPermission: permission => { assert.equal(permission, 'owner'); return { required_auth: {} }; }, head_block_time: '2026-01-01' }) } }; } };
}
test('exchange preserves actual authority, empty message and refreshes every time', async () => {
  let count = 0;
  const fetcher = async (url, opts) => {
    count++; assert.equal(url, 'https://auth.example/sign/api/v1/anchor');
    assert.deepEqual(JSON.parse(opts.body), { signature: 'SIG_TEST', message: '', address: 'alice', authority: 'owner', scope: 'cisumAdmin', expiration: '2030-01-01' });
    return { ok: true, json: async () => ({ data: 'synthetic-token' }) };
  };
  const session = await verifyAndExchange('proof', config, sdk(), fetcher);
  await verifyAndExchange('proof', config, sdk(), fetcher);
  assert.equal(count, 2); assert.equal(session.authority, 'owner');
});
test('reject invalid/expired proof, chain and scope mismatch before exchange', async () => {
  for (const instance of [sdk(false), sdk(true, { chainId: 'b'.repeat(64) }), sdk(true, { scope: 'wrong' })]) {
    await assert.rejects(verifyAndExchange('proof', config, instance, () => { assert.fail('must not exchange'); }));
  }
});
test('missing token, HTTP and network failures fail login', async () => {
  for (const fetcher of [async () => ({ ok: true, json: async () => ({ data: null }) }), async () => ({ ok: false, status: 401 }), async () => { throw new Error('network'); }]) {
    await assert.rejects(verifyAndExchange('proof', config, sdk(), fetcher));
  }
});
test('session saved atomically with owner-only permission', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cv-login-'));
  try { const path = join(dir, 'session.json'); await saveSession(path, { token: 'fake' }); assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal(JSON.parse(await readFile(path)).token, 'fake'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
async function fixture(t, exchange = async () => ({ account: 'alice', token: 'fake' }), timeoutMs = 1000) {
  const dir = await mkdtemp(join(tmpdir(), 'cv-login-'));
  const output = join(dir, 'session.json');
  const app = await startLogin({ config, output, exchange, timeoutMs, assets: new URL('../', import.meta.url) });
  t.after(async () => { app.cancel(); await rm(dir, { recursive: true, force: true }); });
  const url = new URL(app.url);
  const post = (path, body = {}, headers = {}) => fetch(url.origin + path, { method: 'POST', headers: { Origin: url.origin, 'X-Login-Session': url.hash.slice(1), ...headers }, body: JSON.stringify(body) });
  return { app, output, post };
}
test('reject untrusted callbacks; valid completion returns no token', async t => {
  const { app, output, post } = await fixture(t);
  assert.equal((await post('/complete', {}, { 'X-Login-Session': 'bad' })).status, 403);
  assert.equal((await post('/complete', {}, { Origin: 'https://evil.example' })).status, 403);
  const response = await post('/complete', { proof: 'synthetic' });
  assert.deepEqual(await response.json(), { account: 'alice' });
  assert.equal((await app.done).ok, true); assert.equal(JSON.parse(await readFile(output)).token, 'fake');
});
test('cancel and timeout create no session', async t => {
  for (const cancel of [true, false]) {
    const { app, output, post } = await fixture(t, undefined, 40);
    if (cancel) await post('/cancel');
    assert.equal((await app.done).ok, false); await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});
test('authentication failure creates no session and hides remote error details', async t => {
  const { app, output, post } = await fixture(t, async () => { throw new Error('secret'); });
  const response = await post('/complete', { proof: 'synthetic' });
  assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('secret'));
  assert.equal((await app.done).ok, false); await assert.rejects(readFile(output), { code: 'ENOENT' });
});
test('real SDK serializes and verifies identity proof with canonical scope', async () => {
  const { default: real } = await import('@fullon/anchor-link');
  const key = real.PrivateKey.generate('K1');
  const proof = real.IdentityProof.from({ chainId: config.chainId, scope: config.scope,
    signer: { actor: 'alice', permission: 'owner' }, expiration: '2030-01-01T00:00:00', signature: key.signDigest('00'.repeat(32)) });
  proof.signature = key.signDigest(proof.transaction.signingDigest(proof.chainId));
  const auth = { threshold: 1, keys: [{ key: key.toPublic(), weight: 1 }], accounts: [], waits: [] };
  assert.equal(proof.scope.toString(), 'cisum.dmin');
  assert.equal(real.IdentityProof.from(String(proof)).verify(auth, '2026-01-01T00:00:00'), true);
  const instance = { ...real, APIClient: class { v1 = { chain: { get_account: async () => ({ getPermission: () => ({ required_auth: auth }), head_block_time: '2026-01-01T00:00:00' }) } }; } };
  const result = await verifyAndExchange(String(proof), config, instance, async () => ({ ok: true, json: async () => ({ data: 'fake' }) }));
  assert.equal(result.account, 'alice');
  proof.expiration = real.TimePointSec.from('2020-01-01T00:00:00');
  await assert.rejects(verifyAndExchange(String(proof), config, instance));
});
test('configuration supports JSON and source dotenv keys', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { readConfig } = await import('../scripts/core.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'cv-login-'));
  try {
    const json = join(dir, 'config.json');
    await writeFile(json, JSON.stringify(config));
    assert.equal((await readConfig(json)).scope, 'cisumAdmin');
    const env = join(dir, '.env.dev');
    await writeFile(env, `VITE_APP_CHAIN_ID="${config.chainId}"\nVITE_APP_CHAIN_NETWORK=${config.nodeUrl}\nVITE_APP_AUTH=${config.authUrl}\nUNRELATED=ignored\n`);
    assert.equal((await readConfig(env)).authUrl, config.authUrl);
    await writeFile(json, '{}'); await assert.rejects(readConfig(json));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('account filenames isolate users and support custom directories and paths', async () => {
  const { sessionPath } = await import('../scripts/core.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'cv-login-'));
  try {
    const alice = sessionPath('alice', { outputDir: dir });
    const bob = sessionPath('bob', { outputDir: dir });
    assert.equal(alice, join(dir, 'alice.json'));
    await saveSession(alice, { account: 'alice', token: 'old' });
    await saveSession(bob, { account: 'bob', token: 'bob-token' });
    await saveSession(alice, { account: 'alice', token: 'new' });
    assert.equal(JSON.parse(await readFile(alice)).token, 'new');
    assert.equal(JSON.parse(await readFile(bob)).token, 'bob-token');
    assert.equal(sessionPath('alice', { output: join(dir, 'custom.json') }), join(dir, 'custom.json'));
    assert.match(sessionPath('alice'), /sessions\/alice\.json$/);
    for (const invalid of ['../bad', '..', '', '/alice']) assert.throws(() => sessionPath(invalid));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
