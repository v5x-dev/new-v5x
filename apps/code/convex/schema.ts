import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	program: defineTable({
		name: v.string(),
		repoId: v.string(),
		ownerId: v.string(),
	}).index("by_owner", ["ownerId"]),
});
