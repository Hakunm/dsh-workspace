import type { DeviceScope, DeviceView, FileEntryView, RootView } from '../shared/contracts.ts'

export interface DirectoryPage {
  path: string
  entries: FileEntryView[]
  nextCursor?: string
}

export interface SearchFilesResult {
  query: string
  path: string
  entries: FileEntryView[]
  truncated: boolean
}

export interface ContentResult {
  bytes: Uint8Array
  etag: string
  contentType: string
}

export class WorkspaceApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'WorkspaceApiError'
  }
}

export class WorkspaceApi {
  constructor(
    readonly apiBase: string,
    readonly manageBase: string,
    private readonly token?: string,
    private readonly admin = false,
  ) {}

  withToken(token: string | undefined): WorkspaceApi {
    return new WorkspaceApi(this.apiBase, this.manageBase, token, false)
  }

  async roots(): Promise<RootView[]> {
    return (await this.json<{ items: RootView[] }>('/roots')).items
  }

  async list(rootId: string, relativePath: string): Promise<DirectoryPage> {
    return this.json<DirectoryPage>(`/roots/${encodeURIComponent(rootId)}/entries?path=${encodeURIComponent(relativePath)}`)
  }

  async searchFiles(rootId: string, query: string, relativePath = '', limit = 100): Promise<SearchFilesResult> {
    const params = new URLSearchParams({ query, limit: String(limit) })
    if (relativePath !== '') params.set('path', relativePath)
    return this.json<SearchFilesResult>(`/roots/${encodeURIComponent(rootId)}/search?${params.toString()}`)
  }

  async read(rootId: string, relativePath: string): Promise<ContentResult> {
    const response = await this.fetch(`/roots/${encodeURIComponent(rootId)}/content?path=${encodeURIComponent(relativePath)}`)
    await ensureOk(response)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      etag: response.headers.get('etag') ?? '',
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  async write(rootId: string, relativePath: string, bytes: Uint8Array, etag?: string): Promise<{ etag: string }> {
    return this.json(`/roots/${encodeURIComponent(rootId)}/content?path=${encodeURIComponent(relativePath)}`, {
      method: 'PUT',
      headers: etag === undefined ? { 'If-None-Match': '*' } : { 'If-Match': etag },
      body: bytes.slice().buffer as ArrayBuffer,
    })
  }

  async create(rootId: string, relativePath: string, kind: 'file' | 'directory'): Promise<void> {
    await this.json(`/roots/${encodeURIComponent(rootId)}/entries`, { method: 'POST', body: JSON.stringify({ path: relativePath, kind }) })
  }

  async move(rootId: string, relativePath: string, destinationPath: string): Promise<void> {
    await this.json(`/roots/${encodeURIComponent(rootId)}/entries`, {
      method: 'PATCH',
      body: JSON.stringify({ path: relativePath, destinationPath }),
    })
  }

  async trash(rootId: string, relativePath: string): Promise<void> {
    await this.json(`/roots/${encodeURIComponent(rootId)}/entries?path=${encodeURIComponent(relativePath)}`, { method: 'DELETE' })
  }

  downloadUrl(rootId: string, relativePath: string): string {
    return `${this.apiBase}/roots/${encodeURIComponent(rootId)}/content?path=${encodeURIComponent(relativePath)}`
  }

  async status(): Promise<{
    host: string
    port: number
    configuredHost: string
    configuredPort: number
    remoteEnabled: boolean
    fallbackCode?: string
    roots: (RootView & { realPath: string })[]
    devices: DeviceView[]
    operation?: { state: string; code?: string; message?: string; pairingCode?: string; pairingExpiresAt?: number }
  }> {
    return this.manageJson('/status')
  }

  async operation(operationId: string): Promise<Awaited<ReturnType<WorkspaceApi['status']>>> {
    return this.manageJson(`/status?operationId=${encodeURIComponent(operationId)}`)
  }

  async addRoot(path: string, label?: string): Promise<void> {
    await this.manageJson('/roots', { method: 'POST', body: JSON.stringify({ path, label }) })
  }

  async removeRoot(rootId: string): Promise<void> {
    await this.manageJson(`/roots/${encodeURIComponent(rootId)}`, { method: 'DELETE' })
  }

  async enableRemote(rootIds: string[], scopes: DeviceScope[]): Promise<{ id: string }> {
    return this.manageJson('/remote/enable', { method: 'POST', body: JSON.stringify({ rootIds, scopes }) })
  }

  async disableRemote(): Promise<{ id: string }> {
    return this.manageJson('/remote/disable', { method: 'POST' })
  }

  async configureListener(host: string, port: number): Promise<{ id: string }> {
    return this.manageJson('/remote/listener', { method: 'PUT', body: JSON.stringify({ host, port }) })
  }

  async createPairing(rootIds: string[], scopes: DeviceScope[]): Promise<{ code: string; expiresAt: number }> {
    return this.manageJson('/pairings', { method: 'POST', body: JSON.stringify({ rootIds, scopes }) })
  }

  async updateDevice(deviceId: string, scopes: DeviceScope[], rootIds: string[]): Promise<void> {
    await this.manageJson(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ scopes, rootIds }),
    })
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.manageJson(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
  }

  async trashItems(): Promise<{ items: { id: string; rootId: string; path: string; kind: string; size: number; createdAt: number }[] }> {
    return this.json('/trash')
  }

  async restoreTrash(id: string): Promise<void> {
    await this.json(`/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' })
  }

  async purgeTrash(id: string): Promise<void> {
    await this.manageJson(`/trash/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async audit(): Promise<{ items: Record<string, unknown>[] }> {
    return this.manageJson('/audit?limit=200')
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetch(path, init)
    await ensureOk(response)
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  private async manageJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (this.admin) headers.set('X-Dsh-Workspace-Admin', '1')
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const response = await fetch(`${this.manageBase}${path}`, { ...init, headers })
    await ensureOk(response)
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  private fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.token !== undefined) headers.set('Authorization', `Bearer ${this.token}`)
    if (this.admin) headers.set('X-Dsh-Workspace-Admin', '1')
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return fetch(`${this.apiBase}${path}`, { ...init, headers })
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return
  let code = 'HTTP_ERROR'
  let message = `${response.status} ${response.statusText}`
  try {
    const body = await response.json() as { error?: { code?: string; message?: string } }
    code = body.error?.code ?? code
    message = body.error?.message ?? message
  } catch {
    // Preserve the transport status when the server did not return JSON.
  }
  throw new WorkspaceApiError(response.status, code, message)
}
