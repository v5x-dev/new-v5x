export const DEFAULT_SMOL_CLOUD_URL = 'https://api.smolmachines.com'
export const DEFAULT_BUILD_IMAGE_TAG = 'build-fast-v1'
export const BUILD_MACHINE_TTL_SECONDS = 900

// SDK archive extraction can preserve a different directory owner. Limit Git's
// ownership exception to this isolated build workspace, including make's Git calls.
export const BUILD_GIT_ENV = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.directory',
  GIT_CONFIG_VALUE_0: '/workspace',
}

export async function resolveBuildCloud(token: string, cloudUrl: string) {
  const response = await fetch(`${cloudUrl}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(
      `Could not resolve Smol registry namespace (${response.status})`,
    )
  }
  const account: unknown = await response.json()
  const namespace =
    typeof account === 'object' &&
    account !== null &&
    'registryNamespace' in account &&
    typeof account.registryNamespace === 'string'
      ? account.registryNamespace
      : null
  if (!namespace?.startsWith('tenants/')) {
    throw new Error('Smol account has no registry namespace')
  }
  return namespace
}
