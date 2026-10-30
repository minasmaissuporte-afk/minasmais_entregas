import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

const configured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let vapidConfigured = false;
function configureVapid() {
  if (vapidConfigured || !configured()) return;
  webpush.setVapidDetails(
    "mailto:balancocompulsorio@drogariasminasmais.com.br",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidConfigured = true;
}

export function getPushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || null;
  return { enabled: Boolean(publicKey && process.env.VAPID_PRIVATE_KEY), publicKey };
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
