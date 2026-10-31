import AnchorLink from '@fullon/anchor-link';
import Transport from '@fullon/anchor-link-browser-transport';
const status = document.querySelector('#status');
const button = document.querySelector('#login');
const secret = location.hash.slice(1);
history.replaceState(null, '', '/');
async function call(path, body) {
  const result = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Login-Session': secret }, body: JSON.stringify(body ?? {}) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || '请求失败');
  return data;
}
button.onclick = async () => {
  button.disabled = true;
  try {
    const config = await call('/config');
    const link = new AnchorLink({ transport: new Transport({ currentLocale: 'zh-cn' }), service: config.service,
      chains: [{ chainId: config.chainId, nodeUrl: config.nodeUrl }], storage: null });
    status.textContent = '请使用 HuFu 扫码并确认身份授权';
    const identity = await link.login(config.scope);
    const result = await call('/complete', { proof: String(identity.proof) });
    status.textContent = `登录成功：${result.account}。会话已保存在本机，可以关闭页面。`;
  } catch {
    status.textContent = '登录失败或已取消，请查看终端后重新启动客户端。';
    await call('/cancel').catch(() => {});
  }
};
document.querySelector('#cancel').onclick = async () => {
  await call('/cancel').catch(() => {});
  button.disabled = true; status.textContent = '已取消';
};
