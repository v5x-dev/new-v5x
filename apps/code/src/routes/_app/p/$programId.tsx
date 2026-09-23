import { ProgramTree } from "#/components/program-tree";
import { ProgramEditor } from "#/components/program-editor";
import {
	Sidebar,
	SidebarContent,
	SidebarInset,
	SidebarProvider,
} from "#/components/ui/sidebar";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAction, useConvexAuth } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { hasAuthSession } from "#/lib/auth-guard";

export const Route = createFileRoute("/_app/p/$programId")({
	beforeLoad: async () => {
		if (!(await hasAuthSession())) throw redirect({ to: "/login" });
	},
	component: RouteComponent,
});

function RouteComponent() {
	const { isAuthenticated } = useConvexAuth();
	return (
		<SidebarProvider>
			{isAuthenticated ? <AuthenticatedProgram /> : (
				<>
					<Sidebar variant="floating"><SidebarContent /></Sidebar>
					<SidebarInset className="max-h-screen overflow-hidden">
						<p className="p-4">Loading files...</p>
					</SidebarInset>
				</>
			)}
		</SidebarProvider>
	);
}

function AuthenticatedProgram() {
	const { programId } = Route.useParams();
	const id = programId as Id<"program">;
	const listFiles = useAction(api.program.files);
	const readFile = useAction(api.program.readFile);
	const saveFile = useAction(api.program.saveFile);
	const load = useCallback((path: string) => readFile({ programId: id, path }), [readFile, id]);
	const save = useCallback(async (path: string, contents: string) => {
		await saveFile({ programId: id, path, contents });
	}, [saveFile, id]);
	const [paths, setPaths] = useState<string[]>();
	const [selectedPath, setSelectedPath] = useState<string>();
	const [error, setError] = useState<string>();
	const drafts = useRef(new Map<string, string>());

	useEffect(() => {
		let active = true;
		setPaths(undefined);
		setSelectedPath(undefined);
		setError(undefined);
		drafts.current.clear();
		listFiles({ programId: id }).then(
			(files) => {
				if (active) {
					setPaths(files);
					if (files.includes("src/main.cpp")) setSelectedPath("src/main.cpp");
				}
			},
			(err) => { if (active) setError(String(err)); },
		);
		return () => { active = false; };
	}, [id, listFiles]);

	return (
		<>
			<Sidebar variant="floating">
				<SidebarContent>
					{paths && <ProgramTree paths={paths} onSelect={setSelectedPath} />}
				</SidebarContent>
			</Sidebar>

			<SidebarInset className="max-h-screen overflow-hidden">
				{error ? <p className="p-4 text-destructive">{error}</p> : !paths ? <p className="p-4">Loading files...</p> : selectedPath ? (
					<ProgramEditor key={selectedPath} path={selectedPath} load={load} save={save} initialDraft={drafts.current.get(selectedPath)} onDraft={(contents) => drafts.current.set(selectedPath, contents)} />
				) : <p className="p-4 text-muted-foreground">Select a file to edit.</p>}
			</SidebarInset>
		</>
	);
}
