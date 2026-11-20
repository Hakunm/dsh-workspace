package ai.deepseek.dsh.workspace

import java.io.Closeable
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

const val API_VERSION: String = "v1"

@Serializable
data class HealthView(
    val ok: Boolean,
    val version: String,
    val pluginVersion: String? = null,
    val capabilities: List<String> = emptyList(),
)

@Serializable
data class RootView(val id: String, val label: String, val createdAt: Long)

@Serializable
data class FileEntry(
    val name: String,
    val path: String,
    val kind: String,
    val size: Long,
    val modifiedAt: Double,
    val writable: Boolean,
)

@Serializable
data class DirectoryPage(val path: String, val entries: List<FileEntry>, val nextCursor: String? = null)

@Serializable
data class FileSearchResult(
    val query: String,
    val path: String,
    val entries: List<FileEntry>,
    val truncated: Boolean = false,
)

@Serializable
data class DeviceView(
    val id: String,
    val name: String,
    val scopes: List<String>,
    val rootIds: List<String>,
)

@Serializable
data class PairingResult(val token: String, val device: DeviceView)

@Serializable
data class TrashEntry(
    val id: String,
    val rootId: String,
    val path: String,
    val kind: String,
    val size: Long,
    val createdAt: Long,
    val status: String,
)

@Serializable
data class PendingApproval(
    val id: String,
    val sessionId: String,
    val toolName: String,
    val reason: String? = null,
    val detail: String? = null,
    val risk: String,
    val requestedAt: Long,
)

@Serializable
data class CommandInput(val hint: String)

@Serializable
data class CommandDescriptor(
    val name: String,
    val description: String,
    val input: CommandInput? = null,
)

@Serializable
data class CommandResult(
    val kind: String,
    val text: String? = null,
    val sourceEventSeq: Int? = null,
)

@Serializable
data class CommandExecution(val commandId: String, val result: CommandResult)

@Serializable
data class ChatWorkspace(
    val id: String,
    val title: String,
    val rootId: String,
    val path: String,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class AgentPreset(
    val id: String,
    val name: String,
    val description: String? = null,
    val trust: String = "system",
    val isDefault: Boolean = false,
    val available: Boolean = true,
)

@Serializable
data class PermissionOption(
    val value: String,
    val name: String,
    val description: String? = null,
)

@Serializable
data class PermissionCatalog(
    val options: List<PermissionOption>,
    val defaultPreset: String,
)

@Serializable
data class QuestionOption(
    val label: String,
    val description: String? = null,
)

@Serializable
data class QuestionItem(
    val id: String,
    val question: String,
    val detail: String? = null,
    val header: String? = null,
    val options: List<QuestionOption>? = null,
    val multiSelect: Boolean = false,
)

@Serializable
data class PendingQuestion(
    val id: String,
    val sessionId: String,
    val callId: String? = null,
    val state: String,
    val timed: Boolean = false,
    val questions: List<QuestionItem>,
    val requestedAt: Long,
)

@Serializable
data class QuestionAnswerItem(
    val id: String,
    val selected: List<String>,
    val custom: String? = null,
)

@Serializable
data class ImageAttachment(
    val type: String = "image",
    val mediaType: String,
    val data: String,
    val name: String? = null,
)

@Serializable
data class SessionQueuedItem(
    val id: String,
    val placement: String,
    val rpcId: String? = null,
    val content: List<JsonElement> = emptyList(),
)

@Serializable
data class SessionState(
    val cursor: Int,
    val active: Boolean,
    val running: Boolean,
    val queue: List<SessionQueuedItem>? = null,
    val pendingInput: List<String> = emptyList(),
)

@Serializable
data class ModelSelection(val provider: String, val model: String, val reasoningEffort: String? = null)

@Serializable
data class ModelReasoningEffort(val id: String, val name: String, val description: String? = null)

@Serializable
data class ModelReasoning(
    val efforts: List<ModelReasoningEffort>,
    val defaultEffort: String? = null,
)

@Serializable
data class ModelView(
    val id: String,
    val name: String,
    val description: String? = null,
    val contextWindow: Long? = null,
    val maxTokens: Long? = null,
    val reasoning: ModelReasoning? = null,
)

@Serializable
data class ModelProviderGroup(val id: String, val name: String, val models: List<ModelView>)

@Serializable
data class ModelFailure(val provider: String, val message: String)

@Serializable
data class ModelCatalog(
    val groups: List<ModelProviderGroup>,
    val failures: List<ModelFailure> = emptyList(),
)

@Serializable
data class SessionModels(
    val current: ModelSelection,
    val routable: Boolean,
    val groups: List<ModelProviderGroup>,
    val failures: List<ModelFailure> = emptyList(),
)

@Serializable
data class ProviderModel(
    val id: String,
    val name: String? = null,
    val contextWindow: Long? = null,
    val maxTokens: Long? = null,
)

@Serializable
data class ProviderConfig(
    val baseURL: String? = null,
    val api: String? = null,
    val displayName: String? = null,
    val thinking: String? = null,
    val reasoningEffort: String? = null,
    val models: List<ProviderModel> = emptyList(),
    val modelsInherited: Boolean = false,
)

@Serializable
data class CredentialState(
    val ref: String,
    val configured: Boolean,
    val source: String? = null,
    val writable: Boolean,
)

@Serializable
data class ProviderView(
    val id: String,
    val displayName: String,
    val active: Boolean,
    val declared: Boolean? = null,
    val configurable: Boolean,
    val configured: Boolean,
    val removable: Boolean,
    val defaultBaseURL: String? = null,
    val error: String? = null,
    val credential: CredentialState,
    val config: ProviderConfig,
)

@Serializable
data class ProviderSettings(
    val writable: Boolean,
    val revisionByNamespace: Map<String, Int>,
    val customProvider: CustomProviderCapability,
    val providers: List<ProviderView>,
)

@Serializable
data class CustomProviderCapability(
    val available: Boolean,
    val protocols: List<String>,
    val revision: Int? = null,
)

@Serializable
data class ProviderPatch(
    val displayName: String? = null,
    val baseURL: String? = null,
    val api: String? = null,
    val apiKey: String? = null,
    val thinking: String? = null,
    val reasoningEffort: String? = null,
    val models: List<ProviderModel>? = null,
    val expectedRevision: Int? = null,
)

@Serializable
data class CustomProviderCreate(
    val id: String,
    val displayName: String? = null,
    val baseURL: String,
    val api: String,
    val apiKey: String? = null,
    val models: List<ProviderModel>,
    val expectedRevision: Int? = null,
)

@Serializable
data class WorkspaceEvent(val id: String, val type: String, val time: Long, val data: JsonElement)

data class FileContent(val bytes: ByteArray, val etag: String, val contentType: String?)

class WorkspaceApiException(
    val status: Int,
    val code: String,
    override val message: String,
) : RuntimeException(message)

class DshWorkspaceClient(
    apiBase: String,
    private val token: String? = null,
    private val http: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val base: HttpUrl = (apiBase.trimEnd('/') + "/").toHttpUrl()

    fun health(): HealthView = executeJson("healthz", "GET", null, HealthView.serializer(), authenticated = false)

    fun exchangePairing(code: String, deviceName: String): PairingResult {
        val body = json.encodeToString(PairingRequest.serializer(), PairingRequest(code, deviceName))
        return executeJson("pairings/exchange", "POST", body, PairingResult.serializer(), authenticated = false)
    }

    fun listRoots(): List<RootView> = executeJson(
        "roots",
        "GET",
        null,
        RootList.serializer(),
    ).items

    fun currentDevice(): DeviceView = executeJson("devices/self", "GET", null, DeviceView.serializer())

    fun listEntries(rootId: String, path: String = "", cursor: String? = null): DirectoryPage {
        val url = endpoint("roots/$rootId/entries").newBuilder()
            .addQueryParameter("path", path)
            .apply { if (cursor != null) addQueryParameter("cursor", cursor) }
            .build()
        return executeJson(url, "GET", null, DirectoryPage.serializer())
    }

    fun searchFiles(
        rootId: String,
        query: String,
        path: String = "",
        limit: Int = 100,
        includeHidden: Boolean = false,
    ): FileSearchResult {
        val url = endpoint("roots/$rootId/search").newBuilder()
            .addQueryParameter("query", query)
            .addQueryParameter("limit", limit.toString())
            .apply {
                if (path.isNotEmpty()) addQueryParameter("path", path)
                if (includeHidden) addQueryParameter("includeHidden", "true")
            }
            .build()
        return executeJson(url, "GET", null, FileSearchResult.serializer())
    }

    fun readFile(rootId: String, path: String, range: LongRange? = null): FileContent {
        val url = endpoint("roots/$rootId/content").newBuilder().addQueryParameter("path", path).build()
        val builder = request(url)
        if (range != null) builder.header("Range", "bytes=${range.first}-${range.last}")
        http.newCall(builder.get().build()).execute().use { response ->
            ensureSuccess(response)
            return FileContent(
                bytes = response.body?.bytes() ?: ByteArray(0),
                etag = response.header("ETag") ?: "",
                contentType = response.header("Content-Type"),
            )
        }
    }

    fun writeFile(rootId: String, path: String, bytes: ByteArray, etag: String? = null): String {
        val url = endpoint("roots/$rootId/content").newBuilder().addQueryParameter("path", path).build()
        val builder = request(url)
            .put(bytes.toRequestBody("application/octet-stream".toMediaType()))
        if (etag == null) builder.header("If-None-Match", "*") else builder.header("If-Match", etag)
        http.newCall(builder.build()).execute().use { response ->
            ensureSuccess(response)
            return response.header("ETag") ?: ""
        }
    }

    fun createEntry(rootId: String, path: String, kind: String) {
        val body = json.encodeToString(CreateEntryRequest.serializer(), CreateEntryRequest(path, kind))
        executeUnit("roots/$rootId/entries", "POST", body)
    }

    fun moveEntry(rootId: String, path: String, destinationPath: String) {
        val body = json.encodeToString(MoveEntryRequest.serializer(), MoveEntryRequest(path, destinationPath))
        executeUnit("roots/$rootId/entries", "PATCH", body)
    }

    fun trashEntry(rootId: String, path: String) {
        val url = endpoint("roots/$rootId/entries").newBuilder().addQueryParameter("path", path).build()
        executeUnit(url, "DELETE", null)
    }

    fun listTrash(): List<TrashEntry> = executeJson(
        "trash",
        "GET",
        null,
        TrashList.serializer(),
    ).items

    fun restoreTrash(trashId: String) {
        executeUnit("trash/$trashId/restore", "POST", null)
    }

    fun listSessions(includeArchived: Boolean = false): JsonElement {
        val url = endpoint("chat/sessions").newBuilder()
            .apply { if (includeArchived) addQueryParameter("includeArchived", "true") }
            .build()
        val response = execute(url, "GET", null, true)
        response.use {
            ensureSuccess(it)
            return json.parseToJsonElement(it.body?.string() ?: "{}")
        }
    }

    fun searchSessions(query: String, includeArchived: Boolean = false): JsonElement {
        val url = endpoint("chat/sessions/search").newBuilder()
            .addQueryParameter("q", query)
            .apply { if (includeArchived) addQueryParameter("includeArchived", "true") }
            .build()
        val response = execute(url, "GET", null, true)
        response.use {
            ensureSuccess(it)
            return json.parseToJsonElement(it.body?.string() ?: "{}")
        }
    }

    fun listPermissionCatalog(): PermissionCatalog = executeJson(
        "chat/permissions",
        "GET",
        null,
        PermissionCatalog.serializer(),
    )

    fun listChatWorkspaces(): List<ChatWorkspace> = executeJson(
        "chat/workspaces",
        "GET",
        null,
        ChatWorkspaceList.serializer(),
    ).items

    fun listAgentPresets(): List<AgentPreset> = executeJson(
        "chat/agent-presets",
        "GET",
        null,
        AgentPresetList.serializer(),
    ).items

    fun selectSessionAgentPreset(sessionId: String, agentPreset: String): String {
        val body = json.encodeToString(AgentPresetSelection.serializer(), AgentPresetSelection(agentPreset))
        return executeJson(
            "chat/sessions/$sessionId/agent-preset",
            "PUT",
            body,
            SelectedAgentPresetEnvelope.serializer(),
        ).agentPreset
    }

    fun listSessionModels(sessionId: String): SessionModels = executeJson(
        "chat/sessions/$sessionId/models",
        "GET",
        null,
        SessionModels.serializer(),
    )

    fun selectSessionModel(sessionId: String, selection: ModelSelection): ModelSelection {
        val body = json.encodeToString(ModelSelection.serializer(), selection)
        return executeJson(
            "chat/sessions/$sessionId/model",
            "PUT",
            body,
            SelectedModelEnvelope.serializer(),
        ).selected
    }

    fun listProviderSettings(): ProviderSettings = executeJson(
        "settings/providers",
        "GET",
        null,
        ProviderSettings.serializer(),
    )

    fun listModelCatalog(): ModelCatalog = executeJson(
        "settings/models",
        "GET",
        null,
        ModelCatalog.serializer(),
    )

    fun updateProvider(providerId: String, patch: ProviderPatch): ProviderSettings {
        val body = json.encodeToString(ProviderPatch.serializer(), patch)
        return executeJson("settings/providers/$providerId", "PATCH", body, ProviderSettings.serializer())
    }

    fun createCustomProvider(provider: CustomProviderCreate): ProviderSettings {
        val body = json.encodeToString(CustomProviderCreate.serializer(), provider)
        return executeJson("settings/providers", "POST", body, ProviderSettings.serializer())
    }

    fun discoverProviderModels(
        providerId: String,
        baseURL: String? = null,
        api: String? = null,
        apiKey: String? = null,
    ): List<ProviderModel> {
        val body = json.encodeToString(
            DiscoverModelsRequest.serializer(),
            DiscoverModelsRequest(baseURL, api, apiKey),
        )
        return executeJson(
            "settings/providers/$providerId/discover",
            "POST",
            body,
            DiscoveredModelsEnvelope.serializer(),
        ).models
    }

    fun createSessionInWorkspace(
        workspaceId: String,
        clientRequestId: String,
        agentPreset: String? = null,
    ): JsonElement {
        val body = json.encodeToString(
            WorkspaceSessionRequest.serializer(),
            WorkspaceSessionRequest(workspaceId, agentPreset, clientRequestId),
        )
        return executeJsonElement("chat/sessions", "POST", body)
    }

    fun createChatWorkspace(rootId: String, path: String): ChatWorkspace {
        val body = json.encodeToString(CreateWorkspaceRequest.serializer(), CreateWorkspaceRequest(rootId, path))
        return executeJson(
            "chat/workspaces",
            "POST",
            body,
            CreatedWorkspaceEnvelope.serializer(),
        ).workspace
    }

    fun renameChatWorkspace(workspaceId: String, title: String): ChatWorkspace {
        val body = json.encodeToString(RenameRequest.serializer(), RenameRequest(title))
        return executeJson(
            "chat/workspaces/$workspaceId",
            "PATCH",
            body,
            CreatedWorkspaceEnvelope.serializer(),
        ).workspace
    }

    fun deleteChatWorkspace(workspaceId: String) {
        executeUnit("chat/workspaces/$workspaceId", "DELETE", null)
    }

    fun createSession(rootId: String, path: String, clientRequestId: String): JsonElement {
        val body = json.encodeToString(
            CreateSessionRequest.serializer(),
            CreateSessionRequest(rootId, path, clientRequestId),
        )
        return executeJsonElement("chat/sessions", "POST", body)
    }

    fun listMessages(sessionId: String): JsonElement = executeJsonElement("chat/sessions/$sessionId/messages", "GET", null)

    fun renameSession(sessionId: String, title: String) {
        val body = json.encodeToString(RenameRequest.serializer(), RenameRequest(title))
        executeUnit("chat/sessions/$sessionId", "PATCH", body)
    }

    fun forkSession(sessionId: String, atSeq: Int? = null): String {
        val body = json.encodeToString(ForkSessionRequest.serializer(), ForkSessionRequest(atSeq))
        return executeJson(
            "chat/sessions/$sessionId/fork",
            "POST",
            body,
            ForkedSessionEnvelope.serializer(),
        ).sessionId
    }

    fun archiveSession(sessionId: String) {
        executeUnit("chat/sessions/$sessionId/archive", "POST", null)
    }

    fun unarchiveSession(sessionId: String) {
        executeUnit("chat/sessions/$sessionId/unarchive", "POST", null)
    }

    fun pinSession(sessionId: String) {
        executeUnit("chat/sessions/$sessionId/pin", "POST", null)
    }

    fun unpinSession(sessionId: String) {
        executeUnit("chat/sessions/$sessionId/pin", "DELETE", null)
    }

    fun getSessionState(sessionId: String): SessionState = executeJson(
        "chat/sessions/$sessionId/state",
        "GET",
        null,
        SessionState.serializer(),
    )

    fun updateQueue(sessionId: String, itemId: String, kind: String, text: String? = null) {
        val body = json.encodeToString(QueueMutationRequest.serializer(), QueueMutationRequest(kind, text))
        executeUnit("chat/sessions/$sessionId/queue/$itemId", "POST", body)
    }

    fun listPendingQuestions(sessionId: String): List<PendingQuestion> = executeJson(
        "chat/sessions/$sessionId/questions",
        "GET",
        null,
        PendingQuestionList.serializer(),
    ).items

    fun answerQuestion(sessionId: String, questionId: String, answers: List<QuestionAnswerItem>) {
        val body = json.encodeToString(QuestionAnswerRequest.serializer(), QuestionAnswerRequest(answers))
        executeUnit("chat/sessions/$sessionId/questions/$questionId/answer", "POST", body)
    }

    fun listPendingApprovals(sessionId: String): List<PendingApproval> = executeJson(
        "chat/sessions/$sessionId/approvals",
        "GET",
        null,
        PendingApprovalList.serializer(),
    ).items

    fun decideApproval(sessionId: String, approvalId: String, allowOnce: Boolean) {
        val body = json.encodeToString(
            ApprovalDecision.serializer(),
            ApprovalDecision(if (allowOnce) "allowed-once" else "rejected"),
        )
        executeUnit("chat/sessions/$sessionId/approvals/$approvalId/decision", "POST", body)
    }

    fun listSessionCommands(sessionId: String): List<CommandDescriptor> = executeJson(
        "chat/sessions/$sessionId/commands",
        "GET",
        null,
        CommandDescriptorList.serializer(),
    ).items

    fun executeSessionCommand(sessionId: String, line: String): CommandExecution {
        val body = json.encodeToString(CommandRequest.serializer(), CommandRequest(line))
        return executeJson(
            "chat/sessions/$sessionId/commands",
            "POST",
            body,
            CommandExecutionEnvelope.serializer(),
        ).execution
    }

    fun sendMessage(
        sessionId: String,
        text: String,
        clientRequestId: String,
        steer: Boolean = false,
        attachments: List<ImageAttachment> = emptyList(),
    ): JsonElement {
        val body = json.encodeToString(
            SendMessageRequest.serializer(),
            SendMessageRequest(
                text = text,
                mode = if (steer) "steer" else "queue",
                clientRequestId = clientRequestId,
                attachments = attachments.ifEmpty { null },
            ),
        )
        return executeJsonElement("chat/sessions/$sessionId/messages", "POST", body)
    }

    fun cancel(sessionId: String) {
        executeUnit("chat/runs/$sessionId/cancel", "POST", null)
    }

    fun events(listener: WorkspaceEventListener): EventSubscription {
        require(token != null) { "A paired device token is required for events." }
        return EventSubscription(http, webSocketUrl(), token, json, listener)
    }

    private fun webSocketUrl(): HttpUrl = base.newBuilder().addPathSegment("events").build()

    private fun endpoint(relative: String): HttpUrl = base.resolve(relative)
        ?: throw IllegalArgumentException("Invalid API path: $relative")

    private fun request(url: HttpUrl, authenticated: Boolean = true): Request.Builder {
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (authenticated) builder.header("Authorization", "Bearer ${requireNotNull(token) { "A device token is required." }}")
        return builder
    }

    private fun <T> executeJson(
        relative: String,
        method: String,
        body: String?,
        serializer: kotlinx.serialization.KSerializer<T>,
        authenticated: Boolean = true,
    ): T = executeJson(endpoint(relative), method, body, serializer, authenticated)

    private fun <T> executeJson(
        url: HttpUrl,
        method: String,
        body: String?,
        serializer: kotlinx.serialization.KSerializer<T>,
        authenticated: Boolean = true,
    ): T {
        val response = execute(url, method, body, authenticated)
        response.use {
            ensureSuccess(it)
            return json.decodeFromString(serializer, it.body?.string() ?: "{}")
        }
    }

    private fun executeJsonElement(relative: String, method: String, body: String?): JsonElement {
        val response = execute(endpoint(relative), method, body, true)
        response.use {
            ensureSuccess(it)
            return json.parseToJsonElement(it.body?.string() ?: "{}")
        }
    }

    private fun executeUnit(relative: String, method: String, body: String?) = executeUnit(endpoint(relative), method, body)

    private fun executeUnit(url: HttpUrl, method: String, body: String?) {
        execute(url, method, body, true).use { ensureSuccess(it) }
    }

    private fun execute(url: HttpUrl, method: String, body: String?, authenticated: Boolean): Response {
        val requestBody = body?.toRequestBody("application/json".toMediaType())
        return http.newCall(request(url, authenticated).method(method, requestBody).build()).execute()
    }

    private fun ensureSuccess(response: Response) {
        if (response.isSuccessful) return
        val raw = response.body?.string().orEmpty()
        val parsed = runCatching { json.decodeFromString(ErrorEnvelope.serializer(), raw) }.getOrNull()
        throw WorkspaceApiException(
            response.code,
            parsed?.error?.code ?: "HTTP_ERROR",
            parsed?.error?.message ?: "HTTP ${response.code}",
        )
    }
}

interface WorkspaceEventListener {
    fun onEvent(event: WorkspaceEvent)
    fun onConnectionChanged(connected: Boolean) {}
    fun onPermanentFailure(error: Throwable) {}
}

class EventSubscription internal constructor(
    private val http: OkHttpClient,
    private val url: HttpUrl,
    private val token: String,
    private val json: Json,
    private val listener: WorkspaceEventListener,
) : Closeable {
    private val closed = AtomicBoolean(false)
    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var socket: WebSocket? = null
    private var retry: ScheduledFuture<*>? = null
    private var attempts = 0

    init { connect() }

    private fun connect() {
        if (closed.get()) return
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempts = 0
                listener.onConnectionChanged(true)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { json.decodeFromString(WorkspaceEvent.serializer(), text) }
                    .onSuccess(listener::onEvent)
                    .onFailure(listener::onPermanentFailure)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                listener.onConnectionChanged(false)
                if (code == 4001) listener.onPermanentFailure(IllegalStateException("Device token was revoked."))
                else reconnect()
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                listener.onConnectionChanged(false)
                if (response?.code == 401 || response?.code == 403) listener.onPermanentFailure(error) else reconnect()
            }
        })
    }

    private fun reconnect() {
        if (closed.get()) return
        val delaySeconds = minOf(30L, 1L shl minOf(attempts++, 5))
        retry?.cancel(false)
        retry = scheduler.schedule(::connect, delaySeconds, TimeUnit.SECONDS)
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        retry?.cancel(false)
        socket?.close(1000, "Client closed")
        scheduler.shutdownNow()
    }
}

@Serializable private data class RootList(val items: List<RootView>)
@Serializable private data class TrashList(val items: List<TrashEntry>)
@Serializable private data class PendingApprovalList(val items: List<PendingApproval>)
@Serializable private data class ApprovalDecision(val outcome: String)
@Serializable private data class CommandDescriptorList(val items: List<CommandDescriptor>)
@Serializable private data class CommandRequest(val line: String)
@Serializable private data class CommandExecutionEnvelope(val execution: CommandExecution)
@Serializable private data class ChatWorkspaceList(val items: List<ChatWorkspace>)
@Serializable private data class CreatedWorkspaceEnvelope(val workspace: ChatWorkspace)
@Serializable private data class RenameRequest(val title: String)
@Serializable private data class ForkSessionRequest(val atSeq: Int? = null)
@Serializable private data class ForkedSessionEnvelope(val sessionId: String)
@Serializable private data class AgentPresetList(val items: List<AgentPreset>)
@Serializable private data class AgentPresetSelection(val agentPreset: String)
@Serializable private data class SelectedAgentPresetEnvelope(val agentPreset: String)
@Serializable private data class SelectedModelEnvelope(val selected: ModelSelection)
@Serializable private data class DiscoveredModelsEnvelope(val models: List<ProviderModel>)
@Serializable private data class DiscoverModelsRequest(
    val baseURL: String? = null,
    val api: String? = null,
    val apiKey: String? = null,
)
@Serializable private data class PairingRequest(val code: String, val deviceName: String)
@Serializable private data class CreateEntryRequest(val path: String, val kind: String)
@Serializable private data class MoveEntryRequest(val path: String, val destinationPath: String)
@Serializable private data class CreateWorkspaceRequest(val rootId: String, val path: String)
@Serializable private data class CreateSessionRequest(val rootId: String, val path: String, val clientRequestId: String)
@Serializable private data class WorkspaceSessionRequest(
    val workspaceId: String,
    val agentPreset: String? = null,
    val clientRequestId: String,
)
@Serializable private data class PendingQuestionList(val items: List<PendingQuestion>)
@Serializable private data class QuestionAnswerRequest(val answers: List<QuestionAnswerItem>)
@Serializable private data class QueueMutationRequest(val kind: String, val text: String? = null)
@Serializable private data class SendMessageRequest(
    val text: String,
    val mode: String,
    val clientRequestId: String,
    val attachments: List<ImageAttachment>? = null,
)
@Serializable private data class ErrorEnvelope(val error: ApiErrorBody)
@Serializable private data class ApiErrorBody(val code: String, val message: String, val requestId: String)
