# 兼容性

## 运行矩阵

| 组件 | 支持范围 | 验证方式 |
| --- | --- | --- |
| Node.js | `^22.19.0 || >=24.0.0` | CI 22.19 和 24 |
| DSH | 标签 `dsh-v0.2.1-rc.3`（npm `@deepseek-ai/dsh@0.2.1-rc.3`） | tarball profile 安装、配置组合和真实启动 |
| Windows | Windows Server 2022 / Windows 11 | `windows-latest` |
| macOS | GitHub 当前 macOS runner | `macos-latest` |
| Linux | Ubuntu 当前 LTS runner | `ubuntu-latest` |
| Android | Android 8.0（API 26）及以上；compile/target SDK 36 | Gradle、lint、单元/UI 测试、Android 15 端到端与签名 Release APK |

当前 npm 上的旧版 DSH 包存在未发布的内部依赖，独立插件开发仓库设置 `auto-install-peers=false`；插件不在运行时导入这些包，而由已启动的 DSH Host 通过 Cordis service 注入 `sessionController`、`workspaceController`、`settingsController`、`credentialsController`、`llm`、`agentPresets`、`webServer`、`agents` 和 `commands`。

Windows 11 / Node 24.18.0 已完成本地全套验证。GitHub Actions 已配置 Node 22.19/24 核心矩阵、三系统 tarball profile 安装、Ubuntu DSH 真实启动和 JDK 17 SDK 编译；远程仓库创建后才能取得 hosted macOS/Linux 结果。

## 网络监听

- Windows、macOS 和 Linux 均通过 Node `net` 数值地址语义绑定 IPv4/IPv6；指定地址必须属于本机接口，`0.0.0.0`/`::` 表示对应地址族的全部接口。
- Linux 非 root 服务建议选择 `1024–65535` 端口；低端口可能因 `CAP_NET_BIND_SERVICE` 缺失而失败并回滚。
- Docker/Podman 中的绑定只作用于容器网络命名空间，仍需通过 Compose `ports` 或启动参数发布所选端口。
- 云服务器还需在主机防火墙和云安全组中允许所选 TCP 端口；插件不会自动修改防火墙。

## 文件系统规则

- Windows：保留盘符和 UNC 根，wire path 禁止盘符、UNC、反斜杠、冒号、尾随点/空格和保留设备名。junction/reparse point 不得作为穿透路径。
- macOS：不更改真实 Unicode 文件名，不假设大小写敏感或不敏感。
- Linux：保持大小写和权限位，处理 symlink、挂载点及 `EXDEV`。
- 所有平台：路径逐段 `lstat`；内容保存的临时文件与目标同目录；跨卷回收执行复制、摘要校验、清单提交和源删除。

Node 标准库没有跨平台 `openat`/目录句柄相对文件操作，逐段检查与最终操作之间仍存在本机并发改名的窄 TOCTOU 窗口。插件不是恶意本机管理员或同权限进程之间的隔离边界；该残余风险记录在安全模型中。

Android 工程使用 JDK 17 工具链、Jetpack Compose、Material 3 和 OkHttp。HTTP/HTTPS 都可连接；HTTP 需要显式 cleartext 网络配置并持续显示风险提示。Android 15 已验证发布版通过 HTTP listener 配对和恢复；HTTPS 及 Android 8/其他厂商系统仍需扩大实机矩阵。手机、平板和可折叠设备使用自适应 Compose 布局，首期不支持 Android 8.0 以下系统。
