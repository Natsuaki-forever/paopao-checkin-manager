# 炮炮签到站管理端

当前正式版本：`0.11.0`（数据库迁移 v14）。当前验证候选：`0.11.4-rc.4`。

从项目根目录按主 README 的 Docker 或本地运行说明启动。生产环境仅接受 HTTPS 任务地址，并应通过反向代理提供 TLS。生产密钥通过 `CHECKIN_MANAGER_SECRET_PATH` 从独立只读文件加载；Docker 部署时用 `CHECKIN_SECRET_HOST_PATH` 指定该文件的宿主机位置。
