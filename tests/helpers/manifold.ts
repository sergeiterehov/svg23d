import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let cached: ManifoldToplevel | null = null;

/** Loads the WASM module once per test file (Node has no worker indirection). */
export async function loadManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = await Module();
    cached.setup();
  }
  return cached;
}
