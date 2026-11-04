import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { PartMesh, ViewLighting, ViewMaterial, ViewProjection } from '@core/model/types';
import { createNavCube, type NavCubeHandle } from './navCube';
import { createHeightHandles, type HeightHandleSide, type HeightRange } from './heightHandles';

export interface ViewOptions {
  material: ViewMaterial;
  lighting: ViewLighting;
  projection: ViewProjection;
}

export const DEFAULT_VIEW: ViewOptions = {
  material: 'matte',
  lighting: 'studio',
  projection: 'perspective',
};

/** Build plate drawn under the model, in mm. */
const GRID_SIZE_MM = 256;
const GRID_DIVISIONS = 16;

/** Camera pose that survives a 2D/3D switch (the viewer itself is re-created then). */
export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface ViewerHandle {
  /** `frame: true` re-frames the camera; by default the current view is preserved. */
  setParts: (parts: PartMesh[], options?: { frame?: boolean }) => void;
  /** Current orbit pose, to be restored with `setCameraState` after a remount. */
  getCameraState: () => CameraState;
  /** Restores a previously saved pose, including the orthographic zoom. */
  setCameraState: (state: CameraState) => void;
  /** Highlights the given parts with a light-blue outline. */
  setSelectedParts: (partIds: string[]) => void;
  /** Highlights one part under the pointer in white (hover is not selection). */
  setHoveredPart: (partId: string | null) => void;
  /** Height band of the selection: the arrows sit on its top/bottom; `null` hides them. */
  setHeightRange: (range: HeightRange | null) => void;
  /** XY centre of the selected shape in model mm; `null` falls back to the model centre. */
  setHeightCenter: (point: { x: number; y: number } | null) => void;
  /** Material/lighting/projection presets; does not rebuild geometry. */
  setView: (view: ViewOptions) => void;
  /** Mounts the orientation cube; returns a detach function. */
  mountNavCube: (container: HTMLElement) => () => void;
  resetView: () => void;
  toggleWireframe: () => boolean;
  dispose: () => void;
}

export interface ViewerOptions {
  /** Called when a click lands on empty space (no part under the cursor). */
  onBackgroundClick?: () => void;
  /** Called when a click hits a part; argument is the part id (a tree node id). */
  onPartClick?: (partId: string) => void;
  /** ⌘/Ctrl-click on a part: add it to the selection instead of replacing it. */
  onPartAdd?: (partId: string) => void;
  /** Pointer moved onto another part (or off all of them): `null` means nothing is hovered. */
  onPartHover?: (partId: string | null) => void;
  /** Drag start on a 3D height arrow: the top one edits «до», the bottom one «от». */
  onHeightDragStart?: (side: HeightHandleSide) => void;
  /** Drag progress, in mm from the start point, already snapped to `heightStepMm`. */
  onHeightDrag?: (side: HeightHandleSide, deltaMm: number) => void;
  onHeightDragEnd?: (side: HeightHandleSide) => void;
  /** Snap of the drag, in mm (0.5 by default). */
  heightStepMm?: number;
  view?: ViewOptions;
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

  // Arrows on the model itself: raise «до» / lower «от».
  const handles = createHeightHandles();
  scene.add(handles.group);

  const aspectRatio = (): number => (container.clientWidth || 1) / (container.clientHeight || 1);

  const perspective = new THREE.PerspectiveCamera(45, aspectRatio(), 0.1, 50000);
  perspective.up.set(0, 0, 1);
  perspective.position.set(160, -200, 170);

  // The orthographic camera exists from the start so switching projections never re-creates
  // the WebGL context; only the active reference and the composer targets are swapped.
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50000);
  ortho.up.set(0, 0, 1);
  ortho.position.copy(perspective.position);

  // The active camera is typed structurally: `THREE.Camera` itself does not declare `near`/`far`,
  // and both concrete cameras satisfy this shape, so the reference can simply be swapped.
  interface ViewerCamera extends THREE.Camera {
    near: number;
    far: number;
    zoom: number;
    updateProjectionMatrix: () => void;
  }

  let camera: ViewerCamera = perspective;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.9;

  // Screen-space outline for the selected part (crisp at any zoom, unlike an inflated copy).
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
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

  let selectedPartIds: string[] = [];
  let hoveredPartId: string | null = null;

  /** Hover is a white glow on the part's own material — clearly different from the blue outline. */
  const applyHover = (): void => {
    for (const child of partsGroup.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const active = child.userData.partId === hoveredPartId;
      material.emissive.set(active ? '#ffffff' : '#000000');
      material.emissiveIntensity = active ? 0.28 : 0;
    }
  };

  /** Publishes a hover change once per part, so the pointer does not spam the store. */
  const emitHover = (partId: string | null): void => {
    if (hoveredPartId === partId) return;
    hoveredPartId = partId;
    applyHover();
    options.onPartHover?.(partId);
  };

  // Distinguish "click on empty space" from orbiting: only short, non-moving presses count.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pressX = 0;
  let pressY = 0;
  let pressAt = 0;
  let heightDrag: { side: HeightHandleSide; startY: number; applied: number } | null = null;

  /** World millimetres per screen pixel — converts a vertical drag into a height change. */
  const worldPerPixel = (): number => {
    const height = container.clientHeight || 1;
    if (camera === ortho) return (ortho.top - ortho.bottom) / ortho.zoom / height;
    const distance = camera.position.distanceTo(controls.target);
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2)) / height;
  };

  const pointAt = (event: PointerEvent): boolean => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return true;
  };

  const handlePointerDown = (event: PointerEvent): void => {
    pressX = event.clientX;
    pressY = event.clientY;
    pressAt = performance.now();

    // Grabbing an arrow starts a height drag: orbiting is paused until the pointer is released.
    if (!pointAt(event)) return;
    const side = handles.hit(raycaster);
    if (!side) return;
    heightDrag = { side, startY: event.clientY, applied: 0 };
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'ns-resize';
    options.onHeightDragStart?.(side);
  };

  const endHeightDrag = (event: PointerEvent): boolean => {
    if (!heightDrag) return false;
    const side = heightDrag.side;
    heightDrag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    options.onHeightDragEnd?.(side);
    return true;
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (endHeightDrag(event)) return;

    const moved = Math.hypot(event.clientX - pressX, event.clientY - pressY);
    if (moved > 5 || performance.now() - pressAt > 700) return;
    if (!pointAt(event)) return;

    const hits = raycaster.intersectObjects(partsGroup.children, false);
    if (hits.length === 0) {
      options.onBackgroundClick?.();
      return;
    }
    const partId = hits[0].object.userData.partId as string | undefined;
    if (!partId) return;
    if (event.metaKey || event.ctrlKey) options.onPartAdd?.(partId);
    else options.onPartClick?.(partId);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (heightDrag) {
      const step = options.heightStepMm ?? 0.5;
      const raw = (heightDrag.startY - event.clientY) * worldPerPixel();
      const snapped = Math.round(raw / step) * step;
      if (snapped !== heightDrag.applied) {
        heightDrag.applied = snapped;
        options.onHeightDrag?.(heightDrag.side, snapped);
      }
      return;
    }
    if (event.buttons !== 0 || !pointAt(event)) return;
    const side = handles.hit(raycaster);
    handles.setHovered(side);
    if (side) {
      emitHover(null);
      canvas.style.cursor = 'ns-resize';
      return;
    }
    // Hover follows the pointer: the part under it is traced in white wherever it is shown.
    const hits = raycaster.intersectObjects(partsGroup.children, false);
    const partId = (hits[0]?.object.userData.partId as string | undefined) ?? null;
    canvas.style.cursor = partId ? 'pointer' : '';
    emitHover(partId);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointercancel', (event) => endHeightDrag(event));
  canvas.addEventListener('pointerleave', () => {
    handles.setHovered(null);
    emitHover(null);
    canvas.style.cursor = '';
  });

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

  /**
   * Lighting presets:
   * - studio: key + fill + ambient, shows volume and relief;
   * - top: mostly from above, similar to a slicer preview;
   * - flat: almost no directional light, uniform colours for checking silhouettes.
   */
  const applyLighting = (lighting: ViewLighting): void => {
    if (lighting === 'top') {
      ambient.intensity = 0.6;
      hemisphere.intensity = 0.5;
      keyLight.position.set(0.15, -0.2, 1);
      keyLight.intensity = 1.7;
      fillLight.position.set(-0.6, 0.5, 0.5);
      fillLight.intensity = 0.3;
      return;
    }
    if (lighting === 'flat') {
      ambient.intensity = 1.25;
      hemisphere.intensity = 0;
      keyLight.intensity = 0;
      fillLight.intensity = 0;
      return;
    }
    ambient.intensity = 0.35;
    hemisphere.intensity = 0.9;
    keyLight.position.set(1, -1.2, 2);
    keyLight.intensity = 1.5;
    fillLight.position.set(-1.5, 1, 0.6);
    fillLight.intensity = 0.45;
  };

  const materialParams = (
    material: ViewMaterial,
  ): {
    roughness: number;
    metalness: number;
  } =>
    material === 'glossy'
      ? { roughness: 0.12, metalness: 0.05 }
      : { roughness: 0.85, metalness: 0 };

  let currentView: ViewOptions = options.view ?? DEFAULT_VIEW;
  applyLighting(currentView.lighting);

  const viewDistance = (): number => Math.max(camera.position.distanceTo(controls.target), 1e-6);

  /**
   * Orthographic framing mirrors the perspective one: the frustum height is what a perspective
   * camera would show at the current distance, so switching projection keeps the model the same
   * size on screen.
   */
  const syncOrthoFrustum = (distance: number): void => {
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(perspective.fov) / 2);
    const aspect = aspectRatio();
    ortho.top = halfHeight;
    ortho.bottom = -halfHeight;
    ortho.left = -halfHeight * aspect;
    ortho.right = halfHeight * aspect;
    ortho.updateProjectionMatrix();
  };

  const setProjection = (next: ViewProjection): void => {
    if ((next === 'orthographic') === (camera === ortho)) return;
    const distance = viewDistance();
    const { near, far } = camera;
    if (next === 'orthographic') {
      ortho.position.copy(camera.position);
      ortho.near = near;
      ortho.far = far;
      ortho.zoom = 1;
      syncOrthoFrustum(distance);
      camera = ortho;
    } else {
      perspective.position.copy(camera.position);
      perspective.near = near;
      perspective.far = far;
      perspective.updateProjectionMatrix();
      camera = perspective;
    }
    controls.object = camera;
    renderPass.camera = camera;
    outlinePass.renderCamera = camera;
    controls.update();
  };

  /**
   * Animated jump to a canonical view (driven by the nav cube). Directions are interpolated with
   * a quaternion so that opposite sides (front → back) never pass through the target.
   */
  let viewTransition: {
    from: THREE.Vector3;
    rotation: THREE.Quaternion;
    distance: number;
    start: number;
  } | null = null;
  const identityQuaternion = new THREE.Quaternion();
  const partialQuaternion = new THREE.Quaternion();

  const orientTo = (direction: THREE.Vector3): void => {
    const from = camera.position.clone().sub(controls.target).normalize();
    const to = direction.clone().normalize();
    if (from.distanceToSquared(to) < 1e-8) return;
    viewTransition = {
      from,
      rotation: new THREE.Quaternion().setFromUnitVectors(from, to),
      distance: viewDistance(),
      start: performance.now(),
    };
  };

  /** Orbit the camera around the target (used when dragging the nav cube). */
  const orbitBy = (dx: number, dy: number): void => {
    const upQuaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    );
    const offset = camera.position.clone().sub(controls.target);
    offset.applyQuaternion(upQuaternion);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const step = 0.02;
    spherical.theta -= dx * step;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * step, 0.02, Math.PI - 0.02);
    offset.setFromSpherical(spherical).applyQuaternion(upQuaternion.clone().invert());
    camera.position.copy(controls.target).add(offset);
    viewTransition = null;
  };

  const stepTransition = (): void => {
    if (!viewTransition) return;
    const t = Math.min((performance.now() - viewTransition.start) / 420, 1);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    partialQuaternion.slerpQuaternions(identityQuaternion, viewTransition.rotation, eased);
    const direction = viewTransition.from.clone().applyQuaternion(partialQuaternion);
    camera.position.copy(controls.target).addScaledVector(direction, viewTransition.distance);
    if (t >= 1) viewTransition = null;
  };

  let grid: THREE.GridHelper | null = null;
  const partsGroup = new THREE.Group();
  scene.add(partsGroup);
  /** Bounds centre of the model in mm, i.e. the offset applied to the parts group. */
  const modelCenter = new THREE.Vector3();

  const materials: THREE.MeshStandardMaterial[] = [];
  const geometries: THREE.BufferGeometry[] = [];

  let wireframe = false;

  const updateGrid = (): void => {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    // Fixed build plate: the model is centred on the origin, so the grid zero is under it.
    grid = new THREE.GridHelper(GRID_SIZE_MM, GRID_DIVISIONS, 0x475569, 0x1e293b);
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
    // Fit the tighter of the two field-of-view axes, otherwise a wide model overflows the sides
    // of a tall, narrow viewport.
    const halfFovY = THREE.MathUtils.degToRad(perspective.fov) / 2;
    const halfFovX = Math.atan(Math.tan(halfFovY) * aspectRatio());
    const distance = (radius / Math.tan(Math.min(halfFovY, halfFovX))) * 1.9;

    controls.target.copy(center);
    camera.position.set(
      center.x + distance * 0.6,
      center.y - distance * 0.85,
      center.z + distance * 0.52,
    );
    camera.near = Math.max(distance / 200, 0.01);
    camera.far = distance * 20;
    viewTransition = null;
    if (camera === ortho) syncOrthoFrustum(distance);
    else camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = (): void => {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (camera === ortho) {
      syncOrthoFrustum(viewDistance());
    } else {
      perspective.aspect = width / height;
      perspective.updateProjectionMatrix();
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let navCube: NavCubeHandle | null = null;

  renderer.setAnimationLoop(() => {
    stepTransition();
    controls.update();
    composer.render();
    // The arrows keep a constant on-screen height, whatever the zoom and the model size.
    handles.setPixelScale(worldPerPixel());
    navCube?.sync(camera);
    navCube?.render();
  });

  const applySelection = (): void => {
    outlinePass.selectedObjects = partsGroup.children.filter((child) =>
      selectedPartIds.includes(child.userData.partId as string),
    );
  };

  return {
    setParts(parts, partOptions) {
      const wasEmpty = partsGroup.children.length === 0;
      disposeParts();
      for (const part of parts) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(part.positions.slice(), 3));
        geometry.setIndex(new THREE.BufferAttribute(part.indices.slice(), 1));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();

        // Flat normals: averaged normals across the 90° edges of an extrusion smear shading over
        // long side walls and make the triangle split visible (the taller the element, the worse).
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(part.color === 'none' ? '#cccccc' : part.color),
          ...materialParams(currentView.material),
          wireframe,
          flatShading: true,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = part.name;
        mesh.userData.partId = part.partId;
        partsGroup.add(mesh);
        geometries.push(geometry);
        materials.push(material);
      }
      // SVG coordinates start at the top-left corner, so without this the model sits in the
      // corner of the plate instead of on its centre.
      partsGroup.position.set(0, 0, 0);
      modelCenter.set(0, 0, 0);
      let bounds = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3());
      if (partsGroup.children.length > 0) {
        bounds = new THREE.Box3().setFromObject(partsGroup);
        const center = bounds.getCenter(new THREE.Vector3());
        modelCenter.copy(center);
        partsGroup.position.set(-center.x, -center.y, 0);
        bounds = new THREE.Box3().setFromObject(partsGroup);
      }
      handles.update(bounds);
      updateGrid();
      // Re-frame only for the first model or when the document itself changed; otherwise the
      // user's camera must survive every settings change and rebuild.
      if (wasEmpty || partOptions?.frame) frameAll();
      applySelection();
      applyHover();
    },
    setSelectedParts(partIds) {
      selectedPartIds = partIds;
      applySelection();
    },
    setHoveredPart(partId) {
      hoveredPartId = partId;
      applyHover();
    },
    getCameraState() {
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        zoom: camera.zoom,
      };
    },
    setCameraState(state) {
      // Both cameras share the pose, so a later projection switch keeps the restored view.
      for (const item of [perspective, ortho]) {
        item.position.set(...state.position);
        item.zoom = state.zoom;
        const distance = item.position.distanceTo(new THREE.Vector3(...state.target));
        item.near = Math.max(distance / 200, 0.01);
        item.far = distance * 20;
        item.updateProjectionMatrix();
      }
      controls.target.set(...state.target);
      viewTransition = null;
      controls.update();
    },
    setHeightRange(range) {
      handles.setRange(range);
    },
    setHeightCenter(point) {
      handles.setCenter(
        point ? new THREE.Vector3(point.x - modelCenter.x, point.y - modelCenter.y, 0) : null,
      );
    },
    setView(view) {
      currentView = view;
      applyLighting(view.lighting);
      const params = materialParams(view.material);
      for (const material of materials) {
        material.roughness = params.roughness;
        material.metalness = params.metalness;
        material.needsUpdate = true;
      }
      setProjection(view.projection);
    },
    mountNavCube(containerElement) {
      navCube?.dispose();
      navCube = createNavCube(containerElement, { onPick: orientTo, onDrag: orbitBy });
      return () => {
        navCube?.dispose();
        navCube = null;
      };
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
      navCube?.dispose();
      navCube = null;
      handles.dispose();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointermove', handlePointerMove);
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
