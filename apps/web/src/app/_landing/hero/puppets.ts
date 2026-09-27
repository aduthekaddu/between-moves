import * as THREE from 'three';

/**
 * Shadow puppets. The House is only ever present as shadows: friends leaning over the table
 * and the hand that moves a piece. Each is a silhouette the camera never sees; only the lamp
 * does.
 */
export type PuppetKind = 'braid' | 'headphones' | 'chai' | 'dupatta' | 'cap';

export async function loadSilhouettes(
  base: string,
): Promise<Record<PuppetKind | 'hand', THREE.Texture>> {
  const loader = new THREE.TextureLoader();
  const kinds = ['braid', 'headphones', 'chai', 'dupatta', 'cap', 'hand'] as const;
  const textures = await Promise.all(kinds.map((kind) => loader.loadAsync(`${base}/${kind}.png`)));
  return Object.fromEntries(kinds.map((kind, i) => [kind, textures[i]])) as Record<
    PuppetKind | 'hand',
    THREE.Texture
  >;
}

/**
 * three copies map/alphaTest from the visible material into the shadow pass, so this never-
 * drawn material carries the silhouette's alpha.
 */
export function puppetMesh(texture: THREE.Texture, width: number) {
  const image = texture.image as { width: number; height: number };
  const height = (width * image.height) / image.width;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: 0.5,
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}
