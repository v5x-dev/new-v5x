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

Hole attachments support all 13 included angle and channel models. Enable
holes, select a fixed face hole, then a hole on another part to attach them.
The assembly panel also offers numeric hole selection. Attached parts form a
rigid group: moving or rotating any member moves the group. Detach an attachment
to move its parts independently. Attachments survive local autosave, JSON
import/export, and undo/redo. Duplicate makes a detached copy; deletion removes
attachments to that part. Cycles are rejected.

Hole centers and outward normals are extracted from closed square face
boundaries in the included GLBs, after applying each model's transform and
converting meters to inches. Both sheet faces are selectable. Regenerate with
`python3 scripts/extract-model-holes.py`. This verifies the digital model geometry;
physical part dimensions still need measurement before precision CAD claims.
These attachments are rigid; they do not model bearings, sliding joints,
collision detection, or bolt clearance.

## Development

From this directory, run `bun run dev`, `bun run typecheck`, or `bun run build`.
Dev uses port 3001 so it can run beside the code app on port 3000 and share its session.
The application uses TanStack Start, Three.js, and installed shadcn components.
Run `bun run format` and `bun run lint` after changes. Generated routes, model
assets, and build output are excluded from formatting.

Unit tests in `src/lib` cover document validation, undo/redo, quantities, inch
units, and transformed hole alignment. Browser acceptance must use the actual
application route and verify a chassis assembly, save/reload, and parts export.
