# V5X Design

Design is a browser-based CAD workspace for assembling VEX V5 robot parts.
Search the parts catalog, add parts to the 3D workspace, and select them in
the assembly tree or viewport. Move and rotate tools and numeric transforms
use inches and degrees. One scene unit is one inch.

The assembly panel supports duplicate, delete, undo/redo, a project name,
JSON import/export, and a CSV parts list. The version 1 document stores part
model paths and transforms. Local autosave keeps the assembly in this browser.
Export a JSON copy for backup or transfer to another device. A failed restore
preserves the stored document until a valid import replaces it.

Hole alignment currently supports the 1x1x35 aluminum angle. Enable holes,
select a fixed hole, then a hole on another part to align their centers and
opposing face normals. This applies a transform once; it does not maintain a
constraint after later edits. The inherited hole metadata still needs physical
part verification before precision CAD claims.

## Development

From this directory, run `bun run dev`, `bun run typecheck`, or `bun run build`.
The application uses TanStack Start, Three.js, and installed shadcn components.
Run `bun run format` and `bun run lint` after changes. Generated routes, model
assets, and build output are excluded from formatting.

Unit tests in `src/lib` cover document validation, undo/redo, quantities, inch
units, and transformed hole alignment. Browser acceptance must use the actual
application route and verify a chassis assembly, save/reload, and parts export.
