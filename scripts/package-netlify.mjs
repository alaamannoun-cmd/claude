// Prepares a static folder for Netlify (dist/netlify) and, with --zip, a drag-and-drop zip.
// Run `npm run build` first so dist/sakura-michi.html is up to date.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = resolve(root, 'dist/sakura-michi.html');
if (!existsSync(game)) {
  console.error('dist/sakura-michi.html is missing: run `npm run build` first.');
  process.exit(1);
}
const out = resolve(root, 'dist/netlify');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(game, resolve(out, 'index.html'));
writeFileSync(
  resolve(out, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/index.html
  Cache-Control: public, max-age=0, must-revalidate
`
);
console.log('dist/netlify/ ready');

if (process.argv.includes('--zip')) {
  const zip = resolve(root, 'dist/sakura-michi-netlify.zip');
  rmSync(zip, { force: true });
  // files sit at the root of the archive, as Netlify Drop expects
  execFileSync('zip', ['-X', '-9', '-r', zip, '.'], { cwd: out, stdio: 'inherit' });
  console.log('dist/sakura-michi-netlify.zip ready');
}
