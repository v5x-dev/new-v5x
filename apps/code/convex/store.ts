import { GitStorage } from "@pierre/storage";

export function getStore() {
	const key = process.env.PIERRE_PRIVATE_KEY;
	if (!key) throw new Error("PIERRE_PRIVATE_KEY is not configured");

	return new GitStorage({ name: "v5x", key });
}
