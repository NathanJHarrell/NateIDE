import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

async function getOwnerHandleMap(
  ctx: { db: any },
  ownerIds: Set<string>,
): Promise<Map<string, string>> {
  const owners = await Promise.all(
    [...ownerIds].map(async (id) => {
      const user = await ctx.db.get(id as Id<"users">);
      return user ? { id: user._id as string, handle: user.handle as string } : null;
    }),
  );
  return new Map(
    owners.filter(Boolean).map((o) => [o!.id, o!.handle]),
  );
}

// ── Queries ──────────────────────────────────────────────────

/** Get trending public projects/harnesses (ordered by star count). */
export const trending = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Fetch public projects sorted by starCount (descending)
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    // Sort by starCount descending, then by updatedAt descending
    projects.sort((a, b) => {
      if (b.starCount !== a.starCount) return b.starCount - a.starCount;
      return b.updatedAt - a.updatedAt;
    });

    const topProjects = projects.slice(0, limit);

    // Fetch public harnesses
    const harnesses = await ctx.db
      .query("harnesses")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    // For harnesses, count stars
    const harnessResults = await Promise.all(
      harnesses.map(async (h) => {
        const stars = await ctx.db
          .query("stars")
          .withIndex("by_target", (q) =>
            q.eq("targetType", "harness").eq("targetId", h._id),
          )
          .collect();
        return { ...h, starCount: stars.length };
      }),
    );

    harnessResults.sort((a, b) => {
      if (b.starCount !== a.starCount) return b.starCount - a.starCount;
      return b.updatedAt - a.updatedAt;
    });

    const topHarnesses = harnessResults.slice(0, limit);

    // Build unified results with owner handles
    const ownerIds = new Set<string>();
    for (const p of topProjects) ownerIds.add(p.ownerId);
    for (const h of topHarnesses) ownerIds.add(h.createdBy);

    const ownerMap = await getOwnerHandleMap(ctx, ownerIds);

    const results = [
      ...topProjects.map((p) => ({
        type: "project" as const,
        id: p._id,
        name: p.name,
        description: p.description,
        ownerHandle: ownerMap.get(p.ownerId) ?? "unknown",
        starCount: p.starCount,
        tags: p.tags,
        updatedAt: p.updatedAt,
      })),
      ...topHarnesses.map((h) => ({
        type: "harness" as const,
        id: h._id,
        name: h.name,
        description: h.description,
        ownerHandle: ownerMap.get(h.createdBy) ?? "unknown",
        starCount: h.starCount,
        tags: [] as string[],
        updatedAt: h.updatedAt,
      })),
    ];

    // Final sort by star count
    results.sort((a, b) => {
      if (b.starCount !== a.starCount) return b.starCount - a.starCount;
      return b.updatedAt - a.updatedAt;
    });

    return results.slice(0, limit);
  },
});

/** Get recently published public artifacts. */
export const recent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    const harnesses = await ctx.db
      .query("harnesses")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    // Build owner handle map
    const ownerIds = new Set<string>();
    for (const p of projects) ownerIds.add(p.ownerId);
    for (const h of harnesses) ownerIds.add(h.createdBy);

    const ownerMap = await getOwnerHandleMap(ctx, ownerIds);

    const results = [
      ...projects.map((p) => ({
        type: "project" as const,
        id: p._id,
        name: p.name,
        description: p.description,
        ownerHandle: ownerMap.get(p.ownerId) ?? "unknown",
        starCount: p.starCount,
        tags: p.tags,
        updatedAt: p.updatedAt,
      })),
      ...harnesses.map((h) => ({
        type: "harness" as const,
        id: h._id,
        name: h.name,
        description: h.description,
        ownerHandle: ownerMap.get(h.createdBy) ?? "unknown",
        starCount: 0,
        tags: [] as string[],
        updatedAt: h.updatedAt,
      })),
    ];

    // Sort by creation/update time descending (most recent first)
    results.sort((a, b) => b.updatedAt - a.updatedAt);

    return results.slice(0, limit);
  },
});

/** Full-text search across public artifacts. */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const q = args.query.toLowerCase();

    // Search projects using the search index
    const projectResults = await ctx.db
      .query("projects")
      .withSearchIndex("search_projects", (s) =>
        s.search("name", args.query).eq("visibility", "public"),
      )
      .collect();

    // Also do a manual description/tag search for projects
    const allPublicProjects = await ctx.db
      .query("projects")
      .withIndex("by_visibility", (qb) => qb.eq("visibility", "public"))
      .collect();

    const descriptionMatches = allPublicProjects.filter(
      (p) =>
        !projectResults.find((r) => r._id === p._id) &&
        (p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))),
    );

    const allMatches = [...projectResults, ...descriptionMatches];

    // Search public harnesses
    const allHarnesses = await ctx.db
      .query("harnesses")
      .withIndex("by_visibility", (qb) => qb.eq("visibility", "public"))
      .collect();

    const matchingHarnesses = allHarnesses.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.description.toLowerCase().includes(q),
    );

    // Build owner handle map
    const ownerIds = new Set<string>();
    for (const p of allMatches) ownerIds.add(p.ownerId);
    for (const h of matchingHarnesses) ownerIds.add(h.createdBy);

    const ownerMap = await getOwnerHandleMap(ctx, ownerIds);

    return [
      ...allMatches.map((p) => ({
        type: "project" as const,
        id: p._id,
        name: p.name,
        description: p.description,
        ownerHandle: ownerMap.get(p.ownerId) ?? "unknown",
        starCount: p.starCount,
        tags: p.tags,
        updatedAt: p.updatedAt,
      })),
      ...matchingHarnesses.map((h) => ({
        type: "harness" as const,
        id: h._id,
        name: h.name,
        description: h.description,
        ownerHandle: ownerMap.get(h.createdBy) ?? "unknown",
        starCount: 0,
        tags: [] as string[],
        updatedAt: h.updatedAt,
      })),
    ];
  },
});

/** Browse artifacts by tag. */
export const byTag = query({
  args: { tag: v.string() },
  handler: async (ctx, args) => {
    const tag = args.tag.toLowerCase();

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .collect();

    const matching = projects.filter((p) =>
      p.tags.some((t) => t.toLowerCase() === tag),
    );

    // Build owner handle map
    const ownerIds = new Set<string>();
    for (const p of matching) ownerIds.add(p.ownerId);

    const ownerMap = await getOwnerHandleMap(ctx, ownerIds);

    return matching.map((p) => ({
      type: "project" as const,
      id: p._id,
      name: p.name,
      description: p.description,
      ownerHandle: ownerMap.get(p.ownerId) ?? "unknown",
      starCount: p.starCount,
      tags: p.tags,
      updatedAt: p.updatedAt,
    }));
  },
});
