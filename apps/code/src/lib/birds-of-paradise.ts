import { registerCustomTheme } from "@pierre/diffs"

const birdsOfParadiseTheme = {
  name: "birds-of-paradise",
  type: "dark" as const,
  bg: "var(--background)",
  fg: "#E6E1C4",
  colors: {
    "editor.background": "var(--background)",
    "editor.foreground": "#E6E1C4",
    "editorCursor.foreground": "#DDDDDD",
    "editor.lineHighlightBackground": "#281C1C66",
    "editor.selectionBackground": "#A40042",
    "editorWhitespace.foreground": "#5B413D",
    "editorLineNumber.foreground": "#6B4E32",
    "editorLineNumber.activeForeground": "#E6E1C4",
    focusBorder: "#6B98BB",
    foreground: "#E6E1C4",
    "sideBar.background": "#372725",
    "sideBar.foreground": "#E6E1C4",
    "terminal.ansiBlack": "#6A4D32",
    "terminal.ansiBlue": "#6B98BB",
    "terminal.ansiCyan": "#85B4BB",
    "terminal.ansiGreen": "#6BA18A",
    "terminal.ansiMagenta": "#BB94B4",
    "terminal.ansiRed": "#CB4131",
    "terminal.ansiWhite": "#E6E1C3",
    "terminal.ansiYellow": "#EEAC36",
  },
  semanticTokenColors: {
    class: "#EFAC32",
    method: "#BB94B4",
    module: "#6B98BB",
    property: "#E6E1C4",
    variable: "#E6E1C4",
    "variable.builtin": "#7DAF9C",
  },
  settings: [
    {
      settings: {
        background: "var(--background)",
        foreground: "#E6E1C4",
      },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#AB7F5B", fontStyle: "italic" },
    },
    {
      scope: ["constant", "constant.numeric", "constant.language"],
      settings: { foreground: "#6C99BB" },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: { foreground: "#EFAC32" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "entity.name.namespace"],
      settings: { foreground: "#EFAC32", fontStyle: "bold" },
    },
    {
      scope: ["keyword", "storage"],
      settings: { foreground: "#EF5D32" },
    },
    {
      scope: ["keyword.operator", "keyword.operator.comparison"],
      settings: { foreground: "#85B4BB" },
    },
    {
      scope: ["meta", "meta.preprocessor", "support.constant"],
      settings: { foreground: "#6C99BB" },
    },
    {
      scope: "punctuation",
      settings: { foreground: "#E6E1C4" },
    },
    {
      scope: "string",
      settings: { foreground: "#D9D762", fontStyle: "italic" },
    },
    {
      scope: [
        "variable",
        "variable.language",
        "variable.other",
        "variable.parameter",
      ],
      settings: { foreground: "#7DAF9C" },
    },
    {
      scope: "invalid",
      settings: { foreground: "#E6E1C4", background: "#CC4232" },
    },
  ],
}

registerCustomTheme("birds-of-paradise", () =>
  Promise.resolve(birdsOfParadiseTheme)
)

export const BIRDS_OF_PARADISE_THEME = "birds-of-paradise" as const
