import modelManifest from "../../public/models/vex-v5rc-parts/manifest.json"

export const PART_DRAG_TYPE = "application/x-v5x-part"

export const modelPaths = modelManifest.models
  .map((model) => model.path)
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))

export const modelPathSet = new Set(modelPaths)

const partNames = new Map(
  modelManifest.models.map((model) => [
    model.path,
    model.name.replace(/\s*\(\d{3}-[\d-]+\)/g, "").trim(),
  ]),
)

export function partName(path: string) {
  return (
    partNames.get(path) ??
    path
      .split("/")
      .at(-1)
      ?.replace(/\.glb$/, "")
      .replaceAll("-", " ") ??
    "Unknown part"
  )
}
