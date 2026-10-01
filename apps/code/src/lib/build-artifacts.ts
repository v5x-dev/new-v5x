import Dexie, { type EntityTable } from 'dexie'

export interface StoredBuildArtifacts {
  programId: string
  commitSha: string
  files: string[]
  artifacts: Array<{ path: string; bytes: Uint8Array }>
}

const db = new Dexie('v5x-build-artifacts') as Dexie & {
  builds: EntityTable<StoredBuildArtifacts, 'programId'>
}

db.version(1).stores({ builds: 'programId' })

export const buildArtifactStore = db.builds
