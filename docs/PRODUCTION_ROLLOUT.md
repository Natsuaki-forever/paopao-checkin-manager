# 正式上线记录

更新时间：2026-07-09（Asia/Shanghai）

## 当前状态

- 正式域名：`https://checkin.boyneverdie.xyz/`
- 应用名称：炮炮签到站（Paopao Checkin Manager）
- 应用版本：`0.7.6`
- 正式容器：`paopao-checkin-manager`
- 数据库迁移版本：v12
- 2026-07-10 已上线 0.7.6 构建可靠性修复：管理端显式声明 `playwright@1.61.0`，类型检查和 Docker 构建不再依赖基础镜像中的隐含模块。无数据迁移、接口、权限、执行链路或环境变量变化。
- 0.7.6 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12。
- 正式镜像为 `paopao-checkin-manager:0.7.6`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue、Session 与邀请注册保持启用，HTTP Flow 保持关闭；容器重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-09 已上线 0.7.5 权限复选框宽屏源规则修复与执行模板页结构重设计：新用户默认能力、用户管理弹窗同类权限网格左对齐；执行模板分类、层级和列表语言与日常工作页统一。无数据迁移、接口、权限、执行链路或环境变量变化。
- 0.7.5 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12。
- 正式镜像为 `paopao-checkin-manager:0.7.5`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-09 已上线 0.7.4 UI 细节修复与发布脚本整理：执行模板、我的投稿、浅/深色预览、系统设置间距、4K 邀请码行和运行记录字体统一；无数据迁移、接口或权限变化。
- 0.7.4 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12。
- 正式镜像为 `paopao-checkin-manager:0.7.4`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-09 已上线 0.7.3 登录页宽屏重心、小猪位置、邀请码行、服务状态、全站运行状态色和深色模式异常白块修复；无数据迁移、接口或权限变化。
- 0.7.3 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12。
- 正式镜像为 `paopao-checkin-manager:0.7.3`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-08 已上线 0.7.2 登录页状态小猪与左侧文案精简；四个透明 WebP 状态覆盖用户登录、密码聚焦、注册和管理员入口，无数据迁移、接口或权限变化。
- 0.7.2 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12，保留 2 个任务、24 条运行记录和 2 个加密会话。
- 正式镜像为 `paopao-checkin-manager:0.7.2`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-08 已上线 0.7.1 账户页间距修复与登录页签到时间轨道；无数据迁移、接口或权限变化。
- 0.7.1 正式镜像通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据库保持 v12，保留 2 个任务、24 条运行记录和 2 个加密会话。
- 正式镜像为 `paopao-checkin-manager:0.7.1`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-08 已上线 0.7.0 运行总览、真实下次执行时间、分步任务向导、精简导航、设置分区和桌面/移动端视觉重构。
- 0.7.0 Docker 基线通过 22 个测试文件共 62 项测试、执行内核与管理端生产构建；正式数据副本验证 v12 完整性正常，保留 2 个任务、24 条运行记录和 2 个加密会话。
- 正式镜像为 `paopao-checkin-manager:0.7.0`，容器健康、重启次数为 0；公网 HTTPS、健康接口、邀请注册状态和未登录鉴权已验证，未触发真实签到。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 保持启用；重建前已通过 `scripts/preserve-production-flags.sh` 保留全部 4 个正式开关。
- 2026-07-07 已上线多用户资源隔离、主管理员/运营管理员权限边界、用户能力与配额、邀请注册、密码重置、模板审核和审计日志。
- 登录页默认显示普通用户登录，管理员入口保留在下方；正式注册方式已从公开注册切换为邀请注册。
- v11→v12 迁移后，原有 2 个任务、22 条运行记录和 2 个加密会话全部保留并归属主管理员；迁移后数据库完整性正常，无活动 Job。
- Queue 与 Session 保持启用，HTTP Flow 保持关闭，`CHECKIN_ALLOW_REGISTRATION` 总开关保持启用；容器重建未覆盖原功能开关。
- 0.6.0 正式镜像在 Docker 中通过 19 个测试文件共 55 项测试、前后端生产构建和 v11 数据副本升级演练；桌面及 390px 移动端界面无控制台错误。
- 正式容器镜像为 `paopao-checkin-manager:0.6.0`，健康状态正常、重启次数为 0；公网 HTTPS、健康接口和未登录鉴权状态已验证，未触发真实签到。
- Queue：已启用；2026-07-04 至 2026-07-06 的生产定时任务验收均成功
- Session：已启用；`Lynvx` 与 `fuliba论坛` 的加密会话均有效并已连续复用成功
- HTTP Flow：生产环境未启用；候选镜像隔离验收已通过
- 2026-07-07 已修复 0.5.0 重建容器后 Queue/Session 环境开关未持久化的问题；现已恢复 Queue 与 Session，保留两份有效会话，HTTP Flow 继续关闭
- 正式容器健康检查、HTTPS、鉴权保护和数据库完整性检查均已通过
- 代理 CONNECT 检测已通过，检测时间与结果会持久化显示；修改代理地址后自动回到待检测
- 人工登录已灰度上线：单会话、10 分钟过期、公网跳转校验、会话状态加密保存；人工会话期间 Queue 保持排队
- Session 已在确认人工会话有效后单独放量；Queue 继续开启，HTTP Flow 仍关闭
- `fuliba论坛` 签到入口已根据失败截图固定为 `#fx_checkin_b`（`alt="签到领奖"`）；线上只读验证为唯一、可见且可用，未在验证中点击
- 失败截图位于 `app/data/screenshots`，可从运行记录详情查看；已按当前 30 天保留设置自动清理过期记录、对应截图和遗留截图
- 数据库已迁移至 v9；截图采用“保留天数 + 容量上限”双条件，任一先到就从最旧截图开始清理，当前上限 500 MB
- 系统设置已显示截图数量/容量、数据库容量、运行记录和已完成 Job 数量；自动清理过期运行记录、已完成 Job、失败/遗留截图和失效人工会话令牌
- 任务编辑页已直接开放“签到入口文字”词库，用户可用 `|` 分隔多个完整按钮文字；CSS 选择器仍位于高级识别项
- 通用签到入口识别已扩展为：显式 CSS → 按钮文字 → `alt/title/aria-label` → `id/class/href/src` 中受控的 `checkin/qiandao/daily-sign/claim` 标记；多候选时仍安全停止，不单独模糊匹配 `sign`
- 线上只读干跑已在不使用任务专用 CSS 时自动命中 `fx_checkin_b` / `alt="签到领奖"`，未点击外部站点
- 人工登录已加入“选择签到元素”模式：在模式内点击远程画面只做元素定位与红框高亮，不向目标站点发送鼠标点击；用户二次确认后才将唯一选择器写入当前任务
- 已修复任务绑定模板时的配置覆盖问题：模板仅提供初始值，词库和人工选中的 CSS 可按任务独立保存
- 线上只读选择器干跑已返回 `#fx_checkin_b`、`label="签到领奖"` 及正确的高亮坐标，`clicked=false`
- Docker 日志已限制为单文件 10 MB、最多 3 份；备份和回滚镜像不自动删除
- 2026-07-04 至 2026-07-06，`Lynvx` 与 `fuliba论坛` 的 Queue + Session 生产定时执行均成功，会话已持续更新
- 数据库已迁移至 v10；`Lynvx 预置模板` 已更名为`通用账号密码网页登录`，并与 `Discuz 论坛签到骨架` 分别补充适用场景说明
- 执行模板页已精简为“预置模板 / 用户模板”两张表，不再显示内部 `v1` 和冗长使用说明
- 添加任务时可直接选择预置模板；保存后自动生成任务专用的用户模板，删除任务时同步清理不再使用的专用模板
- 正式环境已完成预置模板直用验收：停用任务创建、专用模板生成及删除清理全部通过，未触发外部签到
- `0.5.0` 已上线用户注册/登录与独立管理员入口；普通用户和管理员暂时共用功能及数据，角色权限差异留待后续版本实现
- 主题已支持浅色、深色和跟随设备三种模式，并在登录页与管理界面共用
- HAR 导入已并入“新建模板”窗口，原独立侧边栏入口已移除
- 正式环境已显式开启用户注册；容器健康、HTTPS、鉴权状态、v11 迁移、任务/会话保留和无活动 Job 均已验证，未触发真实签到

## 发布与回滚点

- 0.7.6 正式目录：`/root/paopao-checkin-manager`
- 0.7.6 正式镜像：`paopao-checkin-manager:0.7.6`
- 0.7.6 发布包：`/root/paopao-checkin-manager-0.7.6-20260710-100335.tar.gz`
- 0.7.6 发布包 SHA-256：`a14a602b85fcc442c62c05d67cb9fd78ccfc788eb033f2b59b1f9f4f1a827b24`
- 0.7.6 发布前备份：`/root/paopao-backups/20260710-100337-pre-0.7.6`
- 0.7.6 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260710-100340`
- 0.7.6 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.6-20260710-100337`
- 0.7.6 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。

- 0.7.5 正式目录：`/root/paopao-checkin-manager`
- 0.7.5 正式镜像：`paopao-checkin-manager:0.7.5`
- 0.7.5 发布包：`/root/paopao-checkin-manager-0.7.5-20260709-155357.tar.gz`
- 0.7.5 发布包 SHA-256：`98ee0f9af7b4dd2348f77708294731e31683b89f2063f5002c717499d55d1f51`
- 0.7.5 发布前备份：`/root/paopao-backups/20260709-155357-pre-0.7.5`
- 0.7.5 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260709-155401`
- 0.7.5 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.5-20260709-155357`
- 0.7.5 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。
- 0.7.4 正式目录：`/root/paopao-checkin-manager`
- 0.7.4 正式镜像：`paopao-checkin-manager:0.7.4`
- 0.7.4 发布包：`/root/paopao-checkin-manager-0.7.4-20260709-151327.tar.gz`
- 0.7.4 发布包 SHA-256：`125ca34e214ab847ace05b720c56ae3502e37f1500b179208d0d504756f81da7`
- 0.7.4 发布前备份：`/root/paopao-backups/20260709-151327-pre-0.7.4`
- 0.7.4 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260709-151329`
- 0.7.4 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.4-20260709-151327`
- 0.7.4 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。
- 0.7.3 正式目录：`/root/paopao-checkin-manager`
- 0.7.3 正式镜像：`paopao-checkin-manager:0.7.3`
- 0.7.3 发布包：`/root/paopao-checkin-manager-0.7.3-20260709.tar.gz`
- 0.7.3 发布包 SHA-256：`9e32c359466dc0ef088c2fd2a938e469e037b1e3d7c58e61f03cde6b419ad325`
- 0.7.3 发布前备份：`/root/paopao-backups/20260709-095859-pre-0.7.3`
- 0.7.3 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260709-095919`
- 0.7.3 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.3-20260709-095859`
- 0.7.3 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。
- 0.7.2 正式目录：`/root/paopao-checkin-manager`
- 0.7.2 正式镜像：`paopao-checkin-manager:0.7.2`
- 0.7.2 发布包：`/root/paopao-checkin-manager-0.7.2-20260708.tar.gz`
- 0.7.2 发布包 SHA-256：`599d3ba6e55b9895bddc24954b9180279cf59f6629cfe8bdd87b6575dbf0deb9`
- 0.7.2 发布前备份：`/root/paopao-backups/20260708-151854-pre-0.7.2`
- 0.7.2 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260708-151859`
- 0.7.2 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.2-20260708-151854`
- 0.7.2 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。
- 0.7.1 正式目录：`/root/paopao-checkin-manager`
- 0.7.1 正式镜像：`paopao-checkin-manager:0.7.1`
- 0.7.1 发布包：`/root/paopao-checkin-manager-0.7.1-20260708.tar.gz`
- 0.7.1 发布包 SHA-256：`18d51350567be5ef9dde2ba2a8d837a80c24e5c5a7204bf092519ea9ac0ac662`
- 0.7.1 发布前备份：`/root/paopao-backups/20260708-145212-pre-0.7.1`
- 0.7.1 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260708-145214`
- 0.7.1 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.1-20260708-145212`
- 0.7.1 没有数据迁移；回滚时仍应同时恢复发布前数据与环境备份。
- 0.7.0 正式目录：`/root/paopao-checkin-manager`
- 0.7.0 正式镜像：`paopao-checkin-manager:0.7.0`
- 0.7.0 发布包：`/root/paopao-checkin-manager-0.7.0-20260708.tar.gz`
- 0.7.0 发布包 SHA-256：`2015b94c2451cb1308fe58b6a0409312ecdcd3a55cdb2037149023d390dc0ac2`
- 0.7.0 发布前备份：`/root/paopao-backups/20260708-142409-pre-0.7.0`
- 0.7.0 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260708-142422`
- 0.7.0 回滚镜像：`paopao-checkin-manager:rollback-before-0.7.0-20260708-142409`
- 0.7.0 没有数据库迁移；回滚时仍优先同时恢复发布前数据和环境备份，避免运行期间新增状态与旧镜像不一致。
- 0.6.0 正式目录：`/root/paopao-checkin-manager`
- 0.6.0 正式镜像：`paopao-checkin-manager:0.6.0`
- 0.6.0 发布包：`/root/paopao-checkin-manager-0.6.0-20260707-1125.tar.gz`
- 0.6.0 发布包 SHA-256：`bf9b67e1b95f89440597cafd03b804c2f5f391e21f66f49437dd42a85a2fe21a`
- 0.6.0 发布前源码备份：`/root/paopao-backups/20260707-1125-pre-0.6.0/source.tar.gz`
- 0.6.0 发布前数据备份：`/root/paopao-backups/20260707-1125-pre-0.6.0/data.tar.gz`
- 0.6.0 发布前环境备份：`/root/paopao-backups/20260707-1125-pre-0.6.0/env.before`
- 0.6.0 功能开关合并备份：`/root/paopao-checkin-manager/app/.env.before-recreate-20260707-112130`
- 0.6.0 回滚镜像：`paopao-checkin-manager:rollback-before-0.6.0-20260707`
- 回滚 0.5.0 时必须同时恢复上述 v11 数据备份，禁止让 0.5.0 直接打开已迁移至 v12 的正式数据库。
- 0.5.0 正式目录：`/root/paopao-checkin-manager`
- 0.5.0 正式镜像：`paopao-checkin-manager:0.5.0`
- 0.5.0 发布包：`/root/paopao-checkin-manager-0.5.0-20260707.tar.gz`
- 0.5.0 发布包 SHA-256：`e9b25f15c12e1534bead5564f4e76c0430ac4fcf56d994aa965765b51da89d03`
- 0.5.0 发布前源码备份：`/root/paopao-backups/20260707-0945-pre-0.5.0/source.tar.gz`
- 0.5.0 发布前数据备份：`/root/paopao-backups/20260707-0945-pre-0.5.0/data.tar.gz`
- 0.5.0 回滚镜像：`paopao-checkin-manager:rollback-before-0.5.0-20260707`
- 0.5.0 Queue/Session 开关修复前环境备份：`/root/paopao-backups/20260707-1005-session-queue-fix/env.before`
- 0.4.1 正式目录：`/root/paopao-checkin-manager`
- 0.4.1 正式镜像：`paopao-checkin-manager:0.4.1`
- 正式更名前数据备份：`/root/lynvx-auto-checkin/demo/backups/20260706-paopao-rename-data.tar.gz`
- 正式更名前回滚镜像：`demo-manager:rollback-before-paopao-0.4.1-20260706`
- 旧容器已改名为 `paopao-checkin-manager-legacy-rollback` 并停止保留，未删除旧源码与数据
- 发布包：`/root/lynvx-auto-checkin-release-20260703-115000.tar.gz`
- 发布包 SHA-256：`bb6754818abaee671e0ec7a4cd355c93d4c23cb43c46028712f4730a393c3528`
- 发布前备份：`demo/backups/20260703-115000`
- v7 基线备份：`demo/backups/20260703-115700-v7-baseline`
- 回滚镜像：`demo-manager:rollback-20260703-115000`
- 界面改进发布包：`/root/lynvx-auto-checkin-ui-20260703-160000.tar.gz`
- 界面改进 SHA-256：`7dd952927fce972df7d673bf30da36bd3f3a295a93395c5449aa95ae43ffb112`
- 界面改进发布前备份：`demo/backups/20260703-160000-ui-v7`
- 界面改进回滚镜像：`demo-manager:rollback-ui-v7-20260703-160000`
- 人工登录发布前源码备份：`demo/backups/20260703-1620-manual-login-v1.tar.gz`
- 人工登录回滚镜像：`demo-manager:rollback-manual-login-v1-20260703`
- Session 放量前数据与配置备份：`demo/backups/20260703-1630-session-enable-data.tar.gz`
- `fuliba论坛` 按钮选择器修改前数据库备份：`demo/data/checkin-demo-before-fuliba-selector.sqlite`
- 截图保留发布前源码备份：`demo/backups/20260703-1655-screenshot-retention-src.tar.gz`
- 截图保留回滚镜像：`demo-manager:rollback-before-screenshot-retention-20260703`
- v9 发布前源码备份：`demo/backups/20260703-1710-storage-v9-src.tar.gz`
- v9 迁移前数据备份：`demo/backups/20260703-1715-storage-v9-data.tar.gz`
- v9 回滚镜像：`demo-manager:rollback-before-storage-v9-20260703`
- 属性识别发布前源码备份：`demo/backups/20260703-1730-attribute-detection-src.tar.gz`
- 属性识别回滚镜像：`demo-manager:rollback-before-attribute-detection-20260703`
- 元素选择器发布前源码备份：`demo/backups/20260703-1800-element-picker-src.tar.gz`
- 元素选择器回滚镜像：`demo-manager:rollback-before-element-picker-20260703`
- 模板信息架构发布前源码备份：`demo/backups/20260706-1030-template-ia-src.tar.gz`
- v10 迁移前数据备份：`demo/backups/20260706-1035-template-ia-v10-data.tar.gz`
- 模板信息架构回滚镜像：`demo-manager:rollback-before-template-ia-v10-20260706`
- 预置模板直用流程发布前源码备份：`demo/backups/20260706-template-direct-flow-src.tar.gz`
- 预置模板直用流程回滚镜像：`demo-manager:rollback-before-template-direct-flow-20260706`

0.6.0 发布前已使用正式 v11 数据的一致性副本与候选镜像组合启动验证；任务、运行历史和会话保留，健康接口正常。

## 后续放量门槛

1. Queue：确认 08:00 任务产生 Job，并最终成功关联运行记录。
2. Session：已单独启用，下一次 `fuliba论坛` 执行必须确认读取会话后不再返回验证码。
3. HTTP Flow：只在已完整测试的 HTTP 模板需要正式运行时启用；现有浏览器任务不依赖此开关。
4. 每次放量都检查容器健康、重启次数、数据库完整性、活动 Job 和错误日志。

未经明确授权，不手动触发真实外部签到任务。

## 容器重建前置检查

1. 确认没有活动 Job，并备份数据库、密钥、源码和当前环境文件。
2. 在正式项目根目录运行 `./scripts/preserve-production-flags.sh`。脚本必须从现有容器读取并保留全部 `CHECKIN_FEATURE_*` 与 `CHECKIN_ALLOW_REGISTRATION`。
3. 检查生成的 `app/.env.before-recreate-*` 回滚文件存在，再执行 `docker compose ... up -d --force-recreate`。
4. 禁止为新增一个环境变量覆盖整个 `.env`；只能更新或追加目标键。
5. 重建后逐项核对功能开关、容器健康、重启次数、数据库迁移、会话状态、活动 Job 与错误日志。

## 回滚原则

出现容器无法启动、数据库完整性失败、任务丢失或执行链路异常时，停止继续放量。优先关闭新增功能开关；若仍不能恢复，则使用已验证的旧镜像和与其匹配的发布前数据备份恢复。不得直接对正式数据库执行降级迁移。
