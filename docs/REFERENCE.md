# 炮炮签到站（Paopao Checkin Manager）

当前版本：`0.7.6`。

炮炮签到站是面向普通用户的网页签到管理器，提供任务、模板、会话、运行记录、通知、注册与角色权限管理。它不是单个站点脚本；通用浏览器执行内核仍在根目录 `src/`，管理端在 `app/`。

## 文档入口

- 项目目标、实现逻辑和后续方向：[docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md)
- 正式环境状态、发布与回滚记录：[docs/PRODUCTION_ROLLOUT.md](docs/PRODUCTION_ROLLOUT.md)
- 版本变更记录：[CHANGELOG.md](CHANGELOG.md)
- 长期 UX 质量参考：[docs/UX_QUALITY_REFERENCE.md](docs/UX_QUALITY_REFERENCE.md)
- 已完成阶段的历史路线：[docs/HISTORY_IMPLEMENTATION_ROADMAP.md](docs/HISTORY_IMPLEMENTATION_ROADMAP.md)

`app/README.md` 的有效内容已合并到本文，后续只维护这一个 README，避免说明分叉。

## 当前能力

- 多用户登录、邀请注册、主管理员、运营管理员和普通用户权限边界。
- 任务、模板、运行记录、会话、通知和系统设置管理。
- 浏览器表单签到、人工登录会话复用、每任务代理、失败截图和通知策略。
- 受限 HTTP Flow、HAR 导入和模板审核能力；正式环境当前保持 HTTP Flow 关闭。
- 浅色、深色和跟随系统主题；桌面端和移动端响应式布局。

验证码只允许用户人工处理。状态不明确、多候选、页面变化或结果不可确认时，执行链路必须安全停止，不猜测点击。

## 账号与权限

- 首屏默认是普通用户登录，管理员入口保留在登录页底部。
- 主管理员由原有主密码进入，可管理角色、注册策略、权限默认值和永久删除。
- 运营管理员可处理用户状态、异常任务、会话、运行记录和模板审核，但不能修改主管理员专属设置。
- 普通用户只能访问自己的任务、模板、运行记录、会话和通知。
- 管理员不能查看任务密码、Cookie 或通知密钥，也不能代用户运行任务。
- 正式环境建议保持 `CHECKIN_ALLOW_REGISTRATION=true`，并在系统设置里使用“邀请注册”。环境变量是注册总开关，关闭后所有用户注册都会停止。

## 本地开发

要求 Node.js 22 或更高版本。项目以 npm 和 `package-lock.json` 为依赖基线。

```bash
cd app
npm ci
npm run dev
```

开发服务打开 `http://127.0.0.1:5173`。首次访问会要求创建至少 10 个字符的主密码。

常用验证：

```bash
cd app
npm run typecheck
npm test
npm run build
```

生产构建由 Fastify 在 `http://127.0.0.1:8787` 同时提供页面和 API：

```bash
cd app
npm start
```

根目录 `src/` 是正式镜像仍在使用的浏览器执行内核，不是废弃目录，不能删除。

## 正式运行

正式服务器使用 `app/docker-compose.production.yml`。管理服务只映射到 `127.0.0.1:8787`，由 1Panel/OpenResty 通过 HTTPS 域名反向代理。

正式容器重建前必须在项目根目录运行：

```bash
./scripts/preserve-production-flags.sh
```

该脚本会从现有容器读取并保留全部 `CHECKIN_FEATURE_*` 与 `CHECKIN_ALLOW_REGISTRATION`，备份并合并到 `app/.env`。只允许合并目标变量，禁止为了新增单个变量覆盖整个 `.env`。

重新创建正式容器时再进入 `app/` 执行生产 compose 命令。重建后必须检查容器健康、重启次数、HTTPS、数据库版本、任务数量、会话状态、功能开关和错误日志。

普通回归验证不要触发真实外部签到。优先使用模拟模式、只读检查、隔离构建和页面验证。

从 Windows/Codex 工作区发布正式环境时，统一使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-production.ps1
```

脚本会自动从工作区根目录查找部署密钥 `.codex-temp-deploy/lynvx_deploy_ed25519`，也可通过 `PAOPAO_PROD_SSH_KEY` 指定其它密钥；它会生成发布包、上传到正式服务器、备份源码与数据、保留功能开关、重建容器并做健康检查。不得再手写分散的 `ssh`/`scp` 命令绕过这条发布路径。

## 数据与安全

- SQLite 数据库：`app/data/paopao-checkin.sqlite`
- 本地加密密钥：`app/data/paopao-secret.key`
- 失败截图：`app/data/screenshots`
- 主密码只保存 Argon2id 哈希。
- 任务凭据、Cookie 和通知密钥使用 AES-256-GCM 加密。
- API 不返回原始凭据，编辑时留空表示保持现有值。
- `app/data`、日志、截图、发布包、缓存和依赖目录不应提交或公开。

重置本地环境前先停止服务，并自行备份或移走 `app/data` 中的数据库和密钥。正式数据不得用于模拟测试。

## 发布与版本

版本号只在形成可部署的线上产品变化时更新。纯问答、只读检查、本地文件清理、说明文档和协作记忆不升级版本。

- `x.0.0`：大版本，必须由项目所有者明确确认。
- `0.x.0`：较大的功能更新或方向变化。
- `0.0.x`：可部署的 Bug 修复、小功能或小范围体验调整。

版本更新不等于线上部署。只有用户明确要求部署，或当前任务本身包含部署时，才更新正式容器。

正式发布前应记录用户可感知变化、兼容性或迁移影响、验证结果、发布包、备份点和回滚镜像。发布记录维护在 [docs/PRODUCTION_ROLLOUT.md](docs/PRODUCTION_ROLLOUT.md)，版本记录维护在 [CHANGELOG.md](CHANGELOG.md)。
