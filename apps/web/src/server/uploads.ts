import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { decodeBytes } from "@tz/domain";
import { UserError } from "@/lib/errors";
import type { AppContext } from "@/lib/session";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 50;

export type DocKind = "invoice" | "pos_export";

const KIND_TYPES: Record<DocKind, string[]> = {
  invoice: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv"],
  pos_export: ["text/csv"],
};

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/csv": "csv",
};

/**
 * Identify a file from its bytes. The browser-declared type and the file
 * name are ignored: only content decides what we accept.
 */
export function sniff(bytes: Uint8Array): string | null {
  const b = bytes;
  const starts = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  // Text: no NUL bytes in the first 64 KB and it decodes.
  const head = b.subarray(0, 65536);
  if (head.includes(0) && !(b[0] === 0xff && b[1] === 0xfe) && !(b[0] === 0xfe && b[1] === 0xff)) return null;
  const { text } = decodeBytes(head);
  if (/[\x00-\x08\x0e-\x1f]/.test(text.replace(/﻿/, ""))) return null;
  if (/^\s*</.test(text)) return null; // HTML/XML/SVG are not accepted as CSV
  return "text/csv";
}

/** Page count from the PDF object tree. Bounded; used to reject oversized documents. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length || 1;
}

export interface StoredDocument {
  id: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  storagePath: string;
}

export async function storeUpload(app: AppContext, kind: DocKind, file: File): Promise<StoredDocument> {
  if (file.size <= 0) throw new UserError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Files must be 25 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = sniff(bytes);
  if (!mimeType || !KIND_TYPES[kind].includes(mimeType)) {
    throw new UserError(kind === "invoice" ? "Upload a PDF, a photo (JPEG, PNG, WebP) or a CSV file." : "Upload a CSV export.");
  }
  let pageCount: number | null = null;
  if (mimeType === "application/pdf") {
    pageCount = pdfPageCount(bytes);
    if (pageCount > MAX_PDF_PAGES) throw new UserError(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(Buffer.from(bytes).toString("latin1"))) {
      // We never execute document content; active content is rejected outright.
      throw new UserError("This PDF contains scripts or embedded files and cannot be accepted.");
    }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = randomUUID();
  const storagePath = `org/${app.org.orgId}/${kind}/${id}.${EXT[mimeType]}`;
  const up = await app.supabase.storage.from("documents").upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (up.error) throw new UserError("The file could not be stored. Try again.");
  const safeName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || `upload.${EXT[mimeType]}`;
  const ins = await app.supabase.from("documents").insert({
    id,
    org_id: app.org.orgId,
    location_id: app.location.id,
    kind,
    storage_path: storagePath,
    filename: safeName,
    mime_type: mimeType,
    size_bytes: bytes.length,
    sha256,
    page_count: pageCount,
    uploaded_by: app.user.id,
    retain_until: new Date(Date.now() + (kind === "invoice" ? 7 * 365 : 2 * 365) * 86400000).toISOString().slice(0, 10),
  });
  if (ins.error) throw new UserError("The file could not be recorded. Try again.");
  return { id, sha256, mimeType, sizeBytes: bytes.length, pageCount, storagePath };
}

/** Short-lived signed URL for viewing a document the member may already read. */
export async function signedDocumentUrl(app: AppContext, documentId: string, seconds = 120): Promise<{ url: string; mimeType: string } | null> {
  const { data: doc } = await app.supabase.from("documents").select("storage_path, mime_type").eq("id", documentId).maybeSingle();
  if (!doc) return null;
  const { data } = await app.supabase.storage.from("documents").createSignedUrl(doc.storage_path, seconds);
  return data?.signedUrl ? { url: data.signedUrl, mimeType: doc.mime_type } : null;
}
