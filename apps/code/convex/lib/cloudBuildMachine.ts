import { BUILD_MACHINE_TTL_SECONDS } from './buildCloudSettings'

type Connection = { apiKey: string; baseUrl: string }
type ExecOptions = { timeout?: number; env?: Record<string, string> }
type ExecResult = { exitCode: number; stdout: string; stderr: string }

// The build coordinator needs only HTTP, not the SDK's local VM/native addon.
// Keeping it in Convex's default runtime avoids a cold Node process per build.
export class CloudBuildMachine {
  constructor(
    readonly id: string,
    private readonly connection: Connection,
  ) {}

  private async request(
    path: string,
    method: string,
    body?: unknown,
    timeout = 30_000,
  ) {
    const response = await fetch(`${this.connection.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.connection.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok)
      throw new Error(
        `Build cloud ${method} ${path} failed (${response.status})`,
      )
    return response
  }

  async exec(
    command: Array<string>,
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const timeout = options.timeout ?? 300
    const response = await this.request(
      `/v1/machines/${encodeURIComponent(this.id)}/exec`,
      'POST',
      {
        command,
        cwd: null,
        env: options.env ?? {},
        timeoutSeconds: timeout,
      },
      timeout * 1000 + 30_000,
    )
    const result: unknown = await response.json()
    if (
      !result ||
      typeof result !== 'object' ||
      !('exitCode' in result) ||
      typeof result.exitCode !== 'number'
    ) {
      throw new Error('Invalid build cloud execution response')
    }
    return {
      exitCode: result.exitCode,
      stdout:
        'stdout' in result && typeof result.stdout === 'string'
          ? result.stdout
          : '',
      stderr:
        'stderr' in result && typeof result.stderr === 'string'
          ? result.stderr
          : '',
    }
  }

  async readFile(path: string) {
    const encodedPath = path
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')
    const response = await this.request(
      `/v1/machines/${encodeURIComponent(this.id)}/files/${encodedPath}`,
      'GET',
    )
    return new Uint8Array(await response.arrayBuffer())
  }

  async delete() {
    await this.request(`/v1/machines/${encodeURIComponent(this.id)}`, 'DELETE')
  }

  static async create(image: string, connection: Connection) {
    const cloud = new CloudBuildMachine('', connection)
    const response = await cloud.request('/v1/machines', 'POST', {
      name: null,
      source: { type: 'image', reference: image },
      resources: { cpus: 8, memoryMb: 4096, diskGb: null },
      network: { mode: 'open' },
      ttlSeconds: BUILD_MACHINE_TTL_SECONDS,
    })
    const created: unknown = await response.json()
    if (
      !created ||
      typeof created !== 'object' ||
      !('id' in created) ||
      typeof created.id !== 'string'
    ) {
      throw new Error('Invalid build cloud machine response')
    }
    const machine = new CloudBuildMachine(created.id, connection)
    try {
      await machine.request(
        `/v1/machines/${encodeURIComponent(machine.id)}/start`,
        'POST',
        undefined,
        60_000,
      )
      const deadline = Date.now() + 120_000
      for (;;) {
        try {
          // A successful agent execution proves readiness, including on clouds
          // whose ready flag waits for a published port that builds do not use.
          const probe = await machine.exec(['true'], { timeout: 3 })
          if (probe.exitCode === 0) return machine
        } catch {
          if (Date.now() >= deadline)
            throw new Error('Build worker did not become ready')
        }
        if (Date.now() >= deadline)
          throw new Error('Build worker did not become ready')
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    } catch (error) {
      await machine.delete().catch(() => {})
      throw error
    }
  }
}
