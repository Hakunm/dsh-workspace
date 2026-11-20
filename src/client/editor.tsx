import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'

export function CodeEditor(props: {
  path: string
  value: string
  onChange(value: string): void
  onSave?(): void
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const change = useRef(props.onChange)
  const save = useRef(props.onSave)
  change.current = props.onChange
  save.current = props.onSave

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              save.current?.()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        languageFor(props.path),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current(update.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent })
    return () => { view.destroy() }
  }, [props.path])

  return <div className="daw-editor" ref={host} />
}

function languageFor(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase()
  if (extension === 'json') return json()
  if (extension === 'md' || extension === 'markdown') return markdown()
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension ?? '')) {
    return javascript({ typescript: extension === 'ts' || extension === 'tsx', jsx: extension === 'jsx' || extension === 'tsx' })
  }
  return []
}
