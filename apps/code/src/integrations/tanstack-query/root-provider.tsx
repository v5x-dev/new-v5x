import { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryClient } from "@tanstack/react-query";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;

export function getContext() {
	if (!CONVEX_URL) {
		throw new Error("VITE_CONVEX_URL is not configured");
	}

	const convexQueryClient = new ConvexQueryClient(CONVEX_URL);
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				queryFn: convexQueryClient.queryFn(),
				queryKeyHashFn: convexQueryClient.hashFn(),
			},
		},
	});

	convexQueryClient.connect(queryClient);

	return {
		queryClient,
		convexQueryClient,
	};
}
export default function TanstackQueryProvider() {}
