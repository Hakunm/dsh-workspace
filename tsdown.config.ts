import { defineConfig } from 'tsdown'

const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

export default defineConfig([
  {
    name: 'dsh-workspace/host',
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    fixedExtension: false,
    clean: false,
  },
  {
    name: 'dsh-workspace/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: clientExternals,
      alwaysBundle: (id: string) => clientExternals.includes(id) ? undefined : true,
      onlyBundle: false,
    },
    outputOptions: {
      entryFileNames: 'client.cjs',
      banner: "window.__ModuleLoader__.load({ id: 'dsh-workspace', factory: (require) => {",
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
  {
    name: 'dsh-workspace/standalone',
    entry: { standalone: 'src/standalone/index.tsx' },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: { alwaysBundle: () => true, onlyBundle: false },
    outputOptions: { entryFileNames: 'standalone.js' },
  },
])
