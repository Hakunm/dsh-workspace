import { randomUUID } from 'node:crypto'
import type { RpcResponse, DshApiProxy } from './chat-adapter.ts'
import type { SettingsApiProxy } from './settings-adapter.ts'

type HostBridgeContext = {
  sessionController: SessionControllerFace
  workspaceController: WorkspaceControllerFace
  settingsController: SettingsControllerFace
  credentialsController: CredentialsControllerFace
  llm: LlmFace
  agentPresets: AgentPresetsFace
  on(event: string, handler: (...args: unknown[]) => unknown, options?: { global?: boolean }): () => void
  effect(register: () => (() => void) | void, label?: string): void
}

interface SessionControllerFace {
  list(request: Record<string, never>, signal: AbortSignal): Promise<{ items: SessionSummaryFace[] }>
  create(request: Record<string, unknown>): Promise<{ sessionId: string; agentPreset?: string }>
  page(request: Record<string, unknown>, signal: AbortSignal): Promise<{ records: { event: unknown }[]; hasMore: boolean }>
  prompt(request: Record<string, unknown>, signal: AbortSignal): Promise<{ accepted: true }>
  cancel(request: { sessionId: string }): { accepted: true }
  rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }>
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ sessionId: string }>
  selectModel(request: Record<string, unknown>): Promise<{ selected: Record<string, string | undefined> }>
  resolveAgent(sessionId: string): Promise<{ agent?: { id: string; session: SessionFace } ; error?: RemoteErrorFace }>
  modelCatalog(): Promise<ModelCatalogFace>
  projections(request: { sessionId: string }, signal: AbortSignal): Promise<ProjectionsFace | null>
}

interface WorkspaceControllerFace {
  create(request: { path: string }): Promise<{ workspace: WorkspaceSummaryFace; created: boolean }>
  rename(request: { workspaceId: string; title: string }): Promise<{ workspace: WorkspaceSummaryFace }>
  delete(request: { workspaceId: string }): Promise<{ deleted: true }>
  archiveSession(request: { sessionId: string }): Promise<{ archivedSessionIds: string[] }>
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

interface LlmFace {
  listConfigurableProviders(): ConfigurableProviderFace[]
  discoverModels(settingsNs: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<ModelFace[]>
}

interface AgentPresetsFace {
  remoteExportList(): Promise<{ presets: AgentPresetRowFace[] }>
  select(agent: unknown, agentPreset: string): Promise<string>
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
  createdAt: string
  updatedAt: string
}

interface WorkspaceFollowFace {
  type: string
  value?: { items: WorkspaceSummaryFace[]; archivedSessionIds: string[] }
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
}

interface ConfigurableProviderFace {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  active: boolean
  declared?: boolean
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

interface SessionFace {
  id: string
  seq: number
  eventAt(seq: number): { type: string; data?: Record<string, unknown> } | undefined
}

interface RemoteErrorFace {
  code?: string
  message?: string
}

type ApprovalResolver = (outcome: 'allowed-once' | 'rejected') => void

type RpcCall<T extends Record<string, unknown> = Record<string, unknown>> = {
  rpcId: string
  payload: T
}

const HOST_SIGNAL = AbortSignal.timeout(120_000)

/** Build an in-process ApiProxy-shaped facade over DSH 0.2 host controllers. */
export function createHostDshApi(ctx: HostBridgeContext): SettingsApiProxy & DshApiProxy {
  const eventHub = createEventHub(ctx)
  const approvalResolvers = new Map<string, ApprovalResolver>()

  ctx.on('approval/request', (...args: unknown[]) => {
    const req = args[0] as ApprovalRequestFace
    const next = args[1] as () => Promise<unknown>
    const sessionId = req.agent.session.id
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
    return new Promise<'allowed-once' | 'rejected' | 'unavailable'>((resolve) => {
      approvalResolvers.set(key, (outcome) => {
        approvalResolvers.delete(key)
        eventHub.pushMux({
          type: 'approval/resolved',
          sessionId,
          approvalId,
          outcome,
        })
        resolve(outcome)
      })
      req.signal?.addEventListener('abort', () => {
        if (approvalResolvers.delete(key)) resolve('unavailable')
      }, { once: true })
    }).then((outcome) => {
      if (outcome === 'unavailable') return next() as Promise<'allowed-once' | 'rejected'>
      return outcome
    })
  })

  const rpc = async <T>(run: () => Promise<T>): Promise<RpcResponse<T>> => {
    try {
      return ok(await run())
    } catch (error) {
      return err(asRemoteError(error))
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
      const value = message.result.value as { sessionId?: string; approvalId?: string; outcome?: 'allowed-once' | 'rejected' }
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
        const value = await ctx.sessionController.list({}, HOST_SIGNAL)
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
      create: async (request: RpcCall) => rpc(() => ctx.sessionController.create(request.payload)),
      history: async (request: RpcCall) => rpc(async () => {
        const payload = request.payload
        const sessionId = String(payload.sessionId)
        const page = await ctx.sessionController.page({
          address: { kind: 'session', sessionId },
          throughSeq: -1,
          ...(payload.beforeSeq === undefined ? {} : { beforeSeq: payload.beforeSeq }),
          ...(payload.maxMessages === undefined ? {} : { maxMessages: payload.maxMessages }),
        }, HOST_SIGNAL)
        let projections: unknown
        try {
          const read = await ctx.sessionController.projections({ sessionId }, HOST_SIGNAL)
          if (read !== null && read.values !== undefined) {
            projections = { asOfSeq: read.asOfSeq ?? -1, values: read.values }
          }
        } catch {
          // History remains useful without projections.
        }
        return {
          events: page.records.map(record => record.event),
          hasMore: page.hasMore,
          ...(projections === undefined ? {} : { projections }),
        }
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
        return await ctx.sessionController.prompt(promptRequest, HOST_SIGNAL)
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
        try {
          const projections = await ctx.sessionController.projections({ sessionId }, HOST_SIGNAL)
          const selection = projections?.values?.modelSelection
          if (isRecord(selection) && typeof selection.provider === 'string' && typeof selection.model === 'string') {
            current = {
              provider: selection.provider,
              model: selection.model,
              ...(typeof selection.reasoningEffort === 'string' ? { reasoningEffort: selection.reasoningEffort } : {}),
            }
          }
        } catch {
          // Fall back to deployment default selection.
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
          items: baseline.items.map(item => ({
            workspaceId: item.workspaceId,
            path: item.path,
            title: item.title,
            sessionIds: [],
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
          archivedSessionIds: baseline.archivedSessionIds,
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
        const credentials = await ctx.credentialsController.describe(request.payload.refs as string[])
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
      providers: async () => rpc(async () => ({ providers: ctx.llm.listConfigurableProviders() })),
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
        }, HOST_SIGNAL),
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

function mapWorkspace(workspace: WorkspaceSummaryFace) {
  return {
    workspaceId: workspace.workspaceId,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [] as string[],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

async function readWorkspaceBaseline(controller: WorkspaceControllerFace): Promise<{
  items: WorkspaceSummaryFace[]
  archivedSessionIds: string[]
}> {
  const signal = AbortSignal.timeout(5_000)
  const stream = controller.follow(signal)
  for await (const frame of stream) {
    if (frame.type === 'baseline' && frame.value !== undefined) {
      return {
        items: frame.value.items,
        archivedSessionIds: frame.value.archivedSessionIds,
      }
    }
  }
  return { items: [], archivedSessionIds: [] }
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

function createEventHub(ctx: HostBridgeContext) {
  const muxQueue: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
  const hostQueue: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
  const muxWaiters: Array<() => void> = []
  const hostWaiters: Array<() => void> = []

  const push = (queue: typeof muxQueue, waiters: typeof muxWaiters, payload: Record<string, unknown>) => {
    const frame = { rpcId: randomUUID(), payload }
    if (waiters.length > 0) waiters.shift()?.()
    else queue.push(frame)
  }

  ctx.on('session/event', (...args: unknown[]) => {
    const session = args[0] as { id: string }
    const event = args[1] as Record<string, unknown>
    push(muxQueue, muxWaiters, { type: 'session/event', sessionId: session.id, event })
  }, { global: true })

  ctx.on('api-session/status', (...args: unknown[]) => {
    const sessionId = args[0] as string
    const running = args[1] as boolean
    push(hostQueue, hostWaiters, { type: 'host/session-status', sessionId, running })
  })

  ctx.on('agent-preset/selected', (...args: unknown[]) => {
    const sessionId = args[0] as string
    const agentPreset = args[1] as string
    push(hostQueue, hostWaiters, { type: 'host/remote-event', event: 'agent-preset/selected', args: [sessionId, agentPreset] })
  })

  return {
    pushMux: (payload: Record<string, unknown>) => push(muxQueue, muxWaiters, payload),
    stream(kind: 'mux' | 'host', signal: AbortSignal) {
      const queue = kind === 'mux' ? muxQueue : hostQueue
      const waiters = kind === 'mux' ? muxWaiters : hostWaiters
      return (async function* stream() {
        while (!signal.aborted) {
          if (queue.length === 0) {
            await waitForQueue(signal, waiters)
            if (signal.aborted) break
          }
          const frame = queue.shift()
          if (frame !== undefined) yield frame
        }
      })()
    },
  }
}

async function waitForQueue(signal: AbortSignal, waiters: Array<() => void>): Promise<void> {
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      const index = waiters.indexOf(wake)
      if (index >= 0) waiters.splice(index, 1)
      resolve()
    }
    const wake = (): void => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    waiters.push(wake)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

interface ApprovalRequestFace {
  agent: { session: SessionFace }
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
