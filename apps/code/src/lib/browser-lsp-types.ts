export type RobotTemplate = 'vexcode' | 'pros' | 'ez-template' | 'jar-template'
export type WorkspaceFile = { path: string; contents: string }
export type BrowserLspBoot = {
  type: 'boot'
  projectKey: string
  template: RobotTemplate
  files: WorkspaceFile[]
  assetBase: string
}
export type BrowserLspInput = BrowserLspBoot | { type: 'rpc'; message: unknown }
export type BrowserLspOutput =
  | { type: 'ready' }
  | { type: 'progress'; message: string }
  | { type: 'rpc'; message: unknown }
  | { type: 'error'; message: string }
export type SdkPack = { files: WorkspaceFile[]; includePaths: string[] }

export function safeWorkspacePath(path: string) {
  return (
    !!path &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    path
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  )
}
