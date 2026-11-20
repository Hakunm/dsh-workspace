import { describe, expect, it } from 'vitest'
import { createHostDshApi, type HostBridgeContext } from '../src/host/dsh-host-bridge.ts'

type EventHandler = (...args: unknown[]) => unknown

function createFakeHostContext() {
  const listeners = new Map<string, { fn: EventHandler; prepend?: boolean }[]>()
  const effects: (() => void)[] = []
  const eventsCalls: Record<string, unknown>[] = []
  const credentialBatches: string[][] = []
  const questionAnswers: { callId: string; answers: unknown[] }[] = []
  const optionalServices = new Map<string, unknown>()

  const on = (event: string, listener: EventHandler, options?: { global?: boolean; prepend?: boolean }) => {
    const list = listeners.get(event) ?? []
    if (options?.prepend) list.unshift({ fn: listener, prepend: true })
    else list.push({ fn: listener })
    listeners.set(event, list)
    return () => {
      const idx = list.findIndex(item => item.fn === listener)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  const emit = (event: string, ...args: unknown[]) => {
    for (const entry of [...(listeners.get(event) ?? [])]) {
      entry.fn(...args)
    }
  }

  const waterfall = async <T>(event: string, ...args: unknown[]): Promise<T | undefined> => {
    const handlers = [...(listeners.get(event) ?? [])]
    const invoke = async (index: number): Promise<T | undefined> => {
      const current = handlers[index]
      if (current === undefined) return undefined
      return await current.fn(...args, () => invoke(index + 1)) as T | undefined
    }
    return invoke(0)
  }

  const sessionObj = {
    id: 'session-1',
    seq: 2,
    eventAt: (seq: number) => seq === 1
      ? { type: 'approval/asked', data: { id: 'appr-1', toolName: 'bash' } }
      : undefined,
  }

  const agentObj = {
    id: 'session-1',
    session: sessionObj,
    model: {
      current: () => ({ provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }),
    },
  }

  const ctx: HostBridgeContext = {
    on,
    effect: (register) => {
      const dispose = register()
      if (typeof dispose === 'function') effects.push(dispose as () => void)
    },
    get: <T>(name: string) => optionalServices.get(name) as T | undefined,
    sessionController: {
      list: async () => ({
        items: [
          { sessionId: 'session-1', cwd: '/work/demo', updatedAt: 100, running: false, blank: false },
          { sessionId: 'sub-1', cwd: '/work/demo', updatedAt: 101, running: false, blank: false, origin: 'subagent' },
        ],
      }),
      create: async () => ({ sessionId: 'session-2', agentPreset: 'default' }),
      events: async (input) => {
        eventsCalls.push(input)
        return {
          records: [{ event: { seq: 1, type: 'user/message', data: { text: 'hi' } } }],
          hasMore: false,
          cursor: 1,
        }
      },
      page: async (input) => {
        eventsCalls.push(input)
        return { records: [], hasMore: false, cursor: 0 }
      },
      projections: async () => ({
        asOfSeq: 1,
        values: {
          permissions: { currentValue: 'workspace-write' },
          modelSelection: {
            lastUsed: { provider: 'openai', model: 'gpt-4.1' },
            next: { provider: 'deepseek', model: 'deepseek-chat' },
          },
        },
      }),
      state: async () => ({ cursor: 1, active: true, running: false, queue: [], pendingInput: [] }),
      updateQueue: async () => ({ accepted: true as const }),
      prompt: async () => ({ accepted: true as const }),
      cancel: () => ({ accepted: true as const }),
      rename: async (input) => ({ title: input.title, seq: 2 }),
      fork: async () => ({ sessionId: 'session-fork' }),
      resolveAgent: async () => ({ agent: agentObj }),
      modelCatalog: async () => ({
        default: { provider: 'deepseek', model: 'deepseek-chat' },
        routableProviders: ['deepseek'],
        groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
        failures: [],
      }),
      selectModel: async (input) => ({
        selected: {
          provider: String(input.provider),
          model: String(input.model),
          ...(typeof input.reasoningEffort === 'string' ? { reasoningEffort: input.reasoningEffort } : {}),
        },
      }),
      search: async (input) => ({
        items: [{ sessionId: 'session-1', snippet: `hit:${input.query}` }],
        hasMore: false,
      }),
    },
    workspaceController: {
      follow: async function* () {
        yield {
          type: 'baseline',
          value: {
            items: [{
              workspaceId: 'ws-1',
              path: '/work/demo',
              title: 'Demo',
              sessionIds: ['session-1'],
              createdAt: '2026-11-20T00:00:00.000Z',
              updatedAt: '2026-11-20T00:00:00.000Z',
            }],
            archivedSessionIds: [],
            pinnedSessionIds: ['session-1'],
          },
        }
      },
      create: async (input) => ({
        workspace: {
          workspaceId: 'ws-2',
          path: input.path,
          title: 'New',
          sessionIds: [],
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
        created: true,
      }),
      rename: async (input) => ({
        workspace: {
          workspaceId: input.workspaceId,
          path: '/work/demo',
          title: input.title,
          sessionIds: ['session-1'],
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        },
      }),
      delete: async () => ({ deleted: true as const }),
      archiveSession: async () => ({ archivedSessionIds: ['session-1'] }),
      unarchiveSession: async () => ({ archivedSessionIds: [] }),
      pinSession: async () => ({ pinnedSessionIds: ['session-1'] }),
      unpinSession: async () => ({ pinnedSessionIds: [] }),
    },
    settingsController: {
      describe: () => ({
        writable: true,
        hasDocument: true,
        namespaces: [],
      }),
      mutate: async (ns) => ({ ns, revision: 1, value: {} }),
    },
    credentialsController: {
      describe: async (refs) => {
        credentialBatches.push([...refs])
        return Object.fromEntries(refs.map(ref => [ref, { configured: true, source: 'store', writable: true }]))
      },
      set: async () => undefined,
      unset: async () => undefined,
    },
    llm: {
      listProviders: () => [
        { id: 'deepseek-account', name: 'DeepSeek Account' },
        { id: 'deepseek', name: 'DeepSeek' },
      ],
      listConfigurableProviders: () => [
        // DSH 0.2.2 omits .active on LlmConfigurableProvider
        { provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm/deepseek', settingsPath: ['apiKey'], defaultBaseURL: 'https://api.deepseek.com' },
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm/openai', settingsPath: ['apiKey'] },
      ],
      discoverModels: async () => [],
    },
    agentPresets: {
      remoteExportList: async () => ({
        presets: [{ id: 'default', isDefault: true, name: 'Default' }],
      }),
      select: async (_agent, agentPreset) => agentPreset,
    },
  }

  optionalServices.set('permissionPresets', {
    catalog: () => ({
      defaultPreset: 'workspace-write',
      options: [
        { value: 'read-only', name: 'Read only' },
        { value: 'workspace-write', name: 'Workspace write' },
      ],
    }),
  })

  optionalServices.set('userQuestions', {
    answer: (_agent: unknown, callId: string, answer: { answers: unknown[] }) => {
      questionAnswers.push({ callId, answers: answer.answers })
      return true
    },
  })

  return {
    ctx,
    emit,
    waterfall,
    eventsCalls,
    credentialBatches,
    questionAnswers,
    dispose: () => {
      for (const fn of effects.reverse()) fn()
    },
  }
}

describe('DSH 0.2.2 host bridge', () => {
  it('omits throughSeq when fetching history and enriches permissions projection with catalog options', async () => {
    const harness = createFakeHostContext()
    try {
      const bridge = createHostDshApi(harness.ctx)
      const res = await bridge.sessions.history({ rpcId: 'r1', payload: { sessionId: 'session-1', maxMessages: 20 } })
      expect(res.result.ok).toBe(true)
      expect(harness.eventsCalls).toHaveLength(1)
      expect(harness.eventsCalls[0]).not.toHaveProperty('throughSeq')
      expect(harness.eventsCalls[0]).toMatchObject({ address: { kind: 'session', sessionId: 'session-1' }, maxMessages: 20 })
      if (res.result.ok) {
        const projections = res.result.value.projections as {
          values: { permissions: { currentValue: string; options: { value: string }[]; defaultPreset: string } }
        }
        expect(projections.values.permissions.currentValue).toBe('workspace-write')
        expect(projections.values.permissions.defaultPreset).toBe('workspace-write')
        expect(projections.values.permissions.options.map(option => option.value)).toEqual(['read-only', 'workspace-write'])
      }
    } finally {
      harness.dispose()
    }
  })

  it('fans out assistant-stream deltas to multiple waiting subscribers without dropping frames', async () => {
    const harness = createFakeHostContext()
    try {
      const bridge = createHostDshApi(harness.ctx)
      const controller = new AbortController()
      const subA = bridge.events.mux({ rpcId: 'sub-a', payload: {} }, controller.signal)[Symbol.asyncIterator]()
      const subB = bridge.events.mux({ rpcId: 'sub-b', payload: {} }, controller.signal)[Symbol.asyncIterator]()

      // Start waiting BEFORE emitting so subscriber.wake is armed (tests the Cursor EventHub drop bug)
      const nextA1 = subA.next()
      const nextB1 = subB.next()
      await Promise.resolve()

      harness.emit('agent/assistant-stream', {
        agent: { id: 'session-1' },
        frame: { type: 'start', attemptId: 'a1', turn: 3, step: 2 },
      })
      harness.emit('agent/assistant-stream', {
        agent: { id: 'session-1' },
        frame: { type: 'chunk', attemptId: 'a1', index: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'think...' } },
      })
      harness.emit('agent/assistant-stream', {
        agent: { id: 'session-1' },
        frame: { type: 'chunk', attemptId: 'a1', index: 1, chunk: { type: 'text-delta', index: 1, text: 'Hello!' } },
      })
      harness.emit('agent/assistant-stream', {
        agent: { id: 'session-1' },
        frame: { type: 'end', attemptId: 'a1' },
      })

      const [a1, b1, a2, b2] = await Promise.all([nextA1, nextB1, subA.next(), subB.next()])
      expect(a1.value?.payload).toMatchObject({
        type: 'session/event',
        sessionId: 'session-1',
        event: {
          type: 'assistant/chunk',
          data: { turn: 3, step: 2, frameIndex: 0, chunk: { type: 'reasoning-delta', text: 'think...' } },
        },
      })
      expect(b1.value?.payload).toEqual(a1.value?.payload)
      expect(a2.value?.payload).toMatchObject({
        type: 'session/event',
        sessionId: 'session-1',
        event: {
          type: 'assistant/chunk',
          data: { turn: 3, step: 2, frameIndex: 1, chunk: { type: 'text-delta', text: 'Hello!' } },
        },
      })
      expect(b2.value?.payload).toEqual(a2.value?.payload)
      controller.abort()
    } finally {
      harness.dispose()
    }
  })

  it('computes provider active state from listProviders(), includes deepseek-account, and batches >64 credential refs', async () => {
    const harness = createFakeHostContext()
    try {
      const bridge = createHostDshApi(harness.ctx)
      const providersRes = await bridge.llm.providers({ rpcId: 'p1', payload: {} })
      expect(providersRes.result.ok).toBe(true)
      if (providersRes.result.ok) {
        const byId = new Map(providersRes.result.value.providers.map(provider => [provider.provider, provider]))
        expect(byId.get('deepseek')?.active).toBe(true)
        expect(byId.get('deepseek')?.defaultBaseURL).toBe('https://api.deepseek.com')
        expect(byId.get('openai')?.active).toBe(false)
        expect(byId.get('deepseek-account')?.active).toBe(true)
        expect(byId.get('deepseek-account')?.settingsNs).toBe('')
      }

      const refs = Array.from({ length: 130 }, (_, index) => `API_KEY_${index}`)
      refs.push('invalid-ref-with-dash', '')
      const credsRes = await bridge.credentials.describe({ rpcId: 'c1', payload: { refs } })
      expect(credsRes.result.ok).toBe(true)
      expect(harness.credentialBatches.map(batch => batch.length)).toEqual([64, 64, 2])
      if (credsRes.result.ok) {
        expect(Object.keys(credsRes.result.value.credentials)).toHaveLength(130)
        expect(credsRes.result.value.credentials).not.toHaveProperty('invalid-ref-with-dash')
      }
    } finally {
      harness.dispose()
    }
  })

  it('reads current session model from live agent and DSH 0.2.2 modelSelection projection', async () => {
    const harness = createFakeHostContext()
    try {
      const bridge = createHostDshApi(harness.ctx)
      const modelsRes = await bridge.sessions.models({ rpcId: 'm1', payload: { sessionId: 'session-1' } })
      expect(modelsRes.result.ok).toBe(true)
      if (modelsRes.result.ok) {
        expect(modelsRes.result.value.current).toEqual({
          provider: 'deepseek',
          model: 'deepseek-reasoner',
          reasoningEffort: 'high',
        })
      }
    } finally {
      harness.dispose()
    }
  })

  it('races approval/request between mobile client and downstream WebUI handler without starving either', async () => {
    const harness = createFakeHostContext()
    try {
      let resolveWebUi: ((decision: unknown) => void) | undefined
      // Register downstream WebUI handler BEFORE bridge (bridge uses prepend: true)
      harness.ctx.on('approval/request', () => new Promise(resolve => { resolveWebUi = resolve }))

      const bridge = createHostDshApi(harness.ctx)
      const controller = new AbortController()
      const stream = bridge.events.mux({ rpcId: 'mux-appr', payload: {} }, controller.signal)[Symbol.asyncIterator]()

      // Case 1: Mobile client wins (start listening before waterfall fires)
      const requestedFramePromise = stream.next()
      await Promise.resolve()
      const mobileWinPromise = harness.waterfall('approval/request', {
        agent: { session: { id: 'session-1', seq: 2, eventAt: () => ({ type: 'approval/asked', data: { id: 'appr-1' } }) } },
        toolName: 'bash',
        reason: 'run command',
        signal: new AbortController().signal,
      })

      const requestedFrame = await requestedFramePromise
      expect(requestedFrame.value?.payload).toMatchObject({
        type: 'approval/requested',
        sessionId: 'session-1',
        approvalId: 'appr-1',
      })
      const responded = await bridge.respond({
        type: 'client-response',
        rpcId: requestedFrame.value?.rpcId as string,
        result: { ok: true, value: { sessionId: 'session-1', approvalId: 'appr-1', outcome: 'allowed-once' } },
      })
      expect(responded).toEqual({ accepted: true })
      await expect(mobileWinPromise).resolves.toBe('allowed-once')
      const mobileResolved = await stream.next()
      expect(mobileResolved.value?.payload).toMatchObject({
        type: 'approval/resolved',
        sessionId: 'session-1',
        approvalId: 'appr-1',
        outcome: 'allowed-once',
      })

      // Case 2: WebUI wins and emits approval/resolved to clear mobile cache
      const webUiWinPromise = harness.waterfall('approval/request', {
        agent: { session: { id: 'session-1', seq: 2, eventAt: () => ({ type: 'approval/asked', data: { id: 'appr-2' } }) } },
        toolName: 'bash',
        reason: 'run command 2',
        signal: new AbortController().signal,
      })
      const secondReq = await stream.next()
      expect(secondReq.value?.payload).toMatchObject({ type: 'approval/requested', approvalId: 'appr-2' })
      resolveWebUi?.('rejected')
      await expect(webUiWinPromise).resolves.toBe('rejected')
      const resolvedFrame = await stream.next()
      expect(resolvedFrame.value?.payload).toMatchObject({
        type: 'approval/resolved',
        sessionId: 'session-1',
        approvalId: 'appr-2',
        outcome: 'rejected',
      })

      controller.abort()
    } finally {
      harness.dispose()
    }
  })

  it('handles user-questions/request waterfall and continued question fallback answers', async () => {
    const harness = createFakeHostContext()
    try {
      const bridge = createHostDshApi(harness.ctx)
      const controller = new AbortController()
      const stream = bridge.events.mux({ rpcId: 'mux-q', payload: {} }, controller.signal)[Symbol.asyncIterator]()

      // Downstream throws NO_PROVIDER when no WebUI tab is listening
      harness.ctx.on('user-questions/request', async () => {
        throw Object.assign(new Error('No answerer'), { code: 'NO_PROVIDER' })
      })

      const framePromise = stream.next()
      await Promise.resolve()
      const questionPromise = harness.waterfall('user-questions/request', {
        agent: { id: 'session-1', session: { id: 'session-1', seq: 1, eventAt: () => undefined } },
        questions: [{ id: 'item-1', question: 'Pick an option', options: [{ label: 'A' }, { label: 'B' }] }],
        wait: { callId: 'q-live-1', timed: false },
        signal: new AbortController().signal,
      })

      const frame = await framePromise
      expect(frame.value?.payload).toMatchObject({
        type: 'question/requested',
        sessionId: 'session-1',
        questionId: 'q-live-1',
      })

      const answerRes = await bridge.respond({
        type: 'client-response',
        rpcId: frame.value?.rpcId as string,
        result: {
          ok: true,
          value: {
            sessionId: 'session-1',
            questionId: 'q-live-1',
            answers: [{ id: 'item-1', selected: ['A'] }],
          },
        },
      })
      expect(answerRes).toEqual({ accepted: true })
      await expect(questionPromise).resolves.toEqual({
        answers: [{ id: 'item-1', selected: ['A'] }],
      })

      // Continued question fallback via ctx.get('userQuestions').answer(...)
      const continued = await bridge.respond({
        type: 'client-response',
        rpcId: 'q-cont-rpc',
        result: {
          ok: true,
          value: {
            sessionId: 'session-1',
            questionId: 'q-continued-1',
            answers: [{ id: 'item-2', selected: ['Yes'] }],
          },
        },
      })
      expect(continued).toEqual({ accepted: true })
      expect(harness.questionAnswers).toEqual([{
        callId: 'q-continued-1',
        answers: [{ id: 'item-2', selected: ['Yes'] }],
      }])

      controller.abort()
    } finally {
      harness.dispose()
    }
  })
})
