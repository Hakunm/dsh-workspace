import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceDatabase } from '../src/host/database.ts'
import { FileService } from '../src/host/file-service.ts'

const cleanup: string[] = []

afterEach(async () => {
  for (const target of cleanup.splice(0)) await rm(target, { recursive: true, force: true })
})

describe('file service', () => {
  it('creates, saves with ETags, trashes, and restores a file', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-files-'))
    cleanup.push(base)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const events: string[] = []
    const files = new FileService(database, event => events.push(event.type))
    try {
      const root = await database.addRoot(base, 'Temporary')
      await files.createEntry(root, 'hello.txt', 'file')
      const empty = await files.inspectContent(root, 'hello.txt')
      const saved = await files.writeContent(root, 'hello.txt', new TextEncoder().encode('hello'), { ifMatch: empty.etag })
      await expect(files.writeContent(root, 'hello.txt', new TextEncoder().encode('stale'), { ifMatch: empty.etag }))
        .rejects.toMatchObject({ code: 'ETAG_MISMATCH' })
      expect(await readFile(path.join(base, 'hello.txt'), 'utf8')).toBe('hello')
      const trash = await files.trashEntry(root, 'hello.txt')
      expect(files.listTrash().map(item => item.id)).toContain(trash.id)
      await files.restoreTrash(root, trash.id)
      expect(await readFile(path.join(base, 'hello.txt'), 'utf8')).toBe('hello')
      expect(saved.etag).not.toBe(empty.etag)
      expect(events).toEqual(expect.arrayContaining(['file.created', 'file.changed', 'file.trashed', 'file.restored']))
    } finally {
      database.close()
    }
  })

  it('preserves a conflicting restore destination', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-restore-'))
    cleanup.push(base)
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const files = new FileService(database, () => undefined)
    try {
      const root = await database.addRoot(base)
      await writeFile(path.join(base, 'value.txt'), 'old')
      const trash = await files.trashEntry(root, 'value.txt')
      await writeFile(path.join(base, 'value.txt'), 'new')
      await expect(files.restoreTrash(root, trash.id)).rejects.toMatchObject({ code: 'RESTORE_CONFLICT' })
      expect(await readFile(path.join(base, 'value.txt'), 'utf8')).toBe('new')
    } finally {
      database.close()
    }
  })

  it('recursively searches files within root bounds without traversing symlinks', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'daw-search-'))
    cleanup.push(base)
    const rootDir = path.join(base, 'root')
    const outsideDir = path.join(base, 'outside')
    await mkdir(path.join(rootDir, 'src', 'nested'), { recursive: true })
    await mkdir(path.join(rootDir, '.secret'), { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await writeFile(path.join(rootDir, 'src', 'nested', 'Router.ts'), 'export {}')
    await writeFile(path.join(rootDir, 'src', 'router-helper.ts'), 'export {}')
    await writeFile(path.join(rootDir, '.secret', 'router-hidden.ts'), 'export {}')
    await writeFile(path.join(outsideDir, 'router-escape.ts'), 'export {}')
    try {
      await symlink(outsideDir, path.join(rootDir, 'src', 'escape-link'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      // Skip symlink creation if platform policy blocks unprivileged links.
    }
    const database = new WorkspaceDatabase(path.join(base, 'state'))
    const files = new FileService(database, () => undefined)
    try {
      const root = await database.addRoot(rootDir, 'SearchRoot')
      const defaultSearch = await files.search(root, 'router')
      expect(defaultSearch.entries.map(entry => entry.path)).toEqual(['src/router-helper.ts', 'src/nested/Router.ts'])
      expect(defaultSearch.truncated).toBe(false)

      const withHidden = await files.search(root, 'router', { includeHidden: true })
      expect(withHidden.entries.map(entry => entry.path)).toContain('.secret/router-hidden.ts')
      expect(withHidden.entries.map(entry => entry.path)).not.toContain('src/escape-link/router-escape.ts')

      const limited = await files.search(root, 'router', { limit: 1 })
      expect(limited.entries).toHaveLength(1)
      expect(limited.truncated).toBe(true)
    } finally {
      database.close()
    }
  })
})
