import type { IncomingMessage } from 'node:http'
import type { DevicePrincipal, DeviceScope, Principal } from '../shared/contracts.ts'
import { ADMIN_PRINCIPAL } from '../shared/contracts.ts'
import type { WorkspaceDatabase } from './database.ts'
import { ApiError } from './errors.ts'
import { FixedWindowLimiter } from './rate-limit.ts'

export class AuthService {
  private readonly authFailures = new FixedWindowLimiter(20, 5 * 60_000)
  readonly pairingAttempts = new FixedWindowLimiter(10, 10 * 60_000)
  readonly requests = new FixedWindowLimiter(120, 60_000)

  constructor(private readonly database: WorkspaceDatabase) {}

  principal(req: IncomingMessage, options: { allowAdmin?: boolean } = {}): Principal {
    const remote = requestAddress(req)
    this.requests.consume(remote)
    if (
      options.allowAdmin === true
      && req.headers['x-dsh-workspace-admin'] === '1'
      && isLoopbackAddress(remote)
      && isLoopbackOrigin(req.headers.origin)
    ) {
      return ADMIN_PRINCIPAL
    }
    const authorization = req.headers.authorization
    if (authorization === undefined || !authorization.startsWith('Bearer ')) {
      this.authFailures.consume(remote)
      throw new ApiError(401, 'AUTH_REQUIRED', 'A valid Bearer token is required.')
    }
    const token = authorization.slice('Bearer '.length).trim()
    const device = token === '' ? undefined : this.database.authenticate(token)
    if (device === undefined) {
      this.authFailures.consume(remote)
      throw new ApiError(401, 'TOKEN_INVALID', 'The device token is invalid or revoked.')
    }
    const principal: DevicePrincipal = {
      kind: 'device',
      id: device.id,
      name: device.name,
      scopes: new Set(device.scopes),
      rootIds: new Set(device.rootIds),
    }
    return principal
  }

  requireAdmin(req: IncomingMessage): Principal {
    const remote = requestAddress(req)
    if (!isLoopbackAddress(remote) || !isLoopbackOrigin(req.headers.origin)) {
      throw new ApiError(403, 'ADMIN_LOOPBACK_REQUIRED', 'This operation is available only from the local machine.')
    }
    return ADMIN_PRINCIPAL
  }

  requireScope(principal: Principal, scope: DeviceScope): void {
    if (!principal.scopes.has(scope)) throw new ApiError(403, 'SCOPE_REQUIRED', `The ${scope} scope is required.`)
  }

  requireRoot(principal: Principal, rootId: string): void {
    if (principal.rootIds !== 'all' && !principal.rootIds.has(rootId)) {
      throw new ApiError(403, 'ROOT_FORBIDDEN', 'This device is not authorized for the requested root.')
    }
  }
}

export function requestAddress(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1'
}

export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol === 'dsh-app:') return hostname === 'app' && url.port === ''
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}
