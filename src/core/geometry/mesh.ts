import type { MeshData } from '../model/types';
import type { Solid } from './section';

/** Converts a Manifold solid into flat typed arrays ready for three.js or for export. */
export function meshFromSolid(solid: Solid): MeshData {
  const mesh = solid.getMesh();
  const numProp = mesh.numProp ?? 3;
  const vertexCount = Math.floor(mesh.vertProperties.length / numProp);

  let positions: Float32Array;
  if (numProp === 3) {
    positions = new Float32Array(mesh.vertProperties);
  } else {
    positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = mesh.vertProperties[i * numProp];
      positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
    }
  }

  return {
    positions,
    indices: new Uint32Array(mesh.triVerts),
    triangleCount: mesh.triVerts.length / 3,
    volume: Math.abs(solid.volume()),
  };
}
