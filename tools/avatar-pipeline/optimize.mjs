import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, sparse, meshopt, quantize, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
const ROOT = new URL('.', import.meta.url).pathname;
const outDir = process.argv[2] || new URL('../../public/avatars/models/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const only = process.argv.slice(3);
for (const f of readdirSync(`${ROOT}glb_raw`).filter(f => f.endsWith('.glb') && (!only.length || only.includes(f.replace('.glb', ''))))) {
  const doc = await io.read(`${ROOT}glb_raw/${f}`);
  const texBytes = doc.getRoot().listTextures().reduce((s, t) => s + t.getImage().byteLength, 0);
  await doc.transform(dedup(), prune({ keepAttributes: true }), sparse({ ratio: 0.4 }), textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 86 }), quantize({ quantizeNormal: 10, quantizePosition: 14, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(`${outDir}/${f}`, doc);
  console.log(f, 'raw', Math.round(statSync(`${ROOT}glb_raw/${f}`).size / 1024) + 'KB', 'textures', Math.round(texBytes / 1024) + 'KB', '→', Math.round(statSync(`${outDir}/${f}`).size / 1024) + 'KB');
}
