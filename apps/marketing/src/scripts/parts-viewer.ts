import {
  ACESFilmicToneMapping,
  Box3,
  BufferAttribute,
  type BufferGeometry,
  DirectionalLight,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js"

type SimpleFinish = "aluminum" | "plastic"
export type Finish = SimpleFinish | "controller"

export interface PartPlacement {
  src: string
  size?: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  finish?: Finish
  screen?: string
}

const finishes: Record<SimpleFinish, () => MeshStandardMaterial> = {
  aluminum: () =>
    new MeshStandardMaterial({
      color: 0xc4c8ce,
      metalness: 0.9,
      roughness: 0.38,
    }),
  plastic: () =>
    new MeshStandardMaterial({
      color: 0x34373c,
      metalness: 0.05,
      roughness: 0.62,
    }),
}

// STEP conversions leave untextured bodies as plain white; only those get a finish.
function applyFinish(model: Object3D, finish: Finish) {
  if (finish === "controller") return applyControllerFinish(model)

  const material = finishes[finish]()

  model.traverse((child) => {
    if (!(child instanceof Mesh)) return

    const current = child.material as MeshStandardMaterial
    const { r, g, b } = current.color ?? { r: 1, g: 1, b: 1 }
    if (Math.min(r, g, b) > 0.75) child.material = material
  })
}

// The controller has a cream shell (mat_2) and a white face plate (mat_3).
// The real hardware is a charcoal shell with a near-black face.
function applyControllerFinish(model: Object3D) {
  const shell = new MeshStandardMaterial({
    color: 0x2b2d31,
    metalness: 0.05,
    roughness: 0.55,
  })
  const face = new MeshStandardMaterial({
    color: 0x111214,
    metalness: 0.05,
    roughness: 0.45,
  })

  model.traverse((child) => {
    if (!(child instanceof Mesh)) return

    const name = (child.material as MeshStandardMaterial).name
    if (name === "mat_2") child.material = shell
    else if (name === "mat_3" || name === "mat_13") child.material = face
  })
}

// The V5 Brain model's display is a single flat body with this grey material.
function isBrainScreen(material: MeshStandardMaterial) {
  const { r, g, b } = material.color
  return (
    Math.abs(r - 0.25) < 0.04 &&
    Math.abs(g - 0.27) < 0.04 &&
    Math.abs(b - 0.27) < 0.04
  )
}

async function applyScreen(model: Object3D, src: string) {
  const texture = await new TextureLoader().loadAsync(src)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  model.traverse((child) => {
    if (!(child instanceof Mesh) || !isBrainScreen(child.material)) return

    const geometry = child.geometry as BufferGeometry
    const position = geometry.getAttribute("position")
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox!
    const uv = new Float32Array(position.count * 2)

    for (let index = 0; index < position.count; index++) {
      uv[index * 2] = (position.getX(index) - min.x) / (max.x - min.x)
      uv[index * 2 + 1] = (max.y - position.getY(index)) / (max.y - min.y)
    }

    geometry.setAttribute("uv", new BufferAttribute(uv, 2))
    child.material = new MeshBasicMaterial({ map: texture, toneMapped: false })
  })
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")

class PartsViewer extends HTMLElement {
  #cleanup: (() => void) | undefined

  connectedCallback() {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return

        observer.disconnect()
        this.#start()
      },
      { rootMargin: "200px" }
    )

    observer.observe(this)
    this.#cleanup = () => observer.disconnect()
  }

  disconnectedCallback() {
    this.#cleanup?.()
  }

  async #start() {
    const placements: PartPlacement[] = JSON.parse(this.dataset.parts ?? "[]")
    const spin = Number(this.dataset.spin ?? 0.25)
    const elevation = MathUtils.degToRad(Number(this.dataset.elevation ?? 22))
    const azimuth = MathUtils.degToRad(Number(this.dataset.azimuth ?? 35))
    const zoom = Number(this.dataset.zoom ?? 1)
    const interactive = this.hasAttribute("interactive")

    const renderer = new WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = Number(this.dataset.exposure ?? 1.05)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.domElement.setAttribute("aria-hidden", "true")
    this.append(renderer.domElement)

    const scene = new Scene()
    const environment = new PMREMGenerator(renderer)
    scene.environment = environment.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture

    const key = new DirectionalLight(0xffffff, 1.6)
    key.position.set(4, 6, 5)
    const rim = new DirectionalLight(0xffffff, 0.8)
    rim.position.set(-5, 3, -4)
    scene.add(key, rim)

    const group = new Group()
    scene.add(group)

    const models = await Promise.all(
      placements.map((placement) => loader.loadAsync(placement.src))
    )

    for (const [index, gltf] of models.entries()) {
      const placement = placements[index]
      const model = gltf.scene
      if (placement.finish) applyFinish(model, placement.finish)
      if (placement.screen) await applyScreen(model, placement.screen)

      const box = new Box3().setFromObject(model)
      const size = box.getSize(new Vector3())
      const scale = (placement.size ?? 1) / Math.max(size.x, size.y, size.z)

      model.scale.setScalar(scale)
      model.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale))

      const holder = new Group()
      holder.add(model)
      holder.position.set(...(placement.position ?? [0, 0, 0]))
      holder.rotation.set(...(placement.rotation ?? [0, 0, 0]))
      group.add(holder)
    }

    const bounds = new Box3().setFromObject(group)
    const center = bounds.getCenter(new Vector3())
    const radius = bounds.getSize(new Vector3()).length() / 2

    const camera = new PerspectiveCamera(28, 1, 0.01, 100)
    const distance = radius / Math.sin(MathUtils.degToRad(14)) / zoom
    camera.position.set(
      center.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      center.y + distance * Math.sin(elevation),
      center.z + distance * Math.cos(elevation) * Math.cos(azimuth)
    )
    camera.lookAt(center)

    const controls = interactive
      ? new OrbitControls(camera, renderer.domElement)
      : undefined

    if (controls) {
      controls.target.copy(center)
      controls.enableZoom = false
      controls.enablePan = false
      controls.enableDamping = true
      controls.autoRotate = !reducedMotion.matches && spin > 0
      controls.autoRotateSpeed = spin * 4
      this.style.cursor = "grab"
    }

    const resize = () => {
      const { width, height } = this.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(this)
    resize()

    let visible = true
    const visibility = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
    })
    visibility.observe(this)

    let last = performance.now()
    renderer.setAnimationLoop((now) => {
      const delta = (now - last) / 1000
      last = now
      if (!visible) return

      if (controls) controls.update(delta)
      else if (!reducedMotion.matches) group.rotation.y += spin * delta

      renderer.render(scene, camera)
    })

    this.dataset.ready = ""

    this.#cleanup = () => {
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      visibility.disconnect()
      controls?.dispose()
      environment.dispose()
      renderer.dispose()
    }
  }
}

customElements.define("v5x-parts", PartsViewer)
