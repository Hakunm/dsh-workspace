import { LogOut, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceApi } from '../client/api.ts'
import { LanguageToggle, useWorkspaceI18n } from '../client/i18n.tsx'
import { installWorkspaceStyles } from '../client/styles.ts'
import { AdminOverlay, WorkspaceApp } from '../client/workspace.tsx'

const apiBase = meta('dsh-workspace-api')
const manageBase = meta('dsh-workspace-manage')
const TOKEN_KEY = 'dsh-workspace-device-token'

function Standalone(): JSX.Element {
  const { locale, t } = useWorkspaceI18n()
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [draftToken, setDraftToken] = useState(token)
  const [settings, setSettings] = useState(false)
  const [requiresToken, setRequiresToken] = useState(false)
  const api = useMemo(() => new WorkspaceApi(apiBase, manageBase, token || undefined, token === ''), [token])

  useEffect(() => {
    void api.roots().then(() => setRequiresToken(false), () => { if (token === '') setRequiresToken(true) })
  }, [api, token])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('appName')
  }, [locale, t])

  if (requiresToken && token === '') {
    return <div className="daw-root" style={{ minHeight: '100vh', padding: 16 }}>
      <form className="daw-token" onSubmit={(event) => {
        event.preventDefault()
        const value = draftToken.trim()
        if (value === '') return
        localStorage.setItem(TOKEN_KEY, value)
        setToken(value)
        setRequiresToken(false)
      }}>
        <div className="daw-token-head"><h1>{t('connectTitle')}</h1><LanguageToggle /></div>
        <p className="daw-list-meta">{t('connectDescription')}</p>
        <input className="daw-input" type="password" autoComplete="off" style={{ width: '100%' }} value={draftToken} onChange={event => setDraftToken(event.target.value)} />
        <div className="daw-modal-actions"><button className="daw-command primary" type="submit">{t('connect')}</button></div>
      </form>
    </div>
  }

  const localAdmin = token === ''
  return <div className="daw-root" style={{ minHeight: '100vh' }}>
    <div className="daw-toolbar" style={{ borderBottom: '1px solid var(--daw-line)' }}>
      <strong>{t('appName')}</strong><span className="daw-toolbar-spacer" />
      {localAdmin && <button className="daw-icon" title={t('settings')} onClick={() => setSettings(true)}><Settings size={16} /></button>}
      {!localAdmin && <button className="daw-icon" title={t('forgetToken')} onClick={() => { localStorage.removeItem(TOKEN_KEY); setToken(''); setRequiresToken(true) }}><LogOut size={16} /></button>}
    </div>
    <WorkspaceApp api={api} {...(localAdmin ? { onOpenSettings: () => setSettings(true) } : {})} />
    {localAdmin && <AdminOverlay api={api} open={settings} onClose={() => setSettings(false)} />}
  </div>
}

function meta(name: string): string {
  const value = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
  if (value === undefined || value === '') throw new Error(`Missing ${name} metadata`)
  return value
}

installWorkspaceStyles()
const root = document.getElementById('app')
if (root === null) throw new Error('Missing #app')
createRoot(root).render(<Standalone />)
