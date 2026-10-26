import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService } from '../src/host/auth.ts'
import { DshChatAdapter } from '../src/host/chat-adapter.ts'
import { WorkspaceDatabase } from '../src/host/database.ts'
import { WorkspaceEventBus } from '../src/host/event-bus.ts'
import { FileService } from '../src/host/file-service.ts'
import { ApiRouter } from '../src/host/router.ts'
import { RemoteApiServer } from '../src/host/server.ts'
import { DshSettingsAdapter } from '../src/host/settings-adapter.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('remote HTTP API', () => {
  it('pairs a device and enforces revocation on the next request', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-http-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    await mkdir(project)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const events = new WorkspaceEventBus()
    const auth = new AuthService(database)
    const files = new FileService(database, event => events.emit(event))
    const chat = new DshChatAdapter(fakeApi() as never, database)
    const settings = new DshSettingsAdapter(fakeApi() as never)
    let router!: ApiRouter
    const remote = new RemoteApiServer({
      port: 0,
      database,
      auth,
      chat,
      events,
      handle: (req, res) => router.handle(req, res),
    })
    router = new ApiRouter({ database, auth, files, chat, settings, remote, maxUploadBytes: 1024 * 1024 })
    try {
      await remote.start()
      const origin = 'http://127.0.0.1:3080'
      let baseUrl = `http://127.0.0.1:${remote.status().port}`
      const health = await fetch(`${baseUrl}/api/v1/healthz`)
      expect(health.status).toBe(200)

      const invalidListener = await fetch(`${baseUrl}/manage/remote/listener`, {
        method: 'PUT',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'all-interfaces', port: 3090 }),
      })
      expect(invalidListener.status).toBe(400)
      await expect(invalidListener.json()).resolves.toMatchObject({ error: { code: 'LISTENER_HOST_INVALID' } })

      const customPort = await availablePort()
      const configure = await fetch(`${baseUrl}/manage/remote/listener`, {
        method: 'PUT',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '0.0.0.0', port: customPort }),
      })
      expect(configure.status).toBe(202)
      expect(configure.headers.get('connection')).toBe('close')
      const configureOperation = await configure.json() as { id: string }
      await waitForOperation(remote, configureOperation.id, 'succeeded')
      expect(remote.status()).toMatchObject({
        host: '127.0.0.1',
        port: customPort,
        configuredHost: '0.0.0.0',
        configuredPort: customPort,
        remoteEnabled: false,
      })
      expect(database.getSetting('listener_host')).toBe('0.0.0.0')
      expect(database.getSetting('listener_port')).toBe(String(customPort))
      baseUrl = `http://127.0.0.1:${customPort}`
      expect((await fetch(`${baseUrl}/api/v1/healthz`)).status).toBe(200)

      const occupied = createServer()
      await listen(occupied, 0)
      try {
        const occupiedPort = (occupied.address() as AddressInfo).port
        const conflict = await fetch(`${baseUrl}/manage/remote/listener`, {
          method: 'PUT',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: '0.0.0.0', port: occupiedPort }),
        })
        const conflictOperation = await conflict.json() as { id: string }
        const failed = await waitForOperation(remote, conflictOperation.id, 'failed')
        expect(failed.operation?.code).toBe('LISTENER_ADDRESS_IN_USE')
        expect(remote.status()).toMatchObject({ host: '127.0.0.1', port: customPort })
        expect((await fetch(`${baseUrl}/api/v1/healthz`)).status).toBe(200)
      } finally {
        await close(occupied)
      }

      const nullOriginAdmin = await fetch(`${baseUrl}/manage/status`, { headers: { Origin: 'null' } })
      expect(nullOriginAdmin.status).toBe(403)

      const forwardedAdmin = await fetch(`${baseUrl}/api/v1/roots`, {
        headers: {
          Origin: 'https://untrusted.example',
          'X-Dsh-Workspace-Admin': '1',
          'X-Forwarded-For': '127.0.0.1',
        },
      })
      expect(forwardedAdmin.status).toBe(401)

      const addRoot = await fetch(`${baseUrl}/manage/roots`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: project, label: 'Project' }),
      })
      expect(addRoot.status).toBe(201)
      const root = await addRoot.json() as { id: string }

      const enableResponse = await fetch(`${baseUrl}/manage/remote/enable`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootIds: [root.id], scopes: ['files.read'] }),
      })
      expect(enableResponse.status).toBe(202)
      expect(enableResponse.headers.get('connection')).toBe('close')
      const enableOperation = await enableResponse.json() as { id: string }
      const enabled = await waitForOperation(remote, enableOperation.id, 'succeeded')
      expect(remote.status()).toMatchObject({ host: '0.0.0.0', port: customPort, remoteEnabled: true })
      const pairing = { code: enabled.operation?.pairingCode as string }

      const configureWhileEnabled = await fetch(`${baseUrl}/manage/remote/listener`, {
        method: 'PUT',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: '127.0.0.1', port: customPort }),
      })
      expect(configureWhileEnabled.status).toBe(409)
      await expect(configureWhileEnabled.json()).resolves.toMatchObject({ error: { code: 'REMOTE_ENABLED' } })

      const exchange = await fetch(`${baseUrl}/api/v1/pairings/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pairing.code, deviceName: 'Test phone' }),
      })
      expect(exchange.status).toBe(201)
      const credentials = await exchange.json() as { token: string; device: { id: string } }
      const roots = await fetch(`${baseUrl}/api/v1/roots`, { headers: { Authorization: `Bearer ${credentials.token}` } })
      expect(roots.status).toBe(200)

      const deniedDelete = await fetch(`${baseUrl}/api/v1/roots/${root.id}/entries?path=missing.txt`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credentials.token}` },
      })
      expect(deniedDelete.status).toBe(403)

      const revoke = await fetch(`${baseUrl}/manage/devices/${credentials.device.id}`, {
        method: 'DELETE',
        headers: { Origin: origin },
      })
      expect(revoke.status).toBe(204)
      const denied = await fetch(`${baseUrl}/api/v1/roots`, { headers: { Authorization: `Bearer ${credentials.token}` } })
      expect(denied.status).toBe(401)
    } finally {
      await remote.stop()
      database.close()
    }
  })

  it('exposes authorized workspace and session management routes', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-chat-management-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    await mkdir(project)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    await database.addRoot(project, 'Project')
    const events = new WorkspaceEventBus()
    const auth = new AuthService(database)
    const files = new FileService(database, event => events.emit(event))
    const calls: { name: string; payload: Record<string, unknown> }[] = []
    const chat = new DshChatAdapter(managementApi(await realpath(project), calls) as never, database)
    const settings = new DshSettingsAdapter({} as never)
    let router!: ApiRouter
    const remote = new RemoteApiServer({
      port: 0,
      database,
      auth,
      chat,
      events,
      handle: (req, res) => router.handle(req, res),
    })
    router = new ApiRouter({ database, auth, files, chat, settings, remote, maxUploadBytes: 1024 * 1024 })
    const headers = { Origin: 'http://127.0.0.1:3080', 'X-Dsh-Workspace-Admin': '1', 'Content-Type': 'application/json' }
    try {
      await remote.start()
      const baseUrl = `http://127.0.0.1:${remote.status().port}/api/v1`
      const health = await (await fetch(`${baseUrl}/healthz`)).json() as { pluginVersion: string }
      expect(health.pluginVersion).toBe('1.1.0')

      expect((await fetch(`${baseUrl}/chat/workspaces/workspace-1`, {
        method: 'PATCH', headers, body: JSON.stringify({ title: 'Renamed workspace' }),
      })).status).toBe(200)
      expect((await fetch(`${baseUrl}/chat/sessions/session-1`, {
        method: 'PATCH', headers, body: JSON.stringify({ title: 'Renamed session' }),
      })).status).toBe(200)
      const fork = await fetch(`${baseUrl}/chat/sessions/session-1/fork`, {
        method: 'POST', headers, body: JSON.stringify({ atSeq: 4 }),
      })
      expect(fork.status).toBe(201)
      await expect(fork.json()).resolves.toEqual({ sessionId: 'session-forked' })
      expect((await fetch(`${baseUrl}/chat/sessions/session-1/archive`, {
        method: 'POST', headers, body: '{}',
      })).status).toBe(200)
      expect((await fetch(`${baseUrl}/chat/workspaces/workspace-1`, { method: 'DELETE', headers })).status).toBe(200)
      expect(calls.map(call => call.name)).toEqual(['workspace.rename', 'session.rename', 'session.fork', 'session.archive', 'workspace.delete'])
    } finally {
      await remote.stop()
      database.close()
    }
  })
})

function managementApi(projectPath: string, calls: { name: string; payload: Record<string, unknown> }[]) {
  const ok = <T>(value: T) => ({ result: { ok: true as const, value } })
  let forked = false
  let archived: string[] = []
  let workspaceTitle = 'Project'
  let workspaceDeleted = false
  const workspace = () => ({
    workspaceId: 'workspace-1', path: projectPath, title: workspaceTitle, sessionIds: ['session-1'],
    createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
  })
  return {
    sessions: {
      list: async () => ok({ items: [
        { sessionId: 'session-1', updatedAt: 1, running: false, blank: false, cwd: projectPath },
        ...(forked ? [{ sessionId: 'session-forked', updatedAt: 2, running: false, blank: false, cwd: projectPath }] : []),
      ] }),
      rename: async (request: { payload: Record<string, unknown> }) => {
        calls.push({ name: 'session.rename', payload: request.payload })
        return ok({ title: request.payload.title as string, seq: 8 })
      },
      fork: async (request: { payload: Record<string, unknown> }) => {
        calls.push({ name: 'session.fork', payload: request.payload })
        forked = true
        return ok({ sessionId: 'session-forked' })
      },
    },
    workspace: {
      list: async () => ok({ items: workspaceDeleted ? [] : [workspace()], archivedSessionIds: archived }),
      rename: async (request: { payload: Record<string, unknown> }) => {
        calls.push({ name: 'workspace.rename', payload: request.payload })
        workspaceTitle = request.payload.title as string
        return ok({ workspace: workspace() })
      },
      delete: async (request: { payload: Record<string, unknown> }) => {
        calls.push({ name: 'workspace.delete', payload: request.payload })
        workspaceDeleted = true
        return ok({ deleted: true as const })
      },
      archiveSession: async (request: { payload: Record<string, unknown> }) => {
        calls.push({ name: 'session.archive', payload: request.payload })
        archived = [request.payload.sessionId as string]
        return ok({ archivedSessionIds: archived })
      },
    },
  }
}

async function waitForOperation(
  remote: RemoteApiServer,
  id: string,
  state: 'succeeded' | 'failed',
): Promise<ReturnType<RemoteApiServer['status']>> {
  for (let index = 0; index < 100; index += 1) {
    const status = remote.status(id)
    if (status.operation?.state === state) return status
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for listener operation ${id}`)
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await listen(server, 0)
  const port = (server.address() as AddressInfo).port
  await close(server)
  return port
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}

function fakeApi() {
  const empty = async function* () { /* no live events in this contract test */ }
  return {
    sessions: {
      list: async (request: { rpcId: string }) => ({ rpcId: request.rpcId, result: { ok: true, value: { items: [] } } }),
    },
    events: { mux: empty, host: empty },
  }
}
