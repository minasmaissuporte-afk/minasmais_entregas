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

const bootstrapAdminEmails = new Set(
  [process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_EMAILS]
    .flatMap((value) => value?.split(/[;,\s]+/) ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

export const requireAuthentication: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
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

export async function resolveAppUser(clerkUserId: string) {
  const [linkedProfile] = await db
    .select()
    .from(appUsersTable)
    .where(eq(appUsersTable.clerkUserId, clerkUserId))
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
        clerkUserId,
        name,
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
