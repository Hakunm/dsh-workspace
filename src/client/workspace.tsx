import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  RefreshCw,
  Save,
  Search,
  Settings,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceScope, DeviceView, FileEntryView, RootView } from '../shared/contracts.ts'
import { DEVICE_SCOPES } from '../shared/contracts.ts'
import { PLUGIN_VERSION } from '../shared/version.ts'
import { WorkspaceApi, WorkspaceApiError } from './api.ts'
import {
  canPickDesktopDirectory,
  copyTextToClipboard,
  defaultRootLabel,
  pickDesktopDirectory,
  saveClientFile,
} from './desktop.ts'
import { CodeEditor } from './editor.tsx'
import { LanguageToggle, type MessageKey, type Translate, useWorkspaceI18n } from './i18n.tsx'
import { installWorkspaceStyles } from './styles.ts'

interface OpenFile {
  path: string
  revision: number
  etag: string
  text: string
  savedText: string
  bom: boolean
  newline: '\n' | '\r\n'
  binary: boolean
  bytes: Uint8Array
}

interface SelectedEntry {
  path: string
  kind: FileEntryView['kind']
}

interface StatusMessage {
  key: MessageKey
  values?: Record<string, string | number>
}

export function WorkspaceApp(props: {
  api: WorkspaceApi
  compact?: boolean
  onOpenSettings?(): void
}): JSX.Element {
  useEffect(() => installWorkspaceStyles(), [])
  const { t } = useWorkspaceI18n()
  const [roots, setRoots] = useState<RootView[]>([])
  const [rootId, setRootId] = useState('')
  const [currentDirectory, setCurrentDirectory] = useState('')
  const [selected, setSelected] = useState<SelectedEntry>()
  const [openFile, setOpenFile] = useState<OpenFile>()
  const [status, setStatus] = useState<StatusMessage>({ key: 'ready' })
  const [error, setError] = useState<unknown>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [command, setCommand] = useState<'file' | 'directory' | 'rename'>()
  const [commandValue, setCommandValue] = useState('')
  const [pendingTrashPath, setPendingTrashPath] = useState<string>()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileEntryView[]>([])
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<unknown>()
  const loadRevisionRef = useRef(0)
  const uploadRef = useRef<HTMLInputElement>(null)

  const refreshRoots = useCallback(async () => {
    try {
      const next = await props.api.roots()
      setRoots(next)
      setRootId(current => next.some(root => root.id === current) ? current : next[0]?.id ?? '')
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [props.api])

  useEffect(() => { void refreshRoots() }, [refreshRoots])
  useEffect(() => {
    setSelected(undefined)
    setOpenFile(undefined)
    setCurrentDirectory('')
    setPendingTrashPath(undefined)
    setSearchQuery('')
    setSearchResults([])
    setSearchTruncated(false)
    setSearchError(undefined)
    setRefreshKey(value => value + 1)
  }, [rootId])

  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (rootId === '' || trimmed === '') {
      setSearchResults([])
      setSearchTruncated(false)
      setSearching(false)
      setSearchError(undefined)
      return
    }
    let alive = true
    setSearching(true)
    const timer = setTimeout(() => {
      void props.api.searchFiles(rootId, trimmed).then(result => {
        if (!alive) return
        setSearchResults(result.entries)
        setSearchTruncated(result.truncated)
        setSearchError(undefined)
      }, cause => {
        if (!alive) return
        setSearchError(cause)
      }).finally(() => {
        if (alive) setSearching(false)
      })
    }, 220)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [props.api, refreshKey, rootId, searchQuery])

  const openEntry = useCallback(async (entry: FileEntryView) => {
    setSelected({ path: entry.path, kind: entry.kind })
    if (entry.kind === 'directory') {
      setCurrentDirectory(entry.path)
      return
    }
    if (entry.kind !== 'file' || rootId === '') {
      setOpenFile(undefined)
      setStatus({ key: 'metadataOnly' })
      return
    }
    setStatus({ key: 'loadingFile' })
    try {
      const content = await props.api.read(rootId, entry.path)
      const decoded = decodeText(content.bytes)
      loadRevisionRef.current += 1
      setOpenFile({
        path: entry.path,
        revision: loadRevisionRef.current,
        etag: content.etag,
        text: decoded.text,
        savedText: decoded.text,
        bom: decoded.bom,
        newline: decoded.newline,
        binary: decoded.binary,
        bytes: content.bytes,
      })
      setStatus({ key: decoded.binary ? 'binarySize' : 'utf8Size', values: { size: formatBytes(content.bytes.length) } })
      setError(undefined)
    } catch (cause) {
      setError(cause)
      setStatus({ key: 'loadFailed' })
    }
  }, [props.api, rootId])

  const save = useCallback(async () => {
    if (rootId === '' || openFile === undefined || openFile.binary) return
    setStatus({ key: 'saving' })
    try {
      const bytes = encodeText(openFile.text, openFile.bom, openFile.newline)
      const result = await props.api.write(rootId, openFile.path, bytes, openFile.etag)
      setOpenFile(file => file === undefined ? file : { ...file, etag: result.etag, savedText: file.text, bytes })
      setStatus({ key: 'savedSize', values: { size: formatBytes(bytes.length) } })
      setRefreshKey(value => value + 1)
      setError(undefined)
    } catch (cause) {
      setError(cause)
      setStatus({ key: cause instanceof WorkspaceApiError && cause.code === 'ETAG_MISMATCH' ? 'conflict' : 'saveFailed' })
    }
  }, [openFile, props.api, rootId])

  const submitCommand = useCallback(async () => {
    if (rootId === '' || command === undefined || commandValue.trim() === '') return
    const value = commandValue.trim()
    try {
      if (command === 'rename') {
        if (selected === undefined) return
        await props.api.move(rootId, selected.path, joinWire(parentWire(selected.path), value))
      } else {
        await props.api.create(rootId, joinWire(currentDirectory, value), command)
      }
      setCommand(undefined)
      setCommandValue('')
      setSelected(undefined)
      setOpenFile(undefined)
      setRefreshKey(key => key + 1)
      setStatus({ key: command === 'rename' ? 'renamed' : 'created' })
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [command, commandValue, currentDirectory, props.api, rootId, selected])

  const confirmRemove = useCallback(async () => {
    const targetPath = pendingTrashPath
    if (rootId === '' || targetPath === undefined) return
    setPendingTrashPath(undefined)
    try {
      await props.api.trash(rootId, targetPath)
      setSelected(current => current?.path === targetPath ? undefined : current)
      setOpenFile(current => current?.path === targetPath ? undefined : current)
      setRefreshKey(key => key + 1)
      setStatus({ key: 'movedTrash' })
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [pendingTrashPath, props.api, rootId])

  const upload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined || rootId === '') return
    try {
      await props.api.write(rootId, joinWire(currentDirectory, file.name), new Uint8Array(await file.arrayBuffer()))
      setRefreshKey(key => key + 1)
      setStatus({ key: 'uploaded', values: { name: file.name } })
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [currentDirectory, props.api, rootId])

  const download = useCallback(async () => {
    if (rootId === '' || openFile === undefined) return
    try {
      const content = await props.api.read(rootId, openFile.path)
      const fileName = openFile.path.split('/').at(-1) ?? 'download'
      const outcome = await saveClientFile(fileName, content.bytes, content.contentType)
      if (outcome !== 'cancelled') {
        setStatus({ key: 'downloaded', values: { name: fileName } })
      }
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [openFile, props.api, rootId])

  const dirty = openFile !== undefined && !openFile.binary && openFile.text !== openFile.savedText

  return <div className="daw-root">
    <section className="daw-workspace" aria-label={t('workspaceAria')}>
      <header className="daw-toolbar">
        <HardDrive size={16} aria-hidden="true" />
        <select className="daw-select" value={rootId} onChange={event => setRootId(event.target.value)} aria-label={t('authorizedRoot')}>
          {roots.length === 0 && <option value="">{t('noAuthorizedRoots')}</option>}
          {roots.map(root => <option key={root.id} value={root.id}>{root.label}</option>)}
        </select>
        <button className="daw-icon" title={t('newFile')} disabled={rootId === ''} onClick={() => { setCommand('file'); setCommandValue('') }}><FilePlus2 size={16} /></button>
        <button className="daw-icon" title={t('newFolder')} disabled={rootId === ''} onClick={() => { setCommand('directory'); setCommandValue('') }}><FolderPlus size={16} /></button>
        <button className="daw-icon" title={t('upload')} disabled={rootId === ''} onClick={() => uploadRef.current?.click()}><Upload size={16} /></button>
        <input hidden type="file" ref={uploadRef} onChange={event => { void upload(event) }} />
        <button className="daw-icon hide-mobile" title={t('renameMove')} disabled={selected === undefined} onClick={() => { setCommand('rename'); setCommandValue(selected?.path.split('/').at(-1) ?? '') }}><RefreshCw size={15} /></button>
        <button className="daw-icon hide-mobile" title={t('moveTrash')} disabled={selected === undefined} onClick={() => { if (selected !== undefined) setPendingTrashPath(selected.path) }}><Trash2 size={15} /></button>
        <span className="daw-toolbar-spacer" />
        <LanguageToggle />
        <button className="daw-icon" title={t('refresh')} onClick={() => { setRefreshKey(key => key + 1); void refreshRoots() }}><RefreshCw size={16} /></button>
        {props.onOpenSettings !== undefined && <button className="daw-icon" title={t('workspaceSettings')} onClick={props.onOpenSettings}><Settings size={16} /></button>}
      </header>
      <div className="daw-body">
        <aside className="daw-tree" aria-label={t('fileTree')}>
          {rootId !== '' && <div className="daw-tree-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              placeholder={t('searchFiles')}
              aria-label={t('searchFiles')}
              onChange={event => setSearchQuery(event.target.value)}
            />
            {searchQuery !== '' && <button type="button" className="daw-icon" title={t('clearSearch')} onClick={() => setSearchQuery('')}><X size={13} /></button>}
          </div>}
          <div className="daw-tree-scroll">
            {rootId === ''
              ? <div className="daw-empty">{t('addRootHint')}</div>
              : searchQuery.trim() !== ''
                ? <>
                    {searching && <div className="daw-list-meta">{t('searching')}</div>}
                    {searchError !== undefined && <div className="daw-list-meta">{messageOf(searchError, t)}</div>}
                    {!searching && searchError === undefined && searchResults.length === 0 && <div className="daw-list-meta">{t('noSearchResults')}</div>}
                    {searchResults.map(entry => <button
                      key={entry.path}
                      className={`daw-search-row${selected?.path === entry.path ? ' selected' : ''}`}
                      onClick={() => { void openEntry(entry) }}
                    >
                      {entry.kind === 'directory' ? <Folder size={15} /> : <File size={15} />}
                      <span className="daw-search-meta">
                        <span className="daw-search-name">{entry.name}</span>
                        <span className="daw-search-path">{entry.path}</span>
                      </span>
                    </button>)}
                    {searchTruncated && <div className="daw-list-meta" style={{ paddingTop: 6 }}>{t('searchTruncated', { count: searchResults.length })}</div>}
                  </>
                : <DirectoryNode
                    api={props.api}
                    rootId={rootId}
                    path=""
                    label={roots.find(root => root.id === rootId)?.label ?? t('root')}
                    depth={0}
                    refreshKey={refreshKey}
                    {...(selected?.path === undefined ? {} : { selectedPath: selected.path })}
                    onEntry={entry => { void openEntry(entry) }}
                    onDirectory={path => setCurrentDirectory(path)}
                  />}
          </div>
        </aside>
        <main className="daw-editor-pane">
          <div className="daw-filebar">
            <span className="daw-filepath">{openFile?.path ?? (currentDirectory || t('selectFile'))}</span>
            <span className="daw-toolbar-spacer" />
            <button className="daw-icon" title={t('download')} disabled={openFile === undefined} onClick={() => { void download() }}><Download size={15} /></button>
            <button className="daw-command primary" title={`${t('save')} (Ctrl/Cmd+S)`} disabled={!dirty} onClick={() => { void save() }}><Save size={15} /> {t('save')}</button>
          </div>
          {openFile === undefined
            ? <div className="daw-empty">{t('chooseFile')}</div>
            : openFile.binary
              ? <div className="daw-binary"><div><strong>{t('binaryFile')}</strong><br />{t('binaryDisabled')}</div></div>
              : <CodeEditor
                  key={`${openFile.path}:${openFile.revision}`}
                  path={openFile.path}
                  value={openFile.text}
                  onChange={text => setOpenFile(file => file === undefined ? file : { ...file, text })}
                  onSave={() => { void save() }}
                />}
          <div className={`daw-status${error === undefined ? '' : ' error'}`}>{error === undefined ? t(status.key, status.values) : messageOf(error, t)}{dirty ? ` · ${t('unsavedChanges')}` : ''}</div>
        </main>
      </div>
    </section>
    {command !== undefined && <CommandDialog
      title={command === 'rename' ? t('renameEntry') : command === 'file' ? t('newFile') : t('newFolder')}
      value={commandValue}
      onChange={setCommandValue}
      onCancel={() => setCommand(undefined)}
      onSubmit={() => { void submitCommand() }}
    />}
    {pendingTrashPath !== undefined && <ConfirmDialog
      title={t('moveToTrashConfirmTitle')}
      message={t('trashConfirm', { path: pendingTrashPath })}
      confirmLabel={t('moveTrash')}
      danger
      onCancel={() => setPendingTrashPath(undefined)}
      onConfirm={() => { void confirmRemove() }}
    />}
  </div>
}

function DirectoryNode(props: {
  api: WorkspaceApi
  rootId: string
  path: string
  label: string
  depth: number
  refreshKey: number
  selectedPath?: string
  onEntry(entry: FileEntryView): void
  onDirectory(path: string): void
}): JSX.Element {
  const { t } = useWorkspaceI18n()
  const [expanded, setExpanded] = useState(props.depth === 0)
  const [entries, setEntries] = useState<FileEntryView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>()

  useEffect(() => {
    if (!expanded) return
    let alive = true
    setLoading(true)
    void props.api.list(props.rootId, props.path).then(page => {
      if (alive) setEntries(page.entries)
      if (alive) setError(undefined)
    }, cause => { if (alive) setError(cause) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [expanded, props.api, props.path, props.refreshKey, props.rootId, t])

  return <div>
    <button className={`daw-tree-row${props.selectedPath === props.path ? ' selected' : ''}`} onClick={() => {
      setExpanded(value => !value)
      props.onDirectory(props.path)
    }}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
      <span>{props.label}</span>
    </button>
    {expanded && <div className="daw-tree-children">
      {loading && <div className="daw-list-meta">{t('loading')}</div>}
      {error !== undefined && <div className="daw-list-meta">{messageOf(error, t)}</div>}
      {entries.map(entry => entry.kind === 'directory'
        ? <DirectoryNode
            key={entry.path}
            {...props}
            path={entry.path}
            label={entry.name}
            depth={props.depth + 1}
          />
        : <button
            key={entry.path}
            className={`daw-tree-row${props.selectedPath === entry.path ? ' selected' : ''}`}
            onClick={() => props.onEntry(entry)}
          >
            <span />
            <File size={15} />
            <span>{entry.name}</span>
          </button>)}
    </div>}
  </div>
}

function CommandDialog(props: {
  title: string
  value: string
  onChange(value: string): void
  onCancel(): void
  onSubmit(): void
}): JSX.Element {
  const { t } = useWorkspaceI18n()
  useEscapeKey(props.onCancel)
  return <div className="daw-overlay" data-daw-nested-dialog="true" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onCancel() }}>
    <form className="daw-modal-small" role="dialog" aria-modal="true" aria-label={props.title} onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
      <h3>{props.title}</h3>
      <input autoFocus className="daw-input" style={{ width: '100%' }} value={props.value} onChange={event => props.onChange(event.target.value)} />
      <div className="daw-modal-actions">
        <button type="button" className="daw-command" onClick={props.onCancel}>{t('cancel')}</button>
        <button type="submit" className="daw-command primary">{t('apply')}</button>
      </div>
    </form>
  </div>
}

function ConfirmDialog(props: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onCancel(): void
  onConfirm(): void
}): JSX.Element {
  const { t } = useWorkspaceI18n()
  useEscapeKey(props.onCancel)
  return <div className="daw-overlay" data-daw-nested-dialog="true" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onCancel() }}>
    <div className="daw-modal-small" role="alertdialog" aria-modal="true" aria-label={props.title}>
      <h3>{props.title}</h3>
      <p className="daw-confirm-body">{props.message}</p>
      <div className="daw-modal-actions">
        <button type="button" autoFocus className="daw-command" onClick={props.onCancel}>{t('cancel')}</button>
        <button type="button" className={`daw-command ${props.danger === true ? 'danger-solid' : 'primary'}`} onClick={props.onConfirm}>{props.confirmLabel}</button>
      </div>
    </div>
  </div>
}

export function AdminOverlay(props: { api: WorkspaceApi; open: boolean; onClose(): void }): JSX.Element | null {
  const { locale, t } = useWorkspaceI18n()
  const [tab, setTab] = useState<'roots' | 'remote' | 'devices' | 'trash' | 'audit'>('roots')
  const [status, setStatus] = useState<Awaited<ReturnType<WorkspaceApi['status']>>>()
  const [trash, setTrash] = useState<Awaited<ReturnType<WorkspaceApi['trashItems']>>['items']>([])
  const [audit, setAudit] = useState<Record<string, unknown>[]>([])
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [listenerHost, setListenerHost] = useState('0.0.0.0')
  const [listenerPort, setListenerPort] = useState('3090')
  const [pairing, setPairing] = useState<{ code: string; expiresAt?: number }>()
  const [copiedCode, setCopiedCode] = useState(false)
  const [pendingPurgeId, setPendingPurgeId] = useState<string>()
  const [error, setError] = useState<unknown>()
  const desktopPickerAvailable = canPickDesktopDirectory()

  const refresh = useCallback(async () => {
    try {
      const next = await props.api.status()
      setStatus(next)
      if (tab === 'trash') setTrash((await props.api.trashItems()).items)
      if (tab === 'audit') setAudit((await props.api.audit()).items)
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }, [props.api, tab])

  useEffect(() => { if (props.open) void refresh() }, [props.open, refresh])
  useEffect(() => {
    if (status === undefined) return
    setListenerHost(status.configuredHost)
    setListenerPort(String(status.configuredPort))
  }, [status?.configuredHost, status?.configuredPort])
  useEffect(() => {
    setCopiedCode(false)
  }, [pairing?.code])
  useEscapeKey(props.onClose, props.open && pendingPurgeId === undefined)

  if (!props.open) return null
  const roots = status?.roots ?? []
  const parsedListenerPort = Number(listenerPort)
  const listenerPortValid = Number.isInteger(parsedListenerPort) && parsedListenerPort >= 1 && parsedListenerPort <= 65535
  const listenerDirty = status !== undefined && (
    listenerHost.trim() !== status.configuredHost || parsedListenerPort !== status.configuredPort
  )
  const poll = async (id: string): Promise<void> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(300)
      const next = await props.api.operation(id)
      setStatus(next)
      const operation = next.operation
      if (operation?.state === 'succeeded') {
        if (operation.pairingCode !== undefined) setPairing({
          code: operation.pairingCode,
          ...(operation.pairingExpiresAt === undefined ? {} : { expiresAt: operation.pairingExpiresAt }),
        })
        return
      }
      if (operation?.state === 'failed') throw new Error(listenerOperationError(operation.code, operation.message, t))
    }
    throw new Error(t('listenerTimedOut'))
  }

  const browseRootDirectory = async (): Promise<void> => {
    try {
      const picked = await pickDesktopDirectory()
      if (picked === null || picked.trim() === '') return
      setPath(picked)
      setLabel(current => current.trim() === '' ? defaultRootLabel(picked) : current)
      setError(undefined)
    } catch (cause) {
      setError(cause)
    }
  }

  const copyPairing = async (code: string): Promise<void> => {
    if (await copyTextToClipboard(code)) {
      setCopiedCode(true)
    }
  }

  return <div className="daw-root daw-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section className="daw-dialog" role="dialog" aria-modal="true" aria-label={t('workspaceSettings')}>
      <header className="daw-dialog-head"><h2>{t('workspaceSettings')}</h2><span className="daw-version" title={t('version')}>v{PLUGIN_VERSION}</span><span className="daw-toolbar-spacer" /><a href="https://github.com/Hakunm" target="_blank" rel="noreferrer" style={{ color: 'var(--daw-muted)', fontSize: 12, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('author')}</a><LanguageToggle /><button className="daw-icon" title={t('close')} onClick={props.onClose}><X size={17} /></button></header>
      <div className="daw-dialog-body">
        <nav className="daw-tabs">
          {(['roots', 'remote', 'devices', 'trash', 'audit'] as const).map(name => <button key={name} className={`daw-tab${tab === name ? ' active' : ''}`} onClick={() => setTab(name)}>{tabIcon(name)} {t(`${name}Tab`)}</button>)}
        </nav>
        <main className="daw-admin">
          {error !== undefined && <div className="daw-warning">{messageOf(error, t)}</div>}
          {tab === 'roots' && <>
            <h3>{t('authorizedRoots')}</h3>
            <div className={`daw-form-row${desktopPickerAvailable ? ' with-picker' : ''}`}>
              <input className="daw-input" placeholder={t('absolutePath')} value={path} onChange={event => setPath(event.target.value)} />
              {desktopPickerAvailable && <button type="button" className="daw-command" onClick={() => { void browseRootDirectory() }}><FolderOpen size={15} /> {t('browseDirectory')}</button>}
              <input className="daw-input" placeholder={t('displayLabel')} value={label} onChange={event => setLabel(event.target.value)} />
              <button className="daw-command primary" onClick={() => { void props.api.addRoot(path, label || undefined).then(() => { setPath(''); setLabel(''); return refresh() }).catch(setError) }}>{t('addRoot')}</button>
            </div>
            <div className="daw-list">{roots.map(root => <div className="daw-list-row" key={root.id}><div><div className="daw-list-title">{root.label}</div><div className="daw-list-meta">{root.realPath}</div></div><button className="daw-icon danger" title={t('removeRoot')} onClick={() => { void props.api.removeRoot(root.id).then(refresh).catch(setError) }}><Trash2 size={15} /></button></div>)}</div>
          </>}
          {tab === 'remote' && <>
            <h3>{t('remoteAccess')}</h3>
            <div className="daw-warning">{t('httpWarning')}</div>
            {status?.fallbackCode === 'LISTENER_ADDRESS_IN_USE' && <div className="daw-warning">{t('listenerPortFallbackHint', { configuredPort: status.configuredPort, actualPort: status.port })}</div>}
            {roots.length === 0 && <div className="daw-warning">{t('addRootBeforeRemote')}</div>}
            <div className="daw-listener-form">
              <label className="daw-field"><span>{t('bindIp')}</span><input className="daw-input" value={listenerHost} disabled={status?.remoteEnabled} spellCheck={false} placeholder="0.0.0.0" onChange={event => setListenerHost(event.target.value)} /></label>
              <label className="daw-field"><span>{t('bindPort')}</span><input className="daw-input" type="number" min={1} max={65535} inputMode="numeric" value={listenerPort} disabled={status?.remoteEnabled} onChange={event => setListenerPort(event.target.value)} /></label>
              <button className="daw-command" disabled={status?.remoteEnabled || listenerHost.trim() === '' || !listenerPortValid || !listenerDirty} onClick={() => {
                void props.api.configureListener(listenerHost.trim(), parsedListenerPort)
                  .then(result => poll(result.id)).then(refresh).catch(setError)
              }}>{t('saveListener')}</button>
            </div>
            <div className="daw-listener-status">
              <span><strong>{t('configuredListener')}:</strong> {formatEndpoint(status?.configuredHost ?? listenerHost, status?.configuredPort ?? parsedListenerPort)}</span>
              <span><strong>{t('actualListener')}:</strong> {formatEndpoint(status?.host ?? '127.0.0.1', status?.port ?? parsedListenerPort)}</span>
            </div>
            {status?.remoteEnabled && <div className="daw-list-meta daw-listener-hint">{t('disableToEditListener')}</div>}
            {!status?.remoteEnabled && listenerDirty && <div className="daw-list-meta daw-listener-hint">{t('saveBeforeEnable')}</div>}
            <p><span className={`daw-pill${status?.remoteEnabled ? ' on' : ''}`}>{status?.remoteEnabled ? t('remoteEnabled') : t('loopbackOnly')}</span></p>
            <div className="daw-scope-grid">{DEVICE_SCOPES.map(scope => <label className="daw-check" key={scope}><input type="checkbox" checked readOnly /> {scope}</label>)}</div>
            {status?.remoteEnabled
              ? <button className="daw-command danger" onClick={() => { void props.api.disableRemote().then(result => poll(result.id)).then(refresh).catch(setError) }}>{t('disableRemote')}</button>
              : <button className="daw-command primary" disabled={roots.length === 0 || listenerDirty || !listenerPortValid || listenerHost.trim() === ''} onClick={() => { void props.api.enableRemote(roots.map(root => root.id), [...DEVICE_SCOPES]).then(result => poll(result.id)).catch(setError) }}>{t('enablePairing')}</button>}
            {status?.remoteEnabled && <button className="daw-command daw-inline-command" onClick={() => { void props.api.createPairing(roots.map(root => root.id), [...DEVICE_SCOPES]).then(value => setPairing(value)).catch(setError) }}>{t('newPairingCode')}</button>}
            {pairing !== undefined && <div className="daw-code-wrap">
              <span className="daw-code">{pairing.code}</span>
              <button type="button" className="daw-command" onClick={() => { void copyPairing(pairing.code) }}>
                {copiedCode ? <Check size={15} /> : <Copy size={15} />} {t(copiedCode ? 'copied' : 'copyPairingCode')}
              </button>
            </div>}
          </>}
          {tab === 'devices' && <>
            <h3>{t('pairedDevices')}</h3>
            <div className="daw-list">{(status?.devices ?? []).map(device => <DeviceRow key={device.id} api={props.api} device={device} roots={roots} onChanged={refresh} onError={setError} />)}</div>
          </>}
          {tab === 'trash' && <>
            <h3>{t('pluginTrash')}</h3>
            <div className="daw-list">{trash.map(item => <div className="daw-list-row" key={item.id}><div><div className="daw-list-title">{item.path}</div><div className="daw-list-meta">{item.kind} · {formatBytes(item.size)} · {new Date(item.createdAt).toLocaleString(locale)}</div></div><div><button className="daw-command" onClick={() => { void props.api.restoreTrash(item.id).then(refresh).catch(setError) }}>{t('restore')}</button><button className="daw-icon danger" title={t('deletePermanently')} onClick={() => { setPendingPurgeId(item.id) }}><Trash2 size={15} /></button></div></div>)}</div>
          </>}
          {tab === 'audit' && <>
            <h3>{t('recentAudit')}</h3>
            <div className="daw-list">{audit.map((item, index) => <div className="daw-list-row" key={String(item.id ?? index)}><div><div className="daw-list-title">{String(item.action ?? t('event'))}</div><div className="daw-list-meta">{new Date(Number(item.time ?? 0)).toLocaleString(locale)} · {String(item.actorType ?? '')}:{String(item.actorId ?? '')} · {String(item.relativePath ?? '')}</div></div></div>)}</div>
          </>}
        </main>
      </div>
    </section>
    {pendingPurgeId !== undefined && <ConfirmDialog
      title={t('purgeTrashConfirmTitle')}
      message={t('purgeConfirm')}
      confirmLabel={t('deletePermanently')}
      danger
      onCancel={() => setPendingPurgeId(undefined)}
      onConfirm={() => {
        const targetId = pendingPurgeId
        setPendingPurgeId(undefined)
        void props.api.purgeTrash(targetId).then(refresh).catch(setError)
      }}
    />}
  </div>
}

function DeviceRow(props: {
  api: WorkspaceApi
  device: DeviceView
  roots: (RootView & { realPath: string })[]
  onChanged(): Promise<void>
  onError(error: unknown): void
}): JSX.Element {
  const { t } = useWorkspaceI18n()
  const [editing, setEditing] = useState(false)
  const [scopes, setScopes] = useState<DeviceScope[]>(props.device.scopes)
  const [rootIds, setRootIds] = useState<string[]>(props.device.rootIds)
  const toggle = <T extends string>(list: T[], value: T): T[] => list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  return <div className="daw-list-row">
    <div>
      <div className="daw-list-title">{props.device.name} {props.device.revokedAt !== undefined && <span className="daw-pill">{t('revoked')}</span>}</div>
      <div className="daw-list-meta">{props.device.id} · {props.device.scopes.join(', ')}</div>
      {editing && <>
        <div className="daw-scope-grid">{DEVICE_SCOPES.map(scope => <label className="daw-check" key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => setScopes(current => toggle(current, scope))} />{scope}</label>)}</div>
        <div className="daw-scope-grid">{props.roots.map(root => <label className="daw-check" key={root.id}><input type="checkbox" checked={rootIds.includes(root.id)} onChange={() => setRootIds(current => toggle(current, root.id))} />{root.label}</label>)}</div>
      </>}
    </div>
    {props.device.revokedAt === undefined && <div>
      {editing && <button className="daw-command primary" onClick={() => { void props.api.updateDevice(props.device.id, scopes, rootIds).then(props.onChanged).then(() => setEditing(false)).catch(props.onError) }}>{t('save')}</button>}
      <button className="daw-command" onClick={() => setEditing(value => !value)}>{editing ? t('cancel') : t('permissions')}</button>
      <button className="daw-icon danger" title={t('revokeDevice')} onClick={() => { void props.api.revokeDevice(props.device.id).then(props.onChanged).catch(props.onError) }}><Trash2 size={15} /></button>
    </div>}
  </div>
}

export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const callbackRef = useRef(onEscape)
  callbackRef.current = onEscape
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      callbackRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => { window.removeEventListener('keydown', handleKeyDown, true) }
  }, [enabled])
}

function decodeText(bytes: Uint8Array): { text: string; bom: boolean; newline: '\n' | '\r\n'; binary: boolean } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = bom ? bytes.subarray(3) : bytes
  if (body.includes(0)) return { text: '', bom, newline: '\n', binary: true }
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(body)
    const newline = raw.includes('\r\n') ? '\r\n' : '\n'
    return { text: raw.replaceAll('\r\n', '\n'), bom, newline, binary: false }
  } catch {
    return { text: '', bom, newline: '\n', binary: true }
  }
}

function encodeText(text: string, bom: boolean, newline: '\n' | '\r\n'): Uint8Array {
  const normalized = newline === '\r\n' ? text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n') : text
  const bytes = new TextEncoder().encode(normalized)
  if (!bom) return bytes
  const result = new Uint8Array(bytes.length + 3)
  result.set([0xef, 0xbb, 0xbf])
  result.set(bytes, 3)
  return result
}

function tabIcon(tab: string): JSX.Element {
  if (tab === 'roots') return <HardDrive size={15} />
  if (tab === 'devices') return <Smartphone size={15} />
  if (tab === 'trash') return <Trash2 size={15} />
  if (tab === 'remote') return <Upload size={15} />
  return <File size={15} />
}

function joinWire(parent: string, child: string): string {
  return parent === '' ? child : `${parent}/${child}`
}

function parentWire(value: string): string {
  return value.split('/').slice(0, -1).join('/')
}

function messageOf(cause: unknown, t: Translate): string {
  if (cause instanceof WorkspaceApiError) {
    const translated = apiErrorKey(cause)
    if (translated !== undefined) return t(translated)
  }
  return cause instanceof Error ? cause.message : String(cause)
}

function listenerOperationError(code: string | undefined, fallback: string | undefined, t: Translate): string {
  if (code === 'LISTENER_ADDRESS_IN_USE') return t('listenerAddressInUse')
  if (code === 'LISTENER_ADDRESS_UNAVAILABLE') return t('listenerAddressUnavailable')
  if (code === 'LISTENER_PERMISSION_DENIED') return t('listenerPermissionDenied')
  return fallback ?? t('listenerFailed')
}

function formatEndpoint(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${Number.isFinite(port) ? port : ''}`
}

function apiErrorKey(error: WorkspaceApiError): MessageKey | undefined {
  if (error.status === 401) return 'errorUnauthorized'
  if (error.status === 429) return 'errorRateLimited'
  if (error.code === 'ROOT_NOT_GRANTED' || error.code === 'ROOT_FORBIDDEN') return 'errorRootDenied'
  if (error.code === 'ETAG_MISMATCH') return 'errorEtag'
  if (error.code === 'LISTENER_HOST_INVALID') return 'listenerHostInvalid'
  if (error.code === 'LISTENER_PORT_INVALID') return 'listenerPortInvalid'
  if (error.code === 'REMOTE_ENABLED') return 'disableToEditListener'
  if (error.code.includes('PATH') || error.code.includes('SYMLINK') || error.code.includes('REPARSE')) return 'errorPathInvalid'
  if (error.status === 403) return 'errorForbidden'
  if (error.status === 404) return 'errorNotFound'
  if (error.status === 409) return 'errorConflict'
  return undefined
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
