import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeviceScope, Principal } from '../shared/contracts.ts'
import { DEVICE_SCOPES } from '../shared/contracts.ts'
import type { AuthService } from './auth.ts'
import { requestAddress } from './auth.ts'
import type { DshChatAdapter } from './chat-adapter.ts'
import type { StoredRoot, WorkspaceDatabase } from './database.ts'
import { ApiError, asApiError } from './errors.ts'
import type { FileService } from './file-service.ts'
import type { CustomProviderCreate, DshSettingsAdapter, ProviderPatch } from './settings-adapter.ts'
import { PLUGIN_VERSION } from '../shared/version.ts'

export interface RemoteOperationView {
  id: string
  state: 'pending' | 'succeeded' | 'failed'
  targetHost: string
  targetPort: number
  code?: string
  message?: string
  pairingCode?: string
  pairingExpiresAt?: number
}

export interface RemoteControl {
  status(operationId?: string): {
    host: string
    port: number
    configuredHost: string
    configuredPort: number
    remoteEnabled: boolean
    operation?: RemoteOperationView
  }
  enable(rootIds: string[], scopes: DeviceScope[]): RemoteOperationView
  disable(): RemoteOperationView
  configure(host: string, port: number): RemoteOperationView
}

interface RouterOptions {
  database: WorkspaceDatabase
  auth: AuthService
  files: FileService
  chat: DshChatAdapter
  settings: DshSettingsAdapter
  remote: RemoteControl
  maxUploadBytes: number
}

export class ApiRouter {
  constructor(private readonly options: RouterOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse, stripPrefix = ''): Promise<void> {
    const requestId = header(req, 'x-request-id') || randomUUID()
    setCors(req, res)
    res.setHeader('X-Request-Id', requestId)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    try {
      const rawUrl = req.url ?? '/'
      const url = new URL(rawUrl, 'http://workspace.local')
      if (stripPrefix !== '' && url.pathname.startsWith(stripPrefix)) url.pathname = url.pathname.slice(stripPrefix.length) || '/'
      await this.dispatch(req, res, url, requestId)
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined)
        return
      }
      const apiError = asApiError(error)
      sendJson(res, apiError.status, {
        error: {
          code: apiError.code,
          message: apiError.message,
          requestId,
          ...(apiError.details === undefined ? {} : { details: apiError.details }),
        },
      })
    }
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse, url: URL, requestId: string): Promise<void> {
    const method = req.method ?? 'GET'
    const pathname = url.pathname.replace(/\/$/, '') || '/'

    if (method === 'GET' && pathname === '/api/v1/healthz') {
      sendJson(res, 200, {
        ok: true,
        version: 'v1',
        pluginVersion: PLUGIN_VERSION,
        capabilities: [
          'streaming',
          'permissions',
          'questions',
          'pin',
          'unarchive',
          'search',
          'file-search',
          'queue',
          'image-attachments',
        ],
      })
      return
    }

    if (method === 'POST' && pathname === '/api/v1/pairings/exchange') {
      this.options.auth.pairingAttempts.consume(requestAddress(req))
      const body = await readJson(req, 16_384) as { code?: unknown; deviceName?: unknown }
      if (typeof body.code !== 'string' || typeof body.deviceName !== 'string') {
        throw new ApiError(400, 'BODY_INVALID', 'code and deviceName are required strings.')
      }
      const result = this.options.database.exchangePairing(body.code, body.deviceName)
      sendJson(res, 201, result)
      return
    }

    if (pathname.startsWith('/manage')) {
      this.options.auth.requireAdmin(req)
      await this.dispatchManagement(req, res, url, requestId)
      return
    }

    const principal = this.options.auth.principal(req, { allowAdmin: true })

    if (method === 'GET' && pathname === '/api/v1/devices/self') {
      if (principal.kind === 'admin') {
        sendJson(res, 200, { id: principal.id, name: 'Local administrator', scopes: [...principal.scopes], rootIds: 'all' })
      } else {
        sendJson(res, 200, { id: principal.id, name: principal.name, scopes: [...principal.scopes], rootIds: [...principal.rootIds] })
      }
      return
    }

    if (method === 'GET' && pathname === '/api/v1/roots') {
      this.options.auth.requireScope(principal, 'files.read')
      const roots = this.authorizedRoots(principal).map(({ id, label, createdAt }) => ({ id, label, createdAt }))
      sendJson(res, 200, { items: roots })
      return
    }

    const rootRoute = pathname.match(/^\/api\/v1\/roots\/([^/]+)\/(entries|content|search)$/)
    if (rootRoute !== null) {
      const rootId = decodeURIComponent(rootRoute[1] as string)
      const resource = rootRoute[2]
      const root = this.requireRoot(principal, rootId)
      if (resource === 'entries') {
        await this.dispatchEntries(req, res, url, principal, root, requestId)
        return
      }
      if (resource === 'search') {
        if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported for file search.')
        this.options.auth.requireScope(principal, 'files.read')
        const query = url.searchParams.get('q') ?? url.searchParams.get('query') ?? ''
        const relativePath = url.searchParams.get('path') ?? ''
        const limit = optionalInteger(url.searchParams.get('limit'))
        const includeHidden = url.searchParams.get('includeHidden') === 'true'
        sendJson(res, 200, await this.options.files.search(root, query, {
          relativePath,
          ...(limit === undefined ? {} : { limit }),
          includeHidden,
        }))
        return
      }
      await this.dispatchContent(req, res, url, principal, root, requestId)
      return
    }

    if (method === 'GET' && pathname === '/api/v1/trash') {
      this.options.auth.requireScope(principal, 'files.read')
      const rootIds = principal.rootIds === 'all' ? undefined : principal.rootIds
      sendJson(res, 200, { items: this.options.files.listTrash(rootIds) })
      return
    }

    const restoreRoute = pathname.match(/^\/api\/v1\/trash\/([^/]+)\/restore$/)
    if (method === 'POST' && restoreRoute !== null) {
      this.options.auth.requireScope(principal, 'files.delete')
      const record = this.options.database.getTrash(decodeURIComponent(restoreRoute[1] as string))
      if (record === undefined) throw new ApiError(404, 'TRASH_NOT_FOUND', 'The trash item does not exist.')
      const root = this.requireRoot(principal, record.rootId)
      await this.options.files.restoreTrash(root, record.id)
      this.audit(principal, 'trash.restore', root.id, record.relativePath, requestId)
      sendJson(res, 200, { restored: true })
      return
    }

    if (pathname === '/api/v1/chat/workspaces') {
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'chat.read')
        sendJson(res, 200, { items: await this.options.chat.listWorkspaces(principal) })
        return
      }
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, 64_000) as Record<string, unknown>
        if (typeof body.rootId !== 'string' || typeof body.path !== 'string') {
          throw new ApiError(400, 'BODY_INVALID', 'rootId and path are required strings.')
        }
        const workspace = await this.options.chat.createWorkspace(principal, body.rootId, body.path)
        this.audit(principal, 'chat.workspace.create', body.rootId, body.path, requestId, { workspaceId: workspace.id })
        sendJson(res, 201, { workspace })
        return
      }
    }

    const workspaceRoute = pathname.match(/^\/api\/v1\/chat\/workspaces\/([^/]+)$/)
    if (workspaceRoute !== null) {
      const workspaceId = decodeURIComponent(workspaceRoute[1] as string)
      if (method === 'PATCH') {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, 64_000) as Record<string, unknown>
        if (typeof body.title !== 'string') throw new ApiError(400, 'BODY_INVALID', 'title is required.')
        const workspace = await this.options.chat.renameWorkspace(principal, workspaceId, body.title)
        this.audit(principal, 'chat.workspace.rename', workspace.rootId, workspace.path, requestId, { workspaceId })
        sendJson(res, 200, { workspace })
        return
      }
      if (method === 'DELETE') {
        this.options.auth.requireScope(principal, 'chat.write')
        await this.options.chat.deleteWorkspace(principal, workspaceId)
        this.audit(principal, 'chat.workspace.delete', undefined, undefined, requestId, { workspaceId })
        sendJson(res, 200, { deleted: true })
        return
      }
    }

    if (method === 'GET' && pathname === '/api/v1/chat/agent-presets') {
      this.options.auth.requireScope(principal, 'chat.read')
      sendJson(res, 200, { items: await this.options.chat.listAgentPresets() })
      return
    }

    if (method === 'GET' && pathname === '/api/v1/chat/permissions') {
      this.options.auth.requireScope(principal, 'chat.read')
      sendJson(res, 200, await this.options.chat.listPermissionCatalog())
      return
    }

    if (pathname === '/api/v1/settings/providers') {
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'settings.read')
        sendJson(res, 200, await this.options.settings.listProviders())
        return
      }
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'settings.write')
        const body = await readJson(req, 1_000_000) as Record<string, unknown>
        if (typeof body.id !== 'string' || typeof body.baseURL !== 'string' || typeof body.api !== 'string' || !Array.isArray(body.models)) {
          throw new ApiError(400, 'BODY_INVALID', 'id, baseURL, api, and models are required.')
        }
        const input: CustomProviderCreate = {
          id: body.id,
          baseURL: body.baseURL,
          api: body.api,
          models: body.models as CustomProviderCreate['models'],
          ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
          ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
          ...(Number.isSafeInteger(body.expectedRevision) ? { expectedRevision: body.expectedRevision as number } : {}),
        }
        await this.options.settings.createProvider(input)
        this.audit(principal, 'settings.provider.create', undefined, undefined, requestId, {
          providerId: input.id,
          credentialChanged: typeof input.apiKey === 'string' && input.apiKey.trim() !== '',
        })
        sendJson(res, 201, await this.options.settings.listProviders())
        return
      }
    }

    if (method === 'GET' && pathname === '/api/v1/settings/models') {
      this.options.auth.requireScope(principal, 'settings.read')
      sendJson(res, 200, await this.options.settings.catalog())
      return
    }

    const providerRoute = pathname.match(/^\/api\/v1\/settings\/providers\/([^/]+)$/)
    if (providerRoute !== null) {
      const providerId = decodeURIComponent(providerRoute[1] as string)
      if (method === 'PATCH') {
        this.options.auth.requireScope(principal, 'settings.write')
        const body = await readJson(req, 1_000_000) as ProviderPatch
        await this.options.settings.updateProvider(providerId, body)
        this.audit(principal, 'settings.provider.update', undefined, undefined, requestId, {
          providerId,
          fields: Object.keys(body).filter(field => field !== 'apiKey'),
          credentialChanged: Object.hasOwn(body as object, 'apiKey'),
        })
        sendJson(res, 200, await this.options.settings.listProviders())
        return
      }
      if (method === 'DELETE') {
        this.options.auth.requireScope(principal, 'settings.write')
        const expectedRevision = optionalInteger(url.searchParams.get('expectedRevision'))
        await this.options.settings.removeProvider(providerId, expectedRevision)
        this.audit(principal, 'settings.provider.remove', undefined, undefined, requestId, { providerId })
        res.writeHead(204)
        res.end()
        return
      }
    }

    const discoverProviderRoute = pathname.match(/^\/api\/v1\/settings\/providers\/([^/]+)\/discover$/)
    if (method === 'POST' && discoverProviderRoute !== null) {
      this.options.auth.requireScope(principal, 'settings.write')
      const providerId = decodeURIComponent(discoverProviderRoute[1] as string)
      const body = await readJson(req, 64_000) as { baseURL?: unknown; api?: unknown; apiKey?: unknown }
      const draft = {
        ...(typeof body.baseURL === 'string' ? { baseURL: body.baseURL } : {}),
        ...(typeof body.api === 'string' ? { api: body.api } : {}),
        ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
      }
      const models = await this.options.settings.discover(providerId, draft)
      this.audit(principal, 'settings.provider.discover', undefined, undefined, requestId, { providerId })
      sendJson(res, 200, { models })
      return
    }

    if (method === 'GET' && pathname === '/api/v1/chat/sessions/search') {
      this.options.auth.requireScope(principal, 'chat.read')
      const query = url.searchParams.get('q') ?? ''
      const includeArchived = url.searchParams.get('includeArchived') === 'true'
      sendJson(res, 200, await this.options.chat.searchSessions(principal, query, { includeArchived }))
      return
    }

    if (pathname === '/api/v1/chat/sessions') {
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'chat.read')
        const includeArchived = url.searchParams.get('includeArchived') === 'true'
        sendJson(res, 200, { items: await this.options.chat.listSessions(principal, { includeArchived }) })
        return
      }
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, 64_000) as Record<string, unknown>
        const cached = this.readIdempotent(principal, body.clientRequestId)
        if (cached !== undefined) {
          sendJson(res, cached.status, cached.body)
          return
        }
        const options = {
          ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
          ...(typeof body.agentPreset === 'string' ? { agentPreset: body.agentPreset } : {}),
        }
        const usesWorkspace = typeof body.workspaceId === 'string'
        const usesLegacyPath = typeof body.rootId === 'string' && typeof body.path === 'string'
        if (!usesWorkspace && !usesLegacyPath) {
          throw new ApiError(400, 'BODY_INVALID', 'workspaceId or rootId with path is required.')
        }
        const result = usesWorkspace
          ? await this.options.chat.createSessionInWorkspace(principal, body.workspaceId as string, options)
          : await this.options.chat.createSession(principal, body.rootId as string, body.path as string, options)
        const response = { session: result }
        this.saveIdempotent(principal, body.clientRequestId, 201, response)
        this.audit(
          principal,
          'chat.session.create',
          usesLegacyPath ? body.rootId as string : undefined,
          usesLegacyPath ? body.path as string : undefined,
          requestId,
          usesWorkspace ? { workspaceId: body.workspaceId as string } : {},
        )
        sendJson(res, 201, response)
        return
      }
    }

    const sessionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)$/)
    if (method === 'PATCH' && sessionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(sessionRoute[1] as string)
      const body = await readJson(req, 64_000) as Record<string, unknown>
      if (typeof body.title !== 'string') throw new ApiError(400, 'BODY_INVALID', 'title is required.')
      const result = await this.options.chat.renameSession(principal, sessionId, body.title)
      this.audit(principal, 'chat.session.rename', undefined, undefined, requestId, { sessionId })
      sendJson(res, 200, result)
      return
    }

    const forkSessionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/fork$/)
    if (method === 'POST' && forkSessionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(forkSessionRoute[1] as string)
      const body = await readJson(req, 16_384) as Record<string, unknown>
      const atSeq = body.atSeq === undefined ? undefined : body.atSeq
      if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || (atSeq as number) < 0)) {
        throw new ApiError(400, 'BODY_INVALID', 'atSeq must be a non-negative integer.')
      }
      const forkedSessionId = await this.options.chat.forkSession(principal, sessionId, atSeq as number | undefined)
      this.audit(principal, 'chat.session.fork', undefined, undefined, requestId, { sessionId, forkedSessionId })
      sendJson(res, 201, { sessionId: forkedSessionId })
      return
    }

    const archiveSessionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/archive$/)
    if (method === 'POST' && archiveSessionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(archiveSessionRoute[1] as string)
      await this.options.chat.archiveSession(principal, sessionId)
      this.audit(principal, 'chat.session.archive', undefined, undefined, requestId, { sessionId })
      sendJson(res, 200, { archived: true })
      return
    }

    const unarchiveSessionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/unarchive$/)
    if (method === 'POST' && unarchiveSessionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(unarchiveSessionRoute[1] as string)
      await this.options.chat.unarchiveSession(principal, sessionId)
      this.audit(principal, 'chat.session.unarchive', undefined, undefined, requestId, { sessionId })
      sendJson(res, 200, { archived: false })
      return
    }

    const pinSessionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/pin$/)
    if (pinSessionRoute !== null) {
      const sessionId = decodeURIComponent(pinSessionRoute[1] as string)
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'chat.write')
        await this.options.chat.pinSession(principal, sessionId)
        this.audit(principal, 'chat.session.pin', undefined, undefined, requestId, { sessionId })
        sendJson(res, 200, { pinned: true })
        return
      }
      if (method === 'DELETE') {
        this.options.auth.requireScope(principal, 'chat.write')
        await this.options.chat.unpinSession(principal, sessionId)
        this.audit(principal, 'chat.session.unpin', undefined, undefined, requestId, { sessionId })
        sendJson(res, 200, { pinned: false })
        return
      }
    }

    const sessionStateRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/state$/)
    if (method === 'GET' && sessionStateRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.read')
      const sessionId = decodeURIComponent(sessionStateRoute[1] as string)
      sendJson(res, 200, await this.options.chat.sessionState(principal, sessionId))
      return
    }

    const queueMutationRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/queue\/([^/]+)$/)
    if (method === 'POST' && queueMutationRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(queueMutationRoute[1] as string)
      const itemId = decodeURIComponent(queueMutationRoute[2] as string)
      const body = await readJson(req, 262_144) as Record<string, unknown>
      const kind = body.kind
      if (kind !== 'edit' && kind !== 'remove' && kind !== 'steer') {
        throw new ApiError(400, 'BODY_INVALID', 'kind must be edit, remove, or steer.')
      }
      if (kind === 'edit' && typeof body.text !== 'string') {
        throw new ApiError(400, 'BODY_INVALID', 'text is required when kind is edit.')
      }
      await this.options.chat.updateQueue(
        principal,
        sessionId,
        itemId,
        kind === 'edit' ? { kind: 'edit', text: body.text as string } : { kind },
      )
      this.audit(principal, 'chat.queue.update', undefined, undefined, requestId, { sessionId, itemId, kind })
      sendJson(res, 200, { accepted: true })
      return
    }

    const questionsRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/questions$/)
    if (method === 'GET' && questionsRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.read')
      const sessionId = decodeURIComponent(questionsRoute[1] as string)
      sendJson(res, 200, { items: await this.options.chat.listPendingQuestions(principal, sessionId) })
      return
    }

    const answerQuestionRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/questions\/([^/]+)\/answer$/)
    if (method === 'POST' && answerQuestionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(answerQuestionRoute[1] as string)
      const questionId = decodeURIComponent(answerQuestionRoute[2] as string)
      const body = await readJson(req, 131_072) as Record<string, unknown>
      if (!Array.isArray(body.answers)) {
        throw new ApiError(400, 'BODY_INVALID', 'answers must be an array.')
      }
      await this.options.chat.answerQuestion(
        principal,
        sessionId,
        questionId,
        body.answers as Parameters<typeof this.options.chat.answerQuestion>[3],
      )
      this.audit(principal, 'chat.question.answer', undefined, undefined, requestId, { sessionId, questionId })
      sendJson(res, 202, { accepted: true })
      return
    }

    const messagesRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/messages$/)
    if (messagesRoute !== null) {
      const sessionId = decodeURIComponent(messagesRoute[1] as string)
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'chat.read')
        const beforeSeq = optionalInteger(url.searchParams.get('beforeSeq'))
        const maxMessages = optionalInteger(url.searchParams.get('maxMessages'))
        sendJson(res, 200, await this.options.chat.history(principal, sessionId, {
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          ...(maxMessages === undefined ? {} : { maxMessages }),
        }))
        return
      }
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, Math.max(1_000_000, this.options.maxUploadBytes)) as Record<string, unknown>
        const cached = this.readIdempotent(principal, body.clientRequestId)
        if (cached !== undefined) {
          sendJson(res, cached.status, cached.body)
          return
        }
        const attachments = Array.isArray(body.attachments)
          ? body.attachments.filter((item): item is { type: 'image'; mediaType: string; data: string; name?: string } => (
              typeof item === 'object'
              && item !== null
              && (item as Record<string, unknown>).type === 'image'
              && typeof (item as Record<string, unknown>).mediaType === 'string'
              && typeof (item as Record<string, unknown>).data === 'string'
            ))
          : []
        if (typeof body.text !== 'string' && attachments.length === 0) {
          throw new ApiError(400, 'BODY_INVALID', 'text or attachments is required.')
        }
        const text = typeof body.text === 'string' ? body.text : ''
        const mode = body.mode === 'steer' ? 'steer' : 'queue'
        const result = await this.options.chat.prompt(
          principal,
          sessionId,
          text,
          mode,
          typeof body.clientTimeZone === 'string' ? body.clientTimeZone : undefined,
          attachments,
        )
        const response = { message: result }
        this.saveIdempotent(principal, body.clientRequestId, 202, response)
        this.audit(principal, 'chat.message.submit', undefined, undefined, requestId, {
          sessionId,
          mode,
          ...(attachments.length > 0 ? { attachmentCount: attachments.length } : {}),
        })
        sendJson(res, 202, response)
        return
      }
    }

    const commandsRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/commands$/)
    if (commandsRoute !== null) {
      const sessionId = decodeURIComponent(commandsRoute[1] as string)
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'chat.read')
        sendJson(res, 200, { items: await this.options.chat.listCommands(principal, sessionId) })
        return
      }
      if (method === 'POST') {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, 32_768) as Record<string, unknown>
        if (typeof body.line !== 'string') throw new ApiError(400, 'BODY_INVALID', 'line is required.')
        const execution = await this.options.chat.executeCommand(principal, sessionId, body.line)
        this.audit(principal, 'chat.command.execute', undefined, undefined, requestId, {
          sessionId,
          command: commandName(body.line),
        })
        sendJson(res, 200, { execution })
        return
      }
    }

    const approvalsRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/approvals$/)
    if (method === 'GET' && approvalsRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.read')
      const sessionId = decodeURIComponent(approvalsRoute[1] as string)
      sendJson(res, 200, { items: await this.options.chat.listPendingApprovals(principal, sessionId) })
      return
    }

    const approvalDecisionRoute = pathname.match(
      /^\/api\/v1\/chat\/sessions\/([^/]+)\/approvals\/([^/]+)\/decision$/,
    )
    if (method === 'POST' && approvalDecisionRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(approvalDecisionRoute[1] as string)
      const approvalId = decodeURIComponent(approvalDecisionRoute[2] as string)
      const body = await readJson(req, 16_384) as Record<string, unknown>
      if (body.outcome !== 'allowed-once' && body.outcome !== 'rejected') {
        throw new ApiError(400, 'BODY_INVALID', 'outcome must be allowed-once or rejected.')
      }
      const approval = await this.options.chat.decideApproval(principal, sessionId, approvalId, body.outcome)
      this.audit(principal, 'chat.approval.decide', undefined, undefined, requestId, {
        sessionId,
        approvalId,
        outcome: body.outcome,
        toolName: approval.toolName,
        risk: approval.risk,
      })
      sendJson(res, 202, { accepted: true })
      return
    }

    const sessionModelsRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/model(?:s)?$/)
    if (sessionModelsRoute !== null) {
      const sessionId = decodeURIComponent(sessionModelsRoute[1] as string)
      if (method === 'GET') {
        this.options.auth.requireScope(principal, 'chat.read')
        sendJson(res, 200, await this.options.chat.models(principal, sessionId))
        return
      }
      if (method === 'PUT' && pathname.endsWith('/model')) {
        this.options.auth.requireScope(principal, 'chat.write')
        const body = await readJson(req, 64_000) as Record<string, unknown>
        if (typeof body.provider !== 'string' || typeof body.model !== 'string') {
          throw new ApiError(400, 'BODY_INVALID', 'provider and model are required strings.')
        }
        const selected = await this.options.chat.selectModel(principal, sessionId, {
          provider: body.provider,
          model: body.model,
          ...(typeof body.reasoningEffort === 'string' ? { reasoningEffort: body.reasoningEffort } : {}),
        })
        this.audit(principal, 'chat.model.select', undefined, undefined, requestId, {
          sessionId,
          provider: selected.provider,
          model: selected.model,
          ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
        })
        sendJson(res, 200, { selected })
        return
      }
    }

    const sessionAgentPresetRoute = pathname.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/agent-preset$/)
    if (method === 'PUT' && sessionAgentPresetRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(sessionAgentPresetRoute[1] as string)
      const body = await readJson(req, 64_000) as Record<string, unknown>
      if (typeof body.agentPreset !== 'string') {
        throw new ApiError(400, 'BODY_INVALID', 'agentPreset is required.')
      }
      const agentPreset = await this.options.chat.selectAgentPreset(principal, sessionId, body.agentPreset)
      this.audit(principal, 'chat.agent-preset.select', undefined, undefined, requestId, { sessionId, agentPreset })
      sendJson(res, 200, { agentPreset })
      return
    }

    const cancelRoute = pathname.match(/^\/api\/v1\/chat\/runs\/([^/]+)\/cancel$/)
    if (method === 'POST' && cancelRoute !== null) {
      this.options.auth.requireScope(principal, 'chat.write')
      const sessionId = decodeURIComponent(cancelRoute[1] as string)
      await this.options.chat.cancel(principal, sessionId)
      this.audit(principal, 'chat.run.cancel', undefined, undefined, requestId, { sessionId })
      sendJson(res, 202, { accepted: true })
      return
    }

    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested API route does not exist.')
  }

  private async dispatchManagement(req: IncomingMessage, res: ServerResponse, url: URL, requestId: string): Promise<void> {
    const method = req.method ?? 'GET'
    const pathname = url.pathname.replace(/\/$/, '')
    if (method === 'GET' && pathname === '/manage/status') {
      const operationId = url.searchParams.get('operationId') ?? undefined
      sendJson(res, 200, {
        ...this.options.remote.status(operationId),
        roots: this.options.database.listRoots(),
        devices: this.options.database.listDevices(),
      })
      return
    }
    if (method === 'GET' && pathname === '/manage/roots') {
      sendJson(res, 200, { items: this.options.database.listRoots() })
      return
    }
    if (method === 'POST' && pathname === '/manage/roots') {
      const body = await readJson(req, 64_000) as Record<string, unknown>
      if (typeof body.path !== 'string') throw new ApiError(400, 'BODY_INVALID', 'path is required.')
      const root = await this.options.database.addRoot(body.path, typeof body.label === 'string' ? body.label : undefined)
      sendJson(res, 201, root)
      return
    }
    const rootRoute = pathname.match(/^\/manage\/roots\/([^/]+)$/)
    if (method === 'DELETE' && rootRoute !== null) {
      this.options.database.removeRoot(decodeURIComponent(rootRoute[1] as string))
      res.writeHead(204)
      res.end()
      return
    }
    if (method === 'GET' && pathname === '/manage/devices') {
      sendJson(res, 200, { items: this.options.database.listDevices() })
      return
    }
    const deviceRoute = pathname.match(/^\/manage\/devices\/([^/]+)$/)
    if (deviceRoute !== null && method === 'PATCH') {
      const body = await readJson(req, 64_000) as Record<string, unknown>
      const scopes = validateScopes(body.scopes)
      const rootIds = validateStringArray(body.rootIds, 'rootIds')
      sendJson(res, 200, this.options.database.updateDevice(decodeURIComponent(deviceRoute[1] as string), scopes, rootIds))
      return
    }
    if (deviceRoute !== null && method === 'DELETE') {
      this.options.database.revokeDevice(decodeURIComponent(deviceRoute[1] as string))
      res.writeHead(204)
      res.end()
      return
    }
    if (method === 'POST' && pathname === '/manage/pairings') {
      const body = await readJson(req, 64_000) as Record<string, unknown>
      sendJson(res, 201, this.options.database.createPairing(
        validateStringArray(body.rootIds, 'rootIds'),
        validateScopes(body.scopes),
      ))
      return
    }
    if (method === 'POST' && pathname === '/manage/remote/enable') {
      const body = await readJson(req, 64_000) as Record<string, unknown>
      const operation = this.options.remote.enable(
        validateStringArray(body.rootIds, 'rootIds'),
        validateScopes(body.scopes),
      )
      res.setHeader('Connection', 'close')
      sendJson(res, 202, operation)
      return
    }
    if (method === 'POST' && pathname === '/manage/remote/disable') {
      const operation = this.options.remote.disable()
      res.setHeader('Connection', 'close')
      sendJson(res, 202, operation)
      return
    }
    if (method === 'PUT' && pathname === '/manage/remote/listener') {
      const body = await readJson(req, 16_384) as Record<string, unknown>
      const operation = this.options.remote.configure(
        typeof body.host === 'string' ? body.host : '',
        body.port as number,
      )
      res.setHeader('Connection', 'close')
      sendJson(res, 202, operation)
      return
    }
    if (method === 'GET' && pathname === '/manage/audit') {
      sendJson(res, 200, { items: this.options.database.listAudit(optionalInteger(url.searchParams.get('limit')) ?? 200) })
      return
    }
    const purgeRoute = pathname.match(/^\/manage\/trash\/([^/]+)$/)
    if (method === 'DELETE' && purgeRoute !== null) {
      await this.options.files.purgeTrash(decodeURIComponent(purgeRoute[1] as string))
      this.options.database.audit('admin', 'loopback-admin', 'trash.purge', undefined, undefined, {}, requestId)
      res.writeHead(204)
      res.end()
      return
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested management route does not exist.')
  }

  private async dispatchEntries(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    principal: Principal,
    root: StoredRoot,
    requestId: string,
  ): Promise<void> {
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      this.options.auth.requireScope(principal, 'files.read')
      sendJson(res, 200, await this.options.files.list(
        root,
        url.searchParams.get('path') ?? '',
        optionalInteger(url.searchParams.get('limit')) ?? 200,
        url.searchParams.get('cursor') ?? undefined,
      ))
      return
    }
    if (method === 'POST') {
      this.options.auth.requireScope(principal, 'files.write')
      const body = await readJson(req, 64_000) as Record<string, unknown>
      if (typeof body.path !== 'string' || (body.kind !== 'file' && body.kind !== 'directory')) {
        throw new ApiError(400, 'BODY_INVALID', 'path and a file/directory kind are required.')
      }
      const entry = await this.options.files.createEntry(root, body.path, body.kind)
      this.audit(principal, 'file.create', root.id, body.path, requestId, { kind: body.kind })
      sendJson(res, 201, entry)
      return
    }
    if (method === 'PATCH') {
      this.options.auth.requireScope(principal, 'files.write')
      const body = await readJson(req, 64_000) as Record<string, unknown>
      if (typeof body.path !== 'string' || typeof body.destinationPath !== 'string') {
        throw new ApiError(400, 'BODY_INVALID', 'path and destinationPath are required.')
      }
      await this.options.files.moveEntry(root, body.path, body.destinationPath)
      this.audit(principal, 'file.move', root.id, body.path, requestId, { destinationPath: body.destinationPath })
      sendJson(res, 200, { moved: true })
      return
    }
    if (method === 'DELETE') {
      this.options.auth.requireScope(principal, 'files.delete')
      const relativePath = url.searchParams.get('path')
      if (relativePath === null) throw new ApiError(400, 'PATH_REQUIRED', 'The path query parameter is required.')
      const item = await this.options.files.trashEntry(root, relativePath)
      this.audit(principal, 'file.trash', root.id, relativePath, requestId, { trashId: item.id })
      sendJson(res, 200, item)
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'The method is not supported for entries.')
  }

  private async dispatchContent(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    principal: Principal,
    root: StoredRoot,
    requestId: string,
  ): Promise<void> {
    const relativePath = url.searchParams.get('path')
    if (relativePath === null) throw new ApiError(400, 'PATH_REQUIRED', 'The path query parameter is required.')
    if (req.method === 'GET') {
      this.options.auth.requireScope(principal, 'files.read')
      const descriptor = await this.options.files.inspectContent(root, relativePath)
      const range = parseRange(req.headers.range, descriptor.size)
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('ETag', descriptor.etag)
      res.setHeader('Last-Modified', new Date(descriptor.modifiedAt).toUTCString())
      res.setHeader('Content-Type', descriptor.contentType)
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(relativePath.split('/').at(-1) ?? 'file')}`)
      if (range === undefined) {
        res.writeHead(200, { 'Content-Length': descriptor.size })
        this.options.files.streamContent(descriptor).pipe(res)
      } else {
        res.writeHead(206, {
          'Content-Length': range.end - range.start + 1,
          'Content-Range': `bytes ${range.start}-${range.end}/${descriptor.size}`,
        })
        this.options.files.streamContent(descriptor, range).pipe(res)
      }
      return
    }
    if (req.method === 'PUT') {
      this.options.auth.requireScope(principal, 'files.write')
      const content = await readBytes(req, this.options.maxUploadBytes)
      const result = await this.options.files.writeContent(root, relativePath, content, {
        ...(req.headers['if-match'] === undefined ? {} : { ifMatch: String(req.headers['if-match']) }),
        ...(req.headers['if-none-match'] === undefined ? {} : { ifNoneMatch: String(req.headers['if-none-match']) }),
      })
      this.audit(principal, 'file.write', root.id, relativePath, requestId, { size: result.size, etag: result.etag })
      res.setHeader('ETag', result.etag)
      sendJson(res, 200, result)
      return
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'The method is not supported for content.')
  }

  private requireRoot(principal: Principal, rootId: string): StoredRoot {
    this.options.auth.requireRoot(principal, rootId)
    const root = this.options.database.getRoot(rootId)
    if (root === undefined) throw new ApiError(404, 'ROOT_NOT_FOUND', 'The authorized root does not exist.')
    return root
  }

  private authorizedRoots(principal: Principal): StoredRoot[] {
    const roots = this.options.database.listRoots()
    return principal.rootIds === 'all' ? roots : roots.filter(root => principal.rootIds.has(root.id))
  }

  private audit(
    principal: Principal,
    action: string,
    rootId?: string,
    relativePath?: string,
    requestId?: string,
    details: Record<string, unknown> = {},
  ): void {
    this.options.database.audit(principal.kind, principal.id, action, rootId, relativePath, details, requestId)
  }

  private readIdempotent(principal: Principal, key: unknown) {
    if (principal.kind !== 'device' || typeof key !== 'string' || key === '') return undefined
    return this.options.database.readIdempotent(principal.id, key)
  }

  private saveIdempotent(principal: Principal, key: unknown, status: number, body: unknown): void {
    if (principal.kind === 'device' && typeof key === 'string' && key !== '') {
      this.options.database.saveIdempotent(principal.id, key, status, body)
    }
  }
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const bytes = await readBytes(req, maxBytes)
  if (bytes.length === 0) return {}
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new ApiError(400, 'JSON_INVALID', 'The request body is not valid JSON.')
  }
}

async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, 'BODY_TOO_LARGE', 'The request body is too large.')
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new ApiError(413, 'BODY_TOO_LARGE', 'The request body is too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': encoded.length })
  res.end(encoded)
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (origin !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, If-None-Match, X-Request-Id, X-Dsh-Workspace-Admin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'ETag, Content-Range, X-Request-Id')
  res.setHeader('Cache-Control', 'no-store')
}

function validateScopes(value: unknown): DeviceScope[] {
  const values = validateStringArray(value, 'scopes')
  if (values.some(item => !DEVICE_SCOPES.includes(item as DeviceScope))) {
    throw new ApiError(400, 'SCOPE_INVALID', 'The request contains an unknown device scope.')
  }
  return [...new Set(values)] as DeviceScope[]
}

function validateStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ApiError(400, 'BODY_INVALID', `${name} must be an array of strings.`)
  }
  return [...new Set(value as string[])]
}

function optionalInteger(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ApiError(400, 'NUMBER_INVALID', 'A query parameter must be a non-negative integer.')
  return parsed
}

function commandName(line: string): string {
  return /^\/([a-z][a-z0-9_-]*)/u.exec(line)?.[1] ?? 'unknown'
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (match === null) throw new ApiError(416, 'RANGE_INVALID', 'Only a single byte range is supported.')
  let start: number
  let end: number
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ApiError(416, 'RANGE_INVALID', 'The byte range is invalid.')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
  }
  if (start < 0 || end < start || start >= size) throw new ApiError(416, 'RANGE_INVALID', 'The byte range is outside the file.')
  return { start, end: Math.min(end, size - 1) }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}
