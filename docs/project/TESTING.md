# 测试记录

| 日期 | 环境 | 验证 | 结果 |
| --- | --- | --- | --- |
| 2026-08-15 | Windows 11 | 中英文 README 发布复验与 `pnpm pack --pack-destination artifacts` | 通过；指定截图环境说明已从仓库及 tarball 删除，两张实际效果图路径仍存在；12 个文件/24 项 Vitest、文档/API/SDK 和三份 bundle 一致；tarball 2,644,838 字节，SHA-256 `C4EB21A5A28D7C6B3529BFD59DEB7809D06850C3F0A2BB15C4DCBE52D0274823` |
| 2026-08-15 | Windows 11 / Node 22.19.0 与 24 | listener 冲突回滚与测试稳定性复验 | 不同端口改为候选 listener 成功绑定后再切换，端口占用时不再中断旧 listener；测试预算调整为 15 秒；Node 22 连续 5 轮及 Node 24 一轮完整回归全部通过，共 144 项 Vitest |
| 2026-08-15 | GitHub Actions / Windows、Ubuntu、macOS | [run 31839641415](https://github.com/Hakunm/dsh-workspace/actions/runs/31839641415) | 暴露 Windows runner 负载下默认 5 秒测试超时，以及失败重绑定短暂关闭旧 listener 导致的连接重置；其余九项作业通过，问题已按上一行修复并纳入最终矩阵 |
| 2026-08-15 | GitHub Actions / Windows、Ubuntu、macOS / Node 22.19.0 与 24 | [run 31839360841](https://github.com/Hakunm/dsh-workspace/actions/runs/31839360841) | 通过；Windows Node 22 listener 重绑定回归已修复，六项核心矩阵、浏览器、Kotlin SDK 和三平台 Profile 安装共十一项作业全部成功 |
| 2026-08-15 | Windows 11 / Node 24 | 最终 DSH/AGPLv3 发布刷新：`pnpm pack --pack-destination artifacts` | 通过；12 个文件/24 项 Vitest、9 份文档/32 个任务/6 个 ADR、OpenAPI/AsyncAPI/Kotlin SDK 和三份 bundle 一致；tarball 2,644,940 字节，SHA-256 `B9047FD313C13203F8F36CB643E93206202FB41DF82129B3DCA6BA66634FFB65` |
| 2026-08-15 | Windows 11 / Node 24 / JDK 17 | v1.0.0 `pnpm check`、Kotlin SDK 编译、`pnpm pack`、真实 DSH profile tarball 安装 | 通过；12 个文件/24 项 Vitest，OpenAPI/AsyncAPI/SDK 同步，三份 bundle 构建；`dsh-workspace-1.0.0.tgz` 2,483,535 字节，SHA-256 `739B0C9FDA032B0E15C323A4A1B36FDE15398BE2ECB2234A00B9CE171F6CC40F` |
| 2026-08-15 | Windows 11 / Node 24 / Chromium | README 发布复验：`pnpm check`、`pnpm pack`、隔离 DSH WebUI profile 桌面截图 | 通过；12 个文件/24 项 Vitest、文档/API/SDK 和三份 bundle 一致；两张截图无令牌/服务器地址/个人路径；tarball 2,622,852 字节，SHA-256 `1F7B8C38D5625880A893B08391607185D329ED2E5EC05CA9B0C9600963AA56E7` |

## 必须通过

```sh
pnpm typecheck
pnpm test
pnpm docs:check
pnpm build
pnpm pack
```

Android App 还必须通过：

```sh
gradlew docsCheck testDebugUnitTest lintDebug assembleRelease
apksigner verify --verbose app-release.apk
```

CI 在 Windows、Ubuntu 和 macOS 执行相同核心门禁。Playwright 另外覆盖桌面和移动宽度的工作区与管理流程。

## 已运行

| 日期 | 环境 | 命令 | 结果 |
| --- | --- | --- | --- |
| 2026-10-26 | Cloud VM / Node 22.23.4 / DSH `dsh-v0.2.1-rc.3` | `pnpm check` + `pnpm exec tsx scripts/smoke-profile-install.ts /tmp/dsh-rc3 …` | 通过；24 项 Vitest、docs:check、build 与 profile 安装/compose 均成功；Host 注入更新为 session/workspace/settings/credentials/llm/agentPresets/webServer/agents/commands |
| 2026-08-15 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 安装命令/TODO/权限版 tarball，确认无运行会话后重启 root `npx @deepseek-ai/dsh web` | 通过；新 PID `3698617`，WebUI `3080` 与 listener `3090` 均正常；真实空白会话 `/commands` 返回 `compact/export/feedback/goal/permission/plan`，组合配置注入 `apiProxy/webServer/agents/commands`；Host SHA-256 `65CCF5E4F5595FE5881D1D331BF2DAC934591DDE2581D6758A9A374F72A00627` |
| 2026-08-15 | Windows / Node 24 | `pnpm check` | 通过；12 个文件/23 个 Vitest，覆盖 host 命令列举/执行、未知命令拒绝、REST scope 与命令参数不入审计；OpenAPI/Kotlin SDK 文档同步和 Host/Client/standalone bundle 构建成功 |
| 2026-08-15 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 安装审批 tarball 并按用户要求重启 `npx @deepseek-ai/dsh web` | 通过；新 PID `3669075`，WebUI `127.0.0.1:3080` 返回 200，listener `0.0.0.0:3090` 返回 `{"ok":true,"version":"v1"}`；服务器 Host SHA-256 `598762E2F08F864B41D2506CDBD2E53BCA6A0D5022A95A976651C0623A145824` 与本地一致，安装 OpenAPI 含审批路由 |
| 2026-08-14 | Windows / Node 24.18.0 | `git clone https://github.com/deepseek-ai/deepseek-harness.git` | 通过，SHA `47f9438` |
| 2026-08-14 | Windows / pnpm 11.19.0 | `pnpm install` | 首次失败；peer 自动安装触发上游未发布包 `@deepseek-ai/dsh-user-interaction`，已改用宿主注入策略 |
| 2026-08-14 | Windows / pnpm 11.19.0 | `pnpm install` | 通过；仅允许开发工具 `esbuild` 的安装脚本，运行时依赖无原生构建 |
| 2026-08-14 | Windows / Node 24.18.0 | `pnpm typecheck && pnpm test` | 通过；6 个文件、11 个用例，含路径、ETag、配对、scope、撤销、HTTP 和 WebSocket 授权 |
| 2026-08-14 | Windows / Chromium 151 | `pnpm test:e2e` | 通过；Desktop Chrome 与 Pixel 7 共 4 个用例，截图人工检查无重叠 |
| 2026-08-14 | Windows / Temurin 17 | `kotlin-sdk/gradlew.bat test --no-daemon` | 通过；Kotlin SDK 编译和 jar 生成成功 |
| 2026-08-14 | Windows / pnpm 11.19.0 | `pnpm docs:check && pnpm pack` | 通过；YAML 可解析、文档/API/SDK 版本同步，干净 tarball 约 2.43 MB |
| 2026-08-14 | Windows / DSH `47f9438` | `pnpm exec tsx scripts/smoke-profile-install.ts ...` | 通过；真实 tarball 依赖、bundle 激活和组合配置均正确 |
| 2026-08-14 | Windows / DSH `47f9438` | `pnpm install --frozen-lockfile && pnpm build` | 通过；上游源码未修改，生成运行所需产物 |
| 2026-08-14 | Windows / DSH `47f9438` | `dsh web --port 43992` + HTTP 探针 | 通过；DSH 页面 `200`，插件 `/api/v1/healthz` `200` |
| 2026-08-14 | Windows / pnpm registry | `pnpm audit --prod` | 通过；生产依赖无已知漏洞 |
| 2026-08-14 | Windows / publint 0.3.21 | `pnpm dlx publint@0.3.21` | 通过；npm exports 与 ESM/CJS 文件扩展无警告 |
| 2026-08-14 | Windows / DSH WebUI + Chromium 151 | 浏览器实际加载 `http://127.0.0.1:43992/` 和 `/dsh-workspace` | 通过；DSH 侧栏 `Files` 入口、管理 overlay、授权根与完整文件树均渲染，浏览器控制台无错误 |
| 2026-08-14 | Windows / Node 24.18.0 + Chromium 151 | `pnpm typecheck && pnpm test && pnpm test:e2e` | 通过；7 个文件、12 个 Vitest 和桌面/Pixel 7 共 6 个 Playwright 用例，覆盖默认中文、英文切换及刷新持久化 |
| 2026-08-14 | Windows / DSH `47f9438` + Codex Browser | 新 tarball `dsh plugin --profile web add` 后访问 `:43992` | 通过；真实 DSH 中文 slot/overlay/独立工作区、双向语言切换、授权根和 CodeMirror 文件读取正常 |
| 2026-08-14 | Windows / DSH `47f9438` + Codex Browser | 在 DSH 根页面点击侧栏“文件”，测试编辑器与设置往返 | 通过；URL 保持 `/`，完整文件树与 CodeMirror 可用，设置关闭后仍选中 `README.md`；412×915 下无页面横向溢出 |
| 2026-08-14 | Windows / Node 24.18.0 + Chromium 151 | `pnpm check && pnpm test:e2e` | 通过；8 个文件、14 个 Vitest 和桌面/Pixel 7 共 8 个 Playwright 用例，覆盖监听地址校验、端口占用回滚、自定义监听设置与响应式布局 |
| 2026-08-14 | Windows / DSH `47f9438` + Codex Browser | 在 DSH 宿主内将 listener 从 `3090` 改为 `3190` 并恢复 | 通过；UI、TCP 监听表和 `/api/v1/healthz` 均确认实际重绑定；系统拒绝 `3091` 时旧 `3090` listener 保持可用 |
| 2026-08-14 | Windows / Node 24.18.0 | `pnpm check` | 通过；9 个文件、15 个 Vitest，新增授权 DSH 工作区过滤、Agent Preset 映射、会话标题与 `workspaceId` 创建合约 |
| 2026-08-14 | Windows / Java 26.0.1 | `kotlin-sdk/gradlew.bat test --no-daemon` | 失败；Gradle 8.10.2 不支持 Java 26，未进入代码编译 |
| 2026-08-14 | Windows / Temurin 17 | `kotlin-sdk/gradlew.bat test --no-daemon` | 通过；SDK 新增工作区/Agent Preset 类型接口并生成 jar，WebSocket 使用 HTTP(S) Upgrade URL |
| 2026-08-14 | Windows / DSH `47f9438` | 新 tarball 安装后重启 `dsh web --port 43992` 并探测真实 listener | 通过；原插件状态保留，Agent Preset 返回 4 个 DSH 系统模式，未登记 DSH 工作区时返回空数组且不回退为文件授权根 |
| 2026-08-14 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 当前 tarball 更新 root `web` profile，再执行 `dsh web --dump-config` 与 bundle 哈希核对 | 通过；tarball SHA-256 `1BC6CB5768A66AE8455E121F04DD08C2FC01F3275491E964927360BB6A6FC91D`，Host `4EB6CD1A9469082E635D45614BFCBBF23D64A15C981EC67DA7F3A17AEFEA0549`，Client `460FC5FA792389E323D2C85B2A934EAC3E518A63E8DD1AC5ED83ABA6B27AF5A8`；服务器当时无 DSH 进程，未执行启动或重启 |
| 2026-08-14 | Windows / Node 24.18.0 | `pnpm check` | 通过；10 个文件、17 个 Vitest，新增供应商脱敏/凭据写入、模型发现、会话模型与思考强度选择合约；OpenAPI 和三份 bundle 构建通过 |
| 2026-08-14 | Windows / Temurin 17 | `kotlin-sdk/gradlew.bat clean test` | 通过；SDK 新增供应商、模型目录、会话模型与发现接口并生成 jar |
| 2026-08-14 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 新 tarball 更新 root `web` profile并重载 `dsh web` | 通过；`3080` WebUI 与 `0.0.0.0:3090` listener 恢复，真实合约探针返回 37 个供应商、6 个授权会话、2 个模型组、0 个失败，临时探针设备已撤销 |
| 2026-08-14 | Windows / Node 24.18.0 | `pnpm check` | 通过；10 个文件、18 个 Vitest，新增授权目录 DSH 工作区创建、自定义供应商 schema/创建、供应商有效配置与实时模型回填合约；OpenAPI 和三份 bundle 构建通过 |
| 2026-08-14 | Windows / Node 24.18.0 | `pnpm typecheck && pnpm test` | 通过；10 个文件、19 个 Vitest，新增 `assistant/chunk` 稳定增量映射、Agent Preset 空白会话切换和已开始会话锁定测试 |
| 2026-08-14 | Windows / Temurin 17 | `kotlin-sdk/gradlew.bat clean test` | 通过；SDK 新增 DSH 工作区创建、自定义供应商能力与创建接口并生成 jar |
| 2026-08-14 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 最终 tarball 更新 root `web` profile并重载 `dsh web` | 通过；tarball SHA-256 `77560FA81836A0F891DB65026E71FE6B9FDE0E70E51F97E4834C4B5C49C357B6`，`3080/3090` 恢复；真实探针返回 37 个供应商、3 种自定义协议、1 个授权工作区及 `opencode-go` 模型，探针设备随后撤销 |
| 2026-08-14 | Windows / Node 24.18.0 + Temurin 17 | `pnpm check` 与 `kotlin-sdk/gradlew.bat clean test` | 通过；10 个文件、19 个 Vitest、9 份项目文档、23 个任务、5 个 ADR、OpenAPI/AsyncAPI/SDK 同步和三份 bundle 构建成功；Kotlin SDK clean 编译成功 |
| 2026-08-14 | ARM64 Oracle / Node 24.19.0 / DSH 0.1.0-rc.6 | 有序流式 tarball 更新 root `web` profile、重载并执行真实 REST/WebSocket 探针 | 通过；部署包 SHA-256 `60F17EC1CB273DBFD936B88D4DF39DD76D3F6F35F677E43C5C9C1BD62BD99538`，`3080/3090` 正常；会话返回 24 个 `chat.message.delta`，事件次序严格递增且拼接正文等于持久消息 `STREAMING-ORDER-OK`；空白会话切换 `code` 成功，开始后返回 `409 AGENT_PRESET_LOCKED`，临时设备随后撤销 |
| 2026-08-14 | Windows / Node 24.18.0 + Temurin 17 | `pnpm check`、`kotlin-sdk/gradlew.bat clean test`、`pnpm pack` | 通过；11 个文件/22 个 Vitest 覆盖审批缓存、脱敏、单次决定、REST 合约与内部 RPC 隔离，OpenAPI/AsyncAPI/Kotlin SDK/三份 bundle 同步；tarball 2,475,534 字节，SHA-256 `51B540218E6303B718E5E7B16353B137285FA8CC938025424DCAAF3B54979E8E` |
| 2026-08-14 | ARM64 Oracle / DSH 活动会话保护 | 上传审批 tarball并核对 SHA-256、`/healthz` 与 PID | 通过；包仅暂存为 `/tmp/dsh-android-app-workspace-approval-0.1.0.tgz`，活动 DSH PID `3574165` 与 `3090` 保持健康，未安装、未重启、未替用户决定当前高权限审批 |

尚待远程仓库创建后运行 GitHub Actions 的 `windows-latest`、`ubuntu-latest`、`macos-latest` hosted 矩阵；这也是 `TEST-001` 仍为 `in-progress` 的唯一测试项。

Android `TEST-002` 已通过 8 项 HTTP/文件/聊天/WebSocket URL 与事件呈现单测、`lintDebug`、R8 Release 构建、包名检查和独立 4096 位 RSA APK v2 签名验证。本机真实 listener 另已通过临时设备/根的一次性配对、5 scope、文件创建/读取、ETag 更新、移动、软删除/恢复、会话授权过滤、DSH 工作区发现和 Agent Preset 回归，测试设备与根随后撤销。

Android 15 发布版通过 `adb reverse tcp:3090 tcp:3090` 连接真实 listener，完成健康检查、一次性配对、设备/scope/授权根加载、令牌恢复、WebSocket 握手和会话/文件/设置导航。真机首次发现客户端把握手 URL 提前改为 `ws://`，OkHttp 报 `unexpected scheme: ws`；改为传入 HTTP(S) URL 由 OkHttp Upgrade 后复验通过，并加入回归单测。`connectedDebugAndroidTest` 在干净安装上通过默认中文、连接首屏和中英文切换；一次失败来自真实配对状态残留，清理前置状态后重跑通过。临时设备和根均已撤销。

仍待验证：真实局域网 HTTP 与 HTTPS、聊天发送/steer/取消、移动 UI 完整文件动作与 ETag 冲突、WebSocket 网络切换、旋转/进程恢复及平板实机布局。未完成的 WebUI 功能不能只用 WebView 冒充原生功能对等。

实现期间只把实际执行且可复现的结果写入本表；失败结果也应记录原因和后续修复任务。
