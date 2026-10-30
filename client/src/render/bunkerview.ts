import { DataTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, RGBAFormat, SRGBColorSpace } from 'three';
import type { Scene } from 'three';
import type { Bunker } from '../game/types';

// Draws the bunkers: each one's pixel mask as a texture on a flat quad, one texture pixel to
// one art pixel. A texture is only rebuilt when its bunker's `version` changes (that is, when a
// shot or an alien has eaten into it), so a quiet frame costs nothing.

/** Green-teal body, a lighter top edge, a darker underside, like the concept page. */
export const BUNKER_BODY = 0x3fd6a0;
export const BUNKER_TOP = 0x7af0c8;
export const BUNKER_UNDER = 0x1f7a66;

const MAX_BUNKERS = 8;

/**
 * The bunker's mask as RGBA bytes, row 0 at the bottom (the mask's own order, and a
 * texture's): solid pixels teal, the ones with open air above them lighter, the ones with open air
 * below them darker; gone pixels fully transparent. Fills `out` (width * height * 4 bytes).
 */
export function bunkerPixels(bunker: Bunker, out: Uint8Array): void {
  const { width, height, mask } = bunker;
  const solid = (col: number, row: number): boolean =>
    col >= 0 && col < width && row >= 0 && row < height && mask[row * width + col] === 1;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4;
      if (!solid(col, row)) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
        continue;
      }
      // The underside wins over the top edge in a one-pixel-thick wall.
      const hex = !solid(col, row - 1) ? BUNKER_UNDER : !solid(col, row + 1) ? BUNKER_TOP : BUNKER_BODY;
      out[i] = (hex >> 16) & 255;
      out[i + 1] = (hex >> 8) & 255;
      out[i + 2] = hex & 255;
      out[i + 3] = 255;
    }
  }
}

interface Entry {
  mesh: Mesh;
  texture: DataTexture;
  data: Uint8Array;
  id: number;
  version: number;
}

export class BunkerView {
  private readonly entries: Entry[] = [];
  /** How many texture uploads have happened (for tests, and for checking a quiet frame costs nothing). */
  uploads = 0;

  constructor(private readonly scene: Scene) {}

  private entryFor(index: number, bunker: Bunker): Entry {
    let entry = this.entries[index];
    if (entry && entry.texture.image.width === bunker.width && entry.texture.image.height === bunker.height) return entry;
    if (entry) {
      entry.texture.dispose();
      entry.mesh.removeFromParent();
    }
    const data = new Uint8Array(bunker.width * bunker.height * 4);
    const texture = new DataTexture(data, bunker.width, bunker.height, RGBAFormat);
    texture.magFilter = texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    const mesh = new Mesh(
      new PlaneGeometry(bunker.width, bunker.height),
      new MeshBasicMaterial({ map: texture, alphaTest: 0.5, depthTest: false, depthWrite: false }),
    );
    // Drawn first, so aliens, shots and the ship pass in front of the bunkers.
    mesh.renderOrder = -10;
    mesh.visible = false;
    this.scene.add(mesh);
    entry = this.entries[index] = { mesh, texture, data, id: -1, version: -1 };
    return entry;
  }

  /** Brings the drawn bunkers up to date with the run's. Call every frame. */
  update(bunkers: readonly Bunker[]): void {
    const n = Math.min(bunkers.length, MAX_BUNKERS);
    for (let i = 0; i < n; i++) {
      const bunker = bunkers[i];
      const entry = this.entryFor(i, bunker);
      if (entry.id !== bunker.id || entry.version !== bunker.version) {
        bunkerPixels(bunker, entry.data);
        entry.texture.needsUpdate = true;
        entry.id = bunker.id;
        entry.version = bunker.version;
        this.uploads++;
      }
      entry.mesh.position.set(bunker.x + bunker.width / 2, bunker.y + bunker.height / 2, 0);
      entry.mesh.visible = true;
    }
    for (let i = n; i < this.entries.length; i++) {
      this.entries[i].mesh.visible = false;
      this.entries[i].id = -1;
    }
  }

  clear(): void {
    this.update([]);
  }
}
