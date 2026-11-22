# 当前状态

- 日期：2026-11-22
- 阶段：`dsh-workspace` v1.3.0 适配 DeepSeek Harness 桌面客户端（`profile=desktop`）与 WebUI
- 当前任务：`DESKTOP-001`
- DSH 基线：`dsh-v0.2.2-rc.5`（DeepSeek Harness Desktop `0.2.2-rc.5` 及 npm `@deepseek-ai/dsh@0.2.2-rc.5`）
- 已完成：Host/Client 外置插件同时适配 DSH 桌面客户端（`profile=desktop`）与 DSH WebUI（`profile=web`），包含官方插件管理页双语 `locale` 元数据/SVG 图标与详情页快捷入口、`dsh-app://app` 回环协议鉴权、`DSH_HOME` 默认数据目录、多实例 `EADDRINUSE` 端口平滑回退、原生文件夹选择器（`__DSH_DIRECTORY_PICKER__`）、原生文件另存为（`dshDesktop.fileActions`）、应用内确认弹窗、Windows 自定义标题栏与 macOS 交通灯/窗口拖拽区避让、OpenAPI 3.1 / AsyncAPI 3.0 及 Kotlin SDK 1.3.0 对齐
- 最近验证：Windows 11 / Node 24 下 `tsc --noEmit`、14 个文件 / 35 项 Vitest、10 项 Playwright 桌面/移动 E2E、`kotlin-sdk` Gradle 测试、`docs:check`、`web` + `desktop` 双 profile 安装组合冒烟与真实 DSH Desktop Host 端到端验证通过
- 正式产物：`dsh-workspace-1.3.0.tgz`，2,681,914 字节，SHA-256 `3e906433696a06fa83b0c39f3af6fca315816e8b9f05f1c98b58a7789890b807`（见 `artifacts/SHA256SUMS.txt`）
- GitHub：`https://github.com/Hakunm/dsh-workspace`，topic 包含 `dsh-plugin`
