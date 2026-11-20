# Kotlin SDK

该模块是 DeepSeek Harness Android App 的版本化网络层，支持 HTTP/HTTPS、Bearer token、文件浏览/递归搜索与编辑 REST、聊天工作区/会话管理（含置顶、取消归档与全文检索）、TODO/权限预设目录、DSH host 斜杠命令、审批与结构化提问、排队消息操作、图片附件、供应商/凭据状态、模型发现、会话模型/思考强度选择，以及自动退避重连的 WebSocket。App 位于独立项目 `dsh-android-app`；DSH WebUI 功能对等按插件 API 能力矩阵推进，不直接调用 DSH 私有 wire。

```kotlin
val client = DshWorkspaceClient(
    apiBase = "http://192.168.1.20:3090/api/v1",
    token = storedDeviceToken,
)

val roots = client.listRoots()
val page = client.listEntries(roots.first().id, "src")

val workspaces = client.listChatWorkspaces()
val presets = client.listAgentPresets()
val session = client.createSessionInWorkspace(
    workspaceId = workspaces.first().id,
    agentPreset = presets.firstOrNull { it.isDefault }?.id,
)
val commands = client.listSessionCommands(session.id)
client.executeSessionCommand(session.id, "/permission workspace-write")
client.renameSession(session.id, "Mobile session")
val forkedSessionId = client.forkSession(session.id)
```

`listChatWorkspaces()` 返回 DSH WebUI 登记且当前设备获准访问的会话工作区，不等同于 `listRoots()` 返回的插件文件授权根。没有可用 DSH 工作区时应显示空状态，不能用文件根代替。

应用必须把配对返回的 token 存入 Android Keystore 支持的加密存储，不能写入日志或明文偏好。公网连接建议把 `apiBase` 配置为 HTTPS 或使用 VPN。
