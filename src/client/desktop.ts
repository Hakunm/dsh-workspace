interface DesktopDirectoryPickerBridge {
  pick(): Promise<string | null>
}

interface DesktopFileSaveRequest {
  url: string
  name?: string
  mediaType?: string
  mode: 'download' | 'saveAs'
}

interface DesktopFileSaveResult {
  status: 'saved' | 'cancelled' | 'requested'
  path?: string
}

interface DesktopProductBridge {
  fileActions?: {
    save?(request: DesktopFileSaveRequest): Promise<DesktopFileSaveResult>
  }
}

interface DesktopWindowGlobals {
  __DSH_DIRECTORY_PICKER__?: DesktopDirectoryPickerBridge
  dshDesktop?: DesktopProductBridge
}

function desktopGlobals(): DesktopWindowGlobals {
  return globalThis as unknown as DesktopWindowGlobals
}

export function canPickDesktopDirectory(): boolean {
  return typeof desktopGlobals().__DSH_DIRECTORY_PICKER__?.pick === 'function'
}

export async function pickDesktopDirectory(): Promise<string | null> {
  const picker = desktopGlobals().__DSH_DIRECTORY_PICKER__
  if (typeof picker?.pick !== 'function') return null
  return picker.pick()
}

export function defaultRootLabel(directoryPath: string): string {
  const trimmed = directoryPath.trim().replace(/[\\/]+$/, '')
  if (trimmed === '') return ''
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`
  const segments = trimmed.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? directoryPath.trim()
}

export async function saveClientFile(
  name: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
): Promise<'saved' | 'requested' | 'cancelled'> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType })
  const desktopSave = desktopGlobals().dshDesktop?.fileActions?.save
  if (typeof desktopSave === 'function') {
    const url = URL.createObjectURL(blob)
    try {
      const result = await desktopSave({ url, name, mediaType: contentType, mode: 'saveAs' })
      return result.status === 'cancelled' ? 'cancelled' : 'saved'
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.hidden = true
  document.body?.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
  return 'requested'
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to selection copy when Clipboard API permissions are restricted.
  }
  if (typeof document === 'undefined' || document.body === null) return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:-9999px;top:0'
  document.body.append(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
  }
  return copied
}
