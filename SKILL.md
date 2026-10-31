---
name: cv-hufu-login
description: 使用 HuFu 钱包扫码登录 Cisum 管理后台认证服务，为 agent 获取后台 API 会话。适用于需要登录或 token 过期后重新认证；需要用户在钱包确认。
---

# HuFu 扫码登录

在本 skill 目录运行命令。客户端独立于管理后台，不需要源项目或钱包私钥。

1. 默认使用随 skill 提供的 `config.prod.json`（提取自 cv-admin-webui 的 .env.prod 登录配置）。用户要求测试环境时，使用 `--config config.test.json`（提取自 .env.dev）；其他环境通过 `--config` 指定文件。配置格式和认证细节见 [协议参考](references/protocol.md)。
2. 首次使用执行 `npm ci --ignore-scripts` 和 `npm run build`。使用 Node.js 20 或以上。
3. 执行 `node scripts/login.mjs`。测试环境执行 `node scripts/login.mjs --config config.test.json --output-dir sessions/test`；生产环境默认输出到 `sessions/<账户名>.json`，测试环境输出到 `sessions/test/<账户名>.json`，避免混用会话。默认等待 300 秒，可用 `--timeout` 修改。
4. 打开终端输出的本机 URL，点击“显示登录二维码”，让用户使用 HuFu 扫码并确认。保持客户端运行直到成功、取消或超时。远程执行环境的 loopback URL 只在执行机器可访问。
5. 以退出码 0 和成功结果中的会话文件为完成标准。只向用户报告账户和会话路径。后续获授权的 API 请求从文件读取 token，使用 `Authorization: Bearer <token>`；不把 token 放进聊天、日志或命令参数。

失败后报告原因，按用户意图重新启动；401 时重新扫码登录，不无限重试。登录授权不代表获准执行其他后台业务操作。钱包确认必须由用户完成。

会话文件含凭证，保存在版本控制之外。默认保存为 `sessions/<账户名>.json`，权限 `0600`。不同账户分别保存；同一目录内同一账户再次登录会覆盖其旧会话。可用 `--output-dir` 指定目录，保留账户名作为文件名；显式 `--output` 可覆盖完整路径。不假定 token 的有效期；`obtainedAt` 仅表示获取时间。退出客户端不会撤销已签发 token；本地不再需要时删除会话文件。
