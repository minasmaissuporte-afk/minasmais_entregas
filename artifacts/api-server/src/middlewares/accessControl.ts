import { randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";

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

export const requireAuthentication: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Autenticação necessária." });
    return;
  }
  next();
};

export async function resolveAppUser(clerkUserId: string) {
  const [linkedProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (linkedProfile) return linkedProfile;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email = (
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    ""
  )
    .trim()
    .toLowerCase();
  if (!email) return null;

  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    email;
  const bootstrapAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const initialRole = email === bootstrapAdminEmail ? "ADMIN" : "PENDING";
  const [emailProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.email, email))
    .limit(1);

  if (emailProfile) {
    const [linked] = await db
      .update(appUsersTable)
      .set({ clerkUserId, name, updatedAt: new Date() })
      .where(eq(appUsersTable.id, emailProfile.id))
      .returning();
    return linked ?? emailProfile;
  }

  const [created] = await db
    .insert(appUsersTable)
    .values({
      id: randomUUID(),
      clerkUserId,
      email,
      name,
      role: initialRole,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [racedProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId))
    .limit(1);
  return racedProfile ?? null;
}

export function requireRole(...allowedRoles: AppRole[]): RequestHandler {
  return async (req, res, next) => {
    const clerkUserId = getAuth(req).userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }

    try {
      const profile = await resolveAppUser(clerkUserId);
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
