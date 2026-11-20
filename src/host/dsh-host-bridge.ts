import { randomUUID } from 'node:crypto'
import type { RpcResponse, DshApiProxy } from './chat-adapter.ts'
import type { SettingsApiProxy } from './settings-adapter.ts'

export type HostBridgeContext = {
  sessionController: SessionControllerFace
  workspaceController: WorkspaceControllerFace
  settingsController: SettingsControllerFace
  credentialsController: CredentialsControllerFace
  llm: LlmFace
  agentPresets: AgentPresetsFace
  on(event: string, handler: (...args: unknown[]) => unknown, options?: { global?: boolean; prepend?: boolean }): () => void
  effect(register: () => (() => void | Promise<void>) | void, label?: string): void
  get?<T = unknown>(name: string): T | undefined
}

interface SessionControllerFace {
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: SessionSummaryFace[] }>
  search?(request: { query: string }, signal: AbortSignal): Promise<{ items: { sessionId: string; snippet: string }[]; hasMore: boolean }>
  create(request: Record<string, unknown>): Promise<{ sessionId: string; agentPreset?: string }>
  events?(request: Record<string, unknown>, signal: AbortSignal): Promise<{ cursor?: number; records: { event: unknown }[]; hasMore: boolean }>
  page(request: Record<string, unknown>, signal: AbortSignal): Promise<{ cursor?: number; records: { event: unknown }[]; hasMore: boolean }>
  prompt(request: Record<string, unknown>, signal: AbortSignal): Promise<{ accepted: true }>
  cancel(request: { sessionId: string }): { accepted: true }
  rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }>
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId: string }>
  selectModel(request: Record<string, unknown>): Promise<{ selected: Record<string, string | undefined> }>
  resolveAgent(sessionId: string): Promise<{ agent?: AgentFace; error?: RemoteErrorFace }>
  modelCatalog(): Promise<ModelCatalogFace>
  projections(request: { sessionId: string }, signal: AbortSignal): Promise<ProjectionsFace | null>
  state?(request: { sessionId: string }, signal: AbortSignal): Promise<SessionStateFace>
  updateQueue?(request: { sessionId: string; itemId: string; action: unknown }): Promise<{ accepted: true }>
}

interface WorkspaceControllerFace {
  create(request: { path: string }): Promise<{ workspace: WorkspaceSummaryFace; created: boolean }>
  rename(request: { workspaceId: string; title: string }): Promise<{ workspace: WorkspaceSummaryFace }>
  delete(request: { workspaceId: string }): Promise<{ deleted: true }>
  archiveSession(request: { sessionId: string }): Promise<{ archivedSessionIds: string[] }>
  unarchiveSession?(request: { sessionId: string }): Promise<{ archivedSessionIds: string[] }>
  pinSession?(request: { sessionId: string }): Promise<{ pinnedSessionIds: string[] }>
  unpinSession?(request: { sessionId: string }): Promise<{ pinnedSessionIds: string[] }>
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFace>
}

interface SettingsControllerFace {
  describe(): { writable: boolean; hasDocument: boolean; namespaces: NamespaceFace[] }
  mutate(ns: string, ops: unknown[], expectedRevision?: number): Promise<NamespaceFace>
}

interface CredentialsControllerFace {
  describe(refs: string[]): Promise<Record<string, CredentialFace>>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

interface LlmProviderInfoFace {
  id: string
  name: string
}

interface LlmFace {
  listProviders?(): LlmProviderInfoFace[]
  listConfigurableProviders(): ConfigurableProviderFace[]
  discoverModels(settingsNs: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<ModelFace[]>
}

interface AgentPresetsFace {
  remoteExportList(): Promise<{ presets: AgentPresetRowFace[] }>
  select(agent: unknown, agentPreset: string): Promise<string>
}

interface PermissionPresetsFace {
  catalog(): {
    options: { value: string; name: string; description?: string }[]
    defaultOptions?: { value: string; name: string; description?: string }[]
    defaultPreset: string
  }
}

interface UserQuestionsFace {
  answer(agent: unknown, callId: string, answer: { answers: UserQuestionAnswerItemFace[] }): boolean
}

interface AgentFace {
  id: string
  session: SessionFace
  model?: { current?(): { provider: string; model: string; reasoningEffort?: string } | undefined }
}

interface SessionSummaryFace {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  parentSessionId?: string
  origin?: 'subagent'
  projections?: { asOfSeq?: number; values?: Record<string, unknown> }
}

interface WorkspaceSummaryFace {
  workspaceId: string
  path: string
  title: string
  sessionIds?: string[]
  createdAt: string
  updatedAt: string
}

interface WorkspaceFollowFace {
  type: string
  value?: {
    items: WorkspaceSummaryFace[]
    archivedSessionIds: string[]
    pinnedSessionIds?: string[]
  }
  workspace?: WorkspaceSummaryFace
}

interface NamespaceFace {
  ns: string
  schema?: unknown
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
}

interface CredentialFace {
  configured: boolean
  source?: string
  writable: boolean
  masked?: string
}

interface ConfigurableProviderFace {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
  active?: boolean
  declared?: boolean
  defaultBaseURL?: string
  error?: string
}

interface ModelFace {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

interface AgentPresetRowFace {
  id: string
  isDefault: boolean
  name?: string
  description?: string
  broken?: string
}

interface ModelCatalogFace {
  default: { provider: string; model: string; reasoningEffort?: string }
  routableProviders: string[]
  groups: { id: string; name: string; models: unknown[] }[]
  failures: { id: string; message: string }[]
}

interface ProjectionsFace {
  kind?: string
  asOfSeq?: number
  values?: Record<string, unknown>
}

interface SessionStateFace {
  cursor: number
  active: boolean
  running: boolean
  queue: readonly { id: string; placement: string; rpcId?: string; content: readonly unknown[] }[] | null
  pendingInput: readonly string[]
}

interface SessionFace {
  id: string
  seq: number
  eventAt(seq: number): { type: string; data?: Record<string, unknown> } | undefined
}

interface RemoteErrorFace {
  code?: string
  message?: string
}

export interface UserQuestionOptionFace {
  label: string
  description?: string
}

export interface UserQuestionItemFace {
  id: string
  question: string
  detail?: string
  header?: string
  options?: UserQuestionOptionFace[]
  multiSelect?: boolean
  intent?: Record<string, unknown>
}

export interface UserQuestionAnswerItemFace {
  id: string
  selected: string[]
  custom?: string
}

interface ApprovalRequestFace {
  agent: { session: SessionFace }
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

interface UserQuestionRequestFace {
  agent?: { id?: string; session: SessionFace }
  questions: UserQuestionItemFace[]
  signal?: AbortSignal
  wait?: { callId: string; timed?: boolean }
}

type ApprovalResolver = (outcome: 'allowed-once' | 'rejected') => void
type QuestionResolver = (answer: { answers: UserQuestionAnswerItemFace[] }) => void

type RpcCall<T extends Record<string, unknown> = Record<string, unknown>> = {
  rpcId: string
  payload: T
}

const DEFAULT_HOST_TIMEOUT_MS = 120_000
const MAX_CREDENTIAL_DESCRIBE_BATCH = 64
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_SUBSCRIBER_QUEUE = 4096

function requestSignal(timeoutMs = DEFAULT_HOST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

/** Build an in-process ApiProxy-shaped facade over DSH 0.2.2+ host controllers. */
export function createHostDshApi(ctx: HostBridgeContext): SettingsApiProxy & DshApiProxy {
  const eventHub = createEventHub(ctx)
  const approvalResolvers = new Map<string, ApprovalResolver>()
  const questionResolvers = new Map<string, QuestionResolver>()

  ctx.effect(() => {
    const disposeApproval = ctx.on('approval/request', (...args: unknown[]) => {
      const req = args[0] as ApprovalRequestFace
      const next = args[1] as () => Promise<unknown>
      const sessionId = req.agent?.session?.id
      if (typeof sessionId !== 'string') return next()
      const approvalId = pendingApprovalId(req.agent.session) ?? randomUUID()
      const key = `${sessionId}\u0000${approvalId}`

      eventHub.pushMux({
        type: 'approval/requested',
        sessionId,
        approvalId,
        toolName: req.toolName,
        ...(req.callId === undefined ? {} : { callId: req.callId }),
        ...(req.reason === undefined ? {} : { reason: req.reason }),
      })

      return new Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>((resolve) => {
        let settled = false
        const settle = (outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'): void => {
          if (settled) return
          settled = true
          approvalResolvers.delete(key)
          req.signal?.removeEventListener('abort', onAbort)
          eventHub.pushMux({
            type: 'approval/resolved',
            sessionId,
            approvalId,
            outcome,
          })
          resolve(outcome)
        }
        const onAbort = (): void => { settle('cancelled') }

        approvalResolvers.set(key, (outcome) => { settle(outcome) })
        if (req.signal?.aborted) {
          onAbort()
          return
        }
        req.signal?.addEventListener('abort', onAbort, { once: true })

        // Forward to downstream answerers (e.g. DSH WebUI via api-remotes) in parallel so
        // installing dsh-workspace never blocks WebUI approvals. First concrete answer wins.
        void Promise.resolve().then(() => next()).then(
          (downstream) => {
            if (downstream === 'allowed-once' || downstream === 'rejected' || downstream === 'cancelled') {
              settle(downstream)
            }
          },
          () => {
            // Downstream failure leaves mobile approval eligible until answered or aborted.
          },
        )
      })
    }, { prepend: true })

    const disposeQuestions = ctx.on('user-questions/request', (...args: unknown[]) => {
      const req = args[0] as UserQuestionRequestFace
      const next = args[1] as () => Promise<unknown>
      const sessionId = req.agent?.session?.id
      if (typeof sessionId !== 'string' || !Array.isArray(req.questions) || req.questions.length === 0) {
        return next()
      }
      const questionId = req.wait?.callId ?? randomUUID()
      const key = `${sessionId}\u0000${questionId}`

      eventHub.pushMux({
        type: 'question/requested',
        sessionId,
        questionId,
        ...(req.wait?.callId === undefined ? {} : { callId: req.wait.callId }),
        timed: req.wait?.timed === true,
        questions: req.questions,
      })

      return new Promise<unknown>((resolve, reject) => {
        let settled = false
        let downstreamFailed = false
        let downstreamError: unknown

        const finish = (outcome: 'answered' | 'cancelled' | 'rejected', result?: unknown, error?: unknown): void => {
          if (settled) return
          settled = true
          questionResolvers.delete(key)
          req.signal?.removeEventListener('abort', onAbort)
          eventHub.pushMux({
            type: 'question/resolved',
            sessionId,
            questionId,
            outcome,
          })
          if (error !== undefined) reject(error)
          else resolve(result)
        }
        const onAbort = (): void => {
          finish('cancelled', undefined, req.signal?.reason ?? new Error('ask_user_question was aborted'))
        }

        questionResolvers.set(key, (answer) => { finish('answered', answer) })
        if (req.signal?.aborted) {
          onAbort()
          return
        }
        req.signal?.addEventListener('abort', onAbort, { once: true })

        void Promise.resolve().then(() => next()).then(
          (answer) => { finish('answered', answer) },
          (error: unknown) => {
            // Keep waiting for mobile if no other answerer accepted (NO_PROVIDER).
            const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
            if (code === 'NO_PROVIDER') {
              downstreamFailed = true
              downstreamError = error
              return
            }
            if (!settled && downstreamFailed) {
              finish('rejected', undefined, downstreamError)
              return
            }
            finish('rejected', undefined, error)
          },
        )
      })
    }, { prepend: true })

    return () => {
      disposeQuestions()
      disposeApproval()
      approvalResolvers.clear()
      questionResolvers.clear()
    }
  }, 'dsh-workspace interaction bridges')

  const rpc = async <T>(run: () => Promise<T>): Promise<RpcResponse<T>> => {
    try {
      return ok(await run())
    } catch (error) {
      return err(asRemoteError(error))
    }
  }

  const readPermissionCatalog = (): ReturnType<PermissionPresetsFace['catalog']> | undefined => {
    try {
      return ctx.get?.<PermissionPresetsFace>('permissionPresets')?.catalog()
    } catch {
      return undefined
    }
  }

  const api = {
    respond: async (message: {
      type: 'client-response'
      rpcId: string
      result: { ok: true; value: unknown } | { ok: false; error: unknown }
    }) => {
      if (message.type !== 'client-response' || message.result.ok !== true) {
        return { accepted: false, reason: 'bad-response' }
      }
      const value = message.result.value as {
        sessionId?: string
        approvalId?: string
        outcome?: 'allowed-once' | 'rejected'
        questionId?: string
        answers?: UserQuestionAnswerItemFace[]
      }
      if (typeof value.sessionId === 'string' && typeof value.questionId === 'string' && Array.isArray(value.answers)) {
        const key = `${value.sessionId}\u0000${value.questionId}`
        const resolve = questionResolvers.get(key)
        if (resolve !== undefined) {
          resolve({ answers: value.answers })
          return { accepted: true }
        }
        // Fallback for timed questions that transitioned to `continued` state in DSH 0.2.2+.
        const userQuestions = ctx.get?.<UserQuestionsFace>('userQuestions')
        if (userQuestions !== undefined) {
          const resolved = await ctx.sessionController.resolveAgent(value.sessionId)
          if (resolved.agent !== undefined) {
            const accepted = userQuestions.answer(resolved.agent, value.questionId, { answers: value.answers })
            if (accepted) {
              eventHub.pushMux({
                type: 'question/resolved',
                sessionId: value.sessionId,
                questionId: value.questionId,
                outcome: 'answered',
              })
              return { accepted: true }
            }
          }
        }
        return { accepted: false, reason: 'not-pending' }
      }
      if (typeof value.sessionId !== 'string' || typeof value.approvalId !== 'string' || value.outcome === undefined) {
        return { accepted: false, reason: 'bad-response' }
      }
      const key = `${value.sessionId}\u0000${value.approvalId}`
      const resolve = approvalResolvers.get(key)
      if (resolve === undefined) return { accepted: false, reason: 'not-pending' }
      resolve(value.outcome)
      return { accepted: true }
    },
    sessions: {
      list: async () => rpc(async () => {
        const value = await ctx.sessionController.list({}, requestSignal())
        return {
          items: value.items.map(item => ({
            sessionId: item.sessionId,
            updatedAt: item.updatedAt,
            running: item.running,
            blank: item.blank,
            ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
            ...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
            ...(item.origin === undefined ? {} : { origin: item.origin }),
            ...(readAgentPreset(item) === undefined ? {} : { agentPreset: readAgentPreset(item) }),
            ...(item.projections === undefined ? {} : {
              projections: {
                asOfSeq: item.projections.asOfSeq ?? 0,
                values: item.projections.values ?? {},
              },
            }),
          })),
        }
      }),
      search: async (request: RpcCall<{ query: string }>) => rpc(async () => {
        if (typeof ctx.sessionController.search !== 'function') {
          return { items: [], hasMore: false, supported: false }
        }
        const value = await ctx.sessionController.search({ query: String(request.payload.query) }, requestSignal())
        return { items: value.items, hasMore: value.hasMore, supported: true }
      }),
      activate: async (request: RpcCall<{ sessionId: string }>) => rpc(async () => {
        const resolved = await ctx.sessionController.resolveAgent(String(request.payload.sessionId))
        if (resolved.error !== undefined) throw remoteErrorLike(resolved.error)
        return { active: resolved.agent !== undefined }
      }),
      create: async (request: RpcCall) => rpc(() => ctx.sessionController.create(request.payload)),
      history: async (request: RpcCall) => rpc(async () => {
        const payload = request.payload
        const sessionId = String(payload.sessionId)
        const pageRequest: Record<string, unknown> = {
          address: { kind: 'session', sessionId },
          ...(payload.beforeSeq === undefined ? {} : { beforeSeq: payload.beforeSeq }),
          ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
        }
        // DSH 0.2.2+ omits throughSeq to read through observation.cursor; passing -1 returns empty pages.
        const page = typeof ctx.sessionController.events === 'function'
          ? await ctx.sessionController.events(pageRequest, requestSignal())
          : await ctx.sessionController.page(pageRequest, requestSignal())
        let projections: { asOfSeq: number; values: Record<string, unknown> } | undefined
        try {
          const read = await ctx.sessionController.projections({ sessionId }, requestSignal())
          if (read !== null && read.values !== undefined) {
            projections = {
              asOfSeq: read.asOfSeq ?? -1,
              values: enrichProjections(read.values, readPermissionCatalog()),
            }
          }
        } catch {
          // History remains useful without projections.
        }
        return {
          events: page.records.map(record => record.event),
          hasMore: page.hasMore,
          ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
          ...(projections === undefined ? {} : { projections }),
        }
      }),
      state: async (request: RpcCall<{ sessionId: string }>) => rpc(async () => {
        const sessionId = String(request.payload.sessionId)
        if (typeof ctx.sessionController.state !== 'function') {
          throw remoteErrorLike({ code: 'session/state-unavailable', message: 'Session state inspection is unavailable.' })
        }
        return await ctx.sessionController.state({ sessionId }, requestSignal())
      }),
      updateQueue: async (request: RpcCall<{ sessionId: string; itemId: string; action: unknown }>) => rpc(async () => {
        if (typeof ctx.sessionController.updateQueue !== 'function') {
          throw remoteErrorLike({ code: 'session/queue-unavailable', message: 'Session queue mutation is unavailable.' })
        }
        return await ctx.sessionController.updateQueue({
          sessionId: String(request.payload.sessionId),
          itemId: String(request.payload.itemId),
          action: request.payload.action,
        })
      }),
      prompt: async (request: RpcCall) => rpc(async () => {
        const payload = request.payload
        const promptRequest = {
          requestId: randomUUID(),
          sessionId: payload.sessionId,
          mode: payload.mode,
          content: payload.content,
          ...(payload.clientTimeZone === undefined ? {} : { clientTimeZone: payload.clientTimeZone }),
        }
        return await ctx.sessionController.prompt(promptRequest, requestSignal())
      }),
      cancel: async (request: RpcCall) => rpc(async () => ctx.sessionController.cancel({ sessionId: String(request.payload.sessionId) })),
      rename: async (request: RpcCall) => rpc(() => ctx.sessionController.rename({
        sessionId: String(request.payload.sessionId),
        title: String(request.payload.title),
      })),
      fork: async (request: RpcCall) => rpc(() => ctx.sessionController.fork({
        sessionId: String(request.payload.sessionId),
        ...(request.payload.atSeq === undefined ? {} : { atSeq: request.payload.atSeq as number }),
      })),
      models: async (request: RpcCall) => rpc(async () => {
        const sessionId = String(request.payload.sessionId)
        const resolved = await ctx.sessionController.resolveAgent(sessionId)
        if (resolved.error !== undefined) throw remoteErrorLike(resolved.error)
        const catalog = await ctx.sessionController.modelCatalog()
        let current = catalog.default
        const liveSelection = resolved.agent?.model?.current?.()
        if (liveSelection !== undefined && typeof liveSelection.provider === 'string' && typeof liveSelection.model === 'string') {
          current = {
            provider: liveSelection.provider,
            model: liveSelection.model,
            ...(typeof liveSelection.reasoningEffort === 'string' ? { reasoningEffort: liveSelection.reasoningEffort } : {}),
          }
        } else {
          try {
            const projections = await ctx.sessionController.projections({ sessionId }, requestSignal())
            const projected = readModelSelection(projections?.values?.modelSelection)
            if (projected !== undefined) current = projected
          } catch {
            // Fall back to deployment default selection.
          }
        }
        const routable = catalog.routableProviders.includes(current.provider)
        return {
          current,
          routable,
          groups: catalog.groups.map(group => ({
            id: group.id,
            name: group.name,
            models: group.models,
          })),
          failures: catalog.failures.map(failure => ({ provider: failure.id, message: failure.message })),
        }
      }),
      selectModel: async (request: RpcCall) => rpc(() => ctx.sessionController.selectModel(request.payload)),
    },
    workspace: {
      list: async () => rpc(async () => {
        const baseline = await readWorkspaceBaseline(ctx.workspaceController)
        return {
          items: baseline.items.map(mapWorkspace),
          archivedSessionIds: baseline.archivedSessionIds,
          pinnedSessionIds: baseline.pinnedSessionIds,
        }
      }),
      create: async (request: RpcCall) => rpc(async () => {
        const value = await ctx.workspaceController.create({ path: String(request.payload.path) })
        return { workspace: mapWorkspace(value.workspace), created: value.created }
      }),
      rename: async (request: RpcCall) => rpc(async () => {
        const value = await ctx.workspaceController.rename({
          workspaceId: String(request.payload.workspaceId),
          title: String(request.payload.title),
        })
        return { workspace: mapWorkspace(value.workspace) }
      }),
      delete: async (request: RpcCall) => rpc(() => ctx.workspaceController.delete({ workspaceId: String(request.payload.workspaceId) })),
      archiveSession: async (request: RpcCall) => rpc(() => ctx.workspaceController.archiveSession({ sessionId: String(request.payload.sessionId) })),
      unarchiveSession: async (request: RpcCall) => rpc(async () => {
        if (typeof ctx.workspaceController.unarchiveSession !== 'function') {
          throw remoteErrorLike({ code: 'workspace/unsupported', message: 'Unarchiving sessions is not supported by this DSH version.' })
        }
        return await ctx.workspaceController.unarchiveSession({ sessionId: String(request.payload.sessionId) })
      }),
      pinSession: async (request: RpcCall) => rpc(async () => {
        if (typeof ctx.workspaceController.pinSession !== 'function') {
          throw remoteErrorLike({ code: 'workspace/unsupported', message: 'Pinning sessions is not supported by this DSH version.' })
        }
        return await ctx.workspaceController.pinSession({ sessionId: String(request.payload.sessionId) })
      }),
      unpinSession: async (request: RpcCall) => rpc(async () => {
        if (typeof ctx.workspaceController.unpinSession !== 'function') {
          throw remoteErrorLike({ code: 'workspace/unsupported', message: 'Unpinning sessions is not supported by this DSH version.' })
        }
        return await ctx.workspaceController.unpinSession({ sessionId: String(request.payload.sessionId) })
      }),
    },
    permissions: {
      catalog: async () => rpc(async () => {
        const catalog = readPermissionCatalog()
        return catalog ?? {
          options: [
            { value: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace; wider operations require approval.' },
            { value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' },
          ],
          defaultPreset: 'workspace-write',
        }
      }),
    },
    agentPresets: {
      list: async () => rpc(async () => {
        const roster = await ctx.agentPresets.remoteExportList()
        return {
          presets: roster.presets.map(row => ({
            id: row.id,
            trust: 'system' as const,
            isDefault: row.isDefault,
            ...(row.name === undefined ? {} : { name: row.name }),
            ...(row.description === undefined ? {} : { description: row.description }),
            ...(row.broken === undefined ? {} : { broken: row.broken }),
          })),
          authorable: false,
          hasDocument: true,
        }
      }),
      select: async (request: RpcCall) => rpc(async () => {
        const sessionId = String(request.payload.sessionId)
        const agentPreset = String(request.payload.agentPreset)
        const resolved = await ctx.sessionController.resolveAgent(sessionId)
        if (resolved.error !== undefined) throw remoteErrorLike(resolved.error)
        if (resolved.agent === undefined) {
          throw remoteErrorLike({ code: 'session/not-found', message: `Session "${sessionId}" is unavailable.` })
        }
        const selected = await ctx.agentPresets.select(resolved.agent, agentPreset)
        return { agentPreset: selected }
      }),
    },
    settings: {
      describe: async () => rpc(async () => ctx.settingsController.describe()),
      mutate: async (request: RpcCall) => rpc(() => ctx.settingsController.mutate(
        String(request.payload.ns),
        request.payload.ops as unknown[],
        request.payload.expectedRevision as number | undefined,
      )),
    },
    credentials: {
      describe: async (request: RpcCall) => rpc(async () => {
        const rawRefs = Array.isArray(request.payload.refs) ? request.payload.refs : []
        const validRefs = [...new Set(rawRefs.filter((ref): ref is string => typeof ref === 'string' && CREDENTIAL_REF_PATTERN.test(ref)))]
        const credentials: Record<string, CredentialFace> = {}
        for (let index = 0; index < validRefs.length; index += MAX_CREDENTIAL_DESCRIBE_BATCH) {
          const batch = validRefs.slice(index, index + MAX_CREDENTIAL_DESCRIBE_BATCH)
          const described = await ctx.credentialsController.describe(batch)
          Object.assign(credentials, described)
        }
        return { credentials }
      }),
      set: async (request: RpcCall) => rpc(async () => {
        await ctx.credentialsController.set(String(request.payload.ref), String(request.payload.value))
        return {}
      }),
      unset: async (request: RpcCall) => rpc(async () => {
        await ctx.credentialsController.unset(String(request.payload.ref))
        return {}
      }),
    },
    llm: {
      providers: async () => rpc(async () => {
        const configurable = ctx.llm.listConfigurableProviders()
        const registered = typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []
        const activeIds = new Set(registered.map(provider => provider.id))
        const declaredIds = new Set(configurable.map(entry => entry.provider))
        const providers = configurable.map(entry => ({
          provider: entry.provider,
          displayName: entry.displayName,
          settingsNs: entry.settingsNs,
          settingsPath: [...entry.settingsPath],
          active: typeof entry.active === 'boolean' ? entry.active : activeIds.has(entry.provider),
          ...(entry.declared === undefined ? {} : { declared: entry.declared }),
          ...(entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: entry.defaultBaseURL }),
          ...(entry.error === undefined ? {} : { error: entry.error }),
        }))
        for (const provider of registered) {
          if (declaredIds.has(provider.id)) continue
          providers.push({
            provider: provider.id,
            displayName: provider.name,
            settingsNs: '',
            settingsPath: [],
            active: true,
          })
        }
        providers.sort((left, right) => providerRank(left.provider) - providerRank(right.provider))
        return { providers }
      }),
      models: async () => rpc(async () => {
        const catalog = await ctx.sessionController.modelCatalog()
        return {
          groups: catalog.groups.map(group => ({
            id: group.id,
            name: group.name,
            models: group.models,
          })),
          failures: catalog.failures.map(failure => ({ provider: failure.id, message: failure.message })),
        }
      }),
      discoverModels: async (request: RpcCall) => rpc(async () => ({
        models: await ctx.llm.discoverModels(String(request.payload.settingsNs), {
          ...(request.payload.provider === undefined ? {} : { provider: request.payload.provider }),
          ...(request.payload.baseURL === undefined ? {} : { baseURL: request.payload.baseURL }),
          ...(request.payload.api === undefined ? {} : { api: request.payload.api }),
          ...(request.payload.apiKey === undefined ? {} : { apiKey: request.payload.apiKey }),
        }, requestSignal()),
      })),
    },
    events: {
      mux: (_request: RpcCall, signal: AbortSignal) => eventHub.stream('mux', signal),
      host: (_request: RpcCall, signal: AbortSignal) => eventHub.stream('host', signal),
    },
  }

  return api as unknown as SettingsApiProxy & DshApiProxy
}

export type HostDshServices = Pick<
  HostBridgeContext,
  'sessionController' | 'workspaceController' | 'settingsController' | 'credentialsController' | 'llm' | 'agentPresets'
>

function ok<T>(value: T): RpcResponse<T> {
  return { result: { ok: true, value } }
}

function err(error: RemoteErrorFace): RpcResponse<never> {
  const code = typeof error.code === 'string'
    ? error.code.replace(/^[^/]+\//, '').replaceAll('/', '-')
    : 'internal'
  return {
    result: {
      ok: false,
      error: {
        code,
        message: typeof error.message === 'string' ? error.message : 'DSH request failed.',
      },
    },
  }
}

function asRemoteError(error: unknown): RemoteErrorFace {
  if (isRecord(error)) {
    const face: RemoteErrorFace = {
      message: typeof error.message === 'string' ? error.message : String(error),
    }
    if (typeof error.code === 'string') face.code = error.code
    return face
  }
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) }
}

function remoteErrorLike(error: RemoteErrorFace): Error {
  const message = typeof error.message === 'string' ? error.message : 'DSH request failed.'
  return Object.assign(new Error(message), { code: error.code })
}

function readAgentPreset(item: SessionSummaryFace): string | undefined {
  const preset = item.projections?.values?.agentPreset
  return typeof preset === 'string' ? preset : undefined
}

function readModelSelection(selection: unknown): { provider: string; model: string; reasoningEffort?: string } | undefined {
  if (!isRecord(selection)) return undefined
  // DSH 0.2.2+ wire view: { lastUsed: ModelSelection | null, next: ModelSelection | null }.
  const candidate = isRecord(selection.next)
    ? selection.next
    : isRecord(selection.lastUsed)
      ? selection.lastUsed
      : selection
  if (typeof candidate.provider !== 'string' || typeof candidate.model !== 'string') return undefined
  return {
    provider: candidate.provider,
    model: candidate.model,
    ...(typeof candidate.reasoningEffort === 'string' ? { reasoningEffort: candidate.reasoningEffort } : {}),
  }
}

function enrichProjections(
  values: Record<string, unknown>,
  permissionCatalog: ReturnType<PermissionPresetsFace['catalog']> | undefined,
): Record<string, unknown> {
  if (permissionCatalog === undefined || !isRecord(values.permissions)) return values
  const existing = values.permissions
  if (Array.isArray(existing.options) && existing.options.length > 0) return values
  return {
    ...values,
    permissions: {
      ...existing,
      options: permissionCatalog.options,
      defaultPreset: permissionCatalog.defaultPreset,
    },
  }
}

function providerRank(provider: string): number {
  if (provider === 'deepseek-account') return 0
  if (provider === 'deepseek-official') return 1
  return 2
}

function mapWorkspace(workspace: WorkspaceSummaryFace) {
  return {
    workspaceId: workspace.workspaceId,
    path: workspace.path,
    title: workspace.title,
    sessionIds: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

async function readWorkspaceBaseline(controller: WorkspaceControllerFace): Promise<{
  items: WorkspaceSummaryFace[]
  archivedSessionIds: string[]
  pinnedSessionIds: string[]
}> {
  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort(new Error('workspace baseline timed out')) }, 5_000)
  try {
    const stream = controller.follow(abort.signal)
    for await (const frame of stream) {
      if (frame.type === 'baseline' && frame.value !== undefined) {
        return {
          items: frame.value.items,
          archivedSessionIds: frame.value.archivedSessionIds,
          pinnedSessionIds: Array.isArray(frame.value.pinnedSessionIds) ? frame.value.pinnedSessionIds : [],
        }
      }
    }
    return { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
  } finally {
    clearTimeout(timer)
    abort.abort()
  }
}

function pendingApprovalId(session: SessionFace): string | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq)
    if (event?.type !== 'approval/asked' || !isRecord(event.data) || typeof event.data.id !== 'string') continue
    const id = event.data.id
    let decided = false
    for (let later = seq + 1; later < session.seq; later += 1) {
      const followUp = session.eventAt(later)
      if (followUp?.type === 'approval/decided' && isRecord(followUp.data) && followUp.data.id === id) {
        decided = true
        break
      }
    }
    if (!decided) return id
  }
  return undefined
}

interface HubFrame {
  rpcId: string
  payload: Record<string, unknown>
}

interface HubSubscriber {
  queue: HubFrame[]
  wake?: (() => void) | undefined
}

function createEventHub(ctx: HostBridgeContext) {
  const subscribers: Record<'mux' | 'host', Set<HubSubscriber>> = {
    mux: new Set(),
    host: new Set(),
  }
  const activeAttempts = new Map<string, { turn: number; step: number }>()

  const push = (kind: 'mux' | 'host', payload: Record<string, unknown>): void => {
    const target = subscribers[kind]
    if (target.size === 0) return
    const frame: HubFrame = { rpcId: randomUUID(), payload }
    for (const subscriber of target) {
      if (subscriber.queue.length >= MAX_SUBSCRIBER_QUEUE) subscriber.queue.shift()
      subscriber.queue.push(frame)
      const wake = subscriber.wake
      subscriber.wake = undefined
      wake?.()
    }
  }

  ctx.effect(() => {
    const disposers = [
      ctx.on('session/event', (...args: unknown[]) => {
        const session = args[0] as { id?: string } | undefined
        const event = args[1] as Record<string, unknown> | undefined
        if (typeof session?.id !== 'string' || !isRecord(event)) return
        push('mux', { type: 'session/event', sessionId: session.id, event })
      }, { global: true }),

      ctx.on('agent/assistant-stream', (...args: unknown[]) => {
        const payload = args[0] as { agent?: { id?: string; session?: { id?: string } }; frame?: Record<string, unknown> } | undefined
        const sessionId = payload?.agent?.session?.id ?? payload?.agent?.id
        const frame = payload?.frame
        if (typeof sessionId !== 'string' || !isRecord(frame)) return
        const attemptId = typeof frame.attemptId === 'string' ? frame.attemptId : ''
        const attemptKey = `${sessionId}\u0000${attemptId}`
        if (frame.type === 'start') {
          if (typeof frame.turn === 'number' && typeof frame.step === 'number') {
            activeAttempts.set(attemptKey, { turn: frame.turn, step: frame.step })
          }
          return
        }
        if (frame.type === 'end') {
          activeAttempts.delete(attemptKey)
          return
        }
        if (frame.type === 'chunk' && isRecord(frame.chunk)) {
          const meta = activeAttempts.get(attemptKey)
          push('mux', {
            type: 'session/event',
            sessionId,
            event: {
              type: 'assistant/chunk',
              data: {
                ...(meta === undefined ? {} : { turn: meta.turn, step: meta.step }),
                ...(typeof frame.index === 'number' ? { frameIndex: frame.index } : {}),
                chunk: frame.chunk,
              },
            },
          })
        }
      }, { global: true }),

      ctx.on('agent/disposed', (...args: unknown[]) => {
        const payload = args[0] as { agent?: { id?: string; session?: { id?: string } } } | undefined
        const sessionId = payload?.agent?.session?.id ?? payload?.agent?.id
        if (typeof sessionId !== 'string') return
        const prefix = `${sessionId}\u0000`
        for (const key of activeAttempts.keys()) {
          if (key.startsWith(prefix)) activeAttempts.delete(key)
        }
      }, { global: true }),

      ctx.on('api-session/status', (...args: unknown[]) => {
        const sessionId = args[0] as string
        const running = args[1] as boolean
        if (typeof sessionId !== 'string') return
        push('host', { type: 'host/session-status', sessionId, running: running === true })
      }),

      ctx.on('agent-preset/selected', (...args: unknown[]) => {
        const sessionId = args[0] as string
        const agentPreset = args[1] as string
        if (typeof sessionId !== 'string' || typeof agentPreset !== 'string') return
        push('host', { type: 'host/remote-event', event: 'agent-preset/selected', args: [sessionId, agentPreset] })
      }),
    ]
    return () => {
      for (const dispose of disposers.reverse()) dispose()
      activeAttempts.clear()
      for (const kind of ['mux', 'host'] as const) {
        for (const subscriber of subscribers[kind]) {
          const wake = subscriber.wake
          subscriber.wake = undefined
          wake?.()
        }
        subscribers[kind].clear()
      }
    }
  }, 'dsh-workspace event hub')

  return {
    pushMux: (payload: Record<string, unknown>) => push('mux', payload),
    stream(kind: 'mux' | 'host', signal: AbortSignal) {
      return (async function* stream() {
        if (signal.aborted) return
        const subscriber: HubSubscriber = { queue: [] }
        subscribers[kind].add(subscriber)
        const onAbort = (): void => {
          const wake = subscriber.wake
          subscriber.wake = undefined
          wake?.()
        }
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          while (!signal.aborted) {
            if (subscriber.queue.length === 0) {
              await new Promise<void>((resolve) => {
                if (signal.aborted || subscriber.queue.length > 0) {
                  resolve()
                  return
                }
                subscriber.wake = resolve
              })
              if (signal.aborted) break
            }
            const frame = subscriber.queue.shift()
            if (frame !== undefined) yield frame
          }
        } finally {
          signal.removeEventListener('abort', onAbort)
          subscribers[kind].delete(subscriber)
        }
      })()
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
