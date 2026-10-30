import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  RemovePushSubscriptionBody,
  SavePushSubscriptionBody,
} from "@workspace/api-zod";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { requireAuthentication, requireRole, type AppUserProfile } from "../middlewares/accessControl";
import { getPushConfig } from "../lib/webPush";

const router: IRouter = Router();
router.use(requireAuthentication);

router.get("/push/config", (_req, res): void => {
  res.json(getPushConfig());
});

router.post(
  "/push/subscription",
  requireRole("COURIER"),
  async (req, res): Promise<void> => {
    const body = SavePushSubscriptionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const config = getPushConfig();
    if (!config.enabled) {
      res.status(503).json({ error: "As notificações push ainda não estão configuradas." });
      return;
    }
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
      })
      .onConflictDoUpdate({
        target: pushSubscriptionsTable.endpoint,
        set: {
          courierId: profile.courierId,
          p256dh: body.data.p256dh,
          auth: body.data.auth,
        },
      });
    res.sendStatus(204);
  },
);

router.delete(
  "/push/subscription",
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
