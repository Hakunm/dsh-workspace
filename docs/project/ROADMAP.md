# 路线图

状态只能使用 `planned`、`in-progress`、`blocked` 或 `done`。

| ID | 状态 | 依赖 | 验收条件 |
| --- | --- | --- | --- |
| BOOT-001 | done | - | 独立仓库可安装依赖、构建 Host/Client/standalone 并打包 |
| DOC-001 | done | BOOT-001 | 恢复文档、ADR 和文档校验器可用 |
| DOC-002 | done | DOC-001,REL-002 | 参考高关注 DSH 相关仓库重构中英双语用户 README，插入真实脱敏截图并提供可执行的 GitHub Release 安装路径 |
| DOC-003 | done | DOC-002 | 按发布要求删除中英文 README 的截图环境说明，同时保留两张实际效果图和安装文档 |
| BRAND-002 | done | DOC-002 | 插件用户可见文案和发布截图统一使用社区常用简称 DSH，README 安装标题改为“快速安装” |
| LICENSE-001 | done | REL-002 | 项目自身许可证与 npm 元数据从 MIT 切换为 AGPL-3.0-only，并保留第三方组件原许可证告知 |
| FS-001 | done | BOOT-001 | 授权根、逐段链接检查、列表、读取和 ETag 保存通过测试 |
| FS-002 | done | FS-001 | 新建、移动、上传、软删除、恢复和跨卷回退通过测试 |
| AUTH-001 | done | BOOT-001 | 配对、令牌摘要、scope、根授权、撤销和审计通过测试 |
| NET-001 | done | AUTH-001,FS-002 | 回环默认监听、远程重绑定、限流、CORS、REST 和 WebSocket 可用 |
| NET-002 | done | NET-001,UI-003 | 本机管理面可持久化自定义远程绑定 IP/端口，重绑定失败回滚且三平台行为有测试覆盖 |
| CHAT-001 | done | NET-001 | `ctx.apiProxy` adapter 可列会话、建会话、读消息、发消息和取消 |
| CHAT-002 | done | CHAT-001,AUTH-001 | BFF 可列出或在设备授权目录内创建 DSH 工作区、列出 Agent Preset，并用 `workspaceId` 创建会话且不暴露绝对路径 |
| CHAT-003 | done | CHAT-002 | BFF 把 DSH `assistant/chunk` 规范化为稳定文本/思考增量事件，并允许仅空白会话切换 Agent Preset；已同步 API、SDK 与合约测试 |
| CHAT-004 | done | CHAT-003,AUTH-001 | BFF 可列出并执行当前会话的 DSH host 斜杠命令，TODO 与权限 projection 保持可供移动端读取，命令执行不退化为普通模型消息 |
| CHAT-005 | done | CHAT-002,AUTH-001 | BFF 可重命名/移除 DSH 工作区，并可重命名、分叉和归档会话；归档会话从默认列表隐藏且所有操作保持根授权边界 |
| APPROVAL-001 | done | CHAT-003,AUTH-001 | BFF 缓存 DSH 待审批请求，向获授权设备提供脱敏查询、允许一次与拒绝接口及实时状态事件；不得暴露私有 RPC ID、令牌或原始敏感参数 |
| MODEL-001 | done | CHAT-002,AUTH-001 | BFF 以细粒度设置 scope 暴露供应商有效配置/凭据状态、自定义供应商创建、模型发现、会话模型与思考强度选择，并同步 OpenAPI、SDK 和合约测试 |
| UI-001 | done | NET-001 | 三个官方 slot 和独立 route 提供完整文件工作区与管理面 |
| UI-002 | done | UI-001 | 插件所有用户界面支持中英双语、默认中文、语言偏好持久化且 DSH slot 标签同步切换 |
| UI-003 | done | UI-002 | DSH 侧栏直接打开宿主内完整文件工作区，设置可覆盖打开并返回工作区，独立 route 仅作备用入口 |
| UI-004 | done | UI-003,NET-002 | 远程访问页在无授权根时明确说明无法启用，并在插件设置中展示作者 `Github@Hakunm` |
| SDK-001 | done | NET-001,CHAT-001 | OpenAPI、AsyncAPI 与 Kotlin SDK 覆盖公开接口，包括 DSH 工作区创建和自定义供应商创建 |
| APP-001 | done | SDK-001 | 独立 Android 工程使用 `io.github.hakunm.deepseekharness`、Jetpack Compose、Material 3、DSH 黑色鲸鱼图标和中英双语，Release 使用独立正式签名 |
| APP-002 | in-progress | APP-001,AUTH-001 | App 可通过 HTTP/HTTPS 健康检查和一次性配对连接插件，令牌由 Android Keystore 保护且可撤销/断开 |
| APP-003 | in-progress | APP-002,CHAT-001 | App 可列出/创建会话、查看实时消息、发送/steer、取消，并正确恢复 WebSocket 断线状态 |
| APP-004 | in-progress | APP-002,FS-002 | App 可浏览授权根并完成读取、编辑、ETag 保存、新建、移动、上传、下载、软删除和恢复 |
| PARITY-001 | in-progress | APP-003 | 建立并完成 DSH WebUI 功能对等矩阵；缺失能力只通过版本化、授权明确的插件 BFF 暴露，App 不依赖 DSH 私有 wire |
| TEST-002 | in-progress | APP-001,APP-002 | Android 单元/UI 测试、lint、Release 构建、签名校验和真机/模拟器连接通过 |
| TEST-001 | done | UI-001,SDK-001 | 本机单元、合约、Playwright、SDK、tarball 安装和 DSH 启动通过；hosted Windows、Ubuntu、macOS 与 Node 22.19.0/24 矩阵全部通过 |
| REL-001 | in-progress | TEST-001 | GitHub 公开仓库、`main` 推送和 `dsh-plugin` topic 已完成；等待 hosted CI 与 npm 发布 |
| REL-002 | done | CHAT-005,TEST-001 | `dsh-workspace` v1.0.0 用户文档、版本展示、正式 tarball、独立 Git 仓库和 `v1.0.0` 标签完成 |
| REL-003 | done | BRAND-002,LICENSE-001,DOC-002 | 重新打包 v1.0.0，以单一根提交重写公开 `main` 与 `v1.0.0` 标签，并替换 Release 校验和与产物 |
| REL-004 | done | DOC-003,REL-003 | README 刷新后继续以单一根提交重写公开 `main` 与 `v1.0.0` 标签，不保留中间修改历史 |
| DSH-002 | done | REL-004 | v1.1.0 适配 DSH `dsh-v0.2.1-rc.3`：Host 注入 session/workspace/settings controller 桥接层、审批 waterfall、profile 安装与 `pnpm check` 通过 |
