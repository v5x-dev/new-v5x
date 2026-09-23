import boring from "boring-name-generator";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { getStore } from "./store";

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
