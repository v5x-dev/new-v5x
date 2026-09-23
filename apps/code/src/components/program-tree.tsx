import { FileTree, useFileTree } from "@pierre/trees/react";
import type React from "react";

export function ProgramTree({ paths, onSelect }: { paths: readonly string[]; onSelect: (path: string) => void }) {
	const { model } = useFileTree({
		paths,
		initialExpansion: "open",
		search: false,
		onSelectionChange: (selected) => {
			const path = selected.find((item) => paths.includes(item));
			if (path) onSelect(path);
		},
	});

	return (
		<FileTree
			model={model}
			style={
				{
					"--trees-bg-override": "var(--sidebar)",
					"--trees-bg-muted-override":
						"color-mix(in oklch, var(--sidebar-accent) 75%, transparent)",
					"--trees-selected-bg-override": "var(--sidebar-accent)",
					"--trees-fg-override": "var(--foreground)",
					"--trees-font-family-override": "var(--font-serif)",
					"--trees-focus-ring-color-override":
						"color-mix(in oklch, var(--ring) 75%, transparent)",
					"--trees-selected-focused-border-color-override": "var(--ring)",
					"--trees-padding-inline-override": "var(--spacing)",
					"--trees-border-radius-override": "var(--radius)",
				} as React.CSSProperties
			}
			className="rounded-lg py-1"
		/>
	);
}
