# 当前状态

- 日期：2026-10-26
- 阶段：`dsh-workspace` v1.1.0 DSH 0.2 适配
- 当前任务：`DSH-002`
- DSH 基线：`dsh-v0.2.1-rc.3` / `1f81c047fc48fa190a683e469daa699857e9afe8`
- DSH 路径：`C:\Users\nyanya\Desktop\dsh\deepseek-harness`
- 插件路径：`C:\Users\nyanya\Desktop\dsh\dsh-workspace`
- 已完成：Host/Client 外置插件、DSH WebUI 内文件工作区、授权根与回收站、独立 listener、设备授权、聊天/审批/命令/模型 BFF、OpenAPI/AsyncAPI、Kotlin SDK、中英双语和版本展示
- 本次刷新：按发布要求删除中英文 README 中的截图环境说明，保留实际效果图片和正文结构
- 最近验证：Windows 本机 Node 22.19.0 连续 5 轮、Node 24 一轮完整回归通过，共执行 144 项 Vitest；GitHub Actions 已覆盖 Windows、Ubuntu、macOS 的 Node 22.19.0/24、浏览器、Kotlin SDK 与三平台 Profile 安装，最终提交状态以仓库 Actions 为准
- 正式产物：`artifacts/dsh-workspace-1.0.0.tgz`，2,644,838 字节，SHA-256 `C4EB21A5A28D7C6B3529BFD59DEB7809D06850C3F0A2BB15C4DCBE52D0274823`
- GitHub：`https://github.com/Hakunm/dsh-workspace`，topic 包含 `dsh-plugin`
- Release：`https://github.com/Hakunm/dsh-workspace/releases/tag/v1.0.0`
- 发布策略：最终 `main` 与 `v1.0.0` 标签只保留一个 v1.0.0 根提交，Release 资产使用本页记录的校验和
- 阻塞项：npm 包尚未发布；Android 与 DSH WebUI 的后续完整能力对等仍按 `PARITY-001` 推进
- 下一步：GitHub v1.0.0 已可安装；npm 包仍按后续发布安排处理
