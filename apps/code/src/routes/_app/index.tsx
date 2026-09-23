import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "#/components/ui/sidebar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { hasAuthSession } from "#/lib/auth-guard";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import { useAction } from "convex/react";

export const Route = createFileRoute("/_app/")({
	beforeLoad: async () => {
		if (!(await hasAuthSession())) {
			throw redirect({ to: "/login" });
		}
	},
	component: Dashboard,
});

function Dashboard() {
	const createProgram = useAction(api.program.createProgram);

	const { data: programs } = useQuery(convexQuery(api.program.list));

	return (
		<SidebarProvider>
			<Sidebar variant="floating">
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel>Create</SidebarGroupLabel>

						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										onClick={async () => {
											await createProgram({});
										}}
									>
										VEXCode
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>

			<SidebarInset>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{programs?.map((program) => (
							<TableRow key={program._id}>
								<TableCell>{program.name}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</SidebarInset>
		</SidebarProvider>
	);
}
