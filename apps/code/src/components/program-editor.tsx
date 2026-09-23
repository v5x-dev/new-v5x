import { registerCustomTheme, type ThemeRegistration } from "@pierre/diffs";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import { EditProvider, File } from "@pierre/diffs/react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import birdsOfParadise from "#/themes/birds-of-paradise.json";
import { GitCommitIcon } from "@phosphor-icons/react";

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
	commit,
	commitContainer,
	initialDraft,
	onDraft,
	onStatusChange,
	onCommit,
}: {
	path: string;
	load: (path: string) => Promise<string>;
	commit: (path: string, contents: string) => Promise<void>;
	commitContainer: HTMLElement | null;
	initialDraft?: string;
	onDraft: (contents: string) => void;
	onStatusChange: (modified: boolean) => void;
	onCommit: (contents: string) => void;
}) {
	const [contents, setContents] = useState<string>();
	const [draft, setDraft] = useState<string | undefined>(initialDraft);
	const [committedContents, setCommittedContents] = useState<string>();
	const [committing, setCommitting] = useState(false);
	const [error, setError] = useState<string>();
	const [commitError, setCommitError] = useState<string>();
	const initialDraftRef = useRef(initialDraft);
	const committingRef = useRef(false);

	const commitDraft = useCallback(async () => {
		if (
			committingRef.current ||
			draft === undefined ||
			draft === committedContents
		)
			return;
		committingRef.current = true;
		setCommitting(true);
		setCommitError(undefined);
		try {
			await commit(path, draft);
			setCommittedContents(draft);
			onCommit(draft);
		} catch (err) {
			setCommitError(String(err));
		} finally {
			committingRef.current = false;
			setCommitting(false);
		}
	}, [commit, committedContents, draft, onCommit, path]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() !== "s" ||
				!(event.ctrlKey || event.metaKey) ||
				event.altKey
			)
				return;
			event.preventDefault();
			void commitDraft();
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [commitDraft]);

	useEffect(() => {
		let active = true;
		setContents(undefined);
		setDraft(initialDraftRef.current);
		setError(undefined);
		load(path).then(
			(text) => {
				if (active) {
					setContents(initialDraftRef.current ?? text);
					setCommittedContents(text);
					onStatusChange(
						initialDraftRef.current !== undefined &&
							initialDraftRef.current !== text,
					);
				}
			},
			(err) => {
				if (active) setError(String(err));
			},
		);
		return () => {
			active = false;
		};
	}, [path, load]);

	if (error) return <p className="p-4 text-destructive">{error}</p>;
	if (contents === undefined) return <p className="p-4">Loading {path}...</p>;

	return (
		<EditProvider createEditor={createEditor}>
			{commitContainer &&
				createPortal(
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Commit file"
						title="Commit file (Ctrl+S)"
						disabled={
							committing || draft === undefined || draft === committedContents
						}
						onClick={() => void commitDraft()}
					>
						<GitCommitIcon />
					</Button>,
					commitContainer,
				)}
			<div className="flex h-full flex-col overflow-hidden">
				{commitError && <p className="p-2 text-destructive">{commitError}</p>}
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
							onStatusChange(event.file.contents !== committedContents);
						}}
					/>
				</div>
			</div>
		</EditProvider>
	);
}
