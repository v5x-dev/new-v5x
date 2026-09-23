import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Separator } from "#/components/ui/separator";
import { authClient } from "#/lib/auth-client";
import { DetectiveIcon, GoogleLogoIcon } from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = useNavigate();

	return (
		<div className="grid w-screen h-screen place-items-center">
			<Card className="min-w-2xs">
				<CardHeader>
					<CardTitle className="text-center text-xl">code (by v5x)</CardTitle>
				</CardHeader>
				<Separator />
				<CardContent className="flex flex-col justify-center gap-1 text-center">
					<Button
						onClick={async () => {
							await authClient.signIn.social({ provider: "google" });
							navigate({ to: "/" });
						}}
					>
						<GoogleLogoIcon />
						Sign in with Google
					</Button>
					<span className="text-muted-foreground">or</span>
					<Button variant="outline">
						<DetectiveIcon />
						Sign in anonymously
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
