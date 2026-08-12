import matter from 'gray-matter';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown.mjs';
import { validateProject } from './schema.mjs';

export function parseProjectFile(source, options) {
  const parsed = matter(source);
  const header = source.match(/^---(?:\r\n|\n)[\s\S]*?^---(?:\r\n|\n)?/m)?.[0] ?? '';
  const body = parseMarkdownBody(source.slice(header.length), options);
  return { slug: undefined, frontmatter: parsed.data, ...body };
}
export function serializeProjectFile(document) {
  const { slug, frontmatter, ...body } = document;
  return matter.stringify(serializeMarkdownBody(body), frontmatter).replace(/\r?\n/g, body.newline ?? '\n');
}
export { validateProject };
