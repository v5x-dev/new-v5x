import { GitStorage } from '@pierre/storage'

export const store = new GitStorage({
  name: 'v5x',
  key: process.env.PIERRE_PRIVATE_KEY!,
})
