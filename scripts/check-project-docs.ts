import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'

const root = path.resolve(import.meta.dirname, '..')
const projectDir = path.join(root, 'docs', 'project')
const requiredDocs = [
  'README.md',
  'STATUS.md',
  'ROADMAP.md',
  'ARCHITECTURE.md',
  'API.md',
  'COMPATIBILITY.md',
  'SECURITY.md',
  'TESTING.md',
  'CHANGELOG-DEV.md',
]
const validStatuses = new Set(['planned', 'in-progress', 'blocked', 'done'])

const failures: string[] = []
const contents = new Map<string, string>()
for (const name of requiredDocs) {
  try {
    contents.set(name, await readFile(path.join(projectDir, name), 'utf8'))
  } catch {
    failures.push(`missing docs/project/${name}`)
  }
}

const roadmap = contents.get('ROADMAP.md') ?? ''
const tasks = new Map<string, string>()
for (const match of roadmap.matchAll(/^\| ([A-Z]+-\d{3}) \| ([a-z-]+) \|/gm)) {
  tasks.set(match[1] as string, match[2] as string)
}
if (tasks.size === 0) failures.push('ROADMAP.md contains no stable task IDs')
for (const [id, status] of tasks) if (!validStatuses.has(status)) failures.push(`${id} has invalid status ${status}`)

const statusDoc = contents.get('STATUS.md') ?? ''
for (const match of statusDoc.matchAll(/`([A-Z]+-\d{3})`/g)) {
  if (!tasks.has(match[1] as string)) failures.push(`STATUS.md references unknown task ${match[1]}`)
}

const decisionsDir = path.join(projectDir, 'decisions')
const decisionFiles = (await readdir(decisionsDir)).filter(name => /^ADR-\d{4}-.+\.md$/.test(name))
const index = contents.get('README.md') ?? ''
for (const file of decisionFiles) {
  const number = file.slice(0, 8)
  if (!index.includes(number)) failures.push(`${file} is missing from the ADR index`)
  const body = await readFile(path.join(decisionsDir, file), 'utf8')
  if (!body.includes('状态：accepted') && !body.includes('状态：superseded')) failures.push(`${file} has no accepted/superseded status`)
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { version: string; repository?: unknown }
const openapi = await readFile(path.join(root, 'docs', 'api', 'openapi.yaml'), 'utf8')
const asyncapi = await readFile(path.join(root, 'docs', 'api', 'asyncapi.yaml'), 'utf8')
const openapiDoc = parseYaml('OpenAPI', openapi)
const asyncapiDoc = parseYaml('AsyncAPI', asyncapi)
if (openapiDoc.info?.version !== packageJson.version) failures.push('OpenAPI version differs from package.json')
if (asyncapiDoc.info?.version !== packageJson.version) failures.push('AsyncAPI version differs from package.json')
for (const route of [
  '/healthz',
  '/pairings/exchange',
  '/devices/self',
  '/roots',
  '/roots/{rootId}/entries',
  '/roots/{rootId}/search',
  '/roots/{rootId}/content',
  '/trash',
  '/trash/{trashId}/restore',
  '/chat/sessions',
  '/chat/sessions/search',
  '/chat/permissions',
  '/chat/workspaces',
  '/chat/workspaces/{workspaceId}',
  '/chat/sessions/{sessionId}',
  '/chat/sessions/{sessionId}/fork',
  '/chat/sessions/{sessionId}/archive',
  '/chat/sessions/{sessionId}/unarchive',
  '/chat/sessions/{sessionId}/pin',
  '/chat/sessions/{sessionId}/state',
  '/chat/sessions/{sessionId}/queue/{itemId}',
  '/chat/sessions/{sessionId}/questions',
  '/chat/sessions/{sessionId}/questions/{questionId}/answer',
  '/chat/sessions/{sessionId}/messages',
  '/chat/sessions/{sessionId}/approvals',
  '/chat/sessions/{sessionId}/approvals/{approvalId}/decision',
  '/chat/sessions/{sessionId}/commands',
  '/chat/sessions/{sessionId}/models',
  '/chat/sessions/{sessionId}/model',
  '/chat/sessions/{sessionId}/agent-preset',
  '/chat/runs/{id}/cancel',
  '/settings/providers',
  '/settings/models',
  '/settings/providers/{providerId}',
  '/settings/providers/{providerId}/discover',
]) if (openapiDoc.paths?.[route] === undefined) failures.push(`OpenAPI is missing ${route}`)
if (asyncapiDoc.channels?.events?.address !== '/api/v1/events') failures.push('AsyncAPI is missing /api/v1/events')

const kotlin = await readFile(
  path.join(root, 'kotlin-sdk', 'src', 'main', 'kotlin', 'ai', 'deepseek', 'dsh', 'workspace', 'DshWorkspaceClient.kt'),
  'utf8',
)
if (!kotlin.includes('API_VERSION: String = "v1"')) failures.push('Kotlin SDK API version differs from v1')
if (!kotlin.includes('selectSessionAgentPreset')) failures.push('Kotlin SDK is missing Agent preset selection')
if (!kotlin.includes('listPendingApprovals') || !kotlin.includes('decideApproval')) failures.push('Kotlin SDK is missing approval interaction')
if (!kotlin.includes('listSessionCommands') || !kotlin.includes('executeSessionCommand')) failures.push('Kotlin SDK is missing slash command interaction')
if (!kotlin.includes('renameChatWorkspace') || !kotlin.includes('deleteChatWorkspace')) failures.push('Kotlin SDK is missing workspace management')
if (!kotlin.includes('renameSession') || !kotlin.includes('forkSession') || !kotlin.includes('archiveSession')) failures.push('Kotlin SDK is missing session management')
if (!kotlin.includes('unarchiveSession') || !kotlin.includes('pinSession') || !kotlin.includes('unpinSession')) failures.push('Kotlin SDK is missing session pin/unarchive management')
if (!kotlin.includes('searchFiles') || !kotlin.includes('searchSessions') || !kotlin.includes('listPermissionCatalog')) failures.push('Kotlin SDK is missing search or permission catalog')
if (!kotlin.includes('listPendingQuestions') || !kotlin.includes('answerQuestion') || !kotlin.includes('getSessionState') || !kotlin.includes('updateQueue')) failures.push('Kotlin SDK is missing user questions or queue management')
if (!asyncapi.includes('chat.message.delta')) failures.push('AsyncAPI is missing stable chat delta events')
if (!asyncapi.includes('chat.approval.requested')) failures.push('AsyncAPI is missing approval events')
if (!asyncapi.includes('chat.question.requested')) failures.push('AsyncAPI is missing user-question events')

const trackedText = [
  await readFile(path.join(root, 'README.md'), 'utf8'),
  ...contents.values(),
].join('\n')
if (/github\.com\/OWNER\//.test(trackedText)) failures.push('documentation contains an unresolved GitHub owner placeholder')

function parseYaml(name: string, source: string): Record<string, any> {
  const document = parseDocument(source)
  for (const error of document.errors) failures.push(`${name} YAML is invalid: ${error.message}`)
  return document.toJS() as Record<string, any>
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`docs:check: ${failure}`)
  process.exitCode = 1
} else {
  console.log(`docs:check: ${requiredDocs.length} project docs, ${tasks.size} tasks, ${decisionFiles.length} ADRs, and API/SDK versions are consistent`)
}
