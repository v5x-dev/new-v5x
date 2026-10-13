import { deleteBrowserBuild } from './build-client'
import { deleteWorkspace } from './persistence'

export async function deleteLocalProjectData(projectId: string) {
  await Promise.all([deleteWorkspace(projectId), deleteBrowserBuild(projectId)])
}
