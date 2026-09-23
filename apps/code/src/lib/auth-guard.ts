import { createServerFn } from "@tanstack/react-start";

export const hasAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getToken } = await import("./auth-server");

		return Boolean(await getToken());
	},
);
