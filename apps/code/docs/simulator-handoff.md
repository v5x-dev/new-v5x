# Run a VEXcode build in Brain

Code's project page can send the latest VEXcode binary to Brain's browser
simulator. It uploads a versioned manifest and binary to the Code Convex
deployment, then opens Brain with a short-lived, one-use token. Brain accepts
the token only from its configured Code Convex site, and the backend accepts
requests only from `https://brain.v5x.dev` by default.

For local development, point Code at Brain and allow Brain's origin in the same
development Convex deployment:

```sh
VITE_BRAIN_APP_URL=http://localhost:5173
VITE_CODE_CONVEX_SITE_URL=https://<development-deployment>.convex.site
bunx convex env set V5X_BRAIN_ORIGINS http://localhost:5173
```

Set `VITE_BRAIN_APP_URL` in Code's environment and
`VITE_CODE_CONVEX_SITE_URL` in Brain's environment. Use the exact Convex site
URL from Code's `VITE_CONVEX_SITE_URL`. Add another exact Brain origin to
`V5X_BRAIN_ORIGINS` when the local app uses a different port. Do not use `*`.

The handoff currently supports `build/workspace.bin` from the VEXcode template.
PROS, EZ-Template, and JAR builds need their hot/cold package loader before they
can run in Brain.
