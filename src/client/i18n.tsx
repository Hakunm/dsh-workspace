import { Languages } from 'lucide-react'
import { useCallback, useSyncExternalStore } from 'react'

export type WorkspaceLocale = 'zh-CN' | 'en'

const STORAGE_KEY = 'dsh-workspace-locale'

const zh = {
  appName: 'DSH 文件工作区',
  files: '文件',
  openWorkspace: '打开文件工作区',
  switchLanguage: '切换到 English',
  workspaceAria: 'DSH 文件工作区',
  authorizedRoot: '授权根目录',
  noAuthorizedRoots: '暂无授权根目录',
  newFile: '新建文件',
  newFolder: '新建文件夹',
  upload: '上传',
  renameMove: '重命名或移动',
  moveTrash: '移入回收站',
  refresh: '刷新',
  workspaceSettings: '工作区设置',
  fileTree: '文件树',
  addRootHint: '请先在工作区设置中添加授权根目录。',
  root: '根目录',
  selectFile: '请选择文件',
  download: '下载',
  save: '保存',
  chooseFile: '请从文件树中选择普通文件。',
  binaryFile: '二进制文件',
  binaryDisabled: '不提供预览，请下载或替换该文件。',
  unsavedChanges: '有未保存的更改',
  ready: '就绪',
  metadataOnly: '链接和特殊文件仅显示元数据',
  loadingFile: '正在加载文件',
  binarySize: '{size} 二进制文件',
  utf8Size: '{size} UTF-8',
  loadFailed: '加载失败',
  saving: '正在保存',
  savedSize: '已保存 {size}',
  conflict: '保存冲突：请重新加载后再保存',
  saveFailed: '保存失败',
  renamed: '已重命名',
  created: '已创建',
  trashConfirm: '确定将“{path}”移入插件回收站吗？',
  movedTrash: '已移入回收站',
  uploaded: '已上传 {name}',
  loading: '正在加载…',
  renameEntry: '重命名条目',
  cancel: '取消',
  apply: '应用',
  close: '关闭',
  rootsTab: '根目录',
  remoteTab: '远程访问',
  devicesTab: '设备',
  trashTab: '回收站',
  auditTab: '审计',
  authorizedRoots: '授权根目录',
  absolutePath: '绝对目录路径',
  displayLabel: '显示名称',
  addRoot: '添加根目录',
  removeRoot: '移除根目录',
  remoteAccess: '远程访问',
  bindIp: '绑定 IP',
  bindPort: '端口',
  saveListener: '保存监听设置',
  actualListener: '当前实际监听',
  configuredListener: '远程绑定目标',
  disableToEditListener: '请先关闭远程访问，再修改绑定 IP 或端口。',
  saveBeforeEnable: '请先保存监听设置，再启用远程访问。',
  addRootBeforeRemote: '至少添加一个授权根目录后，才可以启用远程访问并创建配对码。',
  httpWarning: '支持 HTTP，但设备令牌和内容会以明文传输。在可信局域网以外使用时，建议配置 HTTPS、VPN 或可信隧道。',
  remoteEnabled: '远程访问已启用',
  loopbackOnly: '仅限本机访问',
  disableRemote: '关闭远程访问',
  enablePairing: '启用并创建配对',
  newPairingCode: '新建配对码',
  pairedDevices: '已配对设备',
  pluginTrash: '插件回收站',
  restore: '恢复',
  deletePermanently: '永久删除',
  purgeConfirm: '确定永久删除此回收项吗？此操作无法撤销。',
  recentAudit: '最近的审计事件',
  event: '事件',
  revoked: '已撤销',
  permissions: '权限',
  revokeDevice: '撤销设备',
  listenerFailed: '监听地址切换失败',
  listenerTimedOut: '监听地址切换超时',
  listenerHostInvalid: '请输入有效的 IPv4 或 IPv6 数值地址。',
  listenerPortInvalid: '端口必须是 1 到 65535 之间的整数。',
  listenerAddressInUse: '该 IP 和端口已被占用，请更换后重试。',
  listenerAddressUnavailable: '无法绑定该 IP；请确认它属于本机网络接口。',
  listenerPermissionDenied: '无法使用该端口：它可能被系统策略保留，或当前进程没有监听权限。',
  connectTitle: '连接 DSH 文件工作区',
  connectDescription: '请输入通过一次性配对交换获取的设备令牌。',
  connect: '连接',
  settings: '设置',
  forgetToken: '忘记设备令牌',
  errorUnauthorized: '认证失败，请检查设备令牌。',
  errorForbidden: '当前设备没有执行此操作的权限。',
  errorRootDenied: '当前设备没有访问该根目录的权限。',
  errorPathInvalid: '文件路径无效或超出授权根目录。',
  errorEtag: '文件已被其他程序修改，请重新加载。',
  errorNotFound: '请求的文件或资源不存在。',
  errorConflict: '目标已存在或当前状态发生冲突。',
  errorRateLimited: '请求过于频繁，请稍后重试。',
  author: '作者 Github@Hakunm',
  version: '当前版本',
  searchFiles: '搜索文件名…',
  clearSearch: '清空搜索',
  searching: '正在搜索…',
  noSearchResults: '未找到匹配的文件或目录',
  searchTruncated: '仅显示前 {count} 条匹配结果',
  browseDirectory: '选择目录…',
  confirm: '确认',
  moveToTrashConfirmTitle: '移入回收站',
  purgeTrashConfirmTitle: '永久删除',
  copyPairingCode: '复制配对码',
  copied: '已复制',
  downloaded: '已导出 {name}',
  listenerPortFallbackHint: '默认端口 {configuredPort} 已被本机其他实例占用，当前窗口已自动回退到本机端口 {actualPort}；应用内文件工作区不受影响。如需在本窗口开启远程访问，请更换空闲端口并保存。',
} as const

export type MessageKey = keyof typeof zh
type Messages = Record<MessageKey, string>

const en: Messages = {
  appName: 'DSH Workspace',
  files: 'Files',
  openWorkspace: 'Open file workspace',
  switchLanguage: 'Switch to 中文',
  workspaceAria: 'DSH file workspace',
  authorizedRoot: 'Authorized root',
  noAuthorizedRoots: 'No authorized roots',
  newFile: 'New file',
  newFolder: 'New folder',
  upload: 'Upload',
  renameMove: 'Rename or move',
  moveTrash: 'Move to trash',
  refresh: 'Refresh',
  workspaceSettings: 'Workspace settings',
  fileTree: 'File tree',
  addRootHint: 'Add an authorized root from workspace settings.',
  root: 'Root',
  selectFile: 'Select a file',
  download: 'Download',
  save: 'Save',
  chooseFile: 'Choose a regular file from the tree.',
  binaryFile: 'Binary file',
  binaryDisabled: 'Preview is disabled. Download or replace the file instead.',
  unsavedChanges: 'Unsaved changes',
  ready: 'Ready',
  metadataOnly: 'Links and special files are metadata-only',
  loadingFile: 'Loading file',
  binarySize: '{size} binary file',
  utf8Size: '{size} UTF-8',
  loadFailed: 'Load failed',
  saving: 'Saving',
  savedSize: 'Saved {size}',
  conflict: 'Conflict: reload before saving',
  saveFailed: 'Save failed',
  renamed: 'Renamed',
  created: 'Created',
  trashConfirm: 'Move "{path}" to the plugin trash?',
  movedTrash: 'Moved to trash',
  uploaded: 'Uploaded {name}',
  loading: 'Loading…',
  renameEntry: 'Rename entry',
  cancel: 'Cancel',
  apply: 'Apply',
  close: 'Close',
  rootsTab: 'Roots',
  remoteTab: 'Remote',
  devicesTab: 'Devices',
  trashTab: 'Trash',
  auditTab: 'Audit',
  authorizedRoots: 'Authorized roots',
  absolutePath: 'Absolute directory path',
  displayLabel: 'Display label',
  addRoot: 'Add root',
  removeRoot: 'Remove root',
  remoteAccess: 'Remote access',
  bindIp: 'Bind IP',
  bindPort: 'Port',
  saveListener: 'Save listener',
  actualListener: 'Current listener',
  configuredListener: 'Remote bind target',
  disableToEditListener: 'Disable remote access before changing the bind IP or port.',
  saveBeforeEnable: 'Save the listener settings before enabling remote access.',
  addRootBeforeRemote: 'Add at least one authorized root before enabling remote access or creating a pairing code.',
  httpWarning: 'HTTP is supported, but it sends device tokens and content in clear text. Prefer HTTPS, VPN, or a trusted tunnel outside a trusted LAN.',
  remoteEnabled: 'Remote enabled',
  loopbackOnly: 'Loopback only',
  disableRemote: 'Disable remote access',
  enablePairing: 'Enable and create pairing',
  newPairingCode: 'New pairing code',
  pairedDevices: 'Paired devices',
  pluginTrash: 'Plugin trash',
  restore: 'Restore',
  deletePermanently: 'Delete permanently',
  purgeConfirm: 'Permanently delete this trash item? This cannot be undone.',
  recentAudit: 'Recent audit events',
  event: 'Event',
  revoked: 'Revoked',
  permissions: 'Permissions',
  revokeDevice: 'Revoke device',
  listenerFailed: 'Listener change failed',
  listenerTimedOut: 'Listener change timed out',
  listenerHostInvalid: 'Enter a valid numeric IPv4 or IPv6 address.',
  listenerPortInvalid: 'Port must be an integer between 1 and 65535.',
  listenerAddressInUse: 'That IP and port are already in use. Choose another endpoint.',
  listenerAddressUnavailable: 'The IP cannot be bound. Make sure it belongs to a local network interface.',
  listenerPermissionDenied: 'The port cannot be used. It may be reserved by the system, or this process lacks permission to listen on it.',
  connectTitle: 'Connect to DSH workspace',
  connectDescription: 'Enter the device token returned by the one-time pairing exchange.',
  connect: 'Connect',
  settings: 'Settings',
  forgetToken: 'Forget device token',
  errorUnauthorized: 'Authentication failed. Check the device token.',
  errorForbidden: 'This device is not allowed to perform that operation.',
  errorRootDenied: 'This device is not allowed to access that root.',
  errorPathInvalid: 'The file path is invalid or outside the authorized root.',
  errorEtag: 'The file was modified elsewhere. Reload it before saving.',
  errorNotFound: 'The requested file or resource was not found.',
  errorConflict: 'The target already exists or its state has changed.',
  errorRateLimited: 'Too many requests. Try again shortly.',
  author: 'Author Github@Hakunm',
  version: 'Current version',
  searchFiles: 'Search files…',
  clearSearch: 'Clear search',
  searching: 'Searching…',
  noSearchResults: 'No matching files or folders',
  searchTruncated: 'Showing first {count} matches',
  browseDirectory: 'Browse…',
  confirm: 'Confirm',
  moveToTrashConfirmTitle: 'Move to trash',
  purgeTrashConfirmTitle: 'Delete permanently',
  copyPairingCode: 'Copy code',
  copied: 'Copied',
  downloaded: 'Downloaded {name}',
  listenerPortFallbackHint: 'Port {configuredPort} is already in use by another local instance, so this window fell back to local port {actualPort}; embedded workspace features remain available. Choose a free port and save to enable remote access here.',
}

const dictionaries: Record<WorkspaceLocale, Messages> = { 'zh-CN': zh, en }
const listeners = new Set<() => void>()
let currentLocale = readStoredLocale()

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string

export function getWorkspaceLocale(): WorkspaceLocale {
  return currentLocale
}

export function setWorkspaceLocale(locale: WorkspaceLocale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  try { globalThis.localStorage?.setItem(STORAGE_KEY, locale) } catch { /* Storage can be unavailable in embedded WebViews. */ }
  for (const listener of listeners) listener()
}

export function subscribeWorkspaceLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function translate(locale: WorkspaceLocale, key: MessageKey, values: Record<string, string | number> = {}): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

export function useWorkspaceI18n(): { locale: WorkspaceLocale; t: Translate; toggle(): void } {
  const locale = useSyncExternalStore<WorkspaceLocale>(subscribeWorkspaceLocale, getWorkspaceLocale, () => 'zh-CN')
  const t = useCallback<Translate>((key, values) => translate(locale, key, values), [locale])
  const toggle = useCallback(() => setWorkspaceLocale(locale === 'zh-CN' ? 'en' : 'zh-CN'), [locale])
  return { locale, t, toggle }
}

export function LanguageToggle(): JSX.Element {
  const { t, toggle } = useWorkspaceI18n()
  return <button className="daw-icon" type="button" title={t('switchLanguage')} aria-label={t('switchLanguage')} onClick={toggle}>
    <Languages size={16} />
  </button>
}

function readStoredLocale(): WorkspaceLocale {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}
