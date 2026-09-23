import {
	type AuthClient,
	ConvexBetterAuthProvider,
} from "@convex-dev/better-auth/react";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { authClient } from "#/lib/auth-client";

export default function AppConvexProvider({
	convexQueryClient,
	children,
}: {
	convexQueryClient: ConvexQueryClient;
	children: React.ReactNode;
}) {
	return (
		<ConvexBetterAuthProvider
			client={convexQueryClient.convexClient}
			authClient={authClient as unknown as AuthClient}
		>
			{children}
		</ConvexBetterAuthProvider>
	);
}
