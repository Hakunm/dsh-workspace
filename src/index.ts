import path from 'node:path'
import { AuthService } from './host/auth.ts'
import { DshChatAdapter } from './host/chat-adapter.ts'
import { createHostDshApi, type HostDshServices } from './host/dsh-host-bridge.ts'
import { WorkspaceDatabase } from './host/database.ts'
import { WorkspaceEventBus } from './host/event-bus.ts'
import { FileService } from './host/file-service.ts'
import { DEFAULT_REMOTE_HOST, normalizeListenerHost, normalizeListenerPort } from './host/listener-config.ts'
import { ApiRouter } from './host/router.ts'
import { attachEmbeddedRoutes, RemoteApiServer } from './host/server.ts'
import { DshSettingsAdapter } from './host/settings-adapter.ts'
import { PLUGIN_VERSION } from './shared/version.ts'

export const name = 'dsh-workspace'
export const inject = [
  'sessionController',
  'workspaceController',
  'settingsController',
  'credentialsController',
  'llm',
  'agentPresets',
  'webServer',
  'agents',
  'commands',
]

export interface Config {
  dataDir?: string
  port?: number
  remoteHost?: string
  maxUploadBytes?: number
}

interface HostContext extends HostDshServices {
  webServer: Parameters<typeof attachEmbeddedRoutes>[0]
  agents: NonNullable<ConstructorParameters<typeof DshChatAdapter>[2]>['agents']
  commands: NonNullable<ConstructorParameters<typeof DshChatAdapter>[2]>['commands']
  logger: { info(message: string): void; warn(error: Error): void }
  effect(register: () => (() => void | Promise<void>), label?: string): void
  on(event: string, handler: (...args: unknown[]) => unknown, options?: { global?: boolean }): () => void
}

export async function apply(ctx: HostContext, config: Config = {}): Promise<void> {
  const dataDir = path.resolve(config.dataDir ?? path.join(process.cwd(), '.dsh-workspace'))
  const port = normalizeListenerPort(config.port ?? 3090, true)
  const remoteHost = normalizeListenerHost(config.remoteHost ?? DEFAULT_REMOTE_HOST)
  const maxUploadBytes = config.maxUploadBytes ?? 20 * 1024 * 1024
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error('dsh-workspace: maxUploadBytes must be positive')

  const api = createHostDshApi(ctx)
  const database = new WorkspaceDatabase(dataDir)
  const events = new WorkspaceEventBus()
  const auth = new AuthService(database)
  const files = new FileService(database, event => events.emit(event))
  const chat = new DshChatAdapter(api, database, { agents: ctx.agents, commands: ctx.commands })
  const settings = new DshSettingsAdapter(api)
  let router!: ApiRouter
  const remote = new RemoteApiServer({
    port,
    remoteHost,
    database,
    auth,
    chat,
    events,
    handle: (req, res) => router.handle(req, res),
  })
  router = new ApiRouter({ database, auth, files, chat, settings, remote, maxUploadBytes })

  try {
    await remote.start()
  } catch (error) {
    database.close()
    throw error
  }
  const disposeEmbedded = attachEmbeddedRoutes(ctx.webServer, router, remote)
  ctx.effect(() => async () => {
    disposeEmbedded()
    await remote.stop()
    database.close()
  }, 'dsh-workspace lifecycle')
  const status = remote.status()
  ctx.logger.info(`dsh-workspace v${PLUGIN_VERSION}: ${status.host}:${status.port} (${status.remoteEnabled ? 'remote enabled' : 'loopback only'})`)
}

export default apply
