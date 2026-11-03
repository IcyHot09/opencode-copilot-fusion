/**
 * Resolve opencode's stored GitHub Copilot credential the same way the
 * built-in Copilot provider does, so this plugin never asks the user for a
 * separate token:
 *
 *   connection = ctx.integration.connection.active("github-copilot")
 *   credential = ctx.integration.connection.resolve(connection)
 *   // credential: { type: "oauth", refresh === access, metadata: {...} }
 *
 * baseURL resolution mirrors the built-in (`copilotBaseURL`):
 *   metadata.apiEndpoint (e.g. https://api.business.githubcopilot.com)
 *   ?? https://copilot-api.<enterpriseUrl host> (GHES)
 *   ?? https://api.githubcopilot.com
 */

export const COPILOT_INTEGRATION_ID = "github-copilot" as const
export const DEFAULT_BASE_URL = "https://api.githubcopilot.com" as const

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface CopilotCredentials {
  readonly token: string
  readonly baseURL: string
}

/** Pure: metadata -> baseURL. Exported for tests. */
export function copilotBaseURLFromMetadata(metadata: unknown): string {
  if (typeof metadata === "object" && metadata !== null) {
    const record = metadata as Record<string, unknown>
    const endpoint = record.apiEndpoint
    if (typeof endpoint === "string" && endpoint.trim()) {
      return endpoint.replace(/\/+$/, "")
    }
    const enterprise = record.enterpriseUrl
    if (typeof enterprise === "string" && enterprise.trim()) {
      const host = enterprise.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      return `https://copilot-api.${host}`
    }
  }
  return DEFAULT_BASE_URL
}

interface CredentialLike {
  readonly type?: unknown
  readonly refresh?: unknown
  readonly access?: unknown
  readonly metadata?: unknown
}

/** Pure: credential -> credentials. Exported for tests. */
export function copilotCredentialsFromCredential(
  credential: CredentialLike | undefined,
): CopilotCredentials | undefined {
  if (!credential || credential.type !== "oauth") return undefined
  const token = typeof credential.refresh === "string" && credential.refresh
    ? credential.refresh
    : typeof credential.access === "string"
      ? credential.access
      : undefined
  if (!token) return undefined
  return { token, baseURL: copilotBaseURLFromMetadata(credential.metadata) }
}

export interface IntegrationLike<Connection = unknown> {
  readonly connection: {
    readonly active: (integrationID: string) => Promise<Connection | undefined>
    readonly resolve: (connection: Connection) => Promise<CredentialLike | undefined>
  }
}

/**
 * Resolve credentials from an opencode plugin context. Returns undefined
 * when Copilot is not connected (or the stored credential is not an OAuth
 * credential) instead of throwing — the plugin stays inert until the user
 * runs /connect.
 */
export async function resolveCopilotCredentials<Connection>(
  integration: IntegrationLike<Connection>,
): Promise<CopilotCredentials | undefined> {
  try {
    const connection = await integration.connection.active(COPILOT_INTEGRATION_ID)
    if (!connection) return undefined
    const credential = await integration.connection.resolve(connection)
    return copilotCredentialsFromCredential(credential as CredentialLike | undefined)
  } catch {
    return undefined
  }
}
