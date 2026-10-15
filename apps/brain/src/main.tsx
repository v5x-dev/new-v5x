import "~/styles/shadcn.css"
import "@xyflow/react/dist/style.css"
import "~/styles/flow.css"

import { createRoot } from "react-dom/client"

import { App } from "./App"

document.documentElement.classList.toggle(
  "dark",
  localStorage.getItem("theme") !== "light",
)

createRoot(document.getElementById("app")!).render(<App />)
