export type Template = "vexcode" | "pros" | "ez-template" | "jar-template"

export const templateInfo: Record<
  Template,
  { label: string; icon: string; color: string; blurb: string }
> = {
  vexcode: {
    label: "VEXcode",
    icon: "/template-icons/vexcode.png",
    color: "var(--vexcode)",
    blurb: "Official V5 API. Closest to the VEXcode you know.",
  },
  pros: {
    label: "PROS",
    icon: "/template-icons/pros.png",
    color: "var(--pros)",
    blurb: "Open source kernel with tasks, mutexes and PROS tooling.",
  },
  "ez-template": {
    label: "EZ",
    icon: "/template-icons/ez.png",
    color: "var(--ez)",
    blurb: "PROS plus a ready drive library and auton selector.",
  },
  "jar-template": {
    label: "JAR",
    icon: "/template-icons/jar.svg",
    color: "var(--jar)",
    blurb: "Odometry and motion profiling out of the box.",
  },
}

export const templates = Object.keys(templateInfo) as Template[]
