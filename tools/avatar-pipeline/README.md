# Avatar pipeline (dev tool)

Converts [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatars (MIT) into the optimized
GLB files used by the 3D mentors in `public/avatars/models/`.

```bash
cd tools/avatar-pipeline
npm install
node fetch.mjs Adults/Female_Adult_09             # FBX with ARKit blendshapes + textures -> ./src
CHROMIUM_PATH=/path/to/chrome node convert.mjs Adults/Female_Adult_09   # -> ./glb_raw (merged vertices, 55 curated blendshapes)
node optimize.mjs                                  # -> public/avatars/models (sparse morphs, WebP, meshopt)
```

Then register the new id in `MODELS` (`public/js/catalog.js`) and regenerate its thumbnail by opening
the app's Forge once (portraits are rendered by `public/js/avatar3d.js`).
