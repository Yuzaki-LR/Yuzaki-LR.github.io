import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { BLOCK_TYPES } from './types.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);
const stringifier = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
const markerPattern = /^<!-- editor:(section|block) id="([a-z][a-z0-9-]{7,63})"(?: kind="(standard|contribution)")?(?: type="([a-z]+)")? hidden="(true|false)" -->(?:\r\n|\n)?/gm;
function newlineOf(source) { return source.includes('\r\n') ? '\r\n' : '\n'; }
function stripFinalNewline(value) { return value.replace(/\r?\n$/, ''); }
function blockType(node, raw) { if (node.type === 'heading' && node.depth === 3) return 'subheading'; if (node.type === 'paragraph') return /^!\[[^\]]*\]\([^)]+\)\s*$/.test(raw) ? 'image' : 'paragraph'; if (node.type === 'list') return 'list'; if (node.type === 'table') return 'table'; return 'advanced'; }
function heading(raw) { const match = raw.match(/^##\s+(.+?)(?:\r?\n|$)/); return match ? { title: match[1], end: match[0].length } : { title: '', end: 0 }; }
function unmarkedBlocks(raw, id) {
  const tree = parser.parse(raw); const blocks = [];
  for (const node of tree.children) {
    const start = node.position?.start.offset; const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const slice = raw.slice(start, end); const type = blockType(node, slice);
    const block = { id: id(), type, hidden: false, pendingEditorIds: true };
    if (type === 'advanced') block.raw = slice; else block.markdown = slice;
    blocks.push(block);
  }
  return blocks;
}
export function parseMarkdownBody(body, { idFactory } = {}) {
  const newline = newlineOf(body); const markers = []; for (let match; (match = markerPattern.exec(body));) markers.push({ start: match.index, end: markerPattern.lastIndex, match });
  const sections = []; let current; const id = () => (idFactory ? idFactory() : undefined);
  const open = (marker, title) => { current = { id: marker?.match[2] ?? id(), kind: marker?.match[3] ?? 'standard', hidden: marker?.match[5] === 'true', title, blocks: [] }; if (!marker) current.pendingEditorIds = true; sections.push(current); };
  const addUnmarked = (raw) => { if (current) current.blocks.push(...unmarkedBlocks(raw, id)); };
  const addMarked = (marker, raw) => { if (!current) return; const type = BLOCK_TYPES.includes(marker.match[4]) ? marker.match[4] : 'advanced'; const block = { id: marker.match[2], type, hidden: marker.match[5] === 'true' }; if (type === 'advanced') block.raw = stripFinalNewline(raw); else block.markdown = stripFinalNewline(raw); current.blocks.push(block); };
  let cursor = 0;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index]; const next = markers[index + 1];
    if (marker.match[1] === 'section') {
      if (current) addUnmarked(body.slice(cursor, marker.start));
      const after = body.slice(marker.end, next?.start ?? body.length); const parsed = heading(after); open(marker, parsed.title); cursor = marker.end + parsed.end;
    } else {
      if (!current) { const parsed = heading(body.slice(cursor, marker.start)); open(null, parsed.title || 'Untitled'); cursor += parsed.end; }
      addUnmarked(body.slice(cursor, marker.start)); addMarked(marker, body.slice(marker.end, next?.start ?? body.length)); cursor = next?.start ?? body.length;
    }
  }
  if (!current && body.trim()) { const parsed = heading(body); open(null, parsed.title || 'Untitled'); addUnmarked(body.slice(parsed.end)); } else if (current) addUnmarked(body.slice(cursor));
  const pendingEditorIds = sections.some((section) => section.pendingEditorIds || section.blocks.some((block) => block.pendingEditorIds));
  return { sections, newline, trailingNewline: /\r?\n$/.test(body), ...(pendingEditorIds ? { pendingEditorIds: true } : {}) };
}
function renderBlock(block) { if (block.type === 'advanced') return block.raw; if (!block.edited) return block.markdown; return stripFinalNewline(stringifier.stringify(stringifier.parse(block.markdown))); }
export function serializeMarkdownBody(document) {
  const newline = document.newline ?? '\n'; const chunks = [];
  for (const section of document.sections) { chunks.push(`<!-- editor:section id="${section.id}" kind="${section.kind}" hidden="${Boolean(section.hidden)}" -->`, `## ${section.title}`); for (const block of section.blocks) chunks.push(`<!-- editor:block id="${block.id}" type="${block.type}" hidden="${Boolean(block.hidden)}" -->`, renderBlock(block)); }
  const body = chunks.join(newline); return document.trailingNewline ? `${body}${newline}` : body;
}
