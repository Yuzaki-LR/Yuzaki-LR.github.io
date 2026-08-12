import { parseMarkdownBody, serializeMarkdownBody } from './markdown.mjs';
export function parsePageFile(source, options) { return parseMarkdownBody(source, options); }
export function serializePageFile(document) { return serializeMarkdownBody(document); }
