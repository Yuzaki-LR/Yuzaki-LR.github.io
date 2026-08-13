import { z } from 'zod';
import { CONTRIBUTION_TITLE, EDITOR_ID, MANUSCRIPT_STATUS, PROJECT_KINDS } from './types.mjs';
import { parseImageBlock } from './image-block.mjs';
import { validateThemeContrast } from './contrast.mjs';
export { relativeLuminance, contrastRatio, validateThemeContrast } from './contrast.mjs';

const hex = /^#[0-9a-f]{6}$/i;
const safePath = /^(?![\\/]|.*(?:^|[\\/])\.\.(?:[\\/]|$))[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;
const safeUrl = /^(https:|mailto:)/;
const projectSchema = z.object({
  kind: z.enum(PROJECT_KINDS), category: z.string().min(1), title: z.string().min(1), shortTitle: z.string().min(1),
  summary: z.string().min(1), role: z.string().min(1), methods: z.array(z.string().min(1)).min(1), featured: z.boolean(),
  order: z.number().int().nonnegative(), date: z.string().min(1).optional(), status: z.string().min(1).optional(),
}).strict();
const editorFields = { id: z.string().regex(EDITOR_ID), hidden: z.boolean(), edited: z.boolean().optional(), pendingEditorIds: z.boolean().optional() };
const markdownBlock = (type) => z.object({ ...editorFields, type: z.literal(type), markdown: z.string() }).strict();
const advancedBlock = z.object({ ...editorFields, type: z.literal('advanced'), raw: z.string() }).strict();
const blockSchema = z.discriminatedUnion('type', [markdownBlock('subheading'), markdownBlock('paragraph'), markdownBlock('list'), markdownBlock('table'), markdownBlock('image'), advancedBlock]);
const sectionSchema = z.object({ id: z.string().regex(EDITOR_ID), kind: z.enum(['standard', 'contribution']), hidden: z.boolean(), title: z.string().min(1), blocks: z.array(blockSchema).min(1), pendingEditorIds: z.boolean().optional() }).strict();
const researchSchema = z.object({ title: z.string().min(1), summary: z.string().min(1), order: z.number().int().nonnegative(), status: z.literal(MANUSCRIPT_STATUS).optional(), authorship: z.string().min(1).optional(), scope: z.array(z.string().min(1)).optional(), date: z.string().min(1).optional() }).strict();
const themeSchema = z.object({ text: z.string().regex(hex), background: z.string().regex(hex), surface: z.string().regex(hex), accent: z.string().regex(hex), focus: z.string().regex(hex).optional() }).strict();
const linkSchema = z.object({ label: z.string().min(1), href: z.string().regex(safeUrl) }).strict();
const siteSchema = z.object({
  name: z.string().min(1), degree: z.string().min(1).nullable().optional(), institution: z.string().min(1).nullable().optional(),
  email: z.email().nullable().optional(), intro: z.string().min(1), interests: z.array(z.string().min(1)),
  avatar: z.object({ mode: z.enum(['initials', 'hidden', 'image']), src: z.string().optional(), alt: z.string().min(1).optional() }).strict(),
  links: z.object({ github: z.string().regex(safeUrl).nullable().optional(), linkedin: z.string().regex(safeUrl).nullable().optional(), googleScholar: z.string().regex(safeUrl).nullable().optional(), orcid: z.string().regex(safeUrl).nullable().optional(), custom: z.array(linkSchema).optional() }).strict(),
  theme: themeSchema, navigation: z.array(z.object({ label: z.string().min(1), href: z.string().regex(/^\/(?:[a-z0-9-]+\/)*$/) }).strict()),
}).strict();
function fail(message) { throw new Error(message); }
function checked(schema, value, message) { const result = schema.safeParse(value); if (!result.success) fail(message); return result.data; }
function assertBlock(block) {
  checked(blockSchema, block, 'block contract is invalid');
  if (block.type === 'image') {
    const parsed = parseImageBlock(block.markdown);
    if (!parsed) fail('image block syntax is invalid');
    const image = parsed.source;
    if (!image || (!safePath.test(image) && !/^\.\/images\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(image))) fail('image path must be a safe relative path');
  }
}
function validateSections(document, { requireVisible = true } = {}) {
  const seen = new Set();
  for (const section of document.sections ?? []) {
    if (!EDITOR_ID.test(section.id ?? '')) fail('stable editor id is required');
    for (const block of section.blocks ?? []) if (!EDITOR_ID.test(block.id ?? '')) fail('stable editor id is required');
    for (const block of section.blocks ?? []) checked(blockSchema, block, 'block contract is invalid');
    checked(sectionSchema, section, 'section contract is invalid');
    if (seen.has(section.id)) fail('duplicate editor id'); seen.add(section.id);
    if (requireVisible && !section.blocks.some((block) => !block.hidden)) fail('section must contain visible content');
    for (const block of section.blocks) { if (!EDITOR_ID.test(block.id ?? '')) fail('stable editor id is required'); if (seen.has(block.id)) fail('duplicate editor id'); seen.add(block.id); assertBlock(block); }
  }
  if (!document.sections?.length) fail('document must contain sections');
}
export function validateProject(document) {
  checked(projectSchema, document.frontmatter, 'project frontmatter is invalid');
  validateSections(document);
  const contributions = document.sections.filter((section) => section.kind === 'contribution');
  if (document.frontmatter.kind === 'individual' && contributions.length) fail('individual project cannot contain a contribution section');
  if (document.frontmatter.kind === 'team' && contributions.length !== 1) fail('team project requires exactly one contribution section');
  if (contributions.some((section) => section.title !== CONTRIBUTION_TITLE)) fail('contribution section title must be My Role and Contribution');
  if (contributions.some((section) => !section.blocks.some((block) => !block.hidden && /[\p{L}\p{N}]/u.test((block.markdown ?? block.raw ?? '').trim())))) fail('contribution section requires non-empty visible text');
  return document;
}
export function validateResearch(document) { checked(researchSchema, document.frontmatter, 'research frontmatter is invalid'); validateSections(document); return document; }
export function validatePage(document) { validateSections(document); return document; }
export function validateSite(site) {
  checked(siteSchema, site, 'site configuration is invalid');
  validateThemeContrast(site.theme);
  if (site.avatar.mode === 'image' && !site.avatar.src) fail('image avatar requires a content-local source');
  if (site.avatar.mode !== 'image' && site.avatar.src) fail('non-image avatar cannot define a source');
  return site;
}
export function adoptEditorIds(document, idFactory) {
  for (const section of document.sections) { if (!section.id) section.id = idFactory(); for (const block of section.blocks) if (!block.id) block.id = idFactory(); }
  delete document.pendingEditorIds;
  for (const section of document.sections) { delete section.pendingEditorIds; for (const block of section.blocks) delete block.pendingEditorIds; }
  return document;
}
