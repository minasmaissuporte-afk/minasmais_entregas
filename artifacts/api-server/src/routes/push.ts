import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  RemovePushSubscriptionBody,
  RemoveNativePushTokenBody,
  SaveNativePushTokenBody,
  SavePushSubscriptionBody,
  GetVapidPublicKeyResponse,
} from "@workspace/api-zod";
import { db, nativePushTokensTable, pushSubscriptionsTable } from "@workspace/db";
import { requireAuthentication, requireRole, type AppUserProfile } from "../middlewares/accessControl";
import {
  getPushConfig,
  getVapidKeyId,
  getVapidPublicKey,
  pruneStalePushSubscriptions,
} from "../lib/webPush";
import { isFirebasePushConfigured } from "../lib/firebasePush";

const router: IRouter = Router();

router.get("/push/vapid-public-key", (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ error: "A configuração VAPID está ausente ou inválida." });
    return;
  }
  res.json(GetVapidPublicKeyResponse.parse({ publicKey }));
});

router.get("/push/config", requireAuthentication, (_req, res): void => {
  res.json(getPushConfig());
});

router.post(
  "/push/subscription",
  requireAuthentication,
  requireRole("COURIER", "ADMIN", "CENTRAL"),
  async (req, res): Promise<void> => {
    const body = SavePushSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const keyId = getVapidKeyId();
    if (!keyId) {
      res.status(503).json({ error: "As notificações push ainda não estão configuradas." });
      return;
    }
    await pruneStalePushSubscriptions(keyId);
    const profile = res.locals.appUser as AppUserProfile;
    if (profile.role === "COURIER" && !profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    await db
      .insert(pushSubscriptionsTable)
      .values({
        id: randomUUID(),
        courierId: profile.role === "COURIER" ? profile.courierId : null,
        userId: profile.id,
        endpoint: body.data.endpoint,
        p256dh: body.data.p256dh,
        auth: body.data.auth,
        vapidKeyId: keyId,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          courierId: profile.role === "COURIER" ? profile.courierId : null,
          userId: profile.id,
          p256dh: body.data.p256dh,
          auth: body.data.auth,
          vapidKeyId: keyId,
        },
      });
    res.sendStatus(204);
  },
);

router.delete(
  "/push/subscription",
  requireAuthentication,
  requireRole("COURIER", "ADMIN", "CENTRAL"),
  async (req, res): Promise<void> => {
    const body = RemovePushSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (profile.role === "COURIER" && !profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, body.data.endpoint),
          eq(pushSubscriptionsTable.userId, profile.id),
        ),
      );
    res.sendStatus(204);
  },
);

router.post(
  "/push/native-token",
  requireAuthentication,
  requireRole("COURIER", "ADMIN", "CENTRAL"),
  async (req, res): Promise<void> => {
    const body = SaveNativePushTokenBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (!isFirebasePushConfigured()) {
      res.status(503).json({ error: "As notificações Firebase ainda não estão configuradas no servidor." });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (profile.role === "COURIER" && !profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    await db
      .insert(nativePushTokensTable)
      .values({
        id: randomUUID(),
        courierId: profile.role === "COURIER" ? profile.courierId : null,
        userId: profile.id,
        token: body.data.token,
      })
      .onConflictDoUpdate({
        target: nativePushTokensTable.token,
        set: {
          courierId: profile.role === "COURIER" ? profile.courierId : null,
          userId: profile.id,
          updatedAt: new Date(),
        },
      });
    res.sendStatus(204);
  },
);

router.delete(
  "/push/native-token",
  requireAuthentication,
  requireRole("COURIER", "ADMIN", "CENTRAL"),
  async (req, res): Promise<void> => {
    const body = RemoveNativePushTokenBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    await db
      .delete(nativePushTokensTable)
      .where(
        and(
          eq(nativePushTokensTable.token, body.data.token),
          eq(nativePushTokensTable.userId, profile.id),
        ),
      );
    res.sendStatus(204);
  },
);

export default router;
