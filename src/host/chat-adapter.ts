import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import type { Principal, WorkspaceEvent } from '../shared/contracts.ts'
import type { StoredRoot, WorkspaceDatabase } from './database.ts'
import { ApiError } from './errors.ts'
import { resolveAuthorizedPath, wireRelative } from './path-policy.ts'

export interface RpcResponse<T> {
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: unknown } }
}

export type PromptContentInput =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

export type QueueActionInput =
  | { kind: 'edit'; text: string }
  | { kind: 'remove' }
  | { kind: 'steer' }

export interface PermissionOptionView {
  value: string
  name: string
  description?: string
}

export interface PermissionCatalogView {
  options: PermissionOptionView[]
  defaultPreset: string
}

export interface QuestionOptionView {
  label: string
  description?: string
}

export interface QuestionItemView {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOptionView[]
  multiSelect?: boolean
  intent?: Record<string, unknown>
}

export interface PendingQuestionView {
  id: string
  sessionId: string
  callId?: string
  state: 'open' | 'continued'
  timed: boolean
  questions: QuestionItemView[]
  requestedAt: number
}

export interface QuestionAnswerItemInput {
  id: string
  selected: string[]
  custom?: string
}

export interface SessionQueuedItemView {
  id: string
  placement: string
  rpcId?: string
  content: readonly unknown[]
}

export interface SessionStateView {
  cursor: number
  active: boolean
  running: boolean
  queue: readonly SessionQueuedItemView[] | null
  pendingInput: readonly string[]
}

export interface SessionSearchHitView {
  sessionId: string
  snippet: string
  session: ChatSessionView
}

export interface DshApiProxy {
  respond(message: {
    type: 'client-response'
    rpcId: string
    result: { ok: true; value: unknown }
  }): Promise<{ accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }>
  sessions: {
    list(request: { rpcId: string; payload: { cursor?: string } }): Promise<RpcResponse<{ items: DshSessionSummary[] }>>
    search?(request: { rpcId: string; payload: { query: string } }): Promise<RpcResponse<{
      items: { sessionId: string; snippet: string }[]
      hasMore: boolean
      supported?: boolean
    }>>
    activate?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{ active: boolean }>>
    create(request: { rpcId: string; payload: { cwd?: string; workspaceId?: string; sessionId?: string; agentPreset?: string } }): Promise<RpcResponse<{ sessionId: string; agentPreset?: string }>>
    history(request: { rpcId: string; payload: { sessionId: string; beforeSeq?: number; maxMessages?: number } }): Promise<RpcResponse<{
      events: unknown[]
      hasMore: boolean
      cursor?: number
      projections?: unknown
    }>>
    state?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<SessionStateView>>
    updateQueue?(request: { rpcId: string; payload: { sessionId: string; itemId: string; action: unknown } }): Promise<RpcResponse<{ accepted: true }>>
    prompt(request: { rpcId: string; payload: { sessionId: string; mode: 'queue' | 'steer'; content: PromptContentInput[]; clientTimeZone?: string } }): Promise<RpcResponse<{ accepted: true; command?: unknown }>>
    cancel(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{ accepted: true }>>
    rename(request: { rpcId: string; payload: { sessionId: string; title: string } }): Promise<RpcResponse<{ title: string; seq: number }>>
    fork(request: { rpcId: string; payload: { sessionId: string; atSeq?: number } }): Promise<RpcResponse<{ sessionId: string }>>
    models(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<SessionModelsView>>
    selectModel(request: { rpcId: string; payload: { sessionId: string; provider: string; model: string; reasoningEffort?: string } }): Promise<RpcResponse<{ selected: ModelSelectionView }>>
  }
  workspace: {
    list(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{
      items: DshWorkspaceSummary[]
      archivedSessionIds: string[]
      pinnedSessionIds?: string[]
    }>>
    create(request: { rpcId: string; payload: { path: string } }): Promise<RpcResponse<{
      workspace: DshWorkspaceSummary
      created: boolean
    }>>
    rename(request: { rpcId: string; payload: { workspaceId: string; title: string } }): Promise<RpcResponse<{
      workspace: DshWorkspaceSummary
    }>>
    delete(request: { rpcId: string; payload: { workspaceId: string } }): Promise<RpcResponse<{ deleted: true }>>
    archiveSession(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{
      archivedSessionIds: string[]
    }>>
    unarchiveSession?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{
      archivedSessionIds: string[]
    }>>
    pinSession?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{
      pinnedSessionIds: string[]
    }>>
    unpinSession?(request: { rpcId: string; payload: { sessionId: string } }): Promise<RpcResponse<{
      pinnedSessionIds: string[]
    }>>
  }
  permissions?: {
    catalog(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<PermissionCatalogView>>
  }
  agentPresets: {
    list(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{
      presets: DshAgentPresetSummary[]
      authorable: boolean
      hasDocument: boolean
    }>>
    select(request: { rpcId: string; payload: { sessionId: string; agentPreset: string } }): Promise<RpcResponse<{ agentPreset: string }>>
  }
  events: {
    mux(request: { rpcId: string; payload: Record<string, never> }, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: Record<string, unknown> }>
    host(request: { rpcId: string; payload: Record<string, never> }, signal: AbortSignal): AsyncIterable<{ rpcId: string; payload: Record<string, unknown> }>
  }
}

export interface ModelSelectionView {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningView {
  efforts: { id: string; name: string; description?: string }[]
  defaultEffort?: string
}

export interface ModelProviderGroupView {
  id: string
  name: string
  models: { id: string; name: string; description?: string; contextWindow?: number; maxTokens?: number; reasoning?: ModelReasoningView }[]
}

export interface SessionModelsView {
  current: ModelSelectionView
  routable: boolean
  groups: ModelProviderGroupView[]
  failures: { provider: string; message: string }[]
}

export interface CommandDescriptorView {
  name: string
  description: string
  input?: { hint: string; attachments?: boolean }
}

export interface CommandExecutionView {
  commandId: string
  result: { kind: 'success' | 'error'; text?: string; sourceEventSeq?: number }
}

export interface DshCommandRuntime {
  list(agent: unknown): readonly CommandDescriptorView[]
  execute(
    agent: unknown,
    line: string,
    submittedAttachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<CommandExecutionView | undefined>
}

export interface DshAgentRegistry {
  get(sessionId: string): unknown | undefined
}

export interface DshCommandServices {
  commands: DshCommandRuntime
  agents: DshAgentRegistry
}

interface DshSessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  agentPreset?: string
  parentSessionId?: string
  origin?: 'subagent'
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

interface DshWorkspaceSummary {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

interface DshAgentPresetSummary {
  id: string
  trust: 'system' | 'user'
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

export interface ChatSessionView {
  id: string
  rootId: string
  cwd: string
  updatedAt: number
  running: boolean
  blank: boolean
  pinned?: boolean
  archived?: boolean
  title?: string
  workspaceId?: string
  workspaceTitle?: string
  agentPreset?: string
  parentSessionId?: string
  origin?: 'subagent'
  pendingInteraction?: 'approval' | 'question'
}

export interface PendingApprovalView {
  id: string
  sessionId: string
  toolName: string
  reason?: string
  detail?: string
  risk: 'standard' | 'full-access'
  requestedAt: number
}

interface PendingApprovalRecord {
  rpcId: string
  sessionId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
  requestedAt: number
}

interface PendingQuestionRecord {
  rpcId: string
  sessionId: string
  questionId: string
  callId?: string
  timed: boolean
  questions: QuestionItemView[]
  requestedAt: number
}

export interface ChatWorkspaceView {
  id: string
  title: string
  rootId: string
  path: string
  createdAt: string
  updatedAt: string
}

export interface AgentPresetView {
  id: string
  name: string
  description?: string
  trust: 'system' | 'user'
  isDefault: boolean
  available: boolean
}

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export class DshChatAdapter {
  private readonly sessionRootIds = new Map<string, string>()
  private readonly sessionRootLookups = new Map<string, Promise<string | undefined>>()
  private readonly pendingApprovals = new Map<string, PendingApprovalRecord>()
  private readonly pendingQuestions = new Map<string, PendingQuestionRecord>()

  constructor(
    private readonly api: DshApiProxy,
    private readonly database: WorkspaceDatabase,
    private readonly commandServices?: DshCommandServices,
  ) {}

  async listSessions(principal: Principal, options: { includeArchived?: boolean } = {}): Promise<ChatSessionView[]> {
    const [sessionsResponse, workspaceResponse] = await Promise.all([
      this.api.sessions.list({ rpcId: randomUUID(), payload: {} }),
      this.api.workspace.list({ rpcId: randomUUID(), payload: {} }),
    ])
    const value = unwrapDsh(sessionsResponse)
    const workspaceValue = unwrapDsh(workspaceResponse)
    const workspaces = this.visibleWorkspaces(principal, workspaceValue.items)
    const workspaceBySessionId = new Map<string, ChatWorkspaceView>()
    for (const raw of workspaceValue.items) {
      const visibleWorkspace = workspaces.find(item => item.id === raw.workspaceId)
      if (visibleWorkspace === undefined) continue
      for (const sessionId of raw.sessionIds ?? []) {
        workspaceBySessionId.set(sessionId, visibleWorkspace)
      }
    }
    const archivedSessionIds = new Set(workspaceValue.archivedSessionIds)
    const pinnedOrder = workspaceValue.pinnedSessionIds ?? []
    const pinnedIndex = new Map(pinnedOrder.map((id, index) => [id, index]))
    const roots = this.authorizedRoots(principal)
    const visible: ChatSessionView[] = []
    for (const session of value.items) {
      // Subagent sessions are owned by subagent routing in DSH 0.2.x and cannot be activated directly.
      if (session.origin === 'subagent') continue
      const isArchived = archivedSessionIds.has(session.sessionId)
      if (isArchived && options.includeArchived !== true) continue
      const match = session.cwd === undefined ? undefined : matchRoot(roots, session.cwd)
      if (match === undefined) continue
      const workspace = workspaceBySessionId.get(session.sessionId)
        ?? workspaces.find(item => item.rootId === match.root.id && item.path === match.relative)
      const title = sessionTitle(session)
      const isPinned = pinnedIndex.has(session.sessionId)
      const pendingInteraction = this.hasPendingApproval(session.sessionId)
        ? 'approval' as const
        : this.hasPendingQuestion(session.sessionId)
          ? 'question' as const
          : undefined
      visible.push({
        id: session.sessionId,
        rootId: match.root.id,
        cwd: match.relative,
        updatedAt: session.updatedAt,
        running: session.running,
        blank: session.blank,
        ...(isPinned ? { pinned: true } : {}),
        ...(isArchived ? { archived: true } : {}),
        ...(title === undefined ? {} : { title }),
        ...(workspace === undefined ? {} : { workspaceId: workspace.id, workspaceTitle: workspace.title }),
        ...(session.agentPreset === undefined ? {} : { agentPreset: session.agentPreset }),
        ...(session.parentSessionId === undefined ? {} : { parentSessionId: session.parentSessionId }),
        ...(pendingInteraction === undefined ? {} : { pendingInteraction }),
      })
    }
    if (pinnedIndex.size > 0) {
      visible.sort((left, right) => {
        const leftPin = pinnedIndex.get(left.id)
        const rightPin = pinnedIndex.get(right.id)
        if (leftPin !== undefined && rightPin !== undefined) return leftPin - rightPin
        if (leftPin !== undefined) return -1
        if (rightPin !== undefined) return 1
        return 0
      })
    }
    return visible
  }

  async searchSessions(
    principal: Principal,
    query: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<{ items: SessionSearchHitView[]; hasMore: boolean; mode: 'fulltext' | 'metadata' }> {
    const normalized = query.trim()
    if (normalized === '' || normalized.length > 500 || normalized.includes('\0')) {
      throw new ApiError(400, 'SEARCH_QUERY_INVALID', 'Search query must contain 1 to 500 characters and no null bytes.')
    }
    const sessions = await this.listSessions(principal, options)
    const sessionById = new Map(sessions.map(item => [item.id, item]))
    if (typeof this.api.sessions.search === 'function') {
      try {
        const remote = unwrapDsh(await this.api.sessions.search({ rpcId: randomUUID(), payload: { query: normalized } }))
        if (remote.supported !== false) {
          const hits: SessionSearchHitView[] = []
          const seen = new Set<string>()
          for (const hit of remote.items) {
            const session = sessionById.get(hit.sessionId)
            if (session === undefined || seen.has(session.id)) continue
            seen.add(session.id)
            hits.push({ sessionId: session.id, snippet: hit.snippet, session })
          }
          if (hits.length > 0) {
            return { items: hits, hasMore: remote.hasMore, mode: 'fulltext' }
          }
        }
      } catch {
        // Fall back to metadata matching when DSH full-text search index is disabled.
      }
    }
    const needle = normalized.toLowerCase()
    const items: SessionSearchHitView[] = []
    for (const session of sessions) {
      const haystacks = [session.title, session.workspaceTitle, session.cwd, session.id]
      const matched = haystacks.find(value => value !== undefined && value.toLowerCase().includes(needle))
      if (matched === undefined) continue
      items.push({ sessionId: session.id, snippet: matched, session })
      if (items.length >= 20) break
    }
    return { items, hasMore: false, mode: 'metadata' }
  }

  async listWorkspaces(principal: Principal): Promise<ChatWorkspaceView[]> {
    const value = unwrapDsh(await this.api.workspace.list({ rpcId: randomUUID(), payload: {} }))
    return this.visibleWorkspaces(principal, value.items)
  }

  async createWorkspace(principal: Principal, rootId: string, relativePath: string): Promise<ChatWorkspaceView> {
    const root = this.requireAuthorizedRoot(principal, rootId)
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath)
    const info = await lstat(resolved.absolutePath)
    if (!info.isDirectory()) {
      throw new ApiError(400, 'WORKSPACE_PATH_NOT_DIRECTORY', 'A DSH workspace must use an existing directory.')
    }
    const value = unwrapDsh(await this.api.workspace.create({
      rpcId: randomUUID(),
      payload: { path: resolved.absolutePath },
    }))
    const path = wireRelative(root.realPath, value.workspace.path)
    if (path === undefined) {
      throw new ApiError(403, 'WORKSPACE_OUTSIDE_ROOT', 'The created DSH workspace is outside the authorized root.')
    }
    return {
      id: value.workspace.workspaceId,
      title: value.workspace.title,
      rootId: root.id,
      path,
      createdAt: value.workspace.createdAt,
      updatedAt: value.workspace.updatedAt,
    }
  }

  async renameWorkspace(principal: Principal, workspaceId: string, title: string): Promise<ChatWorkspaceView> {
    const workspace = await this.requireWorkspace(principal, workspaceId)
    const normalized = title.trim()
    if (normalized === '') throw new ApiError(400, 'WORKSPACE_TITLE_INVALID', 'The workspace title cannot be empty.')
    const value = unwrapDsh(await this.api.workspace.rename({
      rpcId: randomUUID(),
      payload: { workspaceId, title: normalized },
    }))
    const renamed = this.visibleWorkspaces(principal, [value.workspace])[0]
    if (renamed === undefined) {
      throw new ApiError(403, 'WORKSPACE_OUTSIDE_ROOT', 'The renamed DSH workspace is outside the authorized roots.')
    }
    return { ...renamed, rootId: workspace.rootId, path: workspace.path }
  }

  async deleteWorkspace(principal: Principal, workspaceId: string): Promise<void> {
    await this.requireWorkspace(principal, workspaceId)
    unwrapDsh(await this.api.workspace.delete({ rpcId: randomUUID(), payload: { workspaceId } }))
  }

  async listAgentPresets(): Promise<AgentPresetView[]> {
    const value = unwrapDsh(await this.api.agentPresets.list({ rpcId: randomUUID(), payload: {} }))
    return value.presets.map(preset => ({
      id: preset.id,
      name: preset.name?.trim() || preset.id,
      ...(preset.description === undefined ? {} : { description: preset.description }),
      trust: preset.trust,
      isDefault: preset.isDefault,
      available: preset.broken === undefined,
    }))
  }

  async listPermissionCatalog(): Promise<PermissionCatalogView> {
    if (this.api.permissions?.catalog !== undefined) {
      return unwrapDsh(await this.api.permissions.catalog({ rpcId: randomUUID(), payload: {} }))
    }
    return {
      options: [
        { value: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace; wider operations require approval.' },
        { value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' },
      ],
      defaultPreset: 'workspace-write',
    }
  }

  async selectAgentPreset(principal: Principal, sessionId: string, agentPreset: string): Promise<string> {
    const session = await this.requireSession(principal, sessionId)
    const requested = agentPreset.trim()
    if (requested === '') throw new ApiError(400, 'AGENT_PRESET_INVALID', 'agentPreset is required.')
    if (!session.blank) {
      throw new ApiError(
        409,
        'AGENT_PRESET_LOCKED',
        'This session has already started. Its Agent preset can no longer be changed.',
      )
    }
    const value = unwrapDsh(await this.api.agentPresets.select({
      rpcId: randomUUID(),
      payload: { sessionId, agentPreset: requested },
    }))
    return value.agentPreset
  }

  async createSessionInWorkspace(
    principal: Principal,
    workspaceId: string,
    options: { sessionId?: string; agentPreset?: string },
  ): Promise<{ id: string; agentPreset?: string }> {
    const workspace = (await this.listWorkspaces(principal)).find(item => item.id === workspaceId)
    if (workspace === undefined) {
      throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'The DSH workspace is not visible to this device.')
    }
    const payload = {
      workspaceId,
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    }
    const value = unwrapDsh(await this.api.sessions.create({ rpcId: randomUUID(), payload }))
    return { id: value.sessionId, ...(value.agentPreset === undefined ? {} : { agentPreset: value.agentPreset }) }
  }

  async createSession(
    principal: Principal,
    rootId: string,
    relativePath: string,
    options: { sessionId?: string; agentPreset?: string },
  ): Promise<{ id: string; agentPreset?: string }> {
    const root = this.requireAuthorizedRoot(principal, rootId)
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath)
    const payload = {
      cwd: resolved.absolutePath,
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    }
    const value = unwrapDsh(await this.api.sessions.create({ rpcId: randomUUID(), payload }))
    return { id: value.sessionId, ...(value.agentPreset === undefined ? {} : { agentPreset: value.agentPreset }) }
  }

  async history(
    principal: Principal,
    sessionId: string,
    options: { beforeSeq?: number; maxMessages?: number },
  ): Promise<{ events: unknown[]; hasMore: boolean; cursor?: number; projections?: unknown }> {
    await this.requireSession(principal, sessionId, { includeArchived: true })
    const payload = {
      sessionId,
      ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
      ...(options.maxMessages === undefined ? {} : { maxMessages: options.maxMessages }),
    }
    return unwrapDsh(await this.api.sessions.history({ rpcId: randomUUID(), payload }))
  }

  async sessionState(principal: Principal, sessionId: string): Promise<SessionStateView> {
    await this.requireSession(principal, sessionId, { includeArchived: true })
    if (typeof this.api.sessions.state !== 'function') {
      throw new ApiError(501, 'SESSION_STATE_UNAVAILABLE', 'This DSH version does not expose session state inspection.')
    }
    return unwrapDsh(await this.api.sessions.state({ rpcId: randomUUID(), payload: { sessionId } }))
  }

  async updateQueue(principal: Principal, sessionId: string, itemId: string, action: QueueActionInput): Promise<void> {
    await this.requireSession(principal, sessionId)
    if (typeof this.api.sessions.updateQueue !== 'function') {
      throw new ApiError(501, 'QUEUE_MUTATION_UNAVAILABLE', 'This DSH version does not expose queue management.')
    }
    const normalizedId = itemId.trim()
    if (normalizedId === '') throw new ApiError(400, 'QUEUE_ITEM_INVALID', 'itemId is required.')
    let wireAction: unknown
    if (action.kind === 'edit') {
      if (action.text.trim() === '') throw new ApiError(400, 'MESSAGE_EMPTY', 'The replacement text cannot be empty.')
      wireAction = { kind: 'edit', content: [{ type: 'text', text: action.text }] }
    } else if (action.kind === 'remove' || action.kind === 'steer') {
      wireAction = { kind: action.kind }
    } else {
      throw new ApiError(400, 'QUEUE_ACTION_INVALID', 'action.kind must be edit, remove, or steer.')
    }
    unwrapDsh(await this.api.sessions.updateQueue({
      rpcId: randomUUID(),
      payload: { sessionId, itemId: normalizedId, action: wireAction },
    }))
  }

  async prompt(
    principal: Principal,
    sessionId: string,
    text: string,
    mode: 'queue' | 'steer',
    clientTimeZone?: string,
    attachments: readonly { type: 'image'; mediaType: string; data: string; name?: string }[] = [],
  ): Promise<{ accepted: true; command?: unknown }> {
    await this.requireSession(principal, sessionId)
    const content: PromptContentInput[] = []
    if (text !== '') content.push({ type: 'text', text })
    for (const attachment of attachments) {
      if (attachment.type !== 'image' || !SUPPORTED_IMAGE_MEDIA_TYPES.has(attachment.mediaType) || attachment.data.trim() === '') {
        throw new ApiError(400, 'ATTACHMENT_INVALID', 'Attachments must be base64-encoded PNG, JPEG, WebP, or GIF images.')
      }
      content.push({
        type: 'image',
        mediaType: attachment.mediaType,
        data: attachment.data,
        ...(attachment.name === undefined || attachment.name.trim() === '' ? {} : { name: attachment.name.trim().slice(0, 180) }),
      })
    }
    if (content.length === 0) throw new ApiError(400, 'MESSAGE_EMPTY', 'The message text cannot be empty.')
    return unwrapDsh(await this.api.sessions.prompt({
      rpcId: randomUUID(),
      payload: {
        sessionId,
        mode,
        content,
        ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      },
    }))
  }

  async cancel(principal: Principal, sessionId: string): Promise<void> {
    await this.requireSession(principal, sessionId)
    unwrapDsh(await this.api.sessions.cancel({ rpcId: randomUUID(), payload: { sessionId } }))
  }

  async renameSession(principal: Principal, sessionId: string, title: string): Promise<{ title: string; seq: number }> {
    await this.requireSession(principal, sessionId, { includeArchived: true })
    const normalized = title.trim()
    if (normalized === '') throw new ApiError(400, 'SESSION_TITLE_INVALID', 'The session title cannot be empty.')
    return unwrapDsh(await this.api.sessions.rename({
      rpcId: randomUUID(),
      payload: { sessionId, title: normalized },
    }))
  }

  async forkSession(principal: Principal, sessionId: string, atSeq?: number): Promise<string> {
    await this.requireSession(principal, sessionId, { includeArchived: true })
    const value = unwrapDsh(await this.api.sessions.fork({
      rpcId: randomUUID(),
      payload: { sessionId, ...(atSeq === undefined ? {} : { atSeq }) },
    }))
    if (!await this.isSessionAuthorized(principal, value.sessionId)) {
      throw new ApiError(403, 'SESSION_FORK_OUTSIDE_ROOT', 'The forked session is outside the authorized roots.')
    }
    return value.sessionId
  }

  async archiveSession(principal: Principal, sessionId: string): Promise<string[]> {
    await this.requireSession(principal, sessionId)
    return unwrapDsh(await this.api.workspace.archiveSession({
      rpcId: randomUUID(),
      payload: { sessionId },
    })).archivedSessionIds
  }

  async unarchiveSession(principal: Principal, sessionId: string): Promise<string[]> {
    await this.requireSession(principal, sessionId, { includeArchived: true })
    if (typeof this.api.workspace.unarchiveSession !== 'function') {
      throw new ApiError(501, 'UNARCHIVE_UNAVAILABLE', 'This DSH version does not support unarchiving sessions.')
    }
    return unwrapDsh(await this.api.workspace.unarchiveSession({
      rpcId: randomUUID(),
      payload: { sessionId },
    })).archivedSessionIds
  }

  async pinSession(principal: Principal, sessionId: string): Promise<string[]> {
    await this.requireSession(principal, sessionId)
    if (typeof this.api.workspace.pinSession !== 'function') {
      throw new ApiError(501, 'PIN_UNAVAILABLE', 'This DSH version does not support pinning sessions.')
    }
    return unwrapDsh(await this.api.workspace.pinSession({
      rpcId: randomUUID(),
      payload: { sessionId },
    })).pinnedSessionIds
  }

  async unpinSession(principal: Principal, sessionId: string): Promise<string[]> {
    await this.requireSession(principal, sessionId)
    if (typeof this.api.workspace.unpinSession !== 'function') {
      throw new ApiError(501, 'PIN_UNAVAILABLE', 'This DSH version does not support unpinning sessions.')
    }
    return unwrapDsh(await this.api.workspace.unpinSession({
      rpcId: randomUUID(),
      payload: { sessionId },
    })).pinnedSessionIds
  }

  async listPendingApprovals(principal: Principal, sessionId: string): Promise<PendingApprovalView[]> {
    await this.requireSession(principal, sessionId)
    const records = [...this.pendingApprovals.values()].filter(item => item.sessionId === sessionId)
    if (records.length === 0) return []
    let history: unknown[] = []
    if (records.some(item => item.callId !== undefined)) {
      try {
        history = unwrapDsh(await this.api.sessions.history({
          rpcId: randomUUID(),
          payload: { sessionId, maxMessages: 100 },
        })).events
      } catch {
        // Approval decisions remain available even when an optional command preview cannot be loaded.
      }
    }
    return records
      .sort((left, right) => left.requestedAt - right.requestedAt)
      .map(record => publicApproval(record, findToolCallDetail(history, record.callId)))
  }

  async decideApproval(
    principal: Principal,
    sessionId: string,
    approvalId: string,
    outcome: 'allowed-once' | 'rejected',
  ): Promise<PendingApprovalView> {
    await this.requireSession(principal, sessionId)
    const key = approvalKey(sessionId, approvalId)
    const pending = this.pendingApprovals.get(key)
    if (pending === undefined) {
      throw new ApiError(409, 'APPROVAL_NOT_PENDING', 'This approval is no longer pending.')
    }
    const receipt = await this.api.respond({
      type: 'client-response',
      rpcId: pending.rpcId,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    })
    if (!receipt.accepted) {
      this.pendingApprovals.delete(key)
      throw new ApiError(409, 'APPROVAL_NOT_PENDING', 'This approval is no longer pending.')
    }
    this.pendingApprovals.delete(key)
    return publicApproval(pending)
  }

  async listPendingQuestions(principal: Principal, sessionId: string): Promise<PendingQuestionView[]> {
    await this.requireSession(principal, sessionId)
    const byId = new Map<string, PendingQuestionView>()
    for (const record of this.pendingQuestions.values()) {
      if (record.sessionId !== sessionId) continue
      byId.set(record.questionId, {
        id: record.questionId,
        sessionId: record.sessionId,
        ...(record.callId === undefined ? {} : { callId: record.callId }),
        state: 'open',
        timed: record.timed,
        questions: record.questions,
        requestedAt: record.requestedAt,
      })
    }
    // Also surface `continued` timed questions persisted in DSH 0.2.2+ userQuestions projection.
    try {
      const history = unwrapDsh(await this.api.sessions.history({
        rpcId: randomUUID(),
        payload: { sessionId, maxMessages: 1 },
      }))
      const projectionValues = isRecord(history.projections) && isRecord(history.projections.values)
        ? history.projections.values
        : undefined
      const userQuestions = isRecord(projectionValues?.userQuestions) ? projectionValues.userQuestions : undefined
      if (Array.isArray(userQuestions?.active)) {
        for (const item of userQuestions.active) {
          if (!isRecord(item) || typeof item.callId !== 'string' || !Array.isArray(item.questions)) continue
          if (byId.has(item.callId)) continue
          const state = item.state === 'continued' ? 'continued' : 'open'
          if (state !== 'continued') continue
          const parsed = parseQuestionItems(item.questions)
          if (parsed.length === 0) continue
          byId.set(item.callId, {
            id: item.callId,
            sessionId,
            callId: item.callId,
            state: 'continued',
            timed: true,
            questions: parsed,
            requestedAt: Date.now(),
          })
        }
      }
    } catch {
      // Live waterfall questions remain readable even if projection read fails.
    }
    return [...byId.values()].sort((left, right) => left.requestedAt - right.requestedAt)
  }

  async answerQuestion(
    principal: Principal,
    sessionId: string,
    questionId: string,
    answers: QuestionAnswerItemInput[],
  ): Promise<void> {
    await this.requireSession(principal, sessionId)
    if (!Array.isArray(answers) || answers.length === 0) {
      throw new ApiError(400, 'QUESTION_ANSWER_INVALID', 'At least one answer item is required.')
    }
    const normalizedAnswers: QuestionAnswerItemInput[] = answers.map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim() === '' || !Array.isArray(item.selected)) {
        throw new ApiError(400, 'QUESTION_ANSWER_INVALID', 'Each answer must include id and selected string array.')
      }
      const selected = item.selected.filter((entry): entry is string => typeof entry === 'string')
      const custom = typeof item.custom === 'string' && item.custom.trim() !== '' ? item.custom : undefined
      return { id: item.id, selected, ...(custom === undefined ? {} : { custom }) }
    })
    const key = approvalKey(sessionId, questionId)
    const pending = this.pendingQuestions.get(key)
    const receipt = await this.api.respond({
      type: 'client-response',
      rpcId: pending?.rpcId ?? randomUUID(),
      result: { ok: true, value: { sessionId, questionId, answers: normalizedAnswers } },
    })
    if (!receipt.accepted) {
      this.pendingQuestions.delete(key)
      throw new ApiError(409, 'QUESTION_NOT_PENDING', 'This question is no longer pending.')
    }
    this.pendingQuestions.delete(key)
  }

  async models(principal: Principal, sessionId: string): Promise<SessionModelsView> {
    await this.requireSession(principal, sessionId)
    return unwrapDsh(await this.api.sessions.models({ rpcId: randomUUID(), payload: { sessionId } }))
  }

  async selectModel(
    principal: Principal,
    sessionId: string,
    selection: ModelSelectionView,
  ): Promise<ModelSelectionView> {
    await this.requireSession(principal, sessionId)
    if (selection.provider.trim() === '' || selection.model.trim() === '') {
      throw new ApiError(400, 'MODEL_SELECTION_INVALID', 'provider and model are required.')
    }
    const payload = {
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }
    return unwrapDsh(await this.api.sessions.selectModel({ rpcId: randomUUID(), payload })).selected
  }

  async listCommands(principal: Principal, sessionId: string): Promise<CommandDescriptorView[]> {
    const agent = await this.commandAgent(principal, sessionId)
    return this.commandServices!.commands.list(agent).map(command => ({
      name: command.name,
      description: command.description,
      ...(command.input === undefined ? {} : {
        input: {
          hint: command.input.hint,
          ...(command.input.attachments === true ? { attachments: true } : {}),
        },
      }),
    }))
  }

  async executeCommand(principal: Principal, sessionId: string, line: string): Promise<CommandExecutionView> {
    const normalized = line.trimEnd()
    if (normalized.length === 0 || normalized.length > 16_384 || normalized.includes('\0')) {
      throw new ApiError(400, 'COMMAND_INVALID', 'The command line must contain 1 to 16384 characters and no null bytes.')
    }
    const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(normalized)
    if (match === null) throw new ApiError(400, 'COMMAND_INVALID', 'A slash command must start with a valid command name.')
    const agent = await this.commandAgent(principal, sessionId)
    const known = this.commandServices!.commands.list(agent).some(command => command.name === match[1])
    if (!known) throw new ApiError(404, 'COMMAND_NOT_FOUND', 'The command is not available for this session.')
    try {
      const execution = await this.commandServices!.commands.execute(agent, normalized, [], new AbortController().signal)
      if (execution === undefined) throw new ApiError(404, 'COMMAND_NOT_FOUND', 'The command is no longer available for this session.')
      return {
        commandId: String(execution.commandId),
        result: {
          kind: execution.result.kind,
          ...(execution.result.text === undefined ? {} : { text: execution.result.text }),
          ...(execution.result.sourceEventSeq === undefined ? {} : { sourceEventSeq: execution.result.sourceEventSeq }),
        },
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(409, 'COMMAND_FAILED', error instanceof Error ? error.message : String(error))
    }
  }

  async isSessionAuthorized(principal: Principal, sessionId: string): Promise<boolean> {
    const rootId = await this.sessionRootId(sessionId)
    return rootId !== undefined && (principal.rootIds === 'all' || principal.rootIds.has(rootId))
  }

  startEvents(signal: AbortSignal, emit: (event: WorkspaceEvent) => void): void {
    const run = async (kind: 'mux' | 'host'): Promise<void> => {
      const stream = this.api.events[kind]({ rpcId: randomUUID(), payload: {} }, signal)
      for await (const frame of stream) {
        if (signal.aborted) break
        this.captureInteraction(frame, kind)
        emit(normalizeDshEvent(frame, kind))
      }
    }
    void run('mux').catch(() => undefined)
    void run('host').catch(() => undefined)
  }

  private captureInteraction(
    frame: { rpcId: string; payload: Record<string, unknown> },
    kind: 'mux' | 'host',
  ): void {
    if (kind !== 'mux') return
    const payload = frame.payload
    if (
      payload.type === 'approval/requested'
      && typeof payload.sessionId === 'string'
      && typeof payload.approvalId === 'string'
      && typeof payload.toolName === 'string'
    ) {
      const key = approvalKey(payload.sessionId, payload.approvalId)
      const previous = this.pendingApprovals.get(key)
      this.pendingApprovals.set(key, {
        rpcId: frame.rpcId,
        sessionId: payload.sessionId,
        approvalId: payload.approvalId,
        toolName: redactApprovalText(payload.toolName, 120),
        ...(typeof payload.callId === 'string' ? { callId: payload.callId } : {}),
        ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
        requestedAt: previous?.requestedAt ?? Date.now(),
      })
      return
    }
    if (
      payload.type === 'approval/resolved'
      && typeof payload.sessionId === 'string'
      && typeof payload.approvalId === 'string'
    ) {
      this.pendingApprovals.delete(approvalKey(payload.sessionId, payload.approvalId))
      return
    }
    if (
      payload.type === 'question/requested'
      && typeof payload.sessionId === 'string'
      && typeof payload.questionId === 'string'
      && Array.isArray(payload.questions)
    ) {
      const questions = parseQuestionItems(payload.questions)
      if (questions.length === 0) return
      const key = approvalKey(payload.sessionId, payload.questionId)
      const previous = this.pendingQuestions.get(key)
      this.pendingQuestions.set(key, {
        rpcId: frame.rpcId,
        sessionId: payload.sessionId,
        questionId: payload.questionId,
        ...(typeof payload.callId === 'string' ? { callId: payload.callId } : {}),
        timed: payload.timed === true,
        questions,
        requestedAt: previous?.requestedAt ?? Date.now(),
      })
      return
    }
    if (
      payload.type === 'question/resolved'
      && typeof payload.sessionId === 'string'
      && typeof payload.questionId === 'string'
    ) {
      this.pendingQuestions.delete(approvalKey(payload.sessionId, payload.questionId))
    }
  }

  private hasPendingApproval(sessionId: string): boolean {
    for (const item of this.pendingApprovals.values()) if (item.sessionId === sessionId) return true
    return false
  }

  private hasPendingQuestion(sessionId: string): boolean {
    for (const item of this.pendingQuestions.values()) if (item.sessionId === sessionId) return true
    return false
  }

  private async commandAgent(principal: Principal, sessionId: string): Promise<unknown> {
    await this.requireSession(principal, sessionId)
    const services = this.commandServices
    if (services === undefined) {
      throw new ApiError(503, 'COMMANDS_UNAVAILABLE', 'This DSH composition does not expose the command runtime.')
    }
    let agent = services.agents.get(sessionId)
    if (agent !== undefined) return agent

    try {
      if (typeof this.api.sessions.activate === 'function') {
        unwrapDsh(await this.api.sessions.activate({ rpcId: randomUUID(), payload: { sessionId } }))
      } else {
        unwrapDsh(await this.api.sessions.models({ rpcId: randomUUID(), payload: { sessionId } }))
      }
    } catch {
      // The registry lookup below is the authoritative availability result.
    }
    agent = services.agents.get(sessionId)
    if (agent === undefined) {
      throw new ApiError(409, 'COMMANDS_UNAVAILABLE', 'The session could not be activated for command discovery.')
    }
    return agent
  }

  private async requireSession(
    principal: Principal,
    sessionId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<ChatSessionView> {
    const session = (await this.listSessions(principal, options)).find(item => item.id === sessionId)
    if (session === undefined) throw new ApiError(404, 'SESSION_NOT_FOUND', 'The session is not visible to this device.')
    return session
  }

  private async requireWorkspace(principal: Principal, workspaceId: string): Promise<ChatWorkspaceView> {
    const workspace = (await this.listWorkspaces(principal)).find(item => item.id === workspaceId)
    if (workspace === undefined) {
      throw new ApiError(404, 'WORKSPACE_NOT_FOUND', 'The DSH workspace is not visible to this device.')
    }
    return workspace
  }

  private visibleWorkspaces(principal: Principal, items: DshWorkspaceSummary[]): ChatWorkspaceView[] {
    const roots = this.authorizedRoots(principal)
    const visible: ChatWorkspaceView[] = []
    for (const workspace of items) {
      const match = matchRoot(roots, workspace.path)
      if (match === undefined) continue
      visible.push({
        id: workspace.workspaceId,
        title: workspace.title,
        rootId: match.root.id,
        path: match.relative,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })
    }
    return visible
  }

  private requireAuthorizedRoot(principal: Principal, rootId: string): StoredRoot {
    if (principal.rootIds !== 'all' && !principal.rootIds.has(rootId)) {
      throw new ApiError(403, 'ROOT_FORBIDDEN', 'This device is not authorized for the requested root.')
    }
    const root = this.database.getRoot(rootId)
    if (root === undefined) throw new ApiError(404, 'ROOT_NOT_FOUND', 'The authorized root does not exist.')
    return root
  }

  private authorizedRoots(principal: Principal): StoredRoot[] {
    const all = this.database.listRoots()
    return principal.rootIds === 'all' ? all : all.filter(root => principal.rootIds.has(root.id))
  }

  private async sessionRootId(sessionId: string): Promise<string | undefined> {
    const cached = this.sessionRootIds.get(sessionId)
    if (cached !== undefined) {
      if (this.database.getRoot(cached) !== undefined) return cached
      this.sessionRootIds.delete(sessionId)
    }
    const pending = this.sessionRootLookups.get(sessionId)
    if (pending !== undefined) return pending
    const lookup = (async (): Promise<string | undefined> => {
      const value = unwrapDsh(await this.api.sessions.list({ rpcId: randomUUID(), payload: {} }))
      const session = value.items.find(item => item.sessionId === sessionId)
      if (session?.cwd === undefined) return undefined
      const match = matchRoot(this.database.listRoots(), session.cwd)
      if (match === undefined) return undefined
      this.sessionRootIds.set(sessionId, match.root.id)
      return match.root.id
    })()
    this.sessionRootLookups.set(sessionId, lookup)
    try {
      return await lookup
    } finally {
      if (this.sessionRootLookups.get(sessionId) === lookup) this.sessionRootLookups.delete(sessionId)
    }
  }
}

export function unwrapDsh<T>(response: RpcResponse<T>): T {
  if (response.result.ok) return response.result.value
  const error = response.result.error
  const status = error.code.includes('not-found')
    ? 404
    : error.code.includes('busy')
      || error.code.includes('locked')
      || error.code.includes('conflict')
      || error.code.includes('writer-held')
      || error.code.includes('unavailable')
      ? 409
      : error.code.includes('unsupported')
        ? 501
        : 400
  throw new ApiError(status, `DSH_${error.code.replaceAll('-', '_').toUpperCase()}`, error.message)
}

export function normalizeDshEvent(
  frame: { rpcId: string; payload: Record<string, unknown> },
  fallback: 'mux' | 'host',
  time = Date.now(),
): WorkspaceEvent {
  const payload = frame.payload
  const payloadType = typeof payload.type === 'string' ? payload.type : fallback
  if (
    payloadType === 'approval/requested'
    && typeof payload.sessionId === 'string'
    && typeof payload.approvalId === 'string'
    && typeof payload.toolName === 'string'
  ) {
    return {
      id: `${payload.approvalId}:requested`,
      type: 'chat.approval.requested',
      time,
      data: {
        sessionId: payload.sessionId,
        approvalId: payload.approvalId,
        toolName: payload.toolName,
        risk: approvalRisk(typeof payload.reason === 'string' ? payload.reason : undefined),
      },
    }
  }
  if (
    payloadType === 'approval/resolved'
    && typeof payload.sessionId === 'string'
    && typeof payload.approvalId === 'string'
  ) {
    return {
      id: `${payload.approvalId}:resolved`,
      type: 'chat.approval.resolved',
      time,
      data: {
        sessionId: payload.sessionId,
        approvalId: payload.approvalId,
        ...(typeof payload.outcome === 'string' ? { outcome: payload.outcome } : {}),
      },
    }
  }
  if (
    payloadType === 'question/requested'
    && typeof payload.sessionId === 'string'
    && typeof payload.questionId === 'string'
  ) {
    return {
      id: `${payload.questionId}:requested`,
      type: 'chat.question.requested',
      time,
      data: {
        sessionId: payload.sessionId,
        questionId: payload.questionId,
        timed: payload.timed === true,
        count: Array.isArray(payload.questions) ? payload.questions.length : 0,
      },
    }
  }
  if (
    payloadType === 'question/resolved'
    && typeof payload.sessionId === 'string'
    && typeof payload.questionId === 'string'
  ) {
    return {
      id: `${payload.questionId}:resolved`,
      type: 'chat.question.resolved',
      time,
      data: {
        sessionId: payload.sessionId,
        questionId: payload.questionId,
        ...(typeof payload.outcome === 'string' ? { outcome: payload.outcome } : {}),
      },
    }
  }
  if (payloadType === 'session/event' && typeof payload.sessionId === 'string' && isRecord(payload.event)) {
    const event = payload.event
    const eventType = typeof event.type === 'string' ? event.type : 'unknown'
    const seq = typeof event.seq === 'number' ? event.seq : undefined
    const base = {
      sessionId: payload.sessionId,
      eventType,
      ...(seq === undefined ? {} : { seq }),
    }
    const assistantData = event.data
    if (eventType === 'assistant/chunk' && isRecord(assistantData)) {
      const rawChunk = assistantData.chunk
      if (isRecord(rawChunk)) {
        const kind = rawChunk.type === 'text-delta' ? 'text' : rawChunk.type === 'reasoning-delta' ? 'reasoning' : undefined
        const index = typeof rawChunk.index === 'number'
          ? rawChunk.index
          : typeof assistantData.frameIndex === 'number'
            ? assistantData.frameIndex
            : undefined
        if (kind !== undefined && typeof rawChunk.text === 'string' && index !== undefined) {
          return {
            id: frame.rpcId,
            type: 'chat.message.delta',
            time,
            data: {
              ...base,
              kind,
              text: rawChunk.text,
              index,
              ...(typeof assistantData.turn === 'number' ? { turn: assistantData.turn } : {}),
              ...(typeof assistantData.step === 'number' ? { step: assistantData.step } : {}),
            },
          }
        }
      }
    }
    if (eventType === 'user/message' || eventType === 'assistant/message') {
      const eventData = isRecord(event.data) ? event.data : {}
      return {
        id: frame.rpcId,
        type: 'chat.message.committed',
        time,
        data: {
          ...base,
          role: eventType === 'user/message' ? 'user' : 'assistant',
          ...(typeof eventData.turn === 'number' ? { turn: eventData.turn } : {}),
          ...(typeof eventData.step === 'number' ? { step: eventData.step } : {}),
        },
      }
    }
    if (eventType === 'turn/start' || eventType === 'turn/end') {
      return {
        id: frame.rpcId,
        type: eventType === 'turn/start' ? 'chat.turn.start' : 'chat.turn.end',
        time,
        data: base,
      }
    }
    return { id: frame.rpcId, type: 'chat.session.event', time, data: base }
  }
  if (payloadType === 'host/session-status' && typeof payload.sessionId === 'string') {
    return {
      id: frame.rpcId,
      type: 'chat.session.status',
      time,
      data: { sessionId: payload.sessionId, running: payload.running === true },
    }
  }
  if (payloadType === 'host/remote-event' && payload.event === 'agent-preset/selected' && Array.isArray(payload.args)) {
    const [sessionId, agentPreset] = payload.args
    if (typeof sessionId === 'string' && typeof agentPreset === 'string') {
      return {
        id: frame.rpcId,
        type: 'chat.agent-preset.selected',
        time,
        data: { sessionId, agentPreset },
      }
    }
  }
  return { id: frame.rpcId, type: `chat.${payloadType}`, time, data: payload }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchRoot(roots: StoredRoot[], cwd: string): { root: StoredRoot; relative: string } | undefined {
  for (const root of roots) {
    const relative = wireRelative(root.realPath, cwd)
    if (relative !== undefined) return { root, relative }
  }
  return undefined
}

function sessionTitle(session: DshSessionSummary): string | undefined {
  const title = session.projections?.values.title
  if (typeof title === 'string' && title.trim() !== '') return title
  if (isRecord(title) && typeof title.title === 'string' && title.title.trim() !== '') return title.title
  return undefined
}

function parseQuestionItems(raw: unknown[]): QuestionItemView[] {
  const items: QuestionItemView[] = []
  for (const candidate of raw) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.question !== 'string') continue
    const options = Array.isArray(candidate.options)
      ? candidate.options
          .filter(isRecord)
          .filter((option): option is Record<string, unknown> & { label: string } => typeof option.label === 'string')
          .map(option => ({
            label: option.label,
            ...(typeof option.description === 'string' ? { description: option.description } : {}),
          }))
      : undefined
    items.push({
      id: candidate.id,
      question: candidate.question,
      ...(typeof candidate.detail === 'string' ? { detail: candidate.detail } : {}),
      ...(typeof candidate.header === 'string' ? { header: candidate.header } : {}),
      ...(options === undefined ? {} : { options }),
      ...(candidate.multiSelect === true ? { multiSelect: true } : {}),
      ...(isRecord(candidate.intent) ? { intent: candidate.intent } : {}),
    })
  }
  return items
}

function approvalKey(sessionId: string, approvalId: string): string {
  return `${sessionId}\u0000${approvalId}`
}

function approvalRisk(reason?: string): 'standard' | 'full-access' {
  return reason?.toLowerCase().includes('danger-full-access') === true ? 'full-access' : 'standard'
}

function publicApproval(record: PendingApprovalRecord, detail?: string): PendingApprovalView {
  const reason = record.reason === undefined ? undefined : redactApprovalText(record.reason, 500)
  const safeDetail = detail === undefined ? undefined : redactApprovalText(detail, 1_200)
  return {
    id: record.approvalId,
    sessionId: record.sessionId,
    toolName: redactApprovalText(record.toolName, 120),
    ...(reason === undefined || reason === '' ? {} : { reason }),
    ...(safeDetail === undefined || safeDetail === '' ? {} : { detail: safeDetail }),
    risk: approvalRisk(record.reason),
    requestedAt: record.requestedAt,
  }
}

function findToolCallDetail(events: unknown[], callId?: string): string | undefined {
  if (callId === undefined) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index]
    if (!isRecord(candidate)) continue
    const event = isRecord(candidate.event) ? candidate.event : candidate
    if (event.type !== 'tool/call' || !isRecord(event.data)) continue
    const data = event.data
    const eventCallId = typeof data.callId === 'string' ? data.callId : typeof data.id === 'string' ? data.id : undefined
    if (eventCallId !== callId) continue
    const args = decodeToolArguments(data.arguments)
    if (isRecord(args) && typeof args.command === 'string') return args.command
    if (typeof args === 'string') return args
    if (args !== undefined) return JSON.stringify(args, null, 2)
  }
  return undefined
}

function decodeToolArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export function redactApprovalText(value: string, maxLength = 1_200): string {
  let redacted = value
  redacted = redacted.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
  redacted = redacted.replace(/\b(?:sk|as_sk|ghp|github_pat)[-_][A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
  redacted = redacted.replace(
    /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential)["']?\s*[=:]\s*)(["'])(.*?)\2/gi,
    '$1$2[REDACTED]$2',
  )
  redacted = redacted.replace(
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential)\s*[=:]\s*)[^\s,;"']+/gi,
    '$1[REDACTED]',
  )
  redacted = redacted.replace(
    /([?&](?:api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s]+/gi,
    '$1[REDACTED]',
  )
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, Math.max(0, maxLength - 1))}…`
}
