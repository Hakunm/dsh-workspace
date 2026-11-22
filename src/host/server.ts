import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import type { DevicePrincipal, DeviceScope, Principal, WorkspaceEvent } from '../shared/contracts.ts'
import type { AuthService } from './auth.ts'
import type { DshChatAdapter } from './chat-adapter.ts'
import type { WorkspaceDatabase } from './database.ts'
import { ApiError } from './errors.ts'
import type { WorkspaceEventBus } from './event-bus.ts'
import { DEFAULT_REMOTE_HOST, loopbackFor, normalizeListenerHost, normalizeListenerPort } from './listener-config.ts'
import type { ApiRouter, RemoteControl, RemoteOperationView } from './router.ts'

interface RemoteApiServerOptions {
  port: number
  remoteHost?: string
  database: WorkspaceDatabase
  auth: AuthService
  chat: DshChatAdapter
  events: WorkspaceEventBus
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  onFallback?: (message: string) => void
}

interface OperationState extends RemoteOperationView {
  kind: 'configure' | 'enable' | 'disable'
  nextRemoteEnabled: boolean
  configuredHost?: string
  configuredPort?: number
  rootIds?: string[]
  scopes?: DeviceScope[]
}

export class RemoteApiServer implements RemoteControl {
  private server: Server | undefined
  private host: string = '127.0.0.1'
  private actualPort: number
  private configuredHost: string
  private configuredPort: number
  private remoteEnabled = false
  private fallbackCode: string | undefined
  private readonly operations = new Map<string, OperationState>()
  private readonly sockets = new Map<WebSocket, Principal>()
  private readonly webSockets = new WebSocketServer({ noServer: true, clientTracking: false })
  private readonly eventsAbort = new AbortController()
  private unsubscribeEvents: (() => void) | undefined
  private broadcastQueue: Promise<void> = Promise.resolve()
  private changing = false

  constructor(private readonly options: RemoteApiServerOptions) {
    const fallbackHost = normalizeListenerHost(options.remoteHost ?? DEFAULT_REMOTE_HOST)
    const fallbackPort = normalizeListenerPort(options.port, true)
    this.configuredHost = readStoredHost(options.database, fallbackHost)
    this.configuredPort = readStoredPort(options.database, fallbackPort)
    this.actualPort = this.configuredPort
  }

  async start(): Promise<void> {
    this.remoteEnabled = this.options.database.getSetting('remote_enabled') === 'true'
    this.fallbackCode = undefined
    const loopbackHost = loopbackFor(this.configuredHost)
    const requestedHost = this.remoteEnabled ? this.configuredHost : loopbackHost
    try {
      await this.bind(requestedHost, this.configuredPort)
    } catch (error) {
      const code = listenerErrorCode(error)
      if (code === 'LISTENER_ADDRESS_IN_USE') {
        this.remoteEnabled = false
        this.fallbackCode = code
        await this.bind(loopbackHost, 0)
        this.options.onFallback?.(
          `listener ${requestedHost}:${this.configuredPort} is already in use; using loopback ${this.host}:${this.actualPort} for this instance`,
        )
      } else if (this.remoteEnabled) {
        this.remoteEnabled = false
        this.fallbackCode = code
        this.options.database.setSetting('remote_enabled', 'false')
        try {
          await this.bind(loopbackHost, this.configuredPort)
        } catch (fallbackError) {
          if (listenerErrorCode(fallbackError) !== 'LISTENER_ADDRESS_IN_USE') throw fallbackError
          this.fallbackCode = 'LISTENER_ADDRESS_IN_USE'
          await this.bind(loopbackHost, 0)
        }
        this.options.onFallback?.(
          `remote listener ${requestedHost}:${this.configuredPort} failed (${code}); fell back to loopback ${this.host}:${this.actualPort}`,
        )
      } else {
        throw error
      }
    }
    this.unsubscribeEvents = this.options.events.subscribe(event => {
      this.broadcastQueue = this.broadcastQueue.then(() => this.broadcast(event)).catch(() => undefined)
    })
    this.options.chat.startEvents(this.eventsAbort.signal, event => { this.options.events.emit(event) })
  }

  async stop(): Promise<void> {
    this.eventsAbort.abort()
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = undefined
    await this.broadcastQueue
    await this.closeCurrent()
    this.webSockets.close()
  }

  status(operationId?: string) {
    const operation = operationId === undefined ? undefined : this.operations.get(operationId)
    return {
      host: this.host,
      port: this.actualPort,
      configuredHost: this.configuredHost,
      configuredPort: this.configuredPort,
      remoteEnabled: this.remoteEnabled,
      ...(this.fallbackCode === undefined ? {} : { fallbackCode: this.fallbackCode }),
      ...(operation === undefined ? {} : { operation: publicOperation(operation) }),
    }
  }

  enable(rootIds: string[], scopes: DeviceScope[]): RemoteOperationView {
    return this.scheduleChange({
      kind: 'enable',
      targetHost: this.configuredHost,
      targetPort: this.configuredPort,
      nextRemoteEnabled: true,
      rootIds,
      scopes,
    })
  }

  disable(): RemoteOperationView {
    return this.scheduleChange({
      kind: 'disable',
      targetHost: loopbackFor(this.configuredHost),
      targetPort: this.configuredPort,
      nextRemoteEnabled: false,
    })
  }

  configure(host: string, port: number): RemoteOperationView {
    if (this.remoteEnabled) throw new ApiError(409, 'REMOTE_ENABLED', 'Disable remote access before changing the listener address.')
    const configuredHost = normalizeListenerHost(host)
    const configuredPort = normalizeListenerPort(port)
    return this.scheduleChange({
      kind: 'configure',
      targetHost: loopbackFor(configuredHost),
      targetPort: configuredPort,
      nextRemoteEnabled: false,
      configuredHost,
      configuredPort,
    })
  }

  async serveWorkspace(
    req: IncomingMessage,
    res: ServerResponse,
    options: { apiBase: string; manageBase: string; scriptUrl: string },
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const template = await readFirst([
      fileURLToPath(new URL('../assets/workspace.html', import.meta.url)),
      fileURLToPath(new URL('../../assets/workspace.html', import.meta.url)),
    ], 'utf8') as string
    const body = template
      .replaceAll('__API_BASE__', options.apiBase)
      .replaceAll('__MANAGE_BASE__', options.manageBase)
      .replaceAll('__SCRIPT_URL__', options.scriptUrl)
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  async serveStandaloneScript(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    const body = await readFirst([
      fileURLToPath(new URL('./standalone.js', import.meta.url)),
      fileURLToPath(new URL('../../lib/standalone.js', import.meta.url)),
    ]) as Buffer
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  private scheduleChange(input: Omit<OperationState, 'id' | 'state'>): RemoteOperationView {
    if (this.changing) throw new ApiError(409, 'LISTENER_CHANGE_PENDING', 'A listener change is already in progress.')
    const operation: OperationState = {
      id: randomUUID(),
      state: 'pending',
      ...input,
    }
    this.operations.set(operation.id, operation)
    this.changing = true
    setTimeout(() => { void this.performChange(operation) }, 75)
    return publicOperation(operation)
  }

  private async performChange(operation: OperationState): Promise<void> {
    const previousHost = this.host
    const previousPort = this.actualPort
    try {
      if (previousHost !== operation.targetHost || previousPort !== operation.targetPort) {
        await this.rebind(operation.targetHost, operation.targetPort, previousHost, previousPort)
      }
      if (operation.configuredHost !== undefined && operation.configuredPort !== undefined) {
        this.configuredHost = operation.configuredHost
        this.configuredPort = operation.configuredPort
        this.options.database.setSetting('listener_host', this.configuredHost)
        this.options.database.setSetting('listener_port', String(this.configuredPort))
      }
      this.remoteEnabled = operation.nextRemoteEnabled
      this.fallbackCode = undefined
      this.options.database.setSetting('remote_enabled', String(this.remoteEnabled))
      if (this.remoteEnabled) {
        const pairing = this.options.database.createPairing(operation.rootIds ?? [], operation.scopes ?? [])
        operation.pairingCode = pairing.code
        operation.pairingExpiresAt = pairing.expiresAt
      }
      operation.state = 'succeeded'
      this.options.database.audit('admin', 'loopback-admin', `listener.${operation.kind}`, undefined, undefined, {
        host: operation.kind === 'configure' ? operation.configuredHost : operation.targetHost,
        port: operation.targetPort,
      })
    } catch (error) {
      operation.state = 'failed'
      operation.code = listenerErrorCode(error)
      operation.message = error instanceof Error ? error.message : String(error)
    } finally {
      this.changing = false
      this.trimOperations()
    }
  }

  private async rebind(targetHost: string, targetPort: number, previousHost: string, previousPort: number): Promise<void> {
    if (targetPort !== previousPort) {
      const replacement = await this.createBoundServer(targetHost, targetPort)
      await this.closeCurrent()
      this.server = replacement.server
      this.host = targetHost
      this.actualPort = replacement.port
      return
    }
    await this.closeCurrent()
    try {
      await this.bind(targetHost, targetPort)
    } catch (error) {
      await this.bind(previousHost, previousPort)
      throw error
    }
  }

  private async bind(host: string, port: number): Promise<void> {
    const bound = await this.createBoundServer(host, port)
    this.server = bound.server
    this.host = host
    this.actualPort = bound.port
  }

  private async createBoundServer(host: string, port: number): Promise<{ server: Server; port: number }> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://workspace.local')
      if (url.pathname === '/workspace' || url.pathname === '/workspace/') {
        void this.serveWorkspace(req, res, { apiBase: '/api/v1', manageBase: '/manage', scriptUrl: '/workspace/standalone.js' })
          .catch(error => failResponse(res, error))
        return
      }
      if (url.pathname === '/workspace/standalone.js') {
        void this.serveStandaloneScript(req, res).catch(error => failResponse(res, error))
        return
      }
      void this.options.handle(req, res).catch(error => failResponse(res, error))
    })
    server.requestTimeout = 30_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 5_000
    server.maxHeadersCount = 100
    server.on('upgrade', (req, socket, head) => { this.handleUpgrade(req, socket, head) })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      server.once('error', onError)
      server.listen(port, host, () => {
        server.off('error', onError)
        resolve()
      })
    })
    return { server, port: (server.address() as AddressInfo).port }
  }

  private async closeCurrent(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    for (const socket of this.sockets.keys()) socket.close(1012, 'Listener rebinding')
    this.sockets.clear()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      const url = new URL(req.url ?? '/', 'http://workspace.local')
      if (url.pathname !== '/api/v1/events') {
        socket.destroy()
        return
      }
      const protocolToken = parseProtocolToken(req.headers['sec-websocket-protocol'])
      if (protocolToken !== undefined) req.headers.authorization = `Bearer ${protocolToken}`
      const principal = this.options.auth.principal(req, { allowAdmin: true })
      this.webSockets.handleUpgrade(req, socket, head, (webSocket) => {
        this.sockets.set(webSocket, principal)
        webSocket.on('close', () => { this.sockets.delete(webSocket) })
        webSocket.on('error', () => { this.sockets.delete(webSocket) })
        webSocket.send(JSON.stringify({ id: randomUUID(), type: 'connection.ready', time: Date.now(), data: {} }))
      })
    } catch {
      socket.destroy()
    }
  }

  private async broadcast(event: WorkspaceEvent): Promise<void> {
    for (const [socket, principal] of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue
      let currentPrincipal = principal
      if (principal.kind === 'device') {
        const device = this.options.database.getActiveDevice(principal.id)
        if (device === undefined) {
          socket.close(4001, 'Device revoked')
          continue
        }
        currentPrincipal = {
          kind: 'device',
          id: device.id,
          name: device.name,
          scopes: new Set(device.scopes),
          rootIds: new Set(device.rootIds),
        } satisfies DevicePrincipal
        this.sockets.set(socket, currentPrincipal)
      }
      if (!(await this.eventAllowed(currentPrincipal, event))) continue
      socket.send(JSON.stringify(event))
    }
  }

  private async eventAllowed(principal: Principal, event: WorkspaceEvent): Promise<boolean> {
    if (event.type.startsWith('file.') && !principal.scopes.has('files.read')) return false
    if (event.type.startsWith('chat.') && !principal.scopes.has('chat.read')) return false
    const rootId = typeof event.data.rootId === 'string' ? event.data.rootId : undefined
    if (rootId !== undefined && principal.rootIds !== 'all' && !principal.rootIds.has(rootId)) return false
    const sessionId = typeof event.data.sessionId === 'string' ? event.data.sessionId : undefined
    if (sessionId !== undefined) return this.options.chat.isSessionAuthorized(principal, sessionId)
    return rootId !== undefined || principal.kind === 'admin'
  }

  private trimOperations(): void {
    while (this.operations.size > 20) {
      const first = this.operations.keys().next().value as string | undefined
      if (first === undefined) break
      this.operations.delete(first)
    }
  }
}

export function attachEmbeddedRoutes(
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  },
  router: ApiRouter,
  remote: RemoteApiServer,
): () => void {
  const disposers = [
    webServer.register({
      kind: 'prefix',
      path: '/dsh-workspace-api',
      handler: (req, res) => router.handle(req, res, '/dsh-workspace-api'),
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-workspace',
      handler: (req, res) => remote.serveWorkspace(req, res, {
        apiBase: '/dsh-workspace-api/api/v1',
        manageBase: '/dsh-workspace-api/manage',
        scriptUrl: '/dsh-workspace/standalone.js',
      }),
    }),
    webServer.register({
      kind: 'exact',
      path: '/dsh-workspace/standalone.js',
      handler: (req, res) => remote.serveStandaloneScript(req, res),
    }),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function publicOperation(operation: OperationState): RemoteOperationView {
  return {
    id: operation.id,
    state: operation.state,
    targetHost: operation.targetHost,
    targetPort: operation.targetPort,
    ...(operation.code === undefined ? {} : { code: operation.code }),
    ...(operation.message === undefined ? {} : { message: operation.message }),
    ...(operation.pairingCode === undefined ? {} : { pairingCode: operation.pairingCode }),
    ...(operation.pairingExpiresAt === undefined ? {} : { pairingExpiresAt: operation.pairingExpiresAt }),
  }
}

function listenerErrorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'EADDRINUSE') return 'LISTENER_ADDRESS_IN_USE'
  if (code === 'EADDRNOTAVAIL' || code === 'ENODEV') return 'LISTENER_ADDRESS_UNAVAILABLE'
  if (code === 'EACCES') return 'LISTENER_PERMISSION_DENIED'
  return 'LISTENER_CHANGE_FAILED'
}

function readStoredHost(database: WorkspaceDatabase, fallback: string): string {
  const stored = database.getSetting('listener_host')
  if (stored === undefined) return fallback
  try {
    return normalizeListenerHost(stored)
  } catch {
    database.setSetting('listener_host', fallback)
    return fallback
  }
}

function readStoredPort(database: WorkspaceDatabase, fallback: number): number {
  const stored = database.getSetting('listener_port')
  if (stored === undefined) return fallback
  try {
    return normalizeListenerPort(Number(stored), fallback === 0)
  } catch {
    database.setSetting('listener_port', String(fallback))
    return fallback
  }
}

function parseProtocolToken(value: string | string[] | undefined): string | undefined {
  const joined = Array.isArray(value) ? value.join(',') : value
  if (joined === undefined) return undefined
  const protocol = joined.split(',').map(item => item.trim()).find(item => item.startsWith('bearer.'))
  return protocol?.slice('bearer.'.length)
}

function failResponse(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : undefined)
    return
  }
  const body = Buffer.from(JSON.stringify({
    error: { code: 'INTERNAL_ERROR', message: 'An internal server error occurred.', requestId: randomUUID() },
  }))
  res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Length': body.length })
  res.end(body)
}

async function readFirst(paths: string[], encoding?: BufferEncoding): Promise<Buffer | string> {
  let lastError: unknown
  for (const candidate of paths) {
    try {
      return encoding === undefined ? await readFile(candidate) : await readFile(candidate, encoding)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
