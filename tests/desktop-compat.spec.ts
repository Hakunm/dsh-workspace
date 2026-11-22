import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultRootLabel } from '../src/client/desktop.ts'
import { AuthService, isLoopbackOrigin } from '../src/host/auth.ts'
import { DshChatAdapter } from '../src/host/chat-adapter.ts'
import { WorkspaceDatabase } from '../src/host/database.ts'
import { WorkspaceEventBus } from '../src/host/event-bus.ts'
import { FileService } from '../src/host/file-service.ts'
import { ApiRouter } from '../src/host/router.ts'
import { RemoteApiServer } from '../src/host/server.ts'
import { DshSettingsAdapter } from '../src/host/settings-adapter.ts'
import { resolveDefaultDataDir } from '../src/index.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('DSH Desktop compatibility', () => {
  it('accepts the DSH Desktop custom protocol origin only from loopback sockets', async () => {
    expect(isLoopbackOrigin(undefined)).toBe(true)
    expect(isLoopbackOrigin('dsh-app://app')).toBe(true)
    expect(isLoopbackOrigin('dsh-app://app/')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:3080')).toBe(true)
    expect(isLoopbackOrigin('https://localhost:8443')).toBe(true)
    expect(isLoopbackOrigin('dsh-app://shell')).toBe(false)
    expect(isLoopbackOrigin('dsh-app://app:3080')).toBe(false)
    expect(isLoopbackOrigin('file:///C:/index.html')).toBe(false)
    expect(isLoopbackOrigin('null')).toBe(false)
    expect(isLoopbackOrigin('https://evil.example')).toBe(false)

    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-desktop-auth-'))
    cleanup.push(base)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    try {
      const auth = new AuthService(database)
      const desktopLoopbackReq = fakeReq('127.0.0.1', { origin: 'dsh-app://app', 'x-dsh-workspace-admin': '1' })
      expect(auth.requireAdmin(desktopLoopbackReq).kind).toBe('admin')
      expect(auth.principal(desktopLoopbackReq, { allowAdmin: true }).kind).toBe('admin')

      const shellOriginReq = fakeReq('127.0.0.1', { origin: 'dsh-app://shell', 'x-dsh-workspace-admin': '1' })
      expect(() => auth.requireAdmin(shellOriginReq)).toThrowError(/local machine/i)

      const remoteDesktopSpoofReq = fakeReq('192.168.1.25', { origin: 'dsh-app://app', 'x-dsh-workspace-admin': '1' })
      expect(() => auth.requireAdmin(remoteDesktopSpoofReq)).toThrowError(/local machine/i)
      expect(() => auth.principal(remoteDesktopSpoofReq, { allowAdmin: true })).toThrowError(/Bearer token/i)
    } finally {
      database.close()
    }
  })

  it('resolves default dataDir inside DSH_HOME instead of process.cwd()', () => {
    const customHome = path.join(os.tmpdir(), 'custom-dsh-home')
    expect(resolveDefaultDataDir({ DSH_HOME: `  ${customHome}  ` })).toBe(path.join(path.resolve(customHome), 'dsh-workspace'))
    expect(resolveDefaultDataDir({})).toBe(path.join(os.homedir(), '.dsh', 'dsh-workspace'))
  })

  it('falls back to an ephemeral loopback port without crashing or clobbering SQLite when port 3090 is already bound', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-desktop-coexist-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    await mkdir(project)
    const stateDir = path.join(base, 'shared-state')

    const occupied = createServer()
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', reject)
      occupied.listen(0, '127.0.0.1', resolve)
    })
    const busyPort = (occupied.address() as AddressInfo).port

    const db1 = new WorkspaceDatabase(stateDir)
    await db1.addRoot(project, 'Shared project')
    db1.setSetting('listener_host', '127.0.0.1')
    db1.setSetting('listener_port', String(busyPort))
    db1.setSetting('remote_enabled', 'true')

    const warnings: string[] = []
    const events = new WorkspaceEventBus()
    const auth = new AuthService(db1)
    const files = new FileService(db1, event => events.emit(event))
    const chat = new DshChatAdapter(emptyApi() as never, db1)
    const settings = new DshSettingsAdapter(emptyApi() as never)
    let router!: ApiRouter
    const remote = new RemoteApiServer({
      port: busyPort,
      database: db1,
      auth,
      chat,
      events,
      handle: (req, res) => router.handle(req, res),
      onFallback: message => warnings.push(message),
    })
    router = new ApiRouter({ database: db1, auth, files, chat, settings, remote, maxUploadBytes: 1024 * 1024 })

    try {
      await remote.start()
      const status = remote.status()
      expect(status.host).toBe('127.0.0.1')
      expect(status.port).not.toBe(busyPort)
      expect(status.port).toBeGreaterThan(0)
      expect(status.configuredPort).toBe(busyPort)
      expect(status.remoteEnabled).toBe(false)
      expect(status.fallbackCode).toBe('LISTENER_ADDRESS_IN_USE')
      expect(warnings).toHaveLength(1)
      // Keep the persisted setting intact so the primary instance owning busyPort does not lose remote_enabled.
      expect(db1.getSetting('remote_enabled')).toBe('true')

      const manageStatus = await fetch(`http://127.0.0.1:${status.port}/manage/status`, {
        headers: { Origin: 'dsh-app://app', 'X-Dsh-Workspace-Admin': '1' },
      })
      expect(manageStatus.status).toBe(200)
      await expect(manageStatus.json()).resolves.toMatchObject({
        fallbackCode: 'LISTENER_ADDRESS_IN_USE',
        configuredPort: busyPort,
        port: status.port,
      })
    } finally {
      await remote.stop()
      db1.close()
      await new Promise<void>(resolve => occupied.close(() => resolve()))
    }
  })

  it('derives readable root labels for Windows and POSIX directory paths and ships valid Desktop plugin metadata', async () => {
    expect(defaultRootLabel('C:\\Users\\nyanya\\Desktop\\github-dsh\\')).toBe('github-dsh')
    expect(defaultRootLabel('C:\\')).toBe('C:\\')
    expect(defaultRootLabel('/Users/nyanya/workspace/app/')).toBe('app')

    const repoRoot = path.resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      icon?: string
      exports?: Record<string, unknown>
      files?: string[]
    }
    expect(manifest.icon).toBe('./assets/icon.svg')
    expect(manifest.exports?.['./icon']).toBe('./assets/icon.svg')
    expect(manifest.exports?.['./locale/*.json']).toBe('./locale/*.json')
    expect(manifest.files).toContain('locale/*.json')

    const enLocale = JSON.parse(await readFile(path.join(repoRoot, 'locale', 'en.json'), 'utf8')) as {
      meta?: { title?: string; description?: string; detail?: string }
    }
    const zhLocale = JSON.parse(await readFile(path.join(repoRoot, 'locale', 'zh.json'), 'utf8')) as {
      meta?: { title?: string; description?: string; detail?: string }
    }
    expect(enLocale.meta?.detail).toBe('README.en.md')
    expect(zhLocale.meta?.detail).toBe('README.md')
    expect((await readFile(path.join(repoRoot, 'assets', 'icon.svg'), 'utf8'))).toContain('<svg')
  })
})

function fakeReq(remoteAddress: string, headers: Record<string, string>): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

function emptyApi() {
  const empty = async function* () { /* unused */ }
  return {
    sessions: {
      list: async (request: { rpcId: string }) => ({ rpcId: request.rpcId, result: { ok: true, value: { items: [] } } }),
    },
    events: { mux: empty, host: empty },
  }
}
