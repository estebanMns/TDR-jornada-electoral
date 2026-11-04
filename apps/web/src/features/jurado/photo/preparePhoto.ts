/** Longest side of the stored photo: readable for auditors, ~150 KB on the wire. */
const MAX_SIDE_PX = 1280;
const JPEG_QUALITY = 0.72;

export interface PreparedPhoto {
  blob: Blob;
  /** SHA-256 (hex) of exactly the bytes that will be uploaded. */
  hash: string;
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** Resizes and re-encodes the camera photo to JPEG, then hashes the result. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', JPEG_QUALITY),
  );
  return { blob, hash: await sha256Hex(blob) };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
