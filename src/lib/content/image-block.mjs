const imageBlockPattern = /^!\[([^\]]*)\]\(([^)]+)\)(?:\r?\n+([^\r\n][\s\S]*))?$/;

export function parseImageBlock(markdown) {
  if (typeof markdown !== 'string') return null;
  const match = markdown.match(imageBlockPattern);
  if (!match) return null;
  return { alt: match[1], source: match[2], caption: match[3]?.trim() || null };
}
