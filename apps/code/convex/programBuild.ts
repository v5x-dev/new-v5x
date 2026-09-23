"use node";

import { v } from "convex/values";
import { Machine } from "smolmachines";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import { getStore } from "./store";

export const build = action({
	args: { programId: v.id("program") },
	handler: async (ctx, { programId }) => {
		const program = await ctx.runQuery(api.program.get, { programId });
		const repo = await getStore().findOne({ id: program.repoId });
		if (!repo) throw new Error("Repository not found");

		const token = process.env.SMOL_CLOUD_TOKEN;
		if (!token) throw new Error("SMOL_CLOUD_TOKEN is not configured");

		const accountResponse = await fetch(`${process.env.SMOL_CLOUD_URL}/v1/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!accountResponse.ok)
			throw new Error("Could not resolve Smol registry namespace");

		const account: { registryNamespace?: string } =
			await accountResponse.json();

		if (!account.registryNamespace?.startsWith("tenants/")) {
			throw new Error("Smol account has no registry namespace");
		}

		const machine = await Machine.create(
			{
				image: `registry.smolmachines.com/${account.registryNamespace}/vexcode:v1`,
				resources: { cpus: 2, memoryMb: 2048, network: true },
			},
			{ target: "cloud" },
		);

		try {
			const remoteUrl = await repo.getRemoteURL({ permissions: ["git:read"] });
			const clone = await machine.exec([
				"git",
				"clone",
				remoteUrl,
				"/workspace",
			]);
			if (clone.exitCode !== 0) {
				throw new Error(`Clone failed: ${clone.stderr}`);
			}

			const result = await machine.exec(["make"], {
				workdir: "/workspace",
				env: { VEX_SDK_PATH: "/sdk" },
			});
			return {
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
			};
		} finally {
			await machine.delete();
		}
	},
});
