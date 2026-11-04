import type { PartMesh } from '../model/types';

/**
 * Binary STL writer (ADR-0008). All parts are merged into a single solid, since the format has
 * no notion of objects — use 3MF when the parts must stay separate.
 */
export function writeBinaryStl(parts: PartMesh[]): Uint8Array {
  const triangleCount = parts.reduce((sum, part) => sum + part.triangleCount, 0);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);

  const header = 'svg23d binary STL';
  for (let i = 0; i < header.length && i < 80; i++) {
    view.setUint8(i, header.charCodeAt(i));
  }
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (const part of parts) {
    const { positions, indices } = part;
    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t] * 3;
      const i1 = indices[t + 1] * 3;
      const i2 = indices[t + 2] * 3;

      const ax = positions[i0];
      const ay = positions[i0 + 1];
      const az = positions[i0 + 2];
      const bx = positions[i1];
      const by = positions[i1 + 1];
      const bz = positions[i1 + 2];
      const cx = positions[i2];
      const cy = positions[i2 + 1];
      const cz = positions[i2 + 2];

      const ux = bx - ax;
      const uy = by - ay;
      const uz = bz - az;
      const vx = cx - ax;
      const vy = cy - ay;
      const vz = cz - az;

      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;

      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);
      view.setFloat32(offset + 12, ax, true);
      view.setFloat32(offset + 16, ay, true);
      view.setFloat32(offset + 20, az, true);
      view.setFloat32(offset + 24, bx, true);
      view.setFloat32(offset + 28, by, true);
      view.setFloat32(offset + 32, bz, true);
      view.setFloat32(offset + 36, cx, true);
      view.setFloat32(offset + 40, cy, true);
      view.setFloat32(offset + 44, cz, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }

  return new Uint8Array(buffer);
}

export function stlTriangleCount(parts: PartMesh[]): number {
  return parts.reduce((sum, part) => sum + part.triangleCount, 0);
}
