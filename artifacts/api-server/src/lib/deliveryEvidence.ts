import { and, eq } from "drizzle-orm";
import {
  db,
  deliveryEvidenceUploadsTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

export async function verifyEvidenceUpload(
  deliveryId: string,
  courierId: string,
  objectPath: string,
) {
  const [upload] = await db
    .select()
    .from(deliveryEvidenceUploadsTable)
    .where(
      and(
        eq(deliveryEvidenceUploadsTable.objectPath, objectPath),
        eq(deliveryEvidenceUploadsTable.deliveryId, deliveryId),
        eq(deliveryEvidenceUploadsTable.courierId, courierId),
      ),
    )
    .limit(1);
  if (!upload) return false;
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    return (
      ["image/jpeg", "image/png", "image/webp"].includes(
        String(metadata.contentType ?? ""),
      ) &&
      Number(metadata.size ?? 0) > 0 &&
      Number(metadata.size ?? 0) <= 8 * 1024 * 1024
    );
  } catch {
    return false;
  }
}
