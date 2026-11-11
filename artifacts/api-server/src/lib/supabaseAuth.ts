import type { RequestHandler, Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Supabase Auth on the API side.
 *
 * The web app (and the Android wrapper) send the Supabase access token as
 * `Authorization: Bearer <jwt>`. It is verified locally against the project's
 * public signing keys (JWKS), so no request to Supabase is needed per call.
 * Projects still on the legacy shared secret can set SUPABASE_JWT_SECRET.
 */

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const legacyJwtSecret = process.env.SUPABASE_JWT_SECRET;
const issuer = supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined;
const jwks = supabaseUrl
  ? createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`))
  : null;

async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const options = { issuer, audience: "authenticated" };
  if (legacyJwtSecret) {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(legacyJwtSecret), options);
    return payload;
  }
  if (!jwks) throw new Error("SUPABASE_URL is not configured");
  const { payload } = await jwtVerify(token, jwks, options);
  return payload;
}

function bearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function nameFromMetadata(payload: JWTPayload) {
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const candidate = [metadata.full_name, metadata.name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return candidate?.trim() ?? null;
}

/** Reads the Supabase session (if any) into res.locals.authUser. Never rejects. */
export const supabaseAuthMiddleware: RequestHandler = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const payload = await verifyAccessToken(token);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (payload.sub && email) {
      res.locals.authUser = { id: payload.sub, email, name: nameFromMetadata(payload) } satisfies AuthUser;
    }
  } catch (error) {
    req.log?.debug({ err: error }, "Ignoring invalid or expired access token");
  }
  next();
};

export function getAuthUser(res: { locals: Record<string, unknown> }): AuthUser | null {
  return (res.locals.authUser as AuthUser | undefined) ?? null;
}

/** Deletes a login in Supabase Auth. Needs SUPABASE_SECRET_KEY (server only). */
export async function deleteAuthUser(authUserId: string) {
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required to delete logins");
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    // New `sb_secret_…` keys go only in `apikey`; legacy service_role keys are JWTs and also go in Authorization.
    headers: secretKey.startsWith("sb_secret_")
      ? { apikey: secretKey }
      : { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  // 404: the login was already removed, which is the desired end state.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Supabase Auth admin delete failed with status ${response.status}`);
  }
}
