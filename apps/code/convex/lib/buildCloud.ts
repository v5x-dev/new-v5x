'use node'

import { Machine } from 'smolmachines'

import { BUILD_MACHINE_TTL_SECONDS } from './buildCloudSettings'
export {
  BUILD_GIT_ENV,
  BUILD_MACHINE_TTL_SECONDS,
  DEFAULT_BUILD_IMAGE_TAG,
  DEFAULT_SMOL_CLOUD_URL,
  resolveBuildCloud,
} from './buildCloudSettings'

export function createBuildMachine(
  namespace: string,
  imageTag: string,
  token: string,
  cloudUrl: string,
) {
  return Machine.create(
    {
      image: `registry.smolmachines.com/${namespace}/vexcode:${imageTag}`,
      resources: { cpus: 8, memoryMb: 4096, network: true },
      ttlSeconds: BUILD_MACHINE_TTL_SECONDS,
    },
    { target: 'cloud', apiKey: token, baseUrl: cloudUrl },
  )
}
