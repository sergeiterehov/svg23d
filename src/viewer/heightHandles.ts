import * as THREE from 'three';

/**
 * 3D arrows attached to the model: the upper one raises «до», the lower one lowers «от».
 * They are part of the scene (not HTML buttons), so they live in the same space as the model and
 * stay next to the geometry they affect (see ADR-0020).
 */

export type HeightHandleSide = 'top' | 'bottom';

export interface HeightHandles {
  group: THREE.Group;
  /** Places the arrows above/below the given model bounds and scales them to it. */
  update: (bounds: THREE.Box3) => void;
  /** Which arrow the ray hits, if any. The raycaster must already be set from the camera. */
  hit: (raycaster: THREE.Raycaster) => HeightHandleSide | null;
  setHovered: (side: HeightHandleSide | null) => void;
  /** Moves the dragged arrow along Z without waiting for the model to rebuild. */
  setDragOffset: (side: HeightHandleSide | null, offsetMm: number) => void;
  dispose: () => void;
}

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

  let size = 10;
  let topZ = 0;
  let bottomZ = 0;
  let dragSide: HeightHandleSide | null = null;
  let dragOffset = 0;

  const applyPositions = (): void => {
    up.group.position.z = topZ + (dragSide === 'top' ? dragOffset : 0);
    down.group.position.z = bottomZ + (dragSide === 'bottom' ? dragOffset : 0);
  };

  const setHovered = (side: HeightHandleSide | null): void => {
    up.material.color.set(side === 'top' ? HOVER_COLOR : BASE_COLOR);
    down.material.color.set(side === 'bottom' ? HOVER_COLOR : BASE_COLOR);
  };

  return {
    group,
    update(bounds) {
      if (bounds.isEmpty()) {
        group.visible = false;
        return;
      }
      const extent = bounds.getSize(new THREE.Vector3());
      // Prominent enough to grab, but never dominating the model.
      size = THREE.MathUtils.clamp(Math.max(extent.x, extent.y, extent.z) * 0.22, 6, 48);
      const gap = size * 0.1;
      const center = bounds.getCenter(new THREE.Vector3());

      group.visible = true;
      group.position.set(center.x, center.y, 0);
      topZ = bounds.max.z + gap;
      bottomZ = bounds.min.z - gap;
      up.group.scale.setScalar(size);
      down.group.scale.setScalar(size);
      applyPositions();
    },
    hit(raycaster) {
      if (!group.visible) return null;
      const hits = raycaster.intersectObject(up.group, true);
      if (hits.length > 0) return 'top';
      return raycaster.intersectObject(down.group, true).length > 0 ? 'bottom' : null;
    },
    setHovered,
    setDragOffset(side, offsetMm) {
      dragSide = side;
      dragOffset = offsetMm;
      applyPositions();
    },
    dispose() {
      for (const arrow of [up, down]) {
        for (const geometry of arrow.geometries) geometry.dispose();
        arrow.material.dispose();
      }
      group.removeFromParent();
    },
  };
}
