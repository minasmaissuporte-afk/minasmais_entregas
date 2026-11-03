import webpush from "web-push";
import { and, eq, inArray } from "drizzle-orm";
import {
  appUsersTable,
  couriersTable,
  db,
  pushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "./logger";

const configured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

function normalizeVapidKey(value: string | undefined, expectedBytes: number) {
  if (!value) return null;

  let key = stripWrappingQuotes(value)
    .replace(/\\r?\\n/g, "\n")
    .replace(/^(?:VAPID_)?(?:PUBLIC|PRIVATE)_KEY\s*[:=]\s*/i, "")
    .replace(/^(?:public|private)\s+key\s*:\s*/i, "");
  key = stripWrappingQuotes(key);

  let bytes: Buffer;
  const pemMatch = key.match(
    /^-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----$/,
  );
  if (expectedBytes === 65 && pemMatch) {
    const pemBody = pemMatch[1].replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pemBody)) return null;
    const der = Buffer.from(pemBody, "base64");
    if (
      der.length !== P256_SPKI_PREFIX.length + 65 ||
      !der.subarray(0, P256_SPKI_PREFIX.length).equals(P256_SPKI_PREFIX)
    ) {
      return null;
    }
    bytes = der.subarray(P256_SPKI_PREFIX.length);
  } else {
    key = key.replace(/\s+/g, "");

    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(key)) return null;
    const unpadded = key.replace(/=+$/, "");
    if (unpadded.length % 4 === 1) return null;

    const base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
    bytes = Buffer.from(
      `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`,
      "base64",
    );
  }
  if (bytes.length !== expectedBytes) return null;
  if (expectedBytes === 65 && bytes[0] !== 4) return null;

  return bytes.toString("base64url");
}

let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured || !configured()) return;
  const publicKey = normalizeVapidKey(process.env.VAPID_PUBLIC_KEY, 65);
  const privateKey = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY, 32);
  if (!publicKey || !privateKey) {
    logger.warn("Web push VAPID keys have an invalid format");
    return;
  }
  try {
    webpush.setVapidDetails(
      "mailto:balancocompulsorio@drogariasminasmais.com.br",
      publicKey,
      privateKey,
    );
    vapidConfigured = true;
  } catch {
    logger.warn("Web push VAPID keys could not be configured");
  }
}

export function getPushConfig() {
  const rawPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  const publicKey = rawPublicKey
    ? normalizeVapidKey(rawPublicKey, 65) ?? rawPublicKey
    : null;
  return {
    enabled: Boolean(rawPublicKey && process.env.VAPID_PRIVATE_KEY?.trim()),
    publicKey,
  };
}

export async function notifyCouriers(
  courierIds: string[],
  payload: { title: string; body: string; url?: string },
) {
  if (!courierIds.length) return;
  configureVapid();
  if (!vapidConfigured) {
    logger.warn("Web push is not configured; notification was not sent");
    return;
  }
  try {
    const subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.courierId, courierIds));
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 },
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, subscription.id));
          return;
        }
        logger.warn({ err: error }, "Failed to send web push notification");
        }
      }),
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not load courier push subscriptions");
  }
}

export async function notifyAvailableCouriers(payload: {
  title: string;
  body: string;
  url?: string;
}) {
  try {
    const linkedCouriers = await db
      .select({ courierId: appUsersTable.courierId })
      .from(appUsersTable)
      .innerJoin(couriersTable, eq(appUsersTable.courierId, couriersTable.id))
      .where(
        and(
          eq(appUsersTable.role, "COURIER"),
          inArray(couriersTable.status, ["AVAILABLE", "OFFLINE"]),
        ),
      );
    await notifyCouriers(
      [...new Set(linkedCouriers.flatMap((courier) => courier.courierId ?? []))],
      payload,
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not identify eligible couriers for push");
  }
}
