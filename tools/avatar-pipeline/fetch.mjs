// Downloads the facial-blendshape FBX + textures of Rocketbox avatars into ./src
// usage: node fetch.mjs Adults/Female_Adult_06 Professions/Business_Male_02 ...
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars';
for (const entry of process.argv.slice(2)) {
  const [dir, name] = entry.split('/');
  const files = [`Export/${name}_facial.fbx`];
  // texture prefixes differ per avatar (f202_, m008_…): read them from the FBX
  const fbx = await (await fetch(`${RAW}/${dir}/${name}/Export/${name}_facial.fbx`)).arrayBuffer();
  const refs = [...new Set(Buffer.from(fbx).toString('latin1').match(/[\w-]+_(?:color|normal)\.tga/gi) || [])];
  files.push(...refs.map(r => `Textures/${r}`));
  for (const f of files) {
    const out = `src/${dir}/${name}/${f}`;
    if (existsSync(out)) continue;
    const res = await fetch(`${RAW}/${dir}/${name}/${f}`);
    if (!res.ok) { console.warn('skip', f, res.status); continue; }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
  console.log('fetched', entry, files.length, 'files');
}
