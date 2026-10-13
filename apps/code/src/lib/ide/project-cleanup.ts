import { deleteBrowserBuild } from '@v5x/compiler'
import { deleteWorkspace } from './persistence'

export async function deleteLocalProjectData(projectId: string) {
  await Promise.all([deleteWorkspace(projectId), deleteBrowserBuild(projectId)])
}
