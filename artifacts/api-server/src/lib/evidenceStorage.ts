/**
 * Fotos de comprovação de entrega no Supabase Storage (bucket privado).
 *
 * Fluxo:
 * 1. A API cria uma URL assinada de upload (válida por 2 horas) e devolve ao app
 *    junto com o caminho da foto no formato "/objects/<chave>".
 * 2. O app envia a foto direto para o Supabase com PUT nessa URL.
 * 3. Ao concluir a entrega, a API confere tipo e tamanho do arquivo.
 * 4. A central vê a foto pela API, que lê o arquivo com a chave secreta.
 *
 * O formato "/objects/<chave>" é o mesmo usado no Replit: fotos antigas
 * ("/objects/uploads/<id>") continuam válidas se forem copiadas para o bucket
 * com a mesma chave ("uploads/<id>").
 */
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export const EVIDENCE_BUCKET = process.env.SUPABASE_EVIDENCE_BUCKET?.trim() || "delivery-evidence";
export const EVIDENCE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;

const OBJECT_PATH_PREFIX = "/objects/";

export class EvidenceStorageError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
  }
}

function config() {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  ).trim();
  if (!url || !secretKey) {
    throw new EvidenceStorageError(
      "O armazenamento de fotos não está configurado (SUPABASE_URL e SUPABASE_SECRET_KEY).",
    );
  }
  // Chaves novas `sb_secret_…` vão só em `apikey`; as antigas (JWT) também em Authorization.
  const headers: Record<string, string> = secretKey.startsWith("sb_secret_")
    ? { apikey: secretKey }
    : { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
  return { storageUrl: `${url}/storage/v1`, headers };
}

/** Converte "/objects/<chave>" na chave do arquivo dentro do bucket. */
export function objectKeyFromPath(objectPath: string): string {
  if (!objectPath.startsWith(OBJECT_PATH_PREFIX)) {
    throw new EvidenceStorageError("Caminho de foto inválido.", 400);
  }
  const key = objectPath.slice(OBJECT_PATH_PREFIX.length);
  if (!key || key.includes("..") || key.startsWith("/")) {
    throw new EvidenceStorageError("Caminho de foto inválido.", 400);
  }
  return key;
}

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

let bucketReady: Promise<void> | null = null;

/** Cria o bucket privado na primeira utilização (operação idempotente). */
export function ensureEvidenceBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { storageUrl, headers } = config();
      const existing = await fetch(`${storageUrl}/bucket/${encodeURIComponent(EVIDENCE_BUCKET)}`, {
        headers,
      });
      if (existing.ok) return;
      const created = await fetch(`${storageUrl}/bucket`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: EVIDENCE_BUCKET,
          name: EVIDENCE_BUCKET,
          public: false,
          file_size_limit: EVIDENCE_MAX_BYTES,
          allowed_mime_types: EVIDENCE_CONTENT_TYPES,
        }),
      });
      // 409/400 "already exists": outro processo criou ao mesmo tempo.
      if (!created.ok && created.status !== 409) {
        const text = await created.text().catch(() => "");
        if (!/already exists/i.test(text)) {
          throw new EvidenceStorageError(
            `Não foi possível preparar o armazenamento de fotos (status ${created.status}).`,
          );
        }
      }
    })().catch((error: unknown) => {
      bucketReady = null;
      throw error;
    });
  }
  return bucketReady;
}

/** Gera uma URL assinada para o app enviar a foto com PUT. */
export async function createEvidenceUploadUrl(): Promise<{
  uploadURL: string;
  objectPath: string;
}> {
  await ensureEvidenceBucket();
  const { storageUrl, headers } = config();
  const key = `evidence/${randomUUID()}`;
  const response = await fetch(
    `${storageUrl}/object/upload/sign/${encodeURIComponent(EVIDENCE_BUCKET)}/${encodeKey(key)}`,
    { method: "POST", headers },
  );
  if (!response.ok) {
    throw new EvidenceStorageError(
      `Não foi possível gerar o endereço de envio da foto (status ${response.status}).`,
    );
  }
  const payload = (await response.json()) as { url?: string };
  if (!payload.url) {
    throw new EvidenceStorageError("O Supabase não devolveu o endereço de envio da foto.");
  }
  return {
    uploadURL: `${storageUrl}${payload.url}`,
    objectPath: `${OBJECT_PATH_PREFIX}${key}`,
  };
}

/** Tipo e tamanho do arquivo enviado, ou null se ele não existir. */
export async function getEvidenceMetadata(
  objectPath: string,
): Promise<{ contentType: string; size: number } | null> {
  const { storageUrl, headers } = config();
  const key = objectKeyFromPath(objectPath);
  const response = await fetch(
    `${storageUrl}/object/${encodeURIComponent(EVIDENCE_BUCKET)}/${encodeKey(key)}`,
    { method: "HEAD", headers },
  );
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw new EvidenceStorageError(`Falha ao consultar a foto (status ${response.status}).`);
  }
  return {
    contentType: (response.headers.get("content-type") ?? "").split(";")[0]!.trim(),
    size: Number(response.headers.get("content-length") ?? 0),
  };
}

/** Lê a foto para repassar ao navegador. */
export async function downloadEvidence(
  objectPath: string,
): Promise<{ contentType: string; stream: Readable }> {
  const { storageUrl, headers } = config();
  const key = objectKeyFromPath(objectPath);
  const response = await fetch(
    `${storageUrl}/object/${encodeURIComponent(EVIDENCE_BUCKET)}/${encodeKey(key)}`,
    { headers },
  );
  if (!response.ok || !response.body) {
    throw new EvidenceStorageError(
      "A foto de comprovação não está disponível.",
      response.status === 404 || response.status === 400 ? 404 : 503,
    );
  }
  return {
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    stream: Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
  };
}

/** Apaga fotos do bucket. Caminhos inválidos ou já removidos são ignorados. */
export async function deleteEvidence(objectPaths: Iterable<string>): Promise<void> {
  const keys = [...objectPaths].flatMap((objectPath) => {
    try {
      return [objectKeyFromPath(objectPath)];
    } catch {
      return [];
    }
  });
  if (!keys.length) return;
  const { storageUrl, headers } = config();
  const response = await fetch(`${storageUrl}/object/${encodeURIComponent(EVIDENCE_BUCKET)}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!response.ok && response.status !== 404) {
    throw new EvidenceStorageError(`Falha ao apagar fotos (status ${response.status}).`);
  }
}
