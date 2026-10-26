# dsh-workspace

<p align="center">
  <strong>把文件工作区直接带进 DeepSeek Harness WebUI，并为手机和第三方客户端提供稳定的远程接口。</strong>
</p>

<p align="center">
  中文 · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-v1.1.0-087f8c">
  <img alt="DSH plugin" src="https://img.shields.io/badge/DeepSeek_Harness-plugin-1f2328">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-586069">
  <img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-2da44e">
</p>

`dsh-workspace` 是 DeepSeek Harness（DSH）的 WebUI 文件工作区与远程访问插件。安装后，你可以留在 DSH WebUI 里浏览、编辑和整理本机文件，也可以让 [dsh-android-app](https://github.com/Hakunm/dsh-android-app) 通过版本化 API 连接同一套聊天、工作区和文件能力。

界面默认中文，可随时切换 English。插件支持 Windows、macOS 和 Linux，安装包已经包含编译产物，不要求用户在服务器上重新构建。

## 实际效果

文件工作区直接显示在 DSH WebUI 中，目录树、编辑器和文件操作集中在同一个窗口。

![DSH WebUI 中的文件工作区](./assets/screenshots/workspace-editor.png)

远程访问默认关闭。管理员可在本机 WebUI 中设置绑定 IP、端口和新设备的初始权限。

![远程访问设置](./assets/screenshots/remote-access.png)

## 快速安装

### 环境要求

- 已安装并能正常启动的 DeepSeek Harness WebUI
- Node.js `^22.19.0` 或 `>=24.0.0`
- 默认端口 `3090` 可用，或准备一个其他端口

使用运行 DSH WebUI 的同一系统用户执行：

```sh
dsh plugin --profile web add https://github.com/Hakunm/dsh-workspace/releases/download/v1.0.0/dsh-workspace-1.0.0.tgz
npx @deepseek-ai/dsh web
```

重启 WebUI 后，侧栏会出现“文件”入口，会话视图中也会出现文件标签页。

从 GitHub Release 下载离线安装包时，可直接安装 tarball：

```sh
dsh plugin --profile web add ./dsh-workspace-1.0.0.tgz
```

## 第一次使用

1. 在 DSH WebUI 中打开“文件”，点击右上角的“工作区设置”。
2. 在“根目录”页添加允许管理的本机目录，并为它起一个容易识别的名字。
3. 返回文件工作区，选择授权根后即可浏览和编辑文件。
4. 需要连接手机时，进入“远程访问”，填写绑定 IP 和端口并保存。
5. 点击“启用并创建配对”，再将十分钟内有效的一次性配对码填入 App。

远程访问只有在至少存在一个授权根时才能开启。安装插件本身不会把服务暴露到局域网，未启用时只监听回环地址。

## 你可以做什么

### 在 DSH WebUI 中管理文件

- 懒加载浏览目录，新建文件或文件夹。
- 上传、下载、替换、重命名和移动文件。
- 使用 CodeMirror 6 查看和编辑 UTF-8 文本。
- 尽量保留 UTF-8 BOM 与原有换行风格。
- 使用 ETag 检测外部修改，遇到冲突时拒绝静默覆盖。
- 删除内容时先进入插件回收站，之后可恢复或由本机管理员永久清理。
- 二进制文件只提供元数据、下载和替换，不会被误当作文本写回。

### 连接 Android App 或其他客户端

公开 API 不依赖 DSH 私有协议，可用于：

- 查看、新建、重命名和移除 DSH 工作区登记。
- 创建、重命名、分叉和归档会话。
- 读取消息、流式接收正文和思考、追加引导或取消运行。
- 查看 TODO、斜杠命令、权限模式和待审批操作。
- 选择 Agent、模型和思考强度。
- 查看或修改模型供应商，支持完全自定义供应商。
- 管理设备获准访问的文件和回收站项目。

## 远程访问与安全

默认远程地址为 `0.0.0.0:3090`，IP 和端口都可修改。客户端可以使用能到达服务器的 IP 或域名连接。

插件允许直接使用 HTTP，不强制配置证书。这对可信局域网和临时部署比较方便，但要清楚它的代价：

> HTTP 会明文传输设备令牌、聊天内容和文件内容。在公网或不可信网络中，请使用 Caddy/Nginx 配置 HTTPS，或通过 VPN、Tailscale/WireGuard、SSH 隧道等可信通道连接。

无论是否使用 HTTPS，以下保护都会生效：

- 十分钟有效且只能使用一次的配对码。
- 256 位设备令牌，服务器只保存摘要。
- 可撤销的设备权限与独立根目录授权。
- 配对、认证和普通请求分别限流。
- 审计记录操作类型和对象，但不记录令牌、文件正文或聊天正文。
- 新增根目录不会自动授权给已经配对的设备。

只有来自回环地址的管理界面可以添加根目录、调整设备权限、生成配对码、修改监听设置和永久清理回收站。

## 文件边界

外部接口只接受 `rootId + relativePath`，不会接收服务器绝对路径。路径还会经过以下检查：

- wire path 统一使用 `/`。
- 拒绝绝对路径、盘符、UNC、反斜杠、空字节以及 `.`、`..` 路径段。
- 每次操作逐段检查 symlink、junction 和 reparse point，禁止借助链接逃出授权根。
- 删除末端链接时只删除链接本身，不递归进入链接目标。
- 临时保存文件放在目标目录中，避免跨挂载点替换失败。

“移除 DSH 工作区”只删除 WebUI 中的登记，服务器目录、文件和会话日志不会被删除。“归档会话”只将会话从默认列表隐藏，日志仍会保留。

## 对外接口

REST 基址：

```text
http://HOST:PORT/api/v1
```

除健康检查和配对交换外，请求需要设备令牌：

```http
Authorization: Bearer DEVICE_TOKEN
```

| 接口 | 用途 |
| --- | --- |
| `GET /healthz` | 查看服务状态、API 版本和插件版本 |
| `POST /pairings/exchange` | 使用一次性配对码换取设备令牌 |
| `GET /devices/self` | 查看当前设备、权限和根目录授权 |
| `GET /roots` | 列出设备可访问的文件根 |
| `GET/POST/PATCH/DELETE /roots/{rootId}/entries` | 列目录、新建、移动、重命名和移入回收站 |
| `GET/PUT /roots/{rootId}/content` | 读取、Range 下载、上传和带 ETag 保存 |
| `GET /trash`、`POST /trash/{id}/restore` | 查看与恢复回收项 |
| `GET/POST /chat/workspaces` | 列出或登记 DSH 工作区 |
| `PATCH/DELETE /chat/workspaces/{id}` | 重命名或移除工作区登记 |
| `GET/POST /chat/sessions` | 列出或创建会话 |
| `PATCH /chat/sessions/{id}` | 重命名会话 |
| `POST /chat/sessions/{id}/fork` | 分叉会话 |
| `POST /chat/sessions/{id}/archive` | 归档会话 |
| `GET/POST /chat/sessions/{id}/messages` | 读取历史、发送消息或追加引导 |
| `GET/POST /chat/sessions/{id}/commands` | 列出或执行 host 斜杠命令 |
| `GET/POST /chat/sessions/{id}/approvals...` | 查看和处理待审批操作 |
| `GET /chat/sessions/{id}/models`、`PUT .../model` | 读取模型目录并切换模型或思考强度 |
| `PUT /chat/sessions/{id}/agent-preset` | 在首条消息前切换 Agent |
| `POST /chat/runs/{id}/cancel` | 取消正在运行的会话 |
| `GET/POST/PATCH/DELETE /settings/...` | 管理供应商、凭据状态、模型发现和自定义供应商 |
| `WS /events` | 接收聊天增量、运行、审批和文件变更事件 |

完整字段、响应和错误模型见 [OpenAPI 3.1](./docs/api/openapi.yaml)，实时事件格式见 [AsyncAPI](./docs/api/asyncapi.yaml)。仓库同时提供 [Kotlin SDK](./kotlin-sdk/README.md)。

错误响应保持统一：

```json
{"error":{"code":"ERROR_CODE","message":"Readable message","requestId":"..."}}
```

## 设备权限

| Scope | 允许的操作 |
| --- | --- |
| `chat.read` | 查看工作区、会话、消息、TODO、命令和审批 |
| `chat.write` | 管理工作区与会话、发消息、切换配置、执行命令和处理审批 |
| `files.read` | 浏览、读取和下载文件，查看回收站 |
| `files.write` | 新建、编辑、上传、移动和重命名 |
| `files.delete` | 将文件或目录移入插件回收站 |
| `settings.read` | 查看供应商有效配置和凭据是否已配置 |
| `settings.write` | 修改供应商、写入凭据和创建自定义供应商 |

设备还必须获得相应 `rootId` 的授权。权限和根目录授权都可以在本机 WebUI 的“设备”页随时修改或撤销。

## 升级与卸载

升级前建议先停止 DSH WebUI，再安装新版本并重新启动。卸载命令：

```sh
dsh plugin --profile web remove dsh-workspace
```

默认状态保存在当前 `DSH_HOME` 下的 `dsh-workspace` 目录。卸载插件不会自动删除状态目录或回收站，以免误删尚未恢复的数据。

## 常见问题

**安装后看不到“文件”入口**

确认插件安装在 `web` profile，并在安装后重启 DSH WebUI。

**“启用并创建配对”按钮不可用**

先添加至少一个授权根。如果刚修改过绑定 IP 或端口，还需要先保存监听设置。

**手机无法连接**

检查远程访问是否已启用，服务器防火墙和云安全组是否放行端口，以及 App 中填写的地址是否能从手机到达。不要填写服务器自己的 `127.0.0.1`。

**保存文件时提示冲突**

文件已经被其他窗口或程序修改。重新加载，合并需要保留的内容后再保存。

## 从源码构建

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

v1.1.0 基于 DSH `dsh-v0.2.1-rc.3`（npm `@deepseek-ai/dsh@0.2.1-rc.3`）开发，CI 覆盖 Windows、Ubuntu 和 macOS。

## 项目信息

- 当前版本：`v1.0.0`
- 作者：[Github@Hakunm](https://github.com/Hakunm)
- 许可证：[GNU Affero General Public License v3.0](./LICENSE)
- Android 客户端：[dsh-android-app](https://github.com/Hakunm/dsh-android-app)
