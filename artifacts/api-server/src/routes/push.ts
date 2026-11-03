import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  RemovePushSubscriptionBody,
  SavePushSubscriptionBody,
  GetVapidPublicKeyResponse,
  SendPushTestResponse,
} from "@workspace/api-zod";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { requireAuthentication, requireRole, type AppUserProfile } from "../middlewares/accessControl";
import {
  getPushConfig,
  getVapidKeyId,
  getVapidPublicKey,
  pruneStalePushSubscriptions,
  sendTestPushToCourier,
} from "../lib/webPush";

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
  "/push/test",
  requireAuthentication,
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    const keyId = getVapidKeyId();
    if (!keyId) {
      res.status(503).json({ error: "A configuração VAPID está ausente ou inválida." });
      return;
    }
    await pruneStalePushSubscriptions(keyId);
    const result = await sendTestPushToCourier(profile.courierId);
    if (result.total === 0) {
      res.status(404).json({ error: "Ative as notificações neste aparelho antes de enviar o teste." });
      return;
    }
    if (result.sent === 0) {
      res.status(502).json({ error: "O serviço de notificações rejeitou o teste. Confira os logs da API." });
      return;
    }
    req.log.info(
      { sent: result.sent, failed: result.failed, total: result.total },
      "Test push accepted by browser push services",
    );
    res.json(SendPushTestResponse.parse({ sent: result.sent, failed: result.failed }));
  },
);

router.post(
  "/push/subscription",
  requireAuthentication,
  requireRole("COURIER"),
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
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    await db
      .insert(pushSubscriptionsTable)
      .values({
        id: randomUUID(),
        courierId: profile.courierId,
        endpoint: body.data.endpoint,
        p256dh: body.data.p256dh,
        auth: body.data.auth,
        vapidKeyId: keyId,
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          courierId: profile.courierId,
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
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const body = RemovePushSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const profile = res.locals.appUser as AppUserProfile;
    if (!profile.courierId) {
      res.status(403).json({ error: "Esta conta não está vinculada a um motoboy." });
      return;
    }
    await db
      .delete(pushSubscriptionsTable)
      .where(
        and(
          eq(pushSubscriptionsTable.endpoint, body.data.endpoint),
          eq(pushSubscriptionsTable.courierId, profile.courierId),
        ),
      );
    res.sendStatus(204);
  },
);

export default router;
