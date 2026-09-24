// A mentor's memory is a human-readable Markdown file: data/mentors/<id>/memory.md
// The mentor reads it before every reply; the memory engine appends/removes bullet lines.
// Edits are line-based so anything the learner writes by hand is preserved.
import { MEMORY_SECTIONS } from '../public/js/catalog.js';
import { today } from './store.js';

export const LOG_SECTION = 'سجل التقدّم';
const norm = s => String(s || '').replace(/^\s*[-*]\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function initialMemory(mentor, profile = {}) {
  const out = [
    `# ذاكرة ${mentor.name}`,
    '',
    `> هذا الملف هو ما يتذكّره ${mentor.name} عنك. يقرأه قبل كل رد، ويحدّثه تلقائياً بعد المحادثات. عدّل أو احذف ما تشاء.`,
    '',
  ];
  for (const s of MEMORY_SECTIONS) {
    out.push(`## ${s}`);
    if (s === MEMORY_SECTIONS[0]) {
      if (profile.name) out.push(`- الاسم: ${profile.name}`);
      if (profile.bio) out.push(`- نبذة: ${profile.bio}`);
    }
    if (s === 'التفضيلات وأسلوب التعلّم' && profile.preferences) out.push(`- ${profile.preferences}`);
    if (s === LOG_SECTION) out.push(`- [${today()}] بداية العمل مع ${mentor.name}`);
    out.push('');
  }
  return out.join('\n');
}

export function parseMemory(md = '') {
  const sections = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^##\s+(.+)$/);
    if (h) { cur = { name: h[1].trim(), items: [] }; sections.push(cur); continue; }
    if (!cur || !line || line.startsWith('#') || line.startsWith('>')) continue;
    cur.items.push(line.replace(/^[-*]\s+/, ''));
  }
  return sections;
}

/** @returns {{md: string, added: {section: string, text: string}[]}} */
export function addItems(md, items = []) {
  const lines = md.split(/\r?\n/);
  const existing = new Set(lines.map(norm).filter(Boolean));
  const added = [];
  for (const { section, text } of items) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean || existing.has(norm(clean))) continue;
    existing.add(norm(clean));
    let h = lines.findIndex(l => l.trim() === `## ${section}`);
    if (h === -1) {
      if (lines.length && lines[lines.length - 1].trim()) lines.push('');
      lines.push(`## ${section}`, `- ${clean}`, '');
    } else {
      let end = h + 1;
      while (end < lines.length && !/^##\s/.test(lines[end].trim())) end++;
      let at = end;
      while (at > h + 1 && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, `- ${clean}`);
    }
    added.push({ section, text: clean });
  }
  return { md: lines.join('\n'), added };
}

/** @returns {{md: string, removed: string[]}} */
export function removeItems(md, texts = []) {
  const targets = new Set(texts.map(norm).filter(Boolean));
  if (!targets.size) return { md, removed: [] };
  const removed = [];
  const kept = md.split(/\r?\n/).filter(l => {
    const t = l.trim();
    if (/^[-*]\s+/.test(t) && targets.has(norm(t))) { removed.push(t.replace(/^[-*]\s+/, '')); return false; }
    return true;
  });
  return { md: kept.join('\n'), removed };
}

export const logLine = text => ({ section: LOG_SECTION, text: `[${today()}] ${text}` });

/** Compact version for prompts: drops the preamble, keeps the latest progress log lines. */
export function memoryForPrompt(md = '') {
  const sections = parseMemory(md);
  const parts = [];
  for (const s of sections) {
    let items = s.items;
    if (s.name === LOG_SECTION && items.length > 12) items = items.slice(-12);
    if (!items.length) continue;
    parts.push(`### ${s.name}\n${items.map(i => `- ${i}`).join('\n')}`);
  }
  let text = parts.join('\n\n');
  if (text.length > 7000) text = text.slice(0, 7000) + '\n…';
  return text || '(لا توجد ملاحظات بعد — هذه بداية علاقتكما)';
}
