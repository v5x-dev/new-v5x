import boring from "boring-name-generator";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { getStore } from "./store";
import { templateFiles } from "./template";

export const createProgram = action({
	args: {
		name: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<Id<"program">> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		const repo = await getStore().createRepo({
			id: args.name || boring({ words: 2, number: true }).dashed,
		});

		const commit = repo.createCommit({
			targetBranch: repo.defaultBranch,
			commitMessage: "Initialize template",
			author: { name: "v5x", email: "beanarchyteam@gmail.com" },
		});

		for (const file of templateFiles) {
			commit.addFileFromString(file.path, file.contents);
		}

		await commit.send();

		return await ctx.runMutation(api.program.create, {
			name: args.name || repo.id,
			repoId: repo.id,
		});
	},
});

export const create = mutation({
	args: {
		name: v.string(),
		repoId: v.string(),
	},
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		return await ctx.db.insert("program", {
			name: args.name,
			repoId: args.repoId,
			ownerId: identity.subject,
		});
	},
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");

		return await ctx.db
			.query("program")
			.withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
			.collect();
	},
});

export const get = query({
	args: { programId: v.id("program") },
	handler: async (ctx, { programId }) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Unauthorized");
		const program = await ctx.db.get(programId);
		if (!program || program.ownerId !== identity.subject) {
			throw new Error("Program not found");
		}
		return program;
	},
});

async function findProgramRepo(
	ctx: ActionCtx,
	programId: Id<"program">,
) {
	const program = await ctx.runQuery(api.program.get, { programId });
	const repo = await getStore().findOne({ id: program.repoId });
	if (!repo) throw new Error("Repository not found");
	return repo;
}

export const files = action({
	args: { programId: v.id("program") },
	handler: async (ctx, { programId }) => {
		const repo = await findProgramRepo(ctx, programId);
		const paths: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await repo.listFiles({ recursive: true, cursor });
			paths.push(
				...page.entries
					.filter((entry) => entry.type === "blob")
					.map((entry) => entry.path),
			);
			cursor = page.nextCursor;
		} while (cursor);
		return paths;
	},
});

export const readFile = action({
	args: { programId: v.id("program"), path: v.string() },
	handler: async (ctx, { programId, path }) => {
		const repo = await findProgramRepo(ctx, programId);
		const response = await repo.getFileStream({ path });
		if (!response.ok) throw new Error("File not found");
		return await response.text();
	},
});

export const saveFile = action({
	args: { programId: v.id("program"), path: v.string(), contents: v.string() },
	handler: async (ctx, { programId, path, contents }) => {
		const repo = await findProgramRepo(ctx, programId);
		await repo
			.createCommit({
				targetBranch: repo.defaultBranch,
				commitMessage: `Update ${path}`,
				author: { name: "v5x", email: "beanarchyteam@gmail.com" },
			})
			.addFileFromString(path, contents)
			.send();
	},
});
