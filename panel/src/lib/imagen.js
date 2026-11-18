/** Reduce una foto a JPEG (máx. 1600 px por lado) y la devuelve como data URL. */
export async function comprimir(archivo, max = 1600, calidad = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo?.type ?? '')) throw new Error('La imagen debe ser JPG, PNG o WebP.');
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', calidad);
}

/** Igual que comprimir(), pero devuelve un Blob (sin fetch: la política de seguridad bloquea "data:"). */
export async function comprimirBlob(archivo, max = 1600, calidad = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo?.type ?? '')) throw new Error('La imagen debe ser JPG, PNG o WebP.');
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', calidad));
  if (!blob) throw new Error('No se pudo procesar la imagen.');
  return blob;
}
