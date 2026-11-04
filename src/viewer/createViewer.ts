import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { PartMesh } from '@core/model/types';

export interface ViewerHandle {
  setParts: (parts: PartMesh[]) => void;
  /** Highlights one part with a light-blue outline; `null` clears the selection. */
  setSelectedPart: (partId: string | null) => void;
  resetView: () => void;
  toggleWireframe: () => boolean;
  dispose: () => void;
}

export interface ViewerOptions {
  /** Called when a click lands on empty space (no part under the cursor). */
  onBackgroundClick?: () => void;
  /** Called when a click hits a part; argument is the part id (a tree node id). */
  onPartClick?: (partId: string) => void;
}

/**
 * Imperative three.js viewport. React only mounts it and pushes parts (see ADR-0001):
 * keeping three.js out of the render tree avoids re-creating the WebGL context.
 */
export function createViewer(container: HTMLElement, options: ViewerOptions = {}): ViewerHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1120');

  const camera = new THREE.PerspectiveCamera(
    45,
    (container.clientWidth || 1) / (container.clientHeight || 1),
    0.1,
    50000,
  );
  camera.up.set(0, 0, 1);
  camera.position.set(160, -200, 170);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.9;

  // Screen-space outline for the selected part (crisp at any zoom, unlike an inflated copy).
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const outlinePass = new OutlinePass(
    new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1),
    scene,
    camera,
  );
  outlinePass.edgeStrength = 6;
  outlinePass.edgeGlow = 0.4;
  outlinePass.edgeThickness = 2;
  outlinePass.pulsePeriod = 0;
  outlinePass.visibleEdgeColor.set('#7dd3fc');
  outlinePass.hiddenEdgeColor.set('#0ea5e9');
  composer.addPass(outlinePass);
  composer.addPass(new OutputPass());

  let selectedPartId: string | null = null;

  // Distinguish "click on empty space" from orbiting: only short, non-moving presses count.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressX = 0;
  let pressY = 0;
  let pressAt = 0;

  const handlePointerDown = (event: PointerEvent): void => {
    pressX = event.clientX;
    pressY = event.clientY;
    pressAt = performance.now();
  };

  const handlePointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - pressX, event.clientY - pressY);
    if (moved > 5 || performance.now() - pressAt > 700) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(partsGroup.children, false);
    if (hits.length === 0) {
      options.onBackgroundClick?.();
      return;
    }
    const partId = hits[0].object.userData.partId as string | undefined;
    if (partId) options.onPartClick?.(partId);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);

  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.9);
  scene.add(hemisphere);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
  keyLight.position.set(1, -1.2, 2);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.45);
  fillLight.position.set(-1.5, 1, 0.6);
  scene.add(fillLight);

  let grid: THREE.GridHelper | null = null;
  const partsGroup = new THREE.Group();
  scene.add(partsGroup);

  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  let wireframe = false;

  const updateGrid = (size: number): void => {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    const extent = Math.max(size, 20);
    grid = new THREE.GridHelper(extent, 20, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.01;
    scene.add(grid);
  };

  const disposeParts = (): void => {
    for (const child of [...partsGroup.children]) {
      partsGroup.remove(child);
    }
    for (const geometry of geometries.splice(0)) geometry.dispose();
    for (const material of materials.splice(0)) material.dispose();
  };

  const frameAll = (): void => {
    const box = new THREE.Box3();
    if (partsGroup.children.length === 0) {
      box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 40));
    } else {
      box.setFromObject(partsGroup);
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    const distance = radius / Math.tan((camera.fov * Math.PI) / 360) * 1.9;

    controls.target.copy(center);
    camera.position.set(
      center.x + distance * 0.6,
      center.y - distance * 0.85,
      center.z + distance * 0.52,
    );
    camera.near = Math.max(distance / 200, 0.01);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = (): void => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    composer.render();
  });

  const applySelection = (): void => {
    const mesh = partsGroup.children.find(
      (child) => (child.userData.partId as string | undefined) === selectedPartId,
    );
    outlinePass.selectedObjects = mesh ? [mesh] : [];
  };

  return {
    setParts(parts) {
      disposeParts();
      let extent = 20;
      for (const part of parts) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(part.positions.slice(), 3));
        geometry.setIndex(new THREE.BufferAttribute(part.indices.slice(), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();

        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(part.color === 'none' ? '#cccccc' : part.color),
          roughness: 0.6,
          metalness: 0.05,
          wireframe,
          flatShading: false,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = part.name;
        mesh.userData.partId = part.partId;
        partsGroup.add(mesh);
        geometries.push(geometry);
        materials.push(material);

        const box = geometry.boundingBox;
        if (box) {
          extent = Math.max(extent, box.max.x - box.min.x, box.max.y - box.min.y);
        }
      }
      updateGrid(extent * 1.4);
      frameAll();
      applySelection();
    },
    setSelectedPart(partId) {
      selectedPartId = partId;
      applySelection();
    },
    resetView() {
      frameAll();
    },
    toggleWireframe() {
      wireframe = !wireframe;
      for (const material of materials) material.wireframe = wireframe;
      return wireframe;
    },
    dispose() {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      renderer.setAnimationLoop(null);
      disposeParts();
      outlinePass.selectedObjects = [];
      composer.dispose();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      if (grid) {
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
    },
  };
}
