import { randomUUID } from 'node:crypto'
import type { DshApiProxy, ModelProviderGroupView, RpcResponse } from './chat-adapter.ts'
import { unwrapDsh } from './chat-adapter.ts'
import { ApiError } from './errors.ts'

interface SettingsNamespaceView {
  ns: string
  schema?: unknown
  value: unknown
  base?: unknown
  user?: unknown
  revision: number
}

interface ConfigurableProvider {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
  active: boolean
  declared?: boolean
  defaultBaseURL?: string
  error?: string
}

export interface SettingsApiProxy extends DshApiProxy {
  settings: {
    describe(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{
      writable: boolean
      hasDocument: boolean
      namespaces: SettingsNamespaceView[]
    }>>
    mutate(request: { rpcId: string; payload: {
      ns: string
      ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>
      expectedRevision?: number
    } }): Promise<RpcResponse<SettingsNamespaceView>>
  }
  credentials: {
    describe(request: { rpcId: string; payload: { refs: string[] } }): Promise<RpcResponse<{
      credentials: Record<string, { configured: boolean; source?: string; writable: boolean }>
    }>>
    set(request: { rpcId: string; payload: { ref: string; value: string } }): Promise<RpcResponse<Record<string, never>>>
    unset(request: { rpcId: string; payload: { ref: string } }): Promise<RpcResponse<Record<string, never>>>
  }
  llm: {
    providers(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{ providers: ConfigurableProvider[] }>>
    models(request: { rpcId: string; payload: Record<string, never> }): Promise<RpcResponse<{
      groups: ModelProviderGroupView[]
      failures: { provider: string; message: string }[]
    }>>
    discoverModels(request: { rpcId: string; payload: {
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    } }): Promise<RpcResponse<{ models: ProviderModelView[] }>>
  }
}

export interface ProviderModelView {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

export interface ProviderConfigView {
  baseURL?: string
  api?: string
  displayName?: string
  thinking?: string
  reasoningEffort?: string
  models: ProviderModelView[]
  modelsInherited?: boolean
}

export interface ProviderView {
  id: string
  displayName: string
  active: boolean
  declared?: boolean
  defaultBaseURL?: string
  error?: string
  configurable: boolean
  configured: boolean
  removable: boolean
  credential: { ref: string; configured: boolean; source?: string; writable: boolean }
  config: ProviderConfigView
}

export interface ProviderPatch {
  displayName?: string | null
  baseURL?: string | null
  api?: string | null
  apiKey?: string | null
  thinking?: string | null
  reasoningEffort?: string | null
  models?: ProviderModelView[]
  expectedRevision?: number
}

export interface CustomProviderCreate {
  id: string
  displayName?: string
  baseURL: string
  api: string
  apiKey?: string
  models: ProviderModelView[]
  expectedRevision?: number
}

export interface CustomProviderCapability {
  available: boolean
  protocols: string[]
  revision?: number
}

export class DshSettingsAdapter {
  constructor(private readonly api: SettingsApiProxy) {}

  async listProviders(): Promise<{
    writable: boolean
    revisionByNamespace: Record<string, number>
    customProvider: CustomProviderCapability
    providers: ProviderView[]
  }> {
    const [directoryResponse, settingsResponse, catalogResponse] = await Promise.all([
      this.api.llm.providers({ rpcId: randomUUID(), payload: {} }),
      this.api.settings.describe({ rpcId: randomUUID(), payload: {} }),
      this.api.llm.models({ rpcId: randomUUID(), payload: {} }),
    ])
    const directory = unwrapDsh(directoryResponse)
    const settings = unwrapDsh(settingsResponse)
    const catalog = unwrapDsh(catalogResponse)
    const namespaces = new Map(settings.namespaces.map(item => [item.ns, item]))
    const customNamespace = namespaces.get('llm-pi-ai')
    const protocols = protocolChoices(customNamespace)
    const rows = directory.providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const baseProfile = recordAt(namespace?.base, entry.settingsPath)
      const valueProfile = recordAt(namespace?.value, entry.settingsPath)
      const profile = mergeRecords(baseProfile, valueProfile)
      const userProfile = recordAt(namespace?.user, entry.settingsPath)
      const configurable = entry.settingsNs !== ''
      const configured = configurable && (entry.settingsPath.length === 0 ? namespace !== undefined : profile !== undefined)
      const removable = configurable && entry.settingsPath.length > 0 && userProfile !== undefined
      const ref = configurable && entry.provider !== 'deepseek-account'
        ? (text(profile?.apiKeyEnv) ?? keyRef(entry.provider))
        : ''
      return { entry, namespace, profile, configurable, configured, removable, ref }
    })
    const refs = [...new Set(rows.map(row => row.ref).filter(ref => ref !== ''))]
    const described = refs.length === 0
      ? { credentials: {} }
      : unwrapDsh(await this.api.credentials.describe({ rpcId: randomUUID(), payload: { refs } }))
    return {
      writable: settings.writable,
      revisionByNamespace: Object.fromEntries(settings.namespaces.map(item => [item.ns, item.revision])),
      customProvider: {
        available: customNamespace !== undefined && protocols.length > 0,
        protocols,
        ...(customNamespace === undefined ? {} : { revision: customNamespace.revision }),
      },
      providers: rows.map(({ entry, profile, configurable, configured, removable, ref }) => {
        const credential = ref === ''
          ? { configured: entry.active, writable: false }
          : (described.credentials[ref] ?? { configured: false, writable: false })
        const inheritedModels = catalog.groups.find(group => group.id === entry.provider)?.models
        return {
          id: entry.provider,
          displayName: text(profile?.displayName) ?? entry.displayName,
          active: entry.active,
          ...(entry.declared === undefined ? {} : { declared: entry.declared }),
          ...(entry.defaultBaseURL === undefined ? {} : { defaultBaseURL: entry.defaultBaseURL }),
          ...(entry.error === undefined ? {} : { error: entry.error }),
          configurable,
          configured,
          removable,
          credential: { ref, ...credential },
          config: projectConfig(profile, inheritedModels),
        }
      }),
    }
  }

  async catalog(): Promise<{ groups: ModelProviderGroupView[]; failures: { provider: string; message: string }[] }> {
    return unwrapDsh(await this.api.llm.models({ rpcId: randomUUID(), payload: {} }))
  }

  async updateProvider(providerId: string, patch: ProviderPatch): Promise<void> {
    const context = await this.providerContext(providerId)
    if (!context.writable) throw new ApiError(409, 'SETTINGS_READ_ONLY', 'DSH settings are read-only.')
    if (context.entry.settingsNs === '') throw new ApiError(409, 'PROVIDER_NOT_CONFIGURABLE', 'This provider has no writable settings section.')
    const ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }> = []
    for (const field of ['displayName', 'baseURL', 'api', 'thinking', 'reasoningEffort'] as const) {
      if (!(field in patch)) continue
      const value = patch[field]
      ops.push(value === null || value === ''
        ? { op: 'unset', path: [...context.entry.settingsPath, field] }
        : { op: 'set', path: [...context.entry.settingsPath, field], value })
    }
    if (patch.models !== undefined) {
      validateModels(patch.models)
      ops.push({ op: 'set', path: [...context.entry.settingsPath, 'models'], value: patch.models })
    }
    const ref = text(context.profile?.apiKeyEnv) ?? keyRef(providerId)
    if (context.entry.settingsPath.length > 0 && context.profile === undefined) {
      ops.unshift({ op: 'set', path: [...context.entry.settingsPath, 'apiKeyEnv'], value: ref })
    }
    if (ops.length > 0) {
      unwrapDsh(await this.api.settings.mutate({
        rpcId: randomUUID(),
        payload: {
          ns: context.entry.settingsNs,
          ops,
          ...(patch.expectedRevision === undefined ? {} : { expectedRevision: patch.expectedRevision }),
        },
      }))
    }
    if (patch.apiKey !== undefined) {
      if (patch.apiKey === null || patch.apiKey === '') {
        unwrapDsh(await this.api.credentials.unset({ rpcId: randomUUID(), payload: { ref } }))
      } else {
        unwrapDsh(await this.api.credentials.set({ rpcId: randomUUID(), payload: { ref, value: patch.apiKey } }))
      }
    }
  }

  async createProvider(input: CustomProviderCreate): Promise<void> {
    const id = input.id.trim()
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
      throw new ApiError(400, 'PROVIDER_ID_INVALID', 'Provider ids must use lowercase letters, digits, and single hyphens, starting with a letter.')
    }
    if (input.baseURL.trim() === '') throw new ApiError(400, 'PROVIDER_BASE_URL_REQUIRED', 'baseURL is required.')
    if (input.models.length === 0) throw new ApiError(400, 'PROVIDER_MODELS_REQUIRED', 'At least one model is required.')
    validateModels(input.models)

    const [directoryResponse, settingsResponse] = await Promise.all([
      this.api.llm.providers({ rpcId: randomUUID(), payload: {} }),
      this.api.settings.describe({ rpcId: randomUUID(), payload: {} }),
    ])
    const directory = unwrapDsh(directoryResponse)
    const settings = unwrapDsh(settingsResponse)
    if (!settings.writable) throw new ApiError(409, 'SETTINGS_READ_ONLY', 'DSH settings are read-only.')
    const namespace = settings.namespaces.find(item => item.ns === 'llm-pi-ai')
    if (namespace === undefined) throw new ApiError(409, 'CUSTOM_PROVIDERS_UNAVAILABLE', 'This DSH installation does not expose custom providers.')
    if (directory.providers.some(provider => provider.provider === id)) {
      throw new ApiError(409, 'PROVIDER_EXISTS', 'A provider with this id already exists.')
    }
    const protocols = protocolChoices(namespace)
    if (!protocols.includes(input.api)) {
      throw new ApiError(400, 'PROVIDER_PROTOCOL_INVALID', 'The selected API protocol is not supported by this DSH installation.')
    }

    const key = input.apiKey?.trim() ?? ''
    const ref = keyRef(id)
    const displayName = input.displayName?.trim() ?? ''
    const profile = {
      ...(displayName === '' ? {} : { displayName }),
      ...(key === '' ? {} : { apiKeyEnv: ref }),
      api: input.api,
      baseURL: input.baseURL.trim(),
      models: input.models,
    }
    unwrapDsh(await this.api.settings.mutate({
      rpcId: randomUUID(),
      payload: {
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', id], value: profile }],
        ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
      },
    }))
    if (key !== '') {
      unwrapDsh(await this.api.credentials.set({ rpcId: randomUUID(), payload: { ref, value: key } }))
    }
  }

  async removeProvider(providerId: string, expectedRevision?: number): Promise<void> {
    const context = await this.providerContext(providerId)
    if (!context.writable) throw new ApiError(409, 'SETTINGS_READ_ONLY', 'DSH settings are read-only.')
    if (context.entry.settingsPath.length === 0) {
      throw new ApiError(409, 'PROVIDER_REQUIRED', 'The built-in provider can be reset but not removed.')
    }
    unwrapDsh(await this.api.settings.mutate({
      rpcId: randomUUID(),
      payload: {
        ns: context.entry.settingsNs,
        ops: [{ op: 'unset', path: context.entry.settingsPath }],
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      },
    }))
  }

  async discover(providerId: string, draft: { baseURL?: string; api?: string; apiKey?: string }): Promise<ProviderModelView[]> {
    const context = await this.providerContext(providerId)
    const payload = {
      settingsNs: context.entry.settingsNs,
      provider: providerId,
      ...(draft.baseURL === undefined || draft.baseURL === '' ? {} : { baseURL: draft.baseURL }),
      ...(draft.api === undefined || draft.api === '' ? {} : { api: draft.api }),
      ...(draft.apiKey === undefined || draft.apiKey === '' ? {} : { apiKey: draft.apiKey }),
    }
    return unwrapDsh(await this.api.llm.discoverModels({ rpcId: randomUUID(), payload })).models
  }

  private async providerContext(providerId: string) {
    const [directoryResponse, settingsResponse] = await Promise.all([
      this.api.llm.providers({ rpcId: randomUUID(), payload: {} }),
      this.api.settings.describe({ rpcId: randomUUID(), payload: {} }),
    ])
    const directory = unwrapDsh(directoryResponse)
    const settings = unwrapDsh(settingsResponse)
    const entry = directory.providers.find(item => item.provider === providerId)
    if (entry === undefined) throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'The provider is not available in DSH.')
    const namespace = settings.namespaces.find(item => item.ns === entry.settingsNs)
    return { entry, writable: settings.writable, namespace, profile: recordAt(namespace?.value, entry.settingsPath) }
  }
}

function projectConfig(
  profile: Record<string, unknown> | undefined,
  inheritedModels: ModelProviderGroupView['models'] | undefined,
): ProviderConfigView {
  const baseURL = text(profile?.baseURL)
  const api = text(profile?.api)
  const displayName = text(profile?.displayName)
  const thinking = text(profile?.thinking)
  const reasoningEffort = text(profile?.reasoningEffort)
  const configuredModels = Array.isArray(profile?.models)
    ? profile.models.filter(isRecord).map(model => {
        const name = text(model.name)
        const contextWindow = positiveInteger(model.contextWindow)
        const maxTokens = positiveInteger(model.maxTokens)
        return {
          id: text(model.id) ?? '',
          ...(name === undefined ? {} : { name }),
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(maxTokens === undefined ? {} : { maxTokens }),
        }
      }).filter(model => model.id !== '')
    : []
  const models = configuredModels.length > 0
    ? configuredModels
    : (inheritedModels ?? []).map(model => ({
        id: model.id,
        ...(model.name === '' ? {} : { name: model.name }),
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      }))
  return {
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(api === undefined ? {} : { api }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    models,
    ...(configuredModels.length === 0 && models.length > 0 ? { modelsInherited: true } : {}),
  }
}

function mergeRecords(
  base: Record<string, unknown> | undefined,
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (base === undefined) return value
  if (value === undefined) return base
  return { ...base, ...value }
}

function protocolChoices(namespace: SettingsNamespaceView | undefined): string[] {
  if (!isRecord(namespace?.schema) || !isRecord(namespace.schema.refs)) return []
  const refs = namespace.schema.refs
  const node = (id: unknown): Record<string, unknown> | undefined => refs[String(id)] as Record<string, unknown> | undefined
  const root = node(namespace.schema.uid)
  if (!isRecord(root?.dict)) return []
  const providers = node(root.dict.providers)
  const profile = node(providers?.inner)
  if (!isRecord(profile?.dict)) return []
  const api = node(profile.dict.api)
  if (api?.type !== 'union' || !Array.isArray(api.list)) return []
  return api.list
    .map(item => node(item)?.value)
    .filter((value): value is string => typeof value === 'string')
}

function validateModels(models: ProviderModelView[]): void {
  const ids = new Set<string>()
  for (const model of models) {
    if (!isRecord(model) || typeof model.id !== 'string' || model.id.trim() === '' || ids.has(model.id)) {
      throw new ApiError(400, 'MODEL_CONFIG_INVALID', 'Model ids must be non-empty and unique.')
    }
    ids.add(model.id)
    for (const value of [model.contextWindow, model.maxTokens]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new ApiError(400, 'MODEL_CONFIG_INVALID', 'Model capacities must be positive integers.')
      }
    }
  }
}

function recordAt(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let current = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return isRecord(current) ? current : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}

function keyRef(provider: string): string {
  return provider === 'deepseek-official'
    ? 'DEEPSEEK_API_KEY'
    : `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}
