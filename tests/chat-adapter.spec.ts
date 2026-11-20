import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DevicePrincipal } from '../src/shared/contracts.ts'
import { DshChatAdapter, normalizeDshEvent, redactApprovalText } from '../src/host/chat-adapter.ts'
import { WorkspaceDatabase } from '../src/host/database.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('DSH chat choices', () => {
  it('projects only authorized DSH workspaces and selectable Agent presets', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-chat-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    const workspacePath = path.join(project, 'mobile-workspace')
    const newWorkspacePath = path.join(project, 'new-workspace')
    const hiddenPath = path.join(base, 'hidden-workspace')
    await mkdir(workspacePath, { recursive: true })
    await mkdir(newWorkspacePath)
    await mkdir(hiddenPath)

    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const root = await database.addRoot(project, 'Files only label')
    let createPayload: Record<string, unknown> | undefined
    let workspaceCreatePayload: Record<string, unknown> | undefined
    let modelPayload: Record<string, unknown> | undefined
    let presetPayload: Record<string, unknown> | undefined
    let workspaceRenamePayload: Record<string, unknown> | undefined
    let workspaceDeletePayload: Record<string, unknown> | undefined
    let sessionRenamePayload: Record<string, unknown> | undefined
    let sessionForkPayload: Record<string, unknown> | undefined
    let sessionArchivePayload: Record<string, unknown> | undefined
    const commandLines: string[] = []
    const commandAgent = { id: 'session-visible' }
    const api = fakeApi({
      workspacePath: await realpath(workspacePath),
      hiddenPath: await realpath(hiddenPath),
      createSession: payload => { createPayload = payload },
      createWorkspace: payload => { workspaceCreatePayload = payload },
      selectModel: payload => { modelPayload = payload },
      selectAgentPreset: payload => { presetPayload = payload },
      renameWorkspace: payload => { workspaceRenamePayload = payload },
      deleteWorkspace: payload => { workspaceDeletePayload = payload },
      renameSession: payload => { sessionRenamePayload = payload },
      forkSession: payload => { sessionForkPayload = payload },
      archiveSession: payload => { sessionArchivePayload = payload },
    })
    const adapter = new DshChatAdapter(api as never, database, {
      agents: { get: sessionId => sessionId === 'session-visible' ? commandAgent : undefined },
      commands: {
        list: agent => agent === commandAgent ? [
          { name: 'permission', description: 'Switch permission preset', input: { hint: '<preset>' } },
          { name: 'compact', description: 'Compact session context' },
        ] : [],
        execute: async (_agent, line, attachments, signal) => {
          expect(Array.isArray(attachments)).toBe(true)
          expect(signal).toBeInstanceOf(AbortSignal)
          commandLines.push(line)
          return { commandId: 'command-1', result: { kind: 'success', text: 'preset workspace-write' } }
        },
      },
    })
    const principal: DevicePrincipal = {
      kind: 'device',
      id: 'phone',
      name: 'Phone',
      scopes: new Set(['chat.read', 'chat.write']),
      rootIds: new Set([root.id]),
    }

    try {
      await expect(adapter.listWorkspaces(principal)).resolves.toEqual([expect.objectContaining({
        id: 'workspace-visible',
        title: 'WebUI Workspace',
        rootId: root.id,
        path: 'mobile-workspace',
      })])
      await expect(adapter.listAgentPresets()).resolves.toEqual([
        expect.objectContaining({ id: 'standard', name: 'Coding', isDefault: true, available: true }),
        expect.objectContaining({ id: 'minimal', name: 'Minimal', isDefault: false, available: true }),
        expect.objectContaining({ id: 'broken', name: 'broken', isDefault: false, available: false }),
      ])
      const sessions = await adapter.listSessions(principal)
      expect(sessions).toEqual(expect.arrayContaining([expect.objectContaining({
        id: 'session-visible',
        title: 'Readable session title',
        workspaceId: 'workspace-visible',
        workspaceTitle: 'WebUI Workspace',
        cwd: 'mobile-workspace',
      })]))
      expect(sessions).toHaveLength(2)
      expect(JSON.stringify({ workspaces: await adapter.listWorkspaces(principal), sessions })).not.toContain(base)

      await expect(adapter.createSessionInWorkspace(principal, 'workspace-visible', { agentPreset: 'standard' }))
        .resolves.toEqual({ id: 'created-session', agentPreset: 'standard' })
      expect(createPayload).toEqual({ workspaceId: 'workspace-visible', agentPreset: 'standard' })
      await expect(adapter.createSessionInWorkspace(principal, 'workspace-hidden', {}))
        .rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
      await expect(adapter.createWorkspace(principal, root.id, 'new-workspace')).resolves.toMatchObject({
        id: 'workspace-created',
        rootId: root.id,
        path: 'new-workspace',
      })
      expect(workspaceCreatePayload).toEqual({ path: await realpath(newWorkspacePath) })
      await expect(adapter.createWorkspace(principal, root.id, 'mobile-workspace/missing'))
        .rejects.toMatchObject({ code: 'PATH_NOT_FOUND' })
      await expect(adapter.renameWorkspace(principal, 'workspace-visible', '  Renamed workspace  '))
        .resolves.toMatchObject({ id: 'workspace-visible', title: 'Renamed workspace', rootId: root.id })
      expect(workspaceRenamePayload).toEqual({ workspaceId: 'workspace-visible', title: 'Renamed workspace' })
      await expect(adapter.deleteWorkspace(principal, 'workspace-visible')).resolves.toBeUndefined()
      expect(workspaceDeletePayload).toEqual({ workspaceId: 'workspace-visible' })
      await expect(adapter.renameSession(principal, 'session-visible', '  Renamed session  '))
        .resolves.toEqual({ title: 'Renamed session', seq: 8 })
      expect(sessionRenamePayload).toEqual({ sessionId: 'session-visible', title: 'Renamed session' })
      await expect(adapter.forkSession(principal, 'session-visible', 4)).resolves.toBe('session-forked')
      expect(sessionForkPayload).toEqual({ sessionId: 'session-visible', atSeq: 4 })
      await expect(adapter.archiveSession(principal, 'session-visible')).resolves.toContain('session-visible')
      expect(sessionArchivePayload).toEqual({ sessionId: 'session-visible' })
      await expect(adapter.models(principal, 'session-visible')).resolves.toMatchObject({
        current: { provider: 'deepseek', model: 'deepseek-v3' },
        routable: true,
        groups: [{ id: 'deepseek', models: [{ id: 'deepseek-v3' }] }],
      })
      await expect(adapter.selectModel(principal, 'session-visible', {
        provider: 'deepseek',
        model: 'deepseek-v3',
        reasoningEffort: 'high',
      })).resolves.toEqual({ provider: 'deepseek', model: 'deepseek-v3', reasoningEffort: 'high' })
      expect(modelPayload).toEqual({
        sessionId: 'session-visible',
        provider: 'deepseek',
        model: 'deepseek-v3',
        reasoningEffort: 'high',
      })
      await expect(adapter.listCommands(principal, 'session-visible')).resolves.toEqual([
        { name: 'permission', description: 'Switch permission preset', input: { hint: '<preset>' } },
        { name: 'compact', description: 'Compact session context' },
      ])
      await expect(adapter.executeCommand(principal, 'session-visible', '/permission workspace-write'))
        .resolves.toEqual({ commandId: 'command-1', result: { kind: 'success', text: 'preset workspace-write' } })
      expect(commandLines).toEqual(['/permission workspace-write'])
      await expect(adapter.executeCommand(principal, 'session-visible', '/missing'))
        .rejects.toMatchObject({ status: 404, code: 'COMMAND_NOT_FOUND' })
      await expect(adapter.executeCommand(principal, 'session-visible', 'permission workspace-write'))
        .rejects.toMatchObject({ status: 400, code: 'COMMAND_INVALID' })
      await expect(adapter.isSessionAuthorized(principal, 'session-blank')).resolves.toBe(true)
      await expect(adapter.isSessionAuthorized(principal, 'session-hidden')).resolves.toBe(false)
      await expect(adapter.selectAgentPreset(principal, 'session-blank', 'minimal')).resolves.toBe('minimal')
      expect(presetPayload).toEqual({ sessionId: 'session-blank', agentPreset: 'minimal' })
      await expect(adapter.selectAgentPreset(principal, 'session-visible', 'minimal'))
        .rejects.toMatchObject({ status: 409, code: 'AGENT_PRESET_LOCKED' })
    } finally {
      database.close()
    }
  })

  it('normalizes token chunks and preset switches into stable mobile events', () => {
    expect(normalizeDshEvent({
      rpcId: 'delta-1',
      payload: {
        type: 'session/event',
        sessionId: 'session-1',
        event: {
          type: 'assistant/chunk',
          seq: 12,
          data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: '你好' } },
        },
      },
    }, 'mux', 100)).toEqual({
      id: 'delta-1',
      type: 'chat.message.delta',
      time: 100,
      data: {
        sessionId: 'session-1',
        eventType: 'assistant/chunk',
        seq: 12,
        turn: 2,
        step: 1,
        index: 0,
        kind: 'text',
        text: '你好',
      },
    })
    expect(normalizeDshEvent({
      rpcId: 'preset-1',
      payload: {
        type: 'host/remote-event',
        event: 'agent-preset/selected',
        args: ['session-1', 'minimal'],
      },
    }, 'host', 101)).toMatchObject({
      type: 'chat.agent-preset.selected',
      data: { sessionId: 'session-1', agentPreset: 'minimal' },
    })
    expect(normalizeDshEvent({
      rpcId: 'private-rpc-id',
      payload: {
        type: 'approval/requested',
        sessionId: 'session-1',
        approvalId: 'approval-1',
        toolName: 'bash',
        reason: 'danger-full-access',
      },
    }, 'mux', 102)).toEqual({
      id: 'approval-1:requested',
      type: 'chat.approval.requested',
      time: 102,
      data: {
        sessionId: 'session-1',
        approvalId: 'approval-1',
        toolName: 'bash',
        risk: 'full-access',
      },
    })
  })

  it('caches approval requests, redacts command previews, and answers only once', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-approval-'))
    cleanup.push(base)
    const project = path.join(base, 'project')
    await mkdir(project)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const root = await database.addRoot(project, 'Project')
    const responses: unknown[] = []
    const adapter = new DshChatAdapter(approvalApi(await realpath(project), responses) as never, database)
    const principal: DevicePrincipal = {
      kind: 'device',
      id: 'phone',
      name: 'Phone',
      scopes: new Set(['chat.read', 'chat.write']),
      rootIds: new Set([root.id]),
    }
    const abort = new AbortController()
    try {
      adapter.startEvents(abort.signal, () => undefined)
      await new Promise(resolve => setTimeout(resolve, 0))
      await expect(adapter.listSessions(principal)).resolves.toEqual([
        expect.objectContaining({ id: 'session-approval', pendingInteraction: 'approval' }),
      ])

      const approvals = await adapter.listPendingApprovals(principal, 'session-approval')
      expect(approvals).toEqual([expect.objectContaining({
        id: 'approval-1',
        sessionId: 'session-approval',
        toolName: 'bash',
        reason: 'danger-full-access',
        risk: 'full-access',
      })])
      const serialized = JSON.stringify(approvals)
      expect(serialized).toContain('curl')
      expect(serialized).toContain('[REDACTED]')
      expect(serialized).not.toContain('as_sk_extremely_secret_value')
      expect(serialized).not.toContain('plain-secret-value')
      expect(serialized).not.toContain('private-rpc-id')

      await expect(adapter.decideApproval(principal, 'session-approval', 'approval-1', 'rejected'))
        .resolves.toMatchObject({ id: 'approval-1', toolName: 'bash', risk: 'full-access' })
      expect(responses).toEqual([{
        type: 'client-response',
        rpcId: 'private-rpc-id',
        result: {
          ok: true,
          value: { sessionId: 'session-approval', approvalId: 'approval-1', outcome: 'rejected' },
        },
      }])
      await expect(adapter.decideApproval(principal, 'session-approval', 'approval-1', 'rejected'))
        .rejects.toMatchObject({ status: 409, code: 'APPROVAL_NOT_PENDING' })
    } finally {
      abort.abort()
      database.close()
    }
  })

  it('redacts common secret forms and bounds approval text', () => {
    const source = 'TOKEN=plain-secret-value apiKey="json-secret" Bearer bearer-secret https://x.test?a=1&password=url-secret'
    const redacted = redactApprovalText(source, 90)
    expect(redacted).not.toContain('plain-secret-value')
    expect(redacted).not.toContain('json-secret')
    expect(redacted).not.toContain('bearer-secret')
    expect(redacted).not.toContain('url-secret')
    expect(redacted.length).toBeLessThanOrEqual(90)
  })
})

function approvalApi(workspacePath: string, responses: unknown[]) {
  const ok = <T>(value: T) => ({ result: { ok: true as const, value } })
  return {
    respond: async (message: unknown) => {
      responses.push(message)
      return { accepted: true as const }
    },
    sessions: {
      list: async () => ok({ items: [{
        sessionId: 'session-approval',
        updatedAt: 1,
        running: true,
        blank: false,
        cwd: workspacePath,
      }] }),
      history: async () => ok({
        events: [{
          type: 'tool/call',
          data: {
            callId: 'call-1',
            arguments: JSON.stringify({
              command: 'TOKEN=plain-secret-value curl -H "Authorization: Bearer bearer-secret" "https://example.test?api_key=as_sk_extremely_secret_value"',
            }),
          },
        }],
        hasMore: false,
      }),
    },
    workspace: { list: async () => ok({ items: [], archivedSessionIds: [] }) },
    agentPresets: { list: async () => ok({ presets: [], authorable: false, hasDocument: false }) },
    events: {
      mux: async function* () {
        yield {
          rpcId: 'private-rpc-id',
          payload: {
            type: 'approval/requested',
            sessionId: 'session-approval',
            approvalId: 'approval-1',
            toolName: 'bash',
            callId: 'call-1',
            reason: 'danger-full-access',
          },
        }
      },
      host: async function* () {},
    },
  }
}

function fakeApi(options: {
  workspacePath: string
  hiddenPath: string
  createSession: (payload: Record<string, unknown>) => void
  createWorkspace: (payload: Record<string, unknown>) => void
  selectModel: (payload: Record<string, unknown>) => void
  selectAgentPreset: (payload: Record<string, unknown>) => void
  renameWorkspace: (payload: Record<string, unknown>) => void
  deleteWorkspace: (payload: Record<string, unknown>) => void
  renameSession: (payload: Record<string, unknown>) => void
  forkSession: (payload: Record<string, unknown>) => void
  archiveSession: (payload: Record<string, unknown>) => void
}) {
  const ok = <T>(value: T) => ({ result: { ok: true as const, value } })
  const workspaces = [
    {
      workspaceId: 'workspace-visible',
      path: options.workspacePath,
      title: 'WebUI Workspace',
      sessionIds: ['session-visible'],
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
    {
      workspaceId: 'workspace-hidden',
      path: options.hiddenPath,
      title: 'Hidden Workspace',
      sessionIds: ['session-hidden'],
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    },
  ]
  let forkCreated = false
  return {
    sessions: {
      list: async () => ok({ items: [
        {
          sessionId: 'session-visible',
          updatedAt: 1,
          running: false,
          blank: false,
          cwd: options.workspacePath,
          projections: { asOfSeq: 4, values: { title: 'Readable session title' } },
        },
        {
          sessionId: 'session-blank',
          updatedAt: 2,
          running: false,
          blank: true,
          cwd: options.workspacePath,
          agentPreset: 'standard',
        },
        { sessionId: 'session-hidden', updatedAt: 1, running: false, blank: false, cwd: options.hiddenPath },
        ...(forkCreated ? [{ sessionId: 'session-forked', updatedAt: 3, running: false, blank: false, cwd: options.workspacePath }] : []),
        { sessionId: 'session-archived', updatedAt: 1, running: false, blank: false, cwd: options.workspacePath },
      ] }),
      create: async (request: { payload: Record<string, unknown> }) => {
        options.createSession(request.payload)
        return ok({ sessionId: 'created-session', agentPreset: request.payload.agentPreset as string | undefined })
      },
      models: async () => ok({
        current: { provider: 'deepseek', model: 'deepseek-v3' },
        routable: true,
        groups: [{
          id: 'deepseek',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-v3', name: 'DeepSeek V3', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }],
        }],
        failures: [],
      }),
      selectModel: async (request: { payload: Record<string, unknown> }) => {
        options.selectModel(request.payload)
        return ok({ selected: {
          provider: request.payload.provider,
          model: request.payload.model,
          reasoningEffort: request.payload.reasoningEffort,
        } })
      },
      rename: async (request: { payload: Record<string, unknown> }) => {
        options.renameSession(request.payload)
        return ok({ title: request.payload.title as string, seq: 8 })
      },
      fork: async (request: { payload: Record<string, unknown> }) => {
        options.forkSession(request.payload)
        forkCreated = true
        return ok({ sessionId: 'session-forked' })
      },
    },
    workspace: {
      list: async () => ok({ items: workspaces, archivedSessionIds: ['session-archived'] }),
      create: async (request: { payload: { path: string } }) => {
        options.createWorkspace(request.payload)
        return ok({
          created: true,
          workspace: {
            workspaceId: 'workspace-created',
            path: request.payload.path,
            title: 'new-workspace',
            sessionIds: [],
            createdAt: '2026-08-14T01:00:00.000Z',
            updatedAt: '2026-08-14T01:00:00.000Z',
          },
        })
      },
      rename: async (request: { payload: Record<string, unknown> }) => {
        options.renameWorkspace(request.payload)
        return ok({ workspace: { ...workspaces[0], title: request.payload.title as string } })
      },
      delete: async (request: { payload: Record<string, unknown> }) => {
        options.deleteWorkspace(request.payload)
        return ok({ deleted: true as const })
      },
      archiveSession: async (request: { payload: Record<string, unknown> }) => {
        options.archiveSession(request.payload)
        return ok({ archivedSessionIds: [request.payload.sessionId as string] })
      },
    },
    agentPresets: {
      list: async () => ok({
        presets: [
          { id: 'standard', name: 'Coding', description: 'Full coding agent', trust: 'system', isDefault: true },
          { id: 'minimal', name: 'Minimal', trust: 'system', isDefault: false },
          { id: 'broken', trust: 'user', isDefault: false, broken: `Cannot read ${options.hiddenPath}` },
        ],
        authorable: true,
        hasDocument: true,
      }),
      select: async (request: { payload: Record<string, unknown> }) => {
        options.selectAgentPreset(request.payload)
        return ok({ agentPreset: request.payload.agentPreset })
      },
    },
  }
}
