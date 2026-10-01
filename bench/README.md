# Local SmolVM build benchmark

From the repository root, run:

```sh
python3 bench/smolvm-builds.py
```

The script prepares clean, synthetic projects from the templates in
`apps/code/convex/template.ts`, then runs them with the local artifact at
`.build/vexcode-v2.smolmachine`. It reports dependency setup time, compile time,
and full `smolvm machine run` wall time. It needs `bun`, `smolvm`, and that local
artifact. The artifact is a local build product and is not stored in Git.

Use `--samples 1` for a quick run, or `--template pros` to select one template.
The default is three clean samples per template. Generated projects and build
outputs stay under the ignored `.build/` directory.
