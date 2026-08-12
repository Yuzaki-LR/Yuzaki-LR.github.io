import { toPublicAssetHref } from './asset-routes.mjs';
export function withBase(base, href = '/') { const root = !base || base === '/' ? '/' : `/${base.replace(/^\/+|\/+$/g, '')}/`; return href === '/' ? root : `${root}${href.replace(/^\//, '')}`; }
export function internalHref(base, href) { return typeof href === 'string' && href.startsWith('/') ? withBase(base, href) : href; }
function publicLinks(links) {
  return [
    ['GitHub', links.github], ['LinkedIn', links.linkedin], ['Google Scholar', links.googleScholar], ['ORCID', links.orcid],
    ...(links.custom ?? []).map(({ label, href }) => [label, href]),
  ].filter(([, href]) => typeof href === 'string' && href.length).map(([label, href]) => ({ label, href }));
}
export function toPublicSiteModel(repository, { base = '/' } = {}) {
  const { site, about } = repository;
  const currentDirection = about.sections.flatMap((section) => section.blocks).find((block) => block.type === 'paragraph' && !block.hidden)?.markdown ?? '';
  return {
    profile: { name: site.name, degree: site.degree ?? null, institution: site.institution ?? null, email: site.email ?? null, intro: site.intro, interests: site.interests, avatar: site.avatar.mode === 'image' ? { ...site.avatar, src: toPublicAssetHref({ kind: 'site', relativeSource: site.avatar.src, base }) } : site.avatar, links: publicLinks(site.links) },
    navigation: site.navigation.map((item) => ({ ...item, href: withBase(base, item.href) })),
    base: withBase(base),
    theme: { ...site.theme, focus: site.theme.focus ?? site.theme.accent },
    about: { currentDirection },
    research: repository.research.map(({ slug, document }) => ({ slug, ...document.frontmatter })),
  };
}
