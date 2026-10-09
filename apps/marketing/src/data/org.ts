import type { PartPlacement } from "../scripts/parts-viewer"

export type ProductId = "code" | "brain" | "design" | "serial"

export interface Product {
  id: ProductId
  name: string
  href: string
  host: string
  status: "live" | "in development" | "on npm"
  color: string
  colorOnDark: string
  line: string
  body: string
}

export const products: Product[] = [
  {
    id: "code",
    name: "code",
    href: "https://code.v5x.dev",
    host: "code.v5x.dev",
    status: "live",
    color: "#c99a00",
    colorOnDark: "#fdc700",
    line: "a v5 c++ editor that builds in your browser.",
    body: "VEXcode, PROS, EZ-Template and JAR-Template projects with clangd completions, Clang builds on your own machine, and USB upload to the Brain.",
  },
  {
    id: "brain",
    name: "brain",
    href: "https://brain.v5x.dev",
    host: "brain.v5x.dev",
    status: "live",
    color: "#a3004c",
    colorOnDark: "#ef4f8e",
    line: "a v5 brain simulator in a browser tab.",
    body: "The V5 runtime running in QEMU, compiled to WebAssembly. Upload a program, wire up devices, and watch the screen respond.",
  },
  {
    id: "design",
    name: "design",
    href: "https://design.v5x.dev",
    host: "design.v5x.dev",
    status: "in development",
    color: "#d4000a",
    colorOnDark: "#ff4b4b",
    line: "protobot-style robot cad, in the browser.",
    body: "Drag real V5 parts into a 3D workspace and assemble the robot before anyone cuts metal. Built on 300+ official VEX part models.",
  },
  {
    id: "serial",
    name: "serial",
    href: "https://www.npmjs.com/package/@v5x/serial",
    host: "@v5x/serial",
    status: "on npm",
    color: "#2f6fde",
    colorOnDark: "#6a9cff",
    line: "the v5 serial protocol, for typescript.",
    body: "File transfers, screen capture, device state and the program terminal over USB or Bluetooth, in browsers, Node and Bun.",
  },
]

export const productById = Object.fromEntries(
  products.map((product) => [product.id, product])
) as Record<ProductId, Product>

export const links = {
  github: "https://github.com/v5x-dev",
  repo: "https://github.com/v5x-dev/v5x",
  npm: "https://www.npmjs.com/package/@v5x/serial",
  serialProtocol: "https://github.com/vexide/vex-v5-serial",
  qemu: "https://github.com/vexide/vex-v5-qemu",
  vexide: "https://github.com/vexide",
}

export const shots = {
  editor: {
    src: "/shots/code-editor.webp",
    w: 1600,
    h: 1000,
    alt: "The v5x code editor showing a PROS drive program with clangd completions for MotorGroup",
  },
  built: {
    src: "/shots/code-built.webp",
    w: 1600,
    h: 1000,
    alt: "The v5x code editor after a successful browser build, with hot and cold package binaries in the file tree",
  },
  output: {
    src: "/shots/code-output.webp",
    w: 1600,
    h: 470,
    alt: "Compiler output from a browser build, showing clang targeting the Cortex-A9",
  },
  programs: {
    src: "/shots/code-programs.webp",
    w: 1600,
    h: 1000,
    alt: "The v5x code program list with VEXcode, PROS, EZ and JAR templates",
  },
  brainDark: {
    src: "/shots/brain-dark.webp",
    w: 1600,
    h: 1000,
    alt: "The v5x brain simulator running an example program that reads the simulated battery at 84%",
  },
  brainLight: {
    src: "/shots/brain-light.webp",
    w: 1600,
    h: 1000,
    alt: "The v5x brain simulator in light mode running an example program",
  },
}

const PI = Math.PI

export const parts = {
  brain: {
    src: "/models/v5-robot-brain.glb",
    rotation: [-PI / 2, 0, 0],
    screen: "/shots/brain-screen.webp",
  },
  brainFlat: {
    src: "/models/v5-robot-brain.glb",
    rotation: [PI, 0, 0],
    screen: "/shots/brain-screen.webp",
  },
  motor: { src: "/models/v5-smart-motor.glb" },
  omni: { src: "/models/omni-wheel.glb", finish: "plastic" },
  channel: { src: "/models/c-channel.glb", finish: "aluminum" },
  battery: { src: "/models/v5-robot-battery.glb" },
  radio: { src: "/models/v5-robot-radio.glb" },
  inertial: { src: "/models/v5-inertial-sensor.glb", finish: "plastic" },
  distance: {
    src: "/models/v5-distance-sensor.glb",
    finish: "plastic",
    rotation: [0, PI, 0],
  },
} satisfies Record<string, PartPlacement>
