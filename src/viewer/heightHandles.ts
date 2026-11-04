import * as THREE from 'three';

/**
 * 3D arrows attached to the **selected** elements: the upper one sits on the selection's «до»,
 * the lower one on its «от». Nothing selected → no arrows.
 *
 * Their Z comes from the selection's height band (not from the mesh bounds), so values typed in
 * the inspector, the drag and the rebuilt model all stay in sync (see ADR-0020).
 */

export type HeightHandleSide = 'top' | 'bottom';

export interface HeightRange {
  top: number;
  bottom: number;
}

export interface HeightHandles {
  group: THREE.Group;
  /** Model bounds: fallback XY centre and the "has model" flag. */
  update: (bounds: THREE.Box3) => void;
  /** Height band the arrows straddle; `null` hides them (nothing selected). */
  setRange: (range: HeightRange | null) => void;
  /** XY centre of the selected shape (world units); `null` → model centre. */
  setCenter: (center: THREE.Vector3 | null) => void;
  /** Keeps the arrows the same height on screen: `mmPerPixel` × `ARROW_HEIGHT_PX`. */
  setPixelScale: (mmPerPixel: number) => void;
  /** Which arrow the ray hits, if any. The raycaster must already be set from the camera. */
  hit: (raycaster: THREE.Raycaster) => HeightHandleSide | null;
  setHovered: (side: HeightHandleSide | null) => void;
  dispose: () => void;
}

/** On-screen height of an arrow, in CSS pixels, independent of zoom and model size. */
export const ARROW_HEIGHT_PX = 48;

const BASE_COLOR = '#38bdf8';
const HOVER_COLOR = '#e0f2fe';

interface Arrow {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  geometries: THREE.BufferGeometry[];
}

/** One arrow along +Z, one unit tall, starting at the group origin. */
function buildArrow(): Arrow {
  // Depth test off + a high render order: the handles are UI, so they stay visible and clickable
  // even when the model would hide them (the lower arrow sits under the plate).
  const material = new THREE.MeshBasicMaterial({
    color: BASE_COLOR,
    depthTest: false,
  });
  const geometries: THREE.BufferGeometry[] = [];

  const shaft = new THREE.CylinderGeometry(0.12, 0.12, 0.58, 14);
  shaft.translate(0, 0.29, 0);
  const head = new THREE.ConeGeometry(0.28, 0.42, 20);
  head.translate(0, 0.79, 0);
  geometries.push(shaft, head);

  const group = new THREE.Group();
  for (const geometry of geometries) {
    const mesh = new THREE.Mesh(geometry, material);
    // Cylinders and cones point along +Y by default.
    mesh.rotation.x = Math.PI / 2;
    mesh.renderOrder = 10;
    group.add(mesh);
  }

  return { group, material, geometries };
}

export function createHeightHandles(): HeightHandles {
  const group = new THREE.Group();
  group.visible = false;

  const up = buildArrow();
  const down = buildArrow();
  down.group.rotation.x = Math.PI;
  group.add(up.group, down.group);

  const modelCenter = new THREE.Vector3();
  const center = new THREE.Vector3();
  let size = 10;
  let hasModel = false;
  let range: HeightRange | null = null;
  let explicitCenter: THREE.Vector3 | null = null;

  const apply = (): void => {
    const band = range;
    group.visible = hasModel && band !== null;
    if (!band) return;
    const gap = size * 0.1;
    center.copy(explicitCenter ?? modelCenter);
    group.position.set(center.x, center.y, 0);
    up.group.position.set(0, 0, band.top + gap);
    up.group.scale.setScalar(size);
    down.group.position.set(0, 0, band.bottom - gap);
    down.group.scale.setScalar(size);
  };

  const setHovered = (side: HeightHandleSide | null): void => {
    up.material.color.set(side === 'top' ? HOVER_COLOR : BASE_COLOR);
    down.material.color.set(side === 'bottom' ? HOVER_COLOR : BASE_COLOR);
  };

  return {
    group,
    update(bounds) {
      hasModel = !bounds.isEmpty();
      if (!hasModel) {
        group.visible = false;
        return;
      }
      bounds.getCenter(modelCenter);
      apply();
    },
    setCenter(nextCenter) {
      explicitCenter = nextCenter;
      apply();
    },
    setPixelScale(mmPerPixel) {
      size = Math.max(mmPerPixel * ARROW_HEIGHT_PX, 1e-4);
      apply();
    },
    setRange(next) {
      range = next;
      apply();
    },
    hit(raycaster) {
      if (!group.visible) return null;
      const hits = raycaster.intersectObject(up.group, true);
      if (hits.length > 0) return 'top';
      return raycaster.intersectObject(down.group, true).length > 0 ? 'bottom' : null;
    },
    setHovered,
    dispose() {
      for (const arrow of [up, down]) {
        for (const geometry of arrow.geometries) geometry.dispose();
        arrow.material.dispose();
      }
      group.removeFromParent();
    },
  };
}
