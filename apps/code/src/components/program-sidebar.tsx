import { HammerIcon } from "@phosphor-icons/react";
import { ProgramTree } from "#/components/program-tree";
import { Button } from "#/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "#/components/ui/sidebar";

export function ProgramSidebar({
	name,
	paths,
	modifiedPaths,
	onSelect,
	onCommitContainer,
	onBuild,
	building,
}: {
	name?: string;
	paths?: string[];
	modifiedPaths: ReadonlySet<string>;
	onSelect: (path: string) => void;
	onCommitContainer: (element: HTMLDivElement | null) => void;
	onBuild: () => void;
	building: boolean;
}) {
	return (
		<Sidebar variant="floating">
			<SidebarHeader>
				<span
					className="truncate p-1 pb-0 text-xs font-medium text-muted-foreground"
					title={name}
				>
					{name}
				</span>
			</SidebarHeader>
			<SidebarContent>
				{paths && (
					<ProgramTree
						paths={paths}
						modifiedPaths={modifiedPaths}
						onSelect={onSelect}
					/>
				)}
			</SidebarContent>
			<SidebarFooter>
				<div className="flex items-center gap-1">
					<div ref={onCommitContainer} />
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Build program"
						title="Build program"
						disabled={building}
						onClick={onBuild}
					>
						<HammerIcon className={building ? "animate-hammer" : undefined} />
					</Button>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
