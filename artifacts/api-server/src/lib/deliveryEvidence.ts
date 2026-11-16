import { and, eq } from "drizzle-orm";
import {
  db,
  deliveryEvidenceUploadsTable,
} from "@workspace/db";
import {
  EVIDENCE_CONTENT_TYPES,
  EVIDENCE_MAX_BYTES,
  getEvidenceMetadata,
} from "./evidenceStorage";

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
    const metadata = await getEvidenceMetadata(objectPath);
    return Boolean(
      metadata &&
        (EVIDENCE_CONTENT_TYPES as readonly string[]).includes(metadata.contentType) &&
        metadata.size > 0 &&
        metadata.size <= EVIDENCE_MAX_BYTES,
    );
  } catch {
    return false;
  }
}
