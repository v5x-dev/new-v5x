import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProgramEditor } from "#/components/program-editor";
import { ProgramSidebar } from "#/components/program-sidebar";
import {
	Sidebar,
	SidebarContent,
	SidebarInset,
	SidebarProvider,
} from "#/components/ui/sidebar";
import { Spinner } from "#/components/ui/spinner";
import { hasAuthSession } from "#/lib/auth-guard";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

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
			{isAuthenticated ? (
				<AuthenticatedProgram />
			) : (
				<>
					<Sidebar variant="floating">
						<SidebarContent />
					</Sidebar>
					<SidebarInset className="max-h-screen overflow-hidden">
						<div className="w-full h-full grid place-items-center">
							<Spinner />
						</div>
					</SidebarInset>
				</>
			)}
		</SidebarProvider>
	);
}

function AuthenticatedProgram() {
	const { programId } = Route.useParams();
	const id = programId as Id<"program">;
	const program = useQuery(api.program.get, { programId: id });

	const listFiles = useAction(api.program.files);
	const readFile = useAction(api.program.readFile);
	const saveFile = useAction(api.program.saveFile);
	const buildProgram = useAction(api.programBuild.build);

	const load = useCallback(
		(path: string) => readFile({ programId: id, path }),
		[readFile, id],
	);
	const commit = useCallback(
		async (path: string, contents: string) => {
			await saveFile({ programId: id, path, contents });
		},
		[saveFile, id],
	);

	const [paths, setPaths] = useState<string[]>();
	const [selectedPath, setSelectedPath] = useState<string>();
	const [error, setError] = useState<string>();
	const [building, setBuilding] = useState(false);
	const [modifiedPaths, setModifiedPaths] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [commitContainer, setCommitContainer] = useState<HTMLDivElement | null>(
		null,
	);
	const drafts = useRef(new Map<string, string>());
	const build = async () => {
		setBuilding(true);
		try {
			const result = await buildProgram({ programId: id });
			if (result.exitCode !== 0) console.error("Build failed:", result.stderr);
		} catch (error) {
			console.error("Build failed:", error);
		} finally {
			setBuilding(false);
		}
	};
	const updateStatus = useCallback((path: string, modified: boolean) => {
		setModifiedPaths((previous) => {
			if (previous.has(path) === modified) return previous;

			const next = new Set(previous);
			if (modified) next.add(path);
			else next.delete(path);

			return next;
		});
	}, []);

	useEffect(() => {
		let active = true;

		setPaths(undefined);
		setSelectedPath(undefined);
		setError(undefined);
		setModifiedPaths(new Set());
		drafts.current.clear();

		listFiles({ programId: id }).then(
			(files) => {
				if (active) {
					setPaths(files);
					if (files.includes("src/main.cpp")) setSelectedPath("src/main.cpp");
				}
			},
			(err) => {
				if (active) setError(String(err));
			},
		);

		return () => {
			active = false;
		};
	}, [id, listFiles]);

	return (
		<>
			<ProgramSidebar
				name={program?.name}
				paths={paths}
				modifiedPaths={modifiedPaths}
				onSelect={setSelectedPath}
				onCommitContainer={setCommitContainer}
				onBuild={() => void build()}
				building={building}
			/>

			<SidebarInset className="max-h-screen overflow-hidden">
				{error ? (
					<p className="p-4 text-destructive">{error}</p>
				) : !paths ? (
					<div className="w-full h-full grid place-items-center">
						<Spinner />
					</div>
				) : (
					selectedPath && (
						<ProgramEditor
							key={selectedPath}
							path={selectedPath}
							load={load}
							commit={commit}
							commitContainer={commitContainer}
							initialDraft={drafts.current.get(selectedPath)}
							onDraft={(contents) => drafts.current.set(selectedPath, contents)}
							onStatusChange={(modified) =>
								updateStatus(selectedPath, modified)
							}
							onCommit={(contents) =>
								updateStatus(
									selectedPath,
									drafts.current.get(selectedPath) !== contents,
								)
							}
						/>
					)
				)}
			</SidebarInset>
		</>
	);
}
