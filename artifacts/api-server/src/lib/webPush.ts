import { createECDH, createHash } from "node:crypto";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import webpush from "web-push";
import {
  appUsersTable,
  couriersTable,
  db,
  pushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { notifyNativeCouriers } from "./firebasePush";

type VapidKeyName = "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY";
type NormalizedKey = { value: string; bytes: Buffer };
type VapidConfiguration = {
  publicKey: string;
  keyId: string;
  subject: string;
};

let activeConfigurationSignature: string | null = null;
let lastValidationIssueSignature: string | null = null;
let lastPrunedKeyId: string | null = null;

function stripOuterQuotes(value: string): string {
  return value
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .trim();
}

function extractKeyCandidate(value: string, kind: "PUBLIC" | "PRIVATE"): string {
  const lines = stripOuterQuotes(value)
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .split("\n");
  const label = new RegExp(
    `^(?:VAPID[\\s_-]*)?${kind}[\\s_-]*KEY\\s*[:=]?\\s*(.*)$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trim().match(label);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) return stripOuterQuotes(inline).replace(/[;,]$/, "");
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (/^(?:VAPID[\s_-]*)?(?:PUBLIC|PRIVATE)[\s_-]*KEY\b/i.test(candidate)) break;
      return stripOuterQuotes(candidate).replace(/[;,]$/, "");
    }
    return "";
  }

  return stripOuterQuotes(lines.join("")).replace(
    new RegExp(`^(?:VAPID[\\s_-]*)?${kind}[\\s_-]*KEY\\s*[:=]\\s*`, "i"),
    "",
  );
}

function normalizeVapidKey(
  raw: string | undefined,
  name: VapidKeyName,
  expectedBytes: 32 | 65,
): { key: NormalizedKey } | { error: string } {
  if (!raw?.trim()) return { error: "segredo ausente ou vazio" };

  const kind = name === "VAPID_PUBLIC_KEY" ? "PUBLIC" : "PRIVATE";
  const candidate = extractKeyCandidate(raw, kind).replace(/\s+/g, "");
  if (!candidate) return { error: "nenhum valor foi encontrado após o rótulo da chave" };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(candidate)) {
    return { error: "há caracteres que não pertencem a uma chave Base64/Base64URL" };
  }

  const unpadded = candidate.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) {
    return { error: "codificação Base64 incompleta" };
  }
  const base64 = unpadded.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Buffer.from(
    `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`,
    "base64",
  );
  if (bytes.length !== expectedBytes) {
    return {
      error: `esperados ${expectedBytes} bytes decodificados; recebidos ${bytes.length}`,
    };
  }
  if (expectedBytes === 65 && bytes[0] !== 0x04) {
    return { error: "a chave pública precisa começar com o byte 0x04" };
  }
  return { key: { value: bytes.toString("base64url"), bytes } };
}

function issueSignature(key: string, reason: string): string {
  return createHash("sha256")
    .update(process.env.VAPID_PUBLIC_KEY ?? "")
    .update("\0")
    .update(process.env.VAPID_PRIVATE_KEY ?? "")
    .update("\0")
    .update(process.env.VAPID_SUBJECT ?? "")
    .update("\0")
    .update(key)
    .update("\0")
    .update(reason)
    .digest("hex");
}

function logInvalidConfiguration(key: string, reason: string): void {
  const signature = issueSignature(key, reason);
  if (signature === lastValidationIssueSignature) return;
  lastValidationIssueSignature = signature;
  logger.warn({ key, reason }, "Invalid VAPID configuration");
}

function loadVapidConfiguration(): VapidConfiguration | null {
  const publicResult = normalizeVapidKey(
    process.env.VAPID_PUBLIC_KEY,
    "VAPID_PUBLIC_KEY",
    65,
  );
  if ("error" in publicResult) {
    logInvalidConfiguration("VAPID_PUBLIC_KEY", publicResult.error);
    return null;
  }

  const privateResult = normalizeVapidKey(
    process.env.VAPID_PRIVATE_KEY,
    "VAPID_PRIVATE_KEY",
    32,
  );
  if ("error" in privateResult) {
    logInvalidConfiguration("VAPID_PRIVATE_KEY", privateResult.error);
    return null;
  }

  const subject = stripOuterQuotes(process.env.VAPID_SUBJECT ?? "");
  if (!/^(?:mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/i.test(subject)) {
    logInvalidConfiguration(
      "VAPID_SUBJECT",
      "informe um endereço mailto: válido ou uma URL HTTPS",
    );
    return null;
  }

  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateResult.key.bytes);
    const derivedPublicKey = ecdh.getPublicKey(undefined, "uncompressed");
    if (!derivedPublicKey.equals(publicResult.key.bytes)) {
      logInvalidConfiguration(
        "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY",
        "as chaves pública e privada não formam o mesmo par P-256",
      );
      return null;
    }
  } catch {
    logInvalidConfiguration(
      "VAPID_PRIVATE_KEY",
      "o valor não é uma chave privada P-256 válida",
    );
    return null;
  }

  const signature = createHash("sha256")
    .update(publicResult.key.value)
    .update("\0")
    .update(privateResult.key.value)
    .update("\0")
    .update(subject)
    .digest("hex");
  const keyId = createHash("sha256")
    .update(publicResult.key.value)
    .digest("hex")
    .slice(0, 24);

  try {
    if (signature !== activeConfigurationSignature) {
      webpush.setVapidDetails(
        subject,
        publicResult.key.value,
        privateResult.key.value,
      );
      activeConfigurationSignature = signature;
    }
  } catch (error) {
    logInvalidConfiguration(
      "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT",
      error instanceof Error ? error.message : "a biblioteca rejeitou a configuração",
    );
    return null;
  }

  lastValidationIssueSignature = null;
  return { publicKey: publicResult.key.value, keyId, subject };
}

export function getPushConfig() {
  const config = loadVapidConfiguration();
  return {
    enabled: Boolean(config),
    publicKey: config?.publicKey ?? null,
  };
}

export function getVapidPublicKey(): string | null {
  return loadVapidConfiguration()?.publicKey ?? null;
}

export function getVapidKeyId(): string | null {
  return loadVapidConfiguration()?.keyId ?? null;
}

export async function pruneStalePushSubscriptions(keyId: string): Promise<void> {
  if (lastPrunedKeyId === keyId) return;
  const removed = await db
    .delete(pushSubscriptionsTable)
    .where(
      or(
        isNull(pushSubscriptionsTable.vapidKeyId),
        ne(pushSubscriptionsTable.vapidKeyId, keyId),
      ),
    )
    .returning({ id: pushSubscriptionsTable.id });
  lastPrunedKeyId = keyId;
  if (removed.length) {
    logger.info(
      { removedCount: removed.length, keyId },
      "Removed push subscriptions created with an older VAPID key",
    );
  }
}

async function sendToSubscription(
  subscription: typeof pushSubscriptionsTable.$inferSelect,
  payload: { title: string; body: string; url?: string },
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return true;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      await db
        .delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.id, subscription.id));
    }
    logger.warn(
      { subscriptionId: subscription.id, statusCode },
      "Failed to send web push notification",
    );
    return false;
  }
}

export async function notifyCouriers(
  courierIds: string[],
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!courierIds.length) return;
  await notifyNativeCouriers(courierIds, payload);
  const config = loadVapidConfiguration();
  if (!config) {
    logger.warn("Web push is not configured; notification was not sent");
    return;
  }
  try {
    await pruneStalePushSubscriptions(config.keyId);
    const subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(inArray(pushSubscriptionsTable.courierId, courierIds));
    await Promise.all(
      subscriptions.map((subscription) =>
        sendToSubscription(subscription, payload),
      ),
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not load courier push subscriptions");
  }
}

export async function notifyCentralUsers(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  const config = loadVapidConfiguration();
  if (!config) {
    logger.warn("Web push is not configured; Central notification was not sent");
    return;
  }
  try {
    await pruneStalePushSubscriptions(config.keyId);
    const users = await db
      .select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(inArray(appUsersTable.role, ["ADMIN", "CENTRAL"]));
    if (!users.length) return;
    const subscriptions = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(inArray(
        pushSubscriptionsTable.userId,
        users.map((user) => user.id),
      ));
    await Promise.all(
      subscriptions.map((subscription) =>
        sendToSubscription(subscription, payload),
      ),
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not load Central push subscriptions");
  }
}

export async function notifyAvailableCouriers(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
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
