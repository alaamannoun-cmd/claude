import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Tiny file-based store. Every entity is a plain JSON/Markdown file under data/,
 * so a mentor's memory is literally a file you can open: data/mentors/<id>/memory.md
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const locks = new Map();

export const uid = (prefix = '') => prefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
export const today = (d = new Date()) => d.toLocaleDateString('en-CA');
const full = rel => path.join(DATA_DIR, rel);

function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  locks.set(key, run.catch(() => {}));
  return run;
}

async function rawRead(rel) {
  try { return await fs.readFile(full(rel), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function rawWrite(rel, text) {
  const file = full(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

export async function readJSON(rel, fallback) {
  const text = await rawRead(rel);
  if (text == null) return structuredClone(fallback);
  try { return JSON.parse(text); } catch { return structuredClone(fallback); }
}

export const writeJSON = (rel, data) => withLock(rel, () => rawWrite(rel, JSON.stringify(data, null, 2)));
export const readText = async (rel, fallback = '') => (await rawRead(rel)) ?? fallback;
export const writeText = (rel, text) => withLock(rel, () => rawWrite(rel, text));

/** Read-modify-write a JSON file atomically. The mutator edits `data` in place. */
export function update(rel, fallback, mutator) {
  return withLock(rel, async () => {
    const data = await readJSON(rel, fallback);
    const out = await mutator(data);
    await rawWrite(rel, JSON.stringify(data, null, 2));
    return out === undefined ? data : out;
  });
}

/** Read-modify-write a text file atomically. The mutator returns the new text. */
export function updateText(rel, fallback, mutator) {
  return withLock(rel, async () => {
    const text = await readText(rel, fallback);
    const next = await mutator(text);
    await rawWrite(rel, next);
    return next;
  });
}

export async function listDirs(rel) {
  try {
    return (await fs.readdir(full(rel), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  } catch { return []; }
}

export async function mtime(rel) {
  try { return (await fs.stat(full(rel))).mtime.toISOString(); } catch { return null; }
}

export const remove = rel => fs.rm(full(rel), { recursive: true, force: true });
