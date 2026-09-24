// Small, safe Markdown renderer: everything is HTML-escaped first, then a limited syntax is applied.
import { esc } from './ui.js';

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  return s;
}

const LIST = /^\s*([-*•]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

export function md(src = '') {
  const lines = esc(src).replace(/\r/g, '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<div class="code" dir="ltr"><div class="code-head"><span>${fence[1] || 'code'}</span><button class="copy-code" type="button">نسخ</button></div><pre><code>${buf.join('\n')}</code></pre></div>`;
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { const lvl = Math.min(h[1].length + 2, 6); html += `<h${lvl}>${inline(h[2])}</h${lvl}>`; i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      html += `<blockquote>${inline(buf.join('<br>'))}</blockquote>`;
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) body.push(row(lines[i++]));
      html += `<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && (LIST.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (LIST.test(lines[i])) items.push(lines[i].replace(LIST, ''));
        else items[items.length - 1] += '<br>' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html += `<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`;
      continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|&gt;|[-*•]\s|\d+[.)]\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    html += `<p>${inline(buf.join('<br>'))}</p>`;
  }
  return html;
}

/** Extract numbered steps ("1. ...") from a markdown text — used to turn a council plan into milestones. */
export function extractSteps(src = '') {
  return src.split('\n').map(l => l.match(/^\s*\d+[.)]\s+(.+)$/)?.[1]).filter(Boolean)
    .map(s => s.replace(/\*\*/g, '').trim()).slice(0, 8);
}
