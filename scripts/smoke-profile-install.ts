import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dshDir = path.resolve(process.argv[2] ?? '../deepseek-harness')
const tarball = path.resolve(process.argv[3] ?? '')
if (process.argv[3] === undefined) throw new Error('Usage: tsx scripts/smoke-profile-install.ts <dsh-dir> <plugin.tgz>')

const dshHome = mkdtempSync(path.join(os.tmpdir(), 'daw-profile-smoke-'))
try {
  // 1. Verify installation and config composition in the web profile.
  runDsh(['plugin', '--profile', 'web', 'add', tarball])
  assertProfileInstalled('web')
  const composedWeb = runDsh(['web', '--dump-config'], true)
  if (!composedWeb.includes('name: dsh-workspace')) {
    throw new Error('The composed DSH web profile does not contain the workspace host row.')
  }

  // 2. Initialize the Desktop profile (matching DSH Desktop first-launch bootstrap) and verify installation + metadata + composition.
  const desktopDir = path.join(dshHome, 'profiles', 'desktop')
  mkdirSync(desktopDir, { recursive: true })
  writeFileSync(path.join(desktopDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    },
  }, null, 2) + '\n')
  writeFileSync(
    path.join(desktopDir, 'pnpm-workspace.yaml'),
    'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n',
  )
  runDesktopDsh(['plugin', '--profile', 'desktop', 'add', tarball])
  assertProfileInstalled('desktop')
  verifyDesktopProfileAndMeta()

  console.log('profile-install: tarball installed, bundle activated, metadata verified, and DSH config composed for both web and desktop profiles')
} finally {
  rmSync(dshHome, { recursive: true, force: true })
}

function assertProfileInstalled(profile: 'web' | 'desktop'): void {
  const manifestPath = path.join(dshHome, 'profiles', profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  if (manifest.dependencies?.['dsh-workspace'] === undefined) {
    throw new Error(`The plugin was not recorded as a ${profile} profile dependency.`)
  }
  if (!manifest.dsh?.profile?.bundles?.includes('dsh-workspace')) {
    throw new Error(`The plugin bundle was not activated in the ${profile} profile.`)
  }
}

function runDsh(args: string[], capture = false): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', ...args], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh ${args.join(' ')} failed (${result.status}): ${result.stderr}`)
  }
  return result.stdout ?? ''
}

function runDesktopDsh(args: string[]): void {
  const binUrl = pathToFileURL(path.join(dshDir, 'apps', 'cli', 'src', 'bin.ts')).href
  const script = `
    const { runCli } = await import(${JSON.stringify(binUrl)});
    process.argv = [process.argv[0], 'bin.ts', ...${JSON.stringify(args)}];
    await runCli({ manageDesktopProfile: true });
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`desktop dsh ${args.join(' ')} failed (${result.status})`)
  }
}

function verifyDesktopProfileAndMeta(): void {
  const appBootUrl = pathToFileURL(path.join(dshDir, 'packages', 'boot', 'app-boot', 'src', 'index.ts')).href
  const installAnchor = path.join(dshDir, 'apps', 'cli', 'package.json')
  const desktopPkgUrl = pathToFileURL(path.join(dshHome, 'profiles', 'desktop', 'package.json')).href
  const script = `
    const { loadProfile, readProfilePatches, composeEntries, readPluginMeta } = await import(${JSON.stringify(appBootUrl)});
    const profile = loadProfile('dsh', 'desktop', ${JSON.stringify(installAnchor)});
    if (!profile.layers.some(layer => layer.packageName === 'dsh-workspace')) {
      throw new Error('Desktop profile layers do not include dsh-workspace.');
    }
    const entries = composeEntries([readProfilePatches('dsh', {
      name: 'desktop',
      dir: profile.dir,
      patchPath: profile.patchPath,
      installAnchor: ${JSON.stringify(installAnchor)},
      startedBundles: profile.layers.map(layer => layer.packageName),
      cwd: process.cwd(),
      home: process.env.DSH_HOME,
      overlayPaths: [],
      telemetryDisabledEnv: '1',
    }, profile)]);
    if (!JSON.stringify(entries).includes('"dsh-workspace"')) {
      throw new Error('Composed Desktop entries do not contain dsh-workspace.');
    }
    const meta = readPluginMeta('dsh-workspace', ${JSON.stringify(desktopPkgUrl)});
    if (!meta || meta.error || typeof meta.icon !== 'string' || !meta.icon.startsWith('data:image/svg+xml;base64,')) {
      throw new Error('Invalid Desktop plugin metadata: ' + JSON.stringify(meta));
    }
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`Desktop profile/meta verification failed (${result.status})`)
  }
}
