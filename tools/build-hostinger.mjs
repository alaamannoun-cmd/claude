// Builds the PHP package for shared hosting (Hostinger…): static frontend + PHP API.
//   node tools/build-hostinger.mjs          → dist/majlis-hostinger/
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../public/js/catalog.js';
import { DIRECTOR, TEMPLATES } from '../public/js/templates.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist/majlis-hostinger`;

// shared data for PHP (single source of truth stays in public/js)
const shared = {
  TRAITS: C.TRAITS, DIALECTS: C.DIALECTS, STYLES: C.STYLES, MEMORY_SECTIONS: C.MEMORY_SECTIONS,
  LESSON_TYPES: C.LESSON_TYPES, ROUNDTABLE_STYLES: C.ROUNDTABLE_STYLES, MODELS: C.MODELS, AURAS: C.AURAS,
  GLASSES: C.GLASSES, LIGHTS: C.LIGHTS, EXPRESSIONS: C.EXPRESSIONS,
  GREETINGS: Object.fromEntries(C.DIALECTS.map(d => [d.id, C.greetingWord(d.id)])),
  DIRECTOR, TEMPLATES,
};
writeFileSync(`${root}php/api/shared.json`, JSON.stringify(shared, null, 1));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(`${root}public`, out, { recursive: true });
cpSync(`${root}php`, out, { recursive: true });
cpSync(`${root}docs/HOSTINGER.md`, `${out}/اقرأني-HOSTINGER.md`);
console.log('built', out);
