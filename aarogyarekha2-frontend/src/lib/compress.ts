export const COMPRESS = { maxSide: 1600, quality: 0.78, normalAboveBytes: 2 * 1024 * 1024, lowDataAboveBytes: 300 * 1024 } as const;

export const shouldCompress = (file: { type: string; size: number }, lowData: boolean): boolean =>
  /^image\/(jpeg|png)$/.test(file.type) && file.size > (lowData ? COMPRESS.lowDataAboveBytes : COMPRESS.normalAboveBytes);

export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: Math.max(1, w), height: Math.max(1, h) };
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

export async function compressImage(file: File, lowData: boolean): Promise<File> {
  if (!shouldCompress(file, lowData)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = fitWithin(bmp.width, bmp.height, lowData ? 1280 : COMPRESS.maxSide);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) return file;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bmp, 0, 0, width, height); bmp.close?.();
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', lowData ? 0.7 : COMPRESS.quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
