import { unified } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { toPublicAssetHref } from './asset-routes.mjs';
import { internalHref } from './render-model.mjs';

const parser = unified().use(remarkParse).use(remarkGfm);
const escapeHtml = (value = '') => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function text(node) { return (node.children ?? []).map((child) => child.value ?? text(child)).join(''); }
function normalizedForScheme(value) {
  let decoded = value.trim();
  for (let index = 0; index < 3; index += 1) {
    try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
  }
  return decoded.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}
function safeLinkHref(value, base) {
  const normalized = normalizedForScheme(value);
  if (/^https:\/\//.test(normalized) || /^mailto:[^\s@]+@[^\s@]+$/.test(normalized)) return value;
  if (/^#[a-z][a-z0-9_-]*$/i.test(value)) return value;
  if (/^\/(?!\/)(?:[a-z0-9-]+\/)*(?:#[a-z][a-z0-9_-]*)?$/i.test(value)) return internalHref(base, value);
  if (/^(?!.*(?:^|\/)\.\.(?:\/|$))[a-z0-9][a-z0-9._/-]*(?:#[a-z][a-z0-9_-]*)?$/i.test(value)) return value;
  return null;
}
function inline(node, base) {
  if (node.type === 'text') return escapeHtml(node.value);
  if (node.type === 'inlineCode') return `<code>${escapeHtml(node.value)}</code>`;
  if (node.type === 'emphasis') return `<em>${node.children.map((child) => inline(child, base)).join('')}</em>`;
  if (node.type === 'strong') return `<strong>${node.children.map((child) => inline(child, base)).join('')}</strong>`;
  if (node.type === 'link') {
    const label = node.children.map((child) => inline(child, base)).join('');
    const href = safeLinkHref(node.url, base);
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
  }
  if (node.type === 'break') return '<br>';
  return escapeHtml(text(node));
}
function nodeHtml(node, base) {
  if (node.type === 'paragraph') return `<p>${node.children.map((child) => inline(child, base)).join('')}</p>`;
  if (node.type === 'heading' && node.depth === 3) return `<h3>${node.children.map((child) => inline(child, base)).join('')}</h3>`;
  if (node.type === 'list') {
    const tag = node.ordered ? 'ol' : 'ul';
    return `<${tag}>${node.children.map((item) => `<li>${item.children.map((child) => nodeHtml(child, base)).join('')}</li>`).join('')}</${tag}>`;
  }
  if (node.type === 'table') {
    const rows = node.children.map((row, index) => `<tr>${row.children.map((cell) => `<${index ? 'td' : 'th'}>${cell.children.map((child) => inline(child, base)).join('')}</${index ? 'td' : 'th'}>`).join('')}</tr>`).join('');
    return `<table>${rows}</table>`;
  }
  return `<pre><code>${escapeHtml(node.value ?? text(node))}</code></pre>`;
}
export function renderSafeMarkdown(markdown, { base = '/' } = {}) {
  return parser.parse(markdown).children.map((node) => nodeHtml(node, base)).join('');
}
/** @param {Record<string, any>} block @param {{ projectSlug?: string, base?: string }} options */
export function renderSafeBlock(block, { projectSlug, base = '/' } = {}) {
  if (block.type === 'advanced') return `<pre><code>${escapeHtml(block.raw)}</code></pre>`;
  if (block.type === 'image') {
    const match = block.markdown.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*(?:\n+(.+))?$/s);
    if (!match || !projectSlug) return `<pre><code>${escapeHtml(block.markdown)}</code></pre>`;
    const src = toPublicAssetHref({ kind: 'project', slug: projectSlug, relativeSource: match[2], base });
    const caption = match[3]?.trim();
    return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(match[1])}" loading="lazy" decoding="async">${caption ? `<figcaption>${escapeHtml(caption.replace(/^Fig\.\s*/i, ''))}</figcaption>` : ''}</figure>`;
  }
  return renderSafeMarkdown(block.markdown, { base });
}
