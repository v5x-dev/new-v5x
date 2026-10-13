import { v } from 'convex/values'
import { httpRouter } from 'convex/server'
import { internal } from './_generated/api'
import {
  action,
  env,
  httpAction,
  internalMutation,
  internalQuery,
} from './_generated/server'
import type { Doc } from './_generated/dataModel'

const maxArtifactBytes = 32 * 1024 * 1024
const transferLifetimeMs = 5 * 60 * 1000
const hashValidator = v.string()

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

async function sha256(bytes: ArrayBuffer) {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
}

function validHash(value: string) {
  return /^[a-f0-9]{64}$/.test(value)
}

function tokenHash(token: string) {
  return sha256(new TextEncoder().encode(token).buffer)
}

const brainOrigins = () =>
  new Set([
    'https://brain.v5x.dev',
    ...(env.V5X_BRAIN_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ])

export function isAllowedBrainOrigin(origin: string | null): origin is string {
  return origin !== null && brainOrigins().has(origin)
}

export const create = action({
  args: {
    programId: v.id('program'),
    expectedCommitSha: v.string(),
    sourceSha256: hashValidator,
    artifactSha256: hashValidator,
    artifactSize: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    if (
      !validHash(args.sourceSha256) ||
      !validHash(args.artifactSha256) ||
      !Number.isSafeInteger(args.artifactSize) ||
      args.artifactSize < 1 ||
      args.artifactSize > maxArtifactBytes
    )
      throw new Error('Invalid simulator artifact')

    const program: Doc<'program'> | null = await ctx.runQuery(
      internal.program.getOwned,
      { programId: args.programId, ownerId: identity.subject },
    )
    if (!program || program.currentCommitSha !== args.expectedCommitSha)
      throw new Error(
        'The project changed. Build the current committed source first.',
      )
    if ((program.template ?? 'vexcode') !== 'vexcode')
      throw new Error(
        'The Brain simulator currently accepts VEXcode binaries only.',
      )

    const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
    const hash = await tokenHash(token)
    const expiresAt = Date.now() + transferLifetimeMs
    await ctx.runMutation(internal.simulatorHandoff.insertTransfer, {
      ...args,
      tokenHash: hash,
      ownerId: identity.subject,
      expiresAt,
    })
    await ctx.scheduler.runAfter(
      transferLifetimeMs,
      internal.simulatorHandoff.cleanup,
      { tokenHash: hash },
    )

    return {
      token,
      uploadUrl: await ctx.storage.generateUploadUrl(),
      endpoint: env.CONVEX_SITE_URL,
    }
  },
})

export const register = action({
  args: {
    programId: v.id('program'),
    expectedCommitSha: v.string(),
    token: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Unauthorized')
    if (!/^[a-f0-9]{64}$/.test(args.token))
      throw new Error('Invalid simulator handoff token')

    const hash = await tokenHash(args.token)
    const transfer = await ctx.runQuery(
      internal.simulatorHandoff.getPendingForOwner,
      { tokenHash: hash, ownerId: identity.subject, programId: args.programId },
    )
    if (
      !transfer ||
      transfer.commitSha !== args.expectedCommitSha ||
      transfer.expiresAt <= Date.now() ||
      transfer.storageId
    )
      throw new Error(
        'Simulator handoff expired or no longer matches this project.',
      )

    const program = await ctx.runQuery(internal.program.getOwned, {
      programId: args.programId,
      ownerId: identity.subject,
    })
    if (
      !program ||
      program.currentCommitSha !== args.expectedCommitSha ||
      (program.template ?? 'vexcode') !== 'vexcode'
    )
      throw new Error(
        'The project changed. Build the current committed source first.',
      )

    const artifact = await ctx.storage.get(args.storageId)
    if (!artifact) throw new Error('Uploaded simulator artifact is missing.')
    if (artifact.size !== transfer.artifactSize) {
      await ctx.storage.delete(args.storageId)
      throw new Error('Uploaded simulator artifact has an unexpected size.')
    }
    const bytes = await artifact.arrayBuffer()
    const digest = await sha256(bytes)
    if (
      bytes.byteLength !== transfer.artifactSize ||
      digest !== transfer.artifactSha256
    ) {
      await ctx.storage.delete(args.storageId)
      throw new Error('Simulator artifact integrity check failed.')
    }

    await ctx.runMutation(internal.simulatorHandoff.attachArtifact, {
      tokenHash: hash,
      ownerId: identity.subject,
      storageId: args.storageId,
    })
    return null
  },
})

export const insertTransfer = internalMutation({
  args: {
    tokenHash: v.string(),
    ownerId: v.string(),
    programId: v.id('program'),
    expectedCommitSha: v.string(),
    sourceSha256: v.string(),
    artifactSha256: v.string(),
    artifactSize: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const program = await ctx.db.get('program', args.programId)
    if (
      !program ||
      program.ownerId !== args.ownerId ||
      program.deleting ||
      (program.template ?? 'vexcode') !== 'vexcode' ||
      program.currentCommitSha !== args.expectedCommitSha
    )
      throw new Error(
        'The project changed. Build the current committed source first.',
      )
    await ctx.db.insert('simulatorHandoffs', {
      tokenHash: args.tokenHash,
      ownerId: args.ownerId,
      programId: args.programId,
      commitSha: args.expectedCommitSha,
      sourceSha256: args.sourceSha256,
      artifactSha256: args.artifactSha256,
      artifactSize: args.artifactSize,
      expiresAt: args.expiresAt,
    })
    return null
  },
})

export const getPendingForOwner = internalQuery({
  args: {
    tokenHash: v.string(),
    ownerId: v.string(),
    programId: v.id('program'),
  },
  handler: async (ctx, args) => {
    const transfer = await ctx.db
      .query('simulatorHandoffs')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', args.tokenHash))
      .unique()
    if (
      !transfer ||
      transfer.ownerId !== args.ownerId ||
      transfer.programId !== args.programId ||
      transfer.consumedAt
    )
      return null
    return transfer
  },
})

export const attachArtifact = internalMutation({
  args: {
    tokenHash: v.string(),
    ownerId: v.string(),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, args) => {
    const transfer = await ctx.db
      .query('simulatorHandoffs')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', args.tokenHash))
      .unique()
    if (
      !transfer ||
      transfer.ownerId !== args.ownerId ||
      transfer.expiresAt <= Date.now() ||
      transfer.consumedAt ||
      transfer.storageId
    )
      throw new Error('Simulator handoff expired or was already used.')
    await ctx.db.patch('simulatorHandoffs', transfer._id, {
      storageId: args.storageId,
    })
    return null
  },
})

export const consume = internalMutation({
  args: { tokenHash: v.string(), now: v.number() },
  handler: async (ctx, { tokenHash: hash, now }) => {
    const transfer = await ctx.db
      .query('simulatorHandoffs')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', hash))
      .unique()
    if (
      !transfer ||
      !transfer.storageId ||
      transfer.expiresAt <= now ||
      transfer.consumedAt
    )
      return null
    await ctx.db.patch('simulatorHandoffs', transfer._id, { consumedAt: now })
    return {
      transferId: transfer._id,
      storageId: transfer.storageId,
      manifest: {
        version: 1,
        format: 'vexcode-v5-raw',
        template: 'vexcode',
        commitSha: transfer.commitSha,
        sourceSha256: transfer.sourceSha256,
        artifact: {
          path: 'build/workspace.bin',
          size: transfer.artifactSize,
          sha256: transfer.artifactSha256,
        },
      },
    }
  },
})

export const cleanup = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash: hash }) => {
    const transfer = await ctx.db
      .query('simulatorHandoffs')
      .withIndex('by_token_hash', (q) => q.eq('tokenHash', hash))
      .unique()
    if (!transfer) return null
    if (transfer.storageId) await ctx.storage.delete(transfer.storageId)
    await ctx.db.delete('simulatorHandoffs', transfer._id)
    return null
  },
})

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Access-Control-Max-Age': '300',
    'Access-Control-Expose-Headers': 'X-V5X-Handoff-Manifest',
    Vary: 'Origin',
  }
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const consumeHttp = httpAction(async (ctx, request) => {
  const origin = request.headers.get('Origin')
  if (!isAllowedBrainOrigin(origin))
    return new Response('Origin not allowed', { status: 403 })
  const headers = corsHeaders(origin)
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers })
  if (request.method !== 'POST')
    return new Response('Method not allowed', {
      status: 405,
      headers: { ...headers, Allow: 'POST, OPTIONS' },
    })

  const authorization = request.headers.get('Authorization') ?? ''
  const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1]
  if (!token)
    return new Response('Invalid handoff token', { status: 401, headers })

  const hash = await tokenHash(token)
  const consumed = await ctx.runMutation(internal.simulatorHandoff.consume, {
    tokenHash: hash,
    now: Date.now(),
  })
  if (!consumed)
    return new Response('Simulator handoff expired or already used', {
      status: 410,
      headers,
    })

  const blob = await ctx.storage.get(consumed.storageId)
  if (!blob)
    return new Response('Simulator artifact is missing', {
      status: 410,
      headers,
    })
  const bytes = await blob.arrayBuffer()
  if (
    bytes.byteLength !== consumed.manifest.artifact.size ||
    (await sha256(bytes)) !== consumed.manifest.artifact.sha256
  ) {
    await ctx.runMutation(internal.simulatorHandoff.cleanup, {
      tokenHash: hash,
    })
    return new Response('Simulator artifact integrity check failed', {
      status: 422,
      headers,
    })
  }

  await ctx.scheduler.runAfter(0, internal.simulatorHandoff.cleanup, {
    tokenHash: hash,
  })
  return new Response(bytes, {
    status: 200,
    headers: {
      ...headers,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/vnd.v5x.simulator-binary',
      'X-V5X-Handoff-Manifest': base64Url(JSON.stringify(consumed.manifest)),
    },
  })
})

export function registerHandoffRoute(http: ReturnType<typeof httpRouter>) {
  http.route({
    path: '/simulator-handoff/consume',
    method: 'OPTIONS',
    handler: consumeHttp,
  })
  http.route({
    path: '/simulator-handoff/consume',
    method: 'POST',
    handler: consumeHttp,
  })
}
