# 配置与协议

不传 `--config` 时读取 skill 目录的 `config.prod.json`，其中保存从 `/Users/wudy/source/ai/cv-admin-webui/.env.prod` 提取的登录配置值。它是独立快照，不依赖原文件存在，也不会随原文件更新。可直接执行 `npm run login`；传入 `--config` 时完全使用指定文件。

内置 `config.test.json` 提取自同一项目的 `.env.dev`，作为测试环境配置。两个文件只包含登录所需配置，不包含其他环境变量。

在 skill 目录运行：

```bash
# 测试环境
npm run login -- --config config.test.json --output-dir sessions/test
# 生产环境（默认）
npm run login
```

配置使用 JSON（扩展名 .json），例如：

```json
{"chainId":"<64 位十六进制链 ID>","nodeUrl":"https://<RPC>","authUrl":"https://<认证服务>","service":"https://fwd.hufu.io"}
```

也支持读取源项目简单 KEY=value 格式的 `.env.dev` / `.env.prod`：仅使用 `VITE_APP_CHAIN_ID`、`VITE_APP_CHAIN_NETWORK`、`VITE_APP_AUTH`。不执行 shell 或展开变量。不要复制环境文件里的其他凭证。

scope 固定为 `cisumAdmin`。转发服务默认 `https://fwd.hufu.io`。配置 URL 应来自可信项目配置，账户权限来自 proof。

来源：cv-admin-webui 的 src/utils/anchorUtils.ts 中 initLink、verifyProof、login_anchor，以及 src/apiRequest/index.ts。

流程：AnchorLink.login → IdentityProof → 验证链 ID、scope、链上账户权限及 proof 时效 → POST 认证服务的 `/sign/api/v1/anchor`。

请求字段：signature、message（空字符串）、address（signer.actor）、authority（signer.permission）、scope、expiration。成功响应的 data 必须是非空 token 字符串。每次新扫码都交换 token。

会话 JSON：token、account、authority、chainId、authUrl、obtainedAt（ISO 时间）。只代表认证成功，不保证账户拥有任何具体管理权限。

本地页面通过随机会话标识提交 proof；本地 Node 服务验证 proof 并交换 token，浏览器不接收 token。本地只绑定 127.0.0.1，校验 Host、Origin 和会话标识。取消或超时后停止接受新登录。

兼容细节：SDK 将 scope 编码为 EOSIO Name，因此字符串 `cisumAdmin` 在 proof 中规范化为 `cisum.dmin`。验证使用 SDK 的 Name.from 规范化后比较；发给认证服务的 scope 仍保留原项目的 `cisumAdmin`。

默认会话路径为启动目录下的 `sessions/<账户名>.json`。`--output-dir` 只改变目录；显式 `--output` 优先指定完整文件路径。相同目录中的同一账户重新登录时替换旧文件，不同账户互不覆盖。测试命令使用独立的 `sessions/test/` 目录。成功结果的 output 字段返回实际绝对路径。
