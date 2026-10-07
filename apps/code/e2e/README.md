# Browser tests

Run from the repository root:

```sh
bun install
cd apps/code
bunx playwright install chromium
cd ../..
bun run test:e2e:code
```

From `apps/code`, use `bun run test:e2e`, `bun run test:e2e:ui`, or
`bun run test:e2e:report`.

Playwright starts the real app on `http://localhost:3000` and prepares clangd
assets. It reuses an existing local server outside CI. It does not start or
deploy Convex. Configure `apps/code/.env.local` with `VITE_CONVEX_URL` and
`VITE_CONVEX_SITE_URL` for a running development backend. Run
`bun run convex:code` separately when backend changes need syncing. The backend
needs its normal Better Auth, repository storage, template and build service
configuration. Use a dedicated test deployment.

To test an already running app:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 bun run test:e2e:code
```

The URL must be allowed by the backend's Better Auth configuration. Chromium is
the default because the app uses Web Serial and WASM language tools. In CI,
install Chromium and its system dependencies with
`bunx playwright install --with-deps chromium` from `apps/code`.

Each authenticated test creates a fresh anonymous Better Auth user through the
same-origin API. Cookies belong to that test's browser context. SSR and Convex
use the real session. No auth bypass, shared credentials, saved session file, or
Better Auth test plugin is needed. Navigation helpers wait for the mounted auth
provider's session request before clicking SSR-rendered buttons.

Tests create real users, repositories, commits, build records and feedback. The
app exposes no program deletion flow, so these records remain after a run. Reset
the test deployment through its normal admin workflow when needed. Build tests
invoke the real build service and can take up to five minutes each. For a faster
run while editing other flows:

```sh
bun run test:e2e --grep-invert 'build a program|report compiler failures'
```

Coverage includes signed-out redirects, anonymous login, session persistence,
logout and auth failures, all four templates, program navigation, draft recovery,
undo/redo, commits, tabs, file picker, search, formatting, problems and output,
file/folder creation, rename, duplicate, copy/cut/paste, download, deletion
cancellation and persistence, both feedback types, successful and failed builds,
cached artifacts, upload slots, and terminal connection cancellation.

Google tests check the outgoing provider and callback request at the app's OAuth
boundary. They do not log into Google's external UI. Brain tests cover upload
prerequisites and disconnected controls, and replace only the serial chooser for
cancellation. Uploading to a physical Brain and streaming hardware output require
a device and are not covered by this suite.

Tests use `/login`, `/`, and `/p/:programId`, never an isolated editor page.
Failures retain screenshots, videos and traces in `test-results`. The HTML
report is in `playwright-report`.
