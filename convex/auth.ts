import { convexAuth } from "@convex-dev/auth/server";
import GitHub from "@auth/core/providers/github";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, GitHub],
  callbacks: {
    async createOrUpdateUser(ctx, { existingUserId, profile, provider }) {
      // If user already exists, just return their ID (don't overwrite fields)
      if (existingUserId) {
        return existingUserId;
      }

      // Map OAuth/password profile fields to our users table schema
      const name = String(profile.name ?? profile.email ?? "User");
      const emailPrefix = profile.email ? String(profile.email).split("@")[0] : null;
      const handle = (
        emailPrefix ??
        name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      ) + "-" + Date.now().toString(36).slice(-4);

      return ctx.db.insert("users", {
        displayName: name,
        handle,
        avatarUrl: profile.image ?? undefined,
        bio: "",
        profileVisibility: "public" as const,
      });
    },
  },
});
