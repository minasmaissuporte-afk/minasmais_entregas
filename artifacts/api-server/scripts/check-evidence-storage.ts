/**
 * Testa o armazenamento das fotos de comprovação no Supabase Storage.
 * Uso: pnpm check:storage
 *
 * Faz o mesmo caminho do app: cria o bucket (se faltar), gera a URL assinada,
 * envia uma imagem pequena com PUT, confere tipo e tamanho, baixa e apaga.
 * Nunca imprime chaves.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "..", "..", "..", ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const storage = await import("../src/lib/evidenceStorage.ts");

// PNG 1x1 transparente.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let failures = 0;
async function step(name: string, run: () => Promise<string>) {
  process.stdout.write(`• ${name}… `);
  try {
    console.log(`OK — ${await run()}`);
  } catch (error) {
    failures += 1;
    console.log(`FALHOU — ${error instanceof Error ? error.message : String(error)}`);
  }
}

let objectPath = "";
let uploadURL = "";

await step(`Bucket privado "${storage.EVIDENCE_BUCKET}"`, async () => {
  await storage.ensureEvidenceBucket();
  return "pronto";
});

await step("URL assinada de upload", async () => {
  ({ uploadURL, objectPath } = await storage.createEvidenceUploadUrl());
  return `caminho ${objectPath}`;
});

await step("Envio da foto com PUT (como o app faz)", async () => {
  const response = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: PNG,
  });
  if (!response.ok) throw new Error(`status ${response.status}: ${await response.text()}`);
  return `${PNG.length} bytes enviados`;
});

await step("Conferência de tipo e tamanho", async () => {
  const metadata = await storage.getEvidenceMetadata(objectPath);
  if (!metadata) throw new Error("arquivo não encontrado");
  if (metadata.contentType !== "image/png" || metadata.size !== PNG.length) {
    throw new Error(`esperava image/png com ${PNG.length} bytes, veio ${metadata.contentType} com ${metadata.size}`);
  }
  return `${metadata.contentType}, ${metadata.size} bytes`;
});

await step("Download pela API", async () => {
  const { contentType, stream } = await storage.downloadEvidence(objectPath);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (!body.equals(PNG)) throw new Error("conteúdo baixado diferente do enviado");
  return `${contentType}, conteúdo idêntico`;
});

await step("Bucket não é público", async () => {
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = storage.objectKeyFromPath(objectPath);
  const response = await fetch(`${base}/storage/v1/object/public/${storage.EVIDENCE_BUCKET}/${key}`);
  if (response.ok) throw new Error("a foto está acessível sem autenticação!");
  return `acesso público bloqueado (status ${response.status})`;
});

await step("Exclusão da foto", async () => {
  await storage.deleteEvidence([objectPath]);
  const metadata = await storage.getEvidenceMetadata(objectPath);
  if (metadata) throw new Error("a foto continua no bucket");
  return "apagada";
});

console.log("");
console.log(failures ? `${failures} etapa(s) falharam.` : "Tudo certo: armazenamento de fotos funcionando.");
process.exitCode = failures ? 1 : 0;
