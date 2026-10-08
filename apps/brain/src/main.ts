import "~/styles/shadcn.css"
import { mount } from "svelte"

import App from "./App.svelte"

document.documentElement.classList.toggle(
  "dark",
  localStorage.getItem("theme") !== "light",
)

const app = mount(App, {
  target: document.getElementById("app")!,
})

export default app
