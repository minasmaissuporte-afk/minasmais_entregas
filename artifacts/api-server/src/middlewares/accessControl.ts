import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";
import { getAuthUser, type AuthUser } from "../lib/supabaseAuth";

export const appRoles = [
  "ADMIN",
  "CENTRAL",
  "STORE_MANAGER",
  "STORE_STAFF",
  "COURIER",
  "PENDING",
] as const;

export type AppRole = (typeof appRoles)[number];
export type AppUserProfile = typeof appUsersTable.$inferSelect;

const bootstrapAdminEmails = new Set(
  [process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_EMAILS]
    .flatMap((value) => value?.split(/[;,\s]+/) ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export const requireAuthentication: RequestHandler = (_req, res, next) => {
  if (!getAuthUser(res)) {
    res.status(401).json({ error: "Autenticação necessária." });
    return;
  }
  next();
};

async function getInitialRole(email: string): Promise<AppRole> {
  if (!bootstrapAdminEmails.has(email.trim().toLowerCase())) return "PENDING";
  const [administrator] = await db
    .select({ id: appUsersTable.id })
    .from(appUsersTable)
    .where(eq(appUsersTable.role, "ADMIN"))
    .limit(1);
  return administrator ? "PENDING" : "ADMIN";
}

/**
 * Finds (or creates) the application profile for a signed-in Supabase user.
 * Existing people are matched by e-mail on their first Supabase sign-in, which
 * keeps their role, store, courier link and delivery history.
 */
export async function resolveAppUser(authUser: AuthUser) {
  const authUserId = authUser.id;
  const [linkedProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.authUserId, authUserId))
    .limit(1);
  if (linkedProfile) {
    if (linkedProfile.role !== "PENDING") return linkedProfile;
    const initialRole = await getInitialRole(linkedProfile.email);
    if (initialRole !== "ADMIN") return linkedProfile;
    const [promoted] = await db
      .update(appUsersTable)
      .set({ role: "ADMIN", updatedAt: new Date() })
      .where(eq(appUsersTable.id, linkedProfile.id))
      .returning();
    return promoted ?? linkedProfile;
  }

  const email = authUser.email.trim().toLowerCase();
  if (!email) return null;

  const displayName = authUser.name || email;
  const initialRole = await getInitialRole(email);
  const [emailProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);

  if (emailProfile) {
    const [linked] = await db
      .update(appUsersTable)
      .set({
        authUserId,
        role: initialRole === "ADMIN" ? "ADMIN" : emailProfile.role,
        updatedAt: new Date(),
      })
      .where(eq(appUsersTable.id, emailProfile.id))
      .returning();
    return linked ?? emailProfile;
  }

  const [created] = await db
    .insert(appUsersTable)
    .values({
      id: randomUUID(),
      authUserId,
      email,
      name: displayName,
      role: initialRole,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [racedProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.authUserId, authUserId))
    .limit(1);
  return racedProfile ?? null;
}

export function requireRole(...allowedRoles: AppRole[]): RequestHandler {
  return async (req, res, next) => {
    const authUser = getAuthUser(res);
    if (!authUser) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }

    try {
      const profile = await resolveAppUser(authUser);
      if (!profile || !allowedRoles.includes(profile.role as AppRole)) {
        res.status(403).json({
          error: "Sua conta ainda não tem acesso a esta área.",
        });
        return;
      }
      res.locals.appUser = profile;
      next();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to resolve application access");
      res.status(500).json({ error: "Não foi possível validar o acesso." });
    }
  };
}
