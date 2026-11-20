import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { FileEntryView, WorkspaceEvent } from '../shared/contracts.ts'
import type { StoredRoot, TrashRecord, WorkspaceDatabase } from './database.ts'
import { ApiError } from './errors.ts'
import { parentWirePath, resolveAuthorizedPath, validateRelativePath } from './path-policy.ts'

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

export interface ContentDescriptor {
  absolutePath: string
  size: number
  modifiedAt: number
  etag: string
  contentType: string
}

export interface TrashView {
  id: string
  rootId: string
  path: string
  kind: string
  size: number
  createdAt: number
  status: string
}

type EventSink = (event: WorkspaceEvent) => void

export class FileService {
  constructor(private readonly database: WorkspaceDatabase, private readonly emit: EventSink) {}

  async list(root: StoredRoot, relativePath: string, limit = 200, cursor?: string): Promise<DirectoryPage> {
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath)
    const directory = await stat(resolved.absolutePath)
    if (!directory.isDirectory()) throw new ApiError(400, 'PATH_NOT_DIRECTORY', 'The requested path is not a directory.')
    const names = await readdir(resolved.absolutePath)
    names.sort((left, right) => left.localeCompare(right))
    const after = cursor === undefined ? undefined : decodeCursor(cursor)
    const afterIndex = after === undefined ? 0 : names.findIndex(name => name > after)
    const start = after === undefined ? 0 : afterIndex === -1 ? names.length : afterIndex
    const pageSize = Math.min(Math.max(limit, 1), 500)
    const selected = names.slice(start, start + pageSize)
    const entries: FileEntryView[] = []
    for (const name of selected) {
      const absolute = path.join(resolved.absolutePath, name)
      const info = await lstat(absolute)
      const childPath = relativePath === '' ? name : `${relativePath}/${name}`
      entries.push({
        name,
        path: childPath,
        kind: kindOf(info),
        size: info.isFile() ? info.size : 0,
        modifiedAt: info.mtimeMs,
        writable: (info.mode & 0o200) !== 0,
      })
    }
    const last = selected.at(-1)
    return {
      path: relativePath,
      entries,
      ...(start + selected.length < names.length && last !== undefined ? { nextCursor: encodeCursor(last) } : {}),
    }
  }

  async search(
    root: StoredRoot,
    query: string,
    options: { relativePath?: string; limit?: number; includeHidden?: boolean } = {},
  ): Promise<SearchFilesResult> {
    const normalized = query.trim()
    if (normalized === '' || normalized.length > 200 || normalized.includes('\0')) {
      throw new ApiError(400, 'SEARCH_QUERY_INVALID', 'Search query must contain 1 to 200 characters and no null bytes.')
    }
    const baseRelative = options.relativePath ?? ''
    const resolved = await resolveAuthorizedPath(root.realPath, baseRelative)
    const startInfo = await lstat(resolved.absolutePath)
    if (!startInfo.isDirectory() || startInfo.isSymbolicLink()) {
      throw new ApiError(400, 'PATH_NOT_DIRECTORY', 'The requested search path is not a directory.')
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
    const maxVisited = 5_000
    const needle = normalized.toLowerCase()
    const skipDirs = new Set(['.git', 'node_modules', '.gradle', '.idea', '__pycache__'])
    const entries: FileEntryView[] = []
    let visited = 0
    let truncated = false

    const queue: Array<{ absolute: string; relative: string }> = [{ absolute: resolved.absolutePath, relative: baseRelative }]
    while (queue.length > 0 && entries.length < limit) {
      const current = queue.shift() as { absolute: string; relative: string }
      let names: string[]
      try {
        names = await readdir(current.absolute)
      } catch {
        continue
      }
      names.sort((left, right) => left.localeCompare(right))
      for (const name of names) {
        visited += 1
        if (visited > maxVisited) {
          truncated = true
          break
        }
        if (!options.includeHidden && (name.startsWith('.') || skipDirs.has(name))) continue
        const childAbsolute = path.join(current.absolute, name)
        const childRelative = current.relative === '' ? name : `${current.relative}/${name}`
        let info: Awaited<ReturnType<typeof lstat>>
        try {
          info = await lstat(childAbsolute)
        } catch {
          continue
        }
        const kind = kindOf(info)
        if (name.toLowerCase().includes(needle) || childRelative.toLowerCase().includes(needle)) {
          entries.push({
            name,
            path: childRelative,
            kind,
            size: info.isFile() ? info.size : 0,
            modifiedAt: info.mtimeMs,
            writable: (info.mode & 0o200) !== 0,
          })
          if (entries.length >= limit) {
            truncated = true
            break
          }
        }
        // Never traverse through symlinks or junctions during recursive search.
        if (kind === 'directory') {
          queue.push({ absolute: childAbsolute, relative: childRelative })
        }
      }
      if (truncated) break
    }
    return { query: normalized, path: baseRelative, entries, truncated }
  }

  async inspectContent(root: StoredRoot, relativePath: string): Promise<ContentDescriptor> {
    if (relativePath === '') throw new ApiError(400, 'PATH_NOT_FILE', 'The root directory has no file content.')
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath)
    const info = await lstat(resolved.absolutePath)
    if (!info.isFile()) throw new ApiError(400, 'PATH_NOT_FILE', 'Only regular files have readable content.')
    const etag = await fileEtag(resolved.absolutePath)
    return {
      absolutePath: resolved.absolutePath,
      size: info.size,
      modifiedAt: info.mtimeMs,
      etag,
      contentType: contentTypeFor(relativePath),
    }
  }

  streamContent(descriptor: ContentDescriptor, range?: { start: number; end: number }) {
    return createReadStream(descriptor.absolutePath, range)
  }

  async writeContent(
    root: StoredRoot,
    relativePath: string,
    content: Uint8Array,
    conditions: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<{ etag: string; size: number; modifiedAt: number }> {
    if (relativePath === '') throw new ApiError(400, 'PATH_NOT_FILE', 'A root directory cannot be overwritten.')
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath, { allowMissingLeaf: true })
    const parent = await resolveAuthorizedPath(root.realPath, parentWirePath(relativePath))
    const parentInfo = await stat(parent.absolutePath)
    if (!parentInfo.isDirectory()) throw new ApiError(400, 'PATH_NOT_DIRECTORY', 'The destination parent is not a directory.')

    let mode = 0o600
    if (resolved.exists) {
      const info = await lstat(resolved.absolutePath)
      if (!info.isFile()) throw new ApiError(400, 'PATH_NOT_FILE', 'Only regular files can be overwritten.')
      if (conditions.ifNoneMatch === '*') throw new ApiError(412, 'PATH_ALREADY_EXISTS', 'The file already exists.')
      if (conditions.ifMatch === undefined) {
        throw new ApiError(428, 'ETAG_REQUIRED', 'If-Match is required when overwriting a file.')
      }
      const currentEtag = await fileEtag(resolved.absolutePath)
      if (conditions.ifMatch !== currentEtag) {
        throw new ApiError(412, 'ETAG_MISMATCH', 'The file changed after it was read.', { currentEtag })
      }
      mode = info.mode
    } else if (conditions.ifNoneMatch !== '*') {
      throw new ApiError(428, 'CREATE_CONDITION_REQUIRED', 'If-None-Match: * is required when creating file content.')
    }

    const temp = path.join(parent.absolutePath, `.${path.basename(resolved.absolutePath)}.dsh-${randomUUID()}.tmp`)
    try {
      const handle = await open(temp, 'wx', mode)
      try {
        await handle.writeFile(content)
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (resolved.exists) {
        const currentEtag = await fileEtag(resolved.absolutePath)
        if (conditions.ifMatch !== currentEtag) {
          throw new ApiError(412, 'ETAG_MISMATCH', 'The file changed while the replacement was prepared.', { currentEtag })
        }
      }
      await replaceFile(temp, resolved.absolutePath, resolved.exists)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }

    const info = await stat(resolved.absolutePath)
    const etag = await fileEtag(resolved.absolutePath)
    this.notify('file.changed', root.id, relativePath, { etag, size: info.size })
    return { etag, size: info.size, modifiedAt: info.mtimeMs }
  }

  async createEntry(
    root: StoredRoot,
    relativePath: string,
    kind: 'file' | 'directory',
  ): Promise<FileEntryView> {
    if (relativePath === '') throw new ApiError(400, 'PATH_INVALID', 'A root already exists.')
    const resolved = await resolveAuthorizedPath(root.realPath, relativePath, { allowMissingLeaf: true })
    if (resolved.exists) throw new ApiError(409, 'PATH_ALREADY_EXISTS', 'The destination already exists.')
    await resolveAuthorizedPath(root.realPath, parentWirePath(relativePath))
    if (kind === 'directory') await mkdir(resolved.absolutePath)
    else await writeFile(resolved.absolutePath, new Uint8Array(), { flag: 'wx', mode: 0o600 })
    const info = await lstat(resolved.absolutePath)
    const name = validateRelativePath(relativePath).at(-1) as string
    this.notify('file.created', root.id, relativePath, { kind })
    return {
      name,
      path: relativePath,
      kind,
      size: info.isFile() ? info.size : 0,
      modifiedAt: info.mtimeMs,
      writable: (info.mode & 0o200) !== 0,
    }
  }

  async moveEntry(root: StoredRoot, sourcePath: string, destinationPath: string): Promise<void> {
    if (sourcePath === '' || destinationPath === '') throw new ApiError(400, 'PATH_INVALID', 'The root itself cannot be moved.')
    const source = await resolveAuthorizedPath(root.realPath, sourcePath, { allowLeafLink: true })
    const destination = await resolveAuthorizedPath(root.realPath, destinationPath, { allowMissingLeaf: true })
    if (destination.exists) throw new ApiError(409, 'PATH_ALREADY_EXISTS', 'The destination already exists.')
    await resolveAuthorizedPath(root.realPath, parentWirePath(destinationPath))
    if (destination.absolutePath.startsWith(`${source.absolutePath}${path.sep}`)) {
      throw new ApiError(400, 'MOVE_INVALID', 'A directory cannot be moved inside itself.')
    }
    try {
      await rename(source.absolutePath, destination.absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await copyVerified(source.absolutePath, destination.absolutePath)
      await removeEntry(source.absolutePath)
    }
    this.notify('file.moved', root.id, sourcePath, { destinationPath })
  }

  async trashEntry(root: StoredRoot, relativePath: string): Promise<TrashView> {
    if (relativePath === '') throw new ApiError(400, 'PATH_INVALID', 'An authorized root cannot be moved to trash.')
    const source = await resolveAuthorizedPath(root.realPath, relativePath, { allowLeafLink: true })
    const info = await lstat(source.absolutePath)
    const id = randomUUID()
    const itemDir = path.join(this.database.trashDir, root.id, id)
    const staging = path.join(itemDir, 'staging')
    const payload = path.join(itemDir, 'payload')
    await mkdir(itemDir, { recursive: true })
    const digest = await treeDigest(source.absolutePath)
    const record: TrashRecord = {
      id,
      rootId: root.id,
      relativePath,
      payloadPath: payload,
      kind: kindOf(info),
      size: await treeSize(source.absolutePath),
      digest,
      createdAt: Date.now(),
      status: 'moving',
    }
    this.database.insertTrash(record)
    try {
      try {
        await rename(source.absolutePath, payload)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
        await copyEntry(source.absolutePath, staging)
        const copiedDigest = await treeDigest(staging)
        if (copiedDigest !== digest) throw new ApiError(500, 'TRASH_VERIFY_FAILED', 'The cross-volume trash copy failed verification.')
        await rename(staging, payload)
        this.database.updateTrashStatus(id, 'committed')
        await removeEntry(source.absolutePath)
      }
      this.database.updateTrashStatus(id, 'trashed')
    } catch (error) {
      this.database.updateTrashStatus(id, 'failed')
      throw error
    }
    this.notify('file.trashed', root.id, relativePath, { trashId: id })
    return trashView({ ...record, status: 'trashed' })
  }

  listTrash(rootIds?: ReadonlySet<string>): TrashView[] {
    return this.database.listTrash(rootIds).map(trashView)
  }

  async restoreTrash(root: StoredRoot, trashId: string): Promise<void> {
    const record = this.database.getTrash(trashId)
    if (record === undefined || record.rootId !== root.id || record.status === 'restored') {
      throw new ApiError(404, 'TRASH_NOT_FOUND', 'The trash item does not exist for this root.')
    }
    const destination = await resolveAuthorizedPath(root.realPath, record.relativePath, { allowMissingLeaf: true })
    if (destination.exists) throw new ApiError(409, 'RESTORE_CONFLICT', 'The original path is already occupied.')
    await resolveAuthorizedPath(root.realPath, parentWirePath(record.relativePath))
    try {
      await rename(record.payloadPath, destination.absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      await copyVerified(record.payloadPath, destination.absolutePath)
      await removeEntry(record.payloadPath)
    }
    this.database.updateTrashStatus(trashId, 'restored')
    await rm(path.dirname(record.payloadPath), { recursive: true, force: true }).catch(() => undefined)
    this.notify('file.restored', root.id, record.relativePath, { trashId })
  }

  async purgeTrash(trashId: string): Promise<void> {
    const record = this.database.getTrash(trashId)
    if (record === undefined) throw new ApiError(404, 'TRASH_NOT_FOUND', 'The trash item does not exist.')
    await rm(path.dirname(record.payloadPath), { recursive: true, force: true })
    this.database.deleteTrashRecord(trashId)
  }

  private notify(type: string, rootId: string, relativePath: string, extra: Record<string, unknown>): void {
    this.emit({ id: randomUUID(), type, time: Date.now(), data: { rootId, path: relativePath, ...extra } })
  }
}

async function fileEtag(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return `"sha256-${hash.digest('base64url')}"`
}

async function replaceFile(temp: string, destination: string, destinationExists: boolean): Promise<void> {
  try {
    await rename(temp, destination)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (!destinationExists || (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES')) throw error
  }

  const backup = `${destination}.dsh-backup-${randomUUID()}`
  await rename(destination, backup)
  try {
    await rename(temp, destination)
    await unlink(backup)
  } catch (error) {
    await rename(backup, destination).catch(() => undefined)
    throw error
  }
}

async function copyVerified(source: string, destination: string): Promise<void> {
  const expected = await treeDigest(source)
  try {
    await copyEntry(source, destination)
    const actual = await treeDigest(destination)
    if (actual !== expected) throw new ApiError(500, 'COPY_VERIFY_FAILED', 'The copied entry failed digest verification.')
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function copyEntry(source: string, destination: string): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), destination, process.platform === 'win32' ? 'junction' : undefined)
    return
  }
  if (info.isDirectory()) {
    await mkdir(destination, { mode: info.mode })
    for (const name of await readdir(source)) await copyEntry(path.join(source, name), path.join(destination, name))
    await chmod(destination, info.mode).catch(() => undefined)
    return
  }
  if (info.isFile()) {
    await copyFile(source, destination)
    await chmod(destination, info.mode).catch(() => undefined)
    return
  }
  throw new ApiError(400, 'FILE_TYPE_UNSUPPORTED', 'This filesystem entry type cannot be copied safely.')
}

async function removeEntry(target: string): Promise<void> {
  const info = await lstat(target)
  if (info.isDirectory() && !info.isSymbolicLink()) await rm(target, { recursive: true })
  else await unlink(target)
}

async function treeDigest(target: string): Promise<string> {
  const hash = createHash('sha256')
  await appendDigest(hash, target, '')
  return hash.digest('hex')
}

async function appendDigest(hash: ReturnType<typeof createHash>, target: string, relative: string): Promise<void> {
  const info = await lstat(target)
  const kind = kindOf(info)
  hash.update(`${kind}\0${relative}\0${info.mode}\0`)
  if (info.isSymbolicLink()) {
    hash.update(await readlink(target))
    return
  }
  if (info.isFile()) {
    await pipeline(createReadStream(target), hash, { end: false })
    return
  }
  if (info.isDirectory()) {
    const names = await readdir(target)
    names.sort()
    for (const name of names) await appendDigest(hash, path.join(target, name), relative === '' ? name : `${relative}/${name}`)
  }
}

async function treeSize(target: string): Promise<number> {
  const info = await lstat(target)
  if (info.isFile()) return info.size
  if (!info.isDirectory() || info.isSymbolicLink()) return 0
  let total = 0
  for (const name of await readdir(target)) total += await treeSize(path.join(target, name))
  return total
}

function kindOf(info: Awaited<ReturnType<typeof lstat>>): FileEntryView['kind'] {
  if (info.isSymbolicLink()) return 'symlink'
  if (info.isDirectory()) return 'directory'
  if (info.isFile()) return 'file'
  return 'other'
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.html', '.xml', '.yml', '.yaml', '.toml', '.ini', '.sh', '.ps1', '.py', '.go', '.rs', '.java', '.kt'].includes(extension)) {
    return extension === '.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
  }
  return 'application/octet-stream'
}

function encodeCursor(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    throw new ApiError(400, 'CURSOR_INVALID', 'The directory cursor is invalid.')
  }
}

function trashView(record: TrashRecord): TrashView {
  return {
    id: record.id,
    rootId: record.rootId,
    path: record.relativePath,
    kind: record.kind,
    size: record.size,
    createdAt: record.createdAt,
    status: record.status,
  }
}
