import { registerCustomTheme, type ThemeRegistration } from "@pierre/diffs";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import { EditProvider, File } from "@pierre/diffs/react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import birdsOfParadise from "#/themes/birds-of-paradise.json";
import { FloppyDiskIcon } from "@phosphor-icons/react";

registerCustomTheme(
	"birds-of-paradise",
	async () =>
		({
			...birdsOfParadise,
			type: "dark" as const,
		}) satisfies ThemeRegistration,
);

const editorStyle = {
	"--diffs-bg": "var(--background)",
	"--diffs-font-family": "var(--font-mono)",
} as CSSProperties;

const createEditor: EditorFactory<undefined, undefined> = (
	type,
	options,
	editStateKey,
) => new Editor(type, options, editStateKey);

export function ProgramEditor({
	path,
	load,
	save,
	initialDraft,
	onDraft,
}: {
	path: string;
	load: (path: string) => Promise<string>;
	save: (path: string, contents: string) => Promise<void>;
	initialDraft?: string;
	onDraft: (contents: string) => void;
}) {
	const [contents, setContents] = useState<string>();
	const [draft, setDraft] = useState<string | undefined>(initialDraft);
	const [savedContents, setSavedContents] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [saveError, setSaveError] = useState<string>();

	useEffect(() => {
		let active = true;
		setContents(undefined);
		setDraft(initialDraft);
		setError(undefined);
		load(path).then(
			(text) => {
				if (active) {
					setContents(initialDraft ?? text);
					setSavedContents(text);
				}
			},
			(err) => {
				if (active) setError(String(err));
			},
		);
		return () => {
			active = false;
		};
	}, [path, load, initialDraft]);

	if (error) return <p className="p-4 text-destructive">{error}</p>;
	if (contents === undefined) return <p className="p-4">Loading {path}...</p>;

	return (
		<EditProvider createEditor={createEditor}>
			<div className="flex h-full flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-4 py-2">
					<span className="truncate text-sm">{path}</span>
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={saving || draft === undefined || draft === savedContents}
						onClick={async () => {
							if (draft === undefined) return;
							setSaving(true);
							setSaveError(undefined);
							try {
								await save(path, draft);
								setSavedContents(draft);
							} catch (err) {
								setSaveError(String(err));
							} finally {
								setSaving(false);
							}
						}}
					>
						<FloppyDiskIcon />
					</Button>
				</div>
				{saveError && <p className="p-2 text-destructive">{saveError}</p>}
				<div className="min-h-0 flex-1 overflow-auto">
					<File
						file={{ name: path, contents }}
						options={{
							theme: "birds-of-paradise",
							themeType: "dark",
							disableFileHeader: true,
						}}
						style={editorStyle}
						edit
						onEditChange={(event) => {
							setDraft(event.file.contents);
							onDraft(event.file.contents);
						}}
					/>
				</div>
			</div>
		</EditProvider>
	);
}
