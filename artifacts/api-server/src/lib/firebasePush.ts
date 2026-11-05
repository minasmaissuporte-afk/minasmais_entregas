import { createHash } from "node:crypto";
import { inArray } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { db, nativePushTokensTable } from "@workspace/db";
import { logger } from "./logger";

type FcmPayload = { title: string; body: string; url?: string };
type FirebaseServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FIREBASE_PROJECT_ID = "minas-mais-entregas";
let cachedCredentialSignature: string | null = null;
let cachedFirebase:
  | { projectId: string; auth: GoogleAuth }
  | null = null;

function getFirebaseConfig(): { projectId: string; auth: GoogleAuth } | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  const signature = createHash("sha256").update(raw).digest("hex");
  if (signature === cachedCredentialSignature) return cachedFirebase;

  try {
    const account = JSON.parse(raw) as FirebaseServiceAccount;
    if (
      !account.project_id ||
      !account.client_email ||
      !account.private_key ||
      account.project_id !== FIREBASE_PROJECT_ID ||
      !account.client_email.endsWith(".iam.gserviceaccount.com") ||
      !account.private_key.includes("-----BEGIN PRIVATE KEY-----")
    ) {
      logger.error(
        {
          missingFields: [
            !account.project_id && "project_id",
            !account.client_email && "client_email",
            !account.private_key && "private_key",
          ].filter(Boolean),
          projectIdMatchesAndroidConfig: account.project_id === FIREBASE_PROJECT_ID,
          serviceAccountEmailValid: account.client_email?.endsWith(".iam.gserviceaccount.com") ?? false,
          privateKeyFormatValid: account.private_key?.includes("-----BEGIN PRIVATE KEY-----") ?? false,
        },
        "Firebase service-account secret is invalid or does not match the Android app project",
      );
      cachedCredentialSignature = signature;
      cachedFirebase = null;
      return null;
    }
    cachedCredentialSignature = signature;
    cachedFirebase = {
      projectId: account.project_id,
      auth: new GoogleAuth({
        credentials: {
          project_id: account.project_id,
          client_email: account.client_email,
          private_key: account.private_key.replace(/\\n/g, "\n"),
        },
        scopes: [FCM_SCOPE],
      }),
    };
    return cachedFirebase;
  } catch (error) {
    logger.error({ err: error }, "Firebase service-account secret is not valid JSON");
    cachedCredentialSignature = signature;
    cachedFirebase = null;
    return null;
  }
}

export function isFirebasePushConfigured(): boolean {
  return getFirebaseConfig() !== null;
}

async function sendToDevice(
  firebase: { projectId: string; auth: GoogleAuth },
  token: string,
  payload: FcmPayload,
): Promise<"sent" | "invalid" | "failed"> {
  try {
    const client = await firebase.auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) throw new Error("Google OAuth did not return an access token");

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebase.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: { url: payload.url ?? "/user-portal" },
            android: {
              priority: "HIGH",
              notification: { channel_id: "delivery-updates" },
            },
          },
        }),
      },
    );

    if (response.ok) return "sent";
    const failure = (await response.json().catch(() => null)) as
      | { error?: { status?: string; code?: number; message?: string; details?: Array<{ errorCode?: string }> } }
      | null;
    const invalid =
      response.status === 404 ||
      failure?.error?.status === "NOT_FOUND" ||
      failure?.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED");
    logger.warn(
      {
        statusCode: response.status,
        status: failure?.error?.status,
        message: failure?.error?.message,
      },
      "Firebase push delivery failed",
    );
    return invalid ? "invalid" : "failed";
  } catch (error) {
    logger.warn({ err: error }, "Could not send Firebase push notification");
    return "failed";
  }
}

export async function notifyNativeCouriers(
  courierIds: string[],
  payload: FcmPayload,
): Promise<void> {
  if (!courierIds.length) return;
  try {
    const tokens = await db
      .select({ id: nativePushTokensTable.id, token: nativePushTokensTable.token })
      .from(nativePushTokensTable)
      .where(inArray(nativePushTokensTable.courierId, courierIds));
    if (!tokens.length) return;
    const firebase = getFirebaseConfig();
    if (!firebase) {
      logger.warn("Firebase push is not configured; native courier notification was skipped");
      return;
    }

    const results = await Promise.all(
      tokens.map(async (entry) => ({
        entry,
        result: await sendToDevice(firebase, entry.token, payload),
      })),
    );
    const staleIds = results
      .filter(({ result }) => result === "invalid")
      .map(({ entry }) => entry.id);
    if (staleIds.length) {
      await db
        .delete(nativePushTokensTable)
        .where(inArray(nativePushTokensTable.id, staleIds));
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not load native courier push tokens");
  }
}
