# 开发日志

## 2026-10-26 · v1.1.0

- 完成 `DSH-002`：适配 DeepSeek Harness `dsh-v0.2.1-rc.3`（`1f81c047fc48fa190a683e469daa699857e9afe8`）。DSH 0.2 移除 `ctx.apiProxy`，插件 Host 改为注入 session/workspace/settings/credentials/llm/agentPresets 控制器，并新增 in-process 桥接层复用现有 chat/settings adapter 与公开 BFF 合约。
- 审批路径改为订阅 DSH `approval/request` waterfall，并继续通过 `client-response` 兼容路径完成移动端“允许一次/拒绝”。
- 实时事件改为订阅 Host `session/event`、`api-session/status` 与 `agent-preset/selected`，保持公开 WebSocket 事件 schema 不变。
- CI profile 安装基线更新为 `dsh-v0.2.1-rc.3`；本机 `pnpm check`（typecheck、24 项 Vitest、docs:check、build）与 `/tmp/dsh-rc3` smoke profile 安装通过。

## 2026-08-15 · v1.0.0

- 完成 `DOC-003` 与 `REL-004`：按发布要求删除中英文 README 的截图环境说明，并继续以单一根提交同步公开分支和标签。
- 完成 `BRAND-002`：插件界面、API 文档、SDK 文档和用户 README 的产品简称统一为 `DSH`；中文安装标题改为“快速安装”，两张 DSH WebUI 实际截图同步重拍。
- 完成 `LICENSE-001`：项目自身许可证和 npm 元数据改为 `AGPL-3.0-only`；上游图标及其他第三方材料继续保留原始许可证，不混入项目主许可证。
- 完成 `REL-003`：v1.0.0 按最终名称、许可证、截图和文档重新打包，公开分支与标签以单一根提交发布，避免暴露开发阶段的提交轨迹。
- GitHub hosted 矩阵发现 Windows / Node 22 在 listener 重绑定后可能复用已关闭的 keep-alive 连接；所有会触发重绑定的 `202` 管理响应现显式返回 `Connection: close`，客户端会在新 listener 上建立新连接，并补充响应头合约测试。
- 修复后的 GitHub Actions `31839360841` 全部通过，覆盖 Windows、Ubuntu、macOS 的 Node 22.19.0/24、浏览器、Kotlin SDK 和三平台 Profile 安装。
- 后续 Windows hosted runner 复现出负载相关的 5 秒测试超时，并发现失败重绑定会短暂关闭仍可用的旧 listener；不同端口现先绑定候选 listener、成功后再切换，端口冲突不会中断现有服务，跨平台集成测试预算同步调整为 15 秒。
- 完成 `CHAT-005`：公开 BFF 新增 DSH 工作区重命名/移除及会话重命名/分叉/归档，所有操作重新执行 scope、session 和 root 授权；归档会话从默认列表隐藏但保留日志。
- 正式项目名统一为 `dsh-workspace`，包、bundle、Cordis row、状态目录、CI、OpenAPI、AsyncAPI 和 Kotlin SDK 版本统一为 `1.0.0`，WebUI 设置页和健康检查显示运行版本。
- 重写中英双语用户 README，补齐安装、远程访问、HTTP 风险、权限、安全语义、完整公开接口和排错说明；新增 ADR-0006 固定插件/App 拆分与版本策略。
- Windows Node 24 下 `pnpm check`、24 项 Vitest、Kotlin SDK JDK 17 编译和真实 tarball profile 安装冒烟通过。正式包 SHA-256 为 `739B0C9FDA032B0E15C323A4A1B36FDE15398BE2ECB2234A00B9CE171F6CC40F`。
- 完成 `DOC-002`：安装 Humanizer-zh，参考 GitHub `dsh-plugin` 主题中高关注项目的首屏、截图、安装和双语组织方式，在保留用户手动删改的前提下重写中文 README，并拆出完整 `README.en.md`。
- 通过隔离 DSH WebUI profile 生成文件编辑器与远程访问两张真实截图；只使用 `C:\DshWorkspaceDemo` 示例根，未展示设备令牌、配对码、外部服务器地址或个人文件。
- 创建 `Hakunm/dsh-workspace` 公开仓库并推送 `main`，设置 `dsh-plugin`、`deepseek-harness`、`dsh`、`file-manager`、`remote-api`、`vibe-coding` topics。重新打包后的 tarball 为 2,622,852 字节，SHA-256 `1F7B8C38D5625880A893B08391607185D329ED2E5EC05CA9B0C9600963AA56E7`。
- 发布 GitHub `v1.0.0` Release，上传正式 tarball 与 `SHA256SUMS.txt`；README 的主安装命令固定到该 Release 资产，不依赖尚未发布的 npm 包。

## 2026-08-15

- 完成 `CHAT-004`：插件注入 DSH `agents/commands` host service，新增受 session/root 与 `chat.read/chat.write` 约束的命令列举/执行 BFF、OpenAPI、Kotlin SDK 和合约测试；命令直接进入 host registry且审计不保存参数。会话 `todos/permissions` projection 保持在历史响应中供 App 使用。
- 完成 `UI-004`：远程访问页在没有授权根时明确提示必须先添加根目录，启用按钮继续保持禁用；插件标题区和包元数据展示作者 `Github@Hakunm`，中英文同步。
- 当前 tarball 已更新到 Oracle root `web` profile并重启 DSH；`3080/3090` 和健康检查恢复，真实命令列表与四项 Host 注入验证通过，既有授权根、设备和监听设置保持不变。
- 用户明确要求重启后，将已校验的审批 tarball 安装到 Oracle root `web` profile，终止旧 DSH 进程并以相同 root/npx 环境后台启动；`3080/3090`、健康检查、审批 OpenAPI 和 Host bundle 哈希全部验证通过。旧待审批运行随重启终止，后续真实验收使用新会话。

## 2026-08-14

- 完成 `APPROVAL-001`：Host 缓存 DSH mux 待审批请求，公开按 session/root 授权的脱敏查询与“允许一次/拒绝”接口，私有 RPC ID 不出服务端；新增 `chat.approval.requested/resolved`、OpenAPI、AsyncAPI、Kotlin SDK、REST/脱敏/重复决定测试和最小审计。
- 审批发布包已上传至 Oracle `/tmp` 但没有安装或重启；当前真实 Skill 会话仍停在原审批点，避免为部署新功能而破坏用户尚未决定的运行。
- 完成 `CHAT-003`：将 DSH token 级 `assistant/chunk` 规范化为公开 `chat.message.delta`，完成消息/运行状态/Agent 选择使用稳定事件；新增仅空白会话可用的 Agent Preset 切换端点，已开始会话返回明确锁定错误，并同步 OpenAPI、AsyncAPI、Kotlin SDK 与合约测试。
- WebSocket 广播改为单一有序队列，修复并发异步授权查询可能重排 token 的问题；会话到根的固定映射只作定位缓存，每个事件仍重新检查设备撤销、scope 和 root grant。ARM64 Oracle 真实探针验证 24 个增量严格有序、拼接正文与持久消息一致。
- 扩展 `CHAT-002`：新增受 `chat.write` 与 root grant 约束的 `POST /chat/workspaces`，允许 Android 从授权目录登记新的 DSH WebUI 工作区后直接创建会话；同步 OpenAPI、Kotlin SDK 和合约测试。
- 扩展 `MODEL-001`：供应商读取合并 DSH 模板基值与用户覆盖，并从实时模型目录补足继承模型；新增与 DSH WebUI 同规则的完全自定义供应商创建、协议 schema 发现、脱敏凭据写入及 Android 合约。
- 最终 tarball 已更新到 ARM64 Oracle 的 root `web` profile 并重载；真实 listener 验证工作区发现、37 个供应商、自定义协议能力和模型回填后撤销临时探针设备，未改动授权根与既有设备。

- 完成 `MODEL-001`：新增 `settings.read/settings.write`、供应商配置与凭据状态/写入、模型发现、会话模型和思考强度接口；同步 OpenAPI 3.1、Kotlin SDK、脱敏与选择合约测试。当前 tarball 已更新并重载至 ARM64 Oracle DSH，现有手机设备保留根授权并追加设置 scope。

- 将通过完整 prepack 校验的当前插件 tarball 更新到私有 ARM64 Oracle 测试服务器 root `web` profile；把易失的 `/tmp` 文件依赖迁移为 `/root/.dsh/packages/` 持久引用，并通过 bundle 哈希与 `--dump-config` 验证。未修改插件数据、授权根、设备或监听设置。
- 克隆 DSH `master@47f943859bef60e4160492346772ded9b24f765a`，确认 Profile bundle、`dsh.client` 和官方 slot 契约。
- 初始化独立插件仓库、发布清单、构建入口和持久化项目追踪文档。
- 接受外置插件、授权根、独立 HTTP listener 三项架构决策。
- 记录 npm 旧版 DSH peer 链不完整的问题；开发安装关闭 peer 自动补全，运行时代码保持宿主 service 注入。
- 完成授权根文件服务：懒加载列表、Range 读取、ETag 保存、新建/移动、跨卷校验、插件回收站和冲突恢复。
- 完成 SQLite 配对、256 位令牌摘要、设备 scope/root grant、撤销、审计、幂等与限流。
- 完成默认回环、显式远程启停与回滚的独立 listener，并发布版本化 REST/WebSocket BFF。
- 完成 DSH `apiProxy` 聊天 adapter、三个官方 WebUI slot、独立工作区 route、CodeMirror 6 和响应式管理面。
- 发布 OpenAPI 3.1、AsyncAPI 3.0 与带 Gradle Wrapper 的 Kotlin/OkHttp SDK；JDK 17 实际编译通过。
- 增加 null Origin、转发头、scope/root、错误脱敏、实时 WebSocket 授权和撤销安全回归。
- 增加三系统 CI profile 安装脚本与 Ubuntu DSH 运行探针；Windows 本地 tarball 安装、上游构建和完整启动通过。
- 将 DSH 自注册 Client bundle 发布为 `client.cjs`，消除 ESM 包中的格式歧义；生产依赖审计和 publint 均通过。
- 在真实 DSH WebUI 完成 Chromium 交互验证：通过侧栏 `Files` 打开管理 overlay、登记插件源码根，并从 DSH 同源 route 展示完整文件工作区。
- 完成 `UI-002`：新增默认中文的中英双语词典、全局语言按钮、浏览器偏好持久化、状态/错误本地化及动态 DSH slot 标签；桌面、移动和真实 DSH WebUI 均完成双向切换验证。
- 完成 `UI-003`：侧栏“文件”改为在 DSH 根页面直接打开完整工作区 overlay；设置往返保留当前文件和编辑状态，独立 `/dsh-workspace` route 降级为备用入口，并通过真实 DSH 桌面/移动视口验证。
- 完成 `NET-002`：远程访问设置可持久化自定义数值 IPv4/IPv6 与端口，禁用状态下安全重绑定，失败自动恢复旧 listener；DSH 宿主内完成 `3090` 到 `3190` 再恢复的实际验证，并为占用、不可用及权限拒绝提供中英文错误提示。
- 启动 DeepSeek Harness Android App：锁定独立工程、`io.github.hakunm.deepseekharness`、Compose/Material 3、中英双语、上游黑色鲸鱼图标、Android Keystore 令牌保护和仓库外正式签名；建立 `PARITY-001`，明确当前 BFF 与 DSH WebUI 全功能之间的差距。
- Android 基础客户端实现配对/恢复、scope 感知、WebSocket 重连、聊天与完整文件操作，并通过 HTTP 合约单测、lint、R8 Release 和独立签名校验，随后进入真实 DSH/Android 验收。
- 对运行中的真实插件 listener 完成临时设备与根的配对、scope、ETag 文件、回收站恢复和会话过滤回归，测试授权已撤销。
- Android 文件传输改为 Okio 流式 I/O，并补充目录分页与 Compose 默认中文连接首屏测试 APK。
- Android 15 发布版通过真实插件 listener 完成健康检查、一次性配对、设备/scope/根加载、重启恢复及会话/文件/设置导航；Compose 仪器测试在清理登录前置状态后通过。
- 真机发现并修复 OkHttp WebSocket 握手 URL 被提前改为 `ws://` 的回归，增加合约测试；测试临时设备和授权根已撤销。
- 完成 `CHAT-002`：新增受 `chat.read` 与 root grant 约束的 DSH 工作区发现和 Agent Preset 列表，创建会话优先接收 `workspaceId`；OpenAPI、Kotlin SDK、合约测试与真实 listener 同步通过，外部响应不暴露绝对工作区路径或 preset 损坏详情。
