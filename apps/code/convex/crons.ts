import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()
crons.interval(
  'Keep template build workers ready',
  { minutes: 1 },
  internal.buildPoolWorker.replenish,
  {},
)
export default crons
