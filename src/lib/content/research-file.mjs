import matter from 'gray-matter';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown.mjs';
export function parseResearchFile(source, options) { const parsed = matter(source); const header = source.match(/^---(?:\r\n|\n)[\s\S]*?^---(?:\r\n|\n)?/m)?.[0] ?? ''; return { frontmatter: parsed.data, ...parseMarkdownBody(source.slice(header.length), options) }; }
export function serializeResearchFile(document) { const { frontmatter, ...body } = document; return matter.stringify(serializeMarkdownBody(body), frontmatter).replace(/\r?\n/g, body.newline ?? '\n'); }
