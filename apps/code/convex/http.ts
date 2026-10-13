import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './betterAuth/auth'
import { registerHandoffRoute } from './simulatorHandoff'

const http = httpRouter()

authComponent.registerRoutes(http, createAuth)
registerHandoffRoute(http)

export default http
