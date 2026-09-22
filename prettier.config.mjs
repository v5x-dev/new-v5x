import * as tailwindcss from "prettier-plugin-tailwindcss"

export default {
  endOfLine: "lf",
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  printWidth: 80,
  plugins: [tailwindcss],
  tailwindStylesheet: "./apps/code/src/styles/app.css",
  tailwindFunctions: ["cn", "cva"],
}
