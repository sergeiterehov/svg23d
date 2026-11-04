/** Browser-only helpers for saving generated files. */

export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.svg$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'model';
}
