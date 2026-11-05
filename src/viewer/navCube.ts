import * as THREE from 'three';
import { subscribeLocale, t, type MessageKey } from '@i18n';

/**
 * Orientation gizmo ("nav cube") drawn in its own tiny WebGL canvas (see ADR-0017).
 * A separate canvas keeps the main composer untouched, gives crisp CSS chrome around the
 * cube and — most importantly — keeps clicks on the cube away from the orbit controls.
 */

export interface NavCubeHandle {
  /** Rotates the gizmo so that it matches the main camera orientation. */
  sync: (camera: THREE.Camera) => void;
  render: () => void;
  dispose: () => void;
}

interface FaceSpec {
  /** Translation key of the face label: the cube speaks the interface language (ADR-0037). */
  label: MessageKey;
  /** Outward normal of the face (a world axis). */
  normal: THREE.Vector3;
  /**
   * Direction from the pivot to the camera for this view. Top/bottom get a tiny tilt so that
   * `lookAt` with the fixed Z up-vector stays well defined and screen-up is +Y.
   */
  view: THREE.Vector3;
  /** World up of the label, so it reads correctly from that view. */
  up: THREE.Vector3;
}

/** Cube edge length in gizmo units. */
const CUBE = 1.6;
const HALF = CUBE / 2;
const scratchDirection = new THREE.Vector3();

const FACES: FaceSpec[] = [
  {
    label: 'nav.front',
    normal: new THREE.Vector3(0, -1, 0),
    view: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    label: 'nav.back',
    normal: new THREE.Vector3(0, 1, 0),
    view: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    label: 'nav.right',
    normal: new THREE.Vector3(1, 0, 0),
    view: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    label: 'nav.left',
    normal: new THREE.Vector3(-1, 0, 0),
    view: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    label: 'nav.top',
    normal: new THREE.Vector3(0, 0, 1),
    view: new THREE.Vector3(0, -0.001, 1).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
  {
    label: 'nav.bottom',
    normal: new THREE.Vector3(0, 0, -1),
    view: new THREE.Vector3(0, 0.001, -1).normalize(),
    up: new THREE.Vector3(0, 1, 0),
  },
];

function labelTexture(text: string): THREE.CanvasTexture {
  const side = 128;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 26px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, side / 2, side / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createNavCube(
  container: HTMLElement,
  options: {
    /** Canonical view of the clicked face. */
    onPick: (view: THREE.Vector3) => void;
    /** Pointer drag on the cube; deltas are already scaled to radians-free pixels. */
    onDrag: (dx: number, dy: number) => void;
  },
): NavCubeHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 20);

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(1.5, -2, 2.5);
  scene.add(light);
  const backLight = new THREE.DirectionalLight(0x93c5fd, 0.5);
  backLight.position.set(-2, 2, -1);
  scene.add(backLight);

  const bodyGeometry = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1e293b'),
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  scene.add(body);

  const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x64748b });
  scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

  const disposables: { dispose: () => void }[] = [
    bodyGeometry,
    bodyMaterial,
    edgeGeometry,
    edgeMaterial,
  ];

  const highlights = new Map<FaceSpec, THREE.MeshBasicMaterial>();
  const labelMaterials = new Map<FaceSpec, THREE.MeshBasicMaterial>();
  const labelTextures = new Map<FaceSpec, THREE.CanvasTexture>();
  for (const face of FACES) {
    const position = face.normal.clone().multiplyScalar(HALF + 0.001);

    const highlightMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#0ea5e9'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const highlightGeometry = new THREE.PlaneGeometry(CUBE - 0.02, CUBE - 0.02);
    const highlight = new THREE.Mesh(highlightGeometry, highlightMaterial);
    highlight.position.copy(position);
    highlight.up.copy(face.up);
    highlight.lookAt(position.clone().add(face.normal));
    scene.add(highlight);

    const texture = labelTexture(t(face.label));
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const labelGeometry = new THREE.PlaneGeometry(CUBE - 0.1, CUBE - 0.1);
    const label = new THREE.Mesh(labelGeometry, labelMaterial);
    label.position.copy(face.normal.clone().multiplyScalar(HALF + 0.004));
    label.up.copy(face.up);
    label.lookAt(label.position.clone().add(face.normal));
    scene.add(label);

    highlights.set(face, highlightMaterial);
    labelMaterials.set(face, labelMaterial);
    labelTextures.set(face, texture);
    disposables.push(highlightGeometry, highlightMaterial, labelGeometry, labelMaterial, texture);
  }

  /**
   * The cube is created once per viewer, so a language switch cannot go through a re-mount:
   * the face labels repaint their textures in place.
   */
  const unsubscribeLocale = subscribeLocale(() => {
    for (const face of FACES) {
      const material = labelMaterials.get(face);
      if (!material) continue;
      const previous = labelTextures.get(face);
      const texture = labelTexture(t(face.label));
      material.map = texture;
      material.needsUpdate = true;
      labelTextures.set(face, texture);
      previous?.dispose();
    }
  });

  const resize = (): void => {
    const width = Math.max(container.clientWidth || 1, 1);
    const height = Math.max(container.clientHeight || 1, 1);
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered: FaceSpec | null = null;
  let pressX = 0;
  let pressY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  const pick = (event: PointerEvent): FaceSpec | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(body, false)[0];
    const normal = hit?.face?.normal;
    if (!normal) return null;
    return (
      FACES.find(
        (face) =>
          Math.abs(face.normal.x - normal.x) < 0.5 &&
          Math.abs(face.normal.y - normal.y) < 0.5 &&
          Math.abs(face.normal.z - normal.z) < 0.5,
      ) ?? null
    );
  };

  const setHovered = (face: FaceSpec | null): void => {
    if (face === hovered) return;
    if (hovered) {
      const previous = highlights.get(hovered);
      if (previous) previous.opacity = 0;
    }
    hovered = face;
    const next = hovered ? highlights.get(hovered) : null;
    if (next) next.opacity = 0.45;
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (dragging) {
      // Dragging rotates the model instead of hovering faces: from a face-on view only one face
      // is visible, so orbiting has to be possible from the gizmo itself.
      options.onDrag(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
      return;
    }
    setHovered(pick(event));
  };

  const handlePointerDown = (event: PointerEvent): void => {
    pressX = event.clientX;
    pressY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    setHovered(null);
    canvas.style.cursor = 'grabbing';
  };

  const handlePointerUp = (event: PointerEvent): void => {
    const wasDragging = dragging;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
    if (!wasDragging) return;
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > 6) return;
    const face = pick(event);
    if (!face) return;
    options.onPick(face.view.clone());
  };

  const handlePointerLeave = (): void => {
    if (!dragging) setHovered(null);
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.style.cursor = 'grab';

  return {
    sync(source) {
      // Copy the orientation verbatim instead of re-deriving it: this stays correct for
      // near-vertical views where `lookAt` would be ambiguous.
      camera.quaternion.copy(source.quaternion);
      source.getWorldDirection(scratchDirection);
      camera.position.copy(scratchDirection).multiplyScalar(-4);
      camera.updateMatrixWorld();
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      unsubscribeLocale();
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
