export function parseAssetName(relativeSource, kind = 'project') {
  const prefix = kind === 'site' ? './site-images/' : './images/';
  if (typeof relativeSource !== 'string' || !new RegExp(`^${prefix.replace('.', '\\.').replace('/', '\\/')}[A-Za-z0-9][A-Za-z0-9_-]*\\.png$`).test(relativeSource)) throw new Error('asset source must be a content-local PNG');
  return relativeSource.slice(prefix.length);
}
export function assetStem(relativeSource, kind = 'project') {
  const name = parseAssetName(relativeSource, kind);
  const stem = name.slice(0, -4);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(stem)) throw new Error('asset name must have an extensionless safe stem');
  return stem;
}
function normalBase(base) {
  if (!base || base === '/') return '';
  return `/${base.replace(/^\/+|\/+$/g, '')}`;
}
export function toPublicAssetHref({ kind, slug, relativeSource, base = '/' }) {
  const name = parseAssetName(relativeSource, kind);
  if (kind === 'project') {
    if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new Error('project asset slug is invalid');
    return `${normalBase(base)}/assets/projects/${slug}/${name}`;
  }
  if (kind === 'site') return `${normalBase(base)}/assets/site/${name}`;
  throw new Error('asset kind is invalid');
}
export function listStaticAssetRoutes(repository) {
  const records = new Map();
  for (const asset of repository.images) {
    const route = { ...asset, pathname: toPublicAssetHref(asset) };
    const key = route.pathname.toLowerCase();
    const prior = records.get(key);
    if (prior && prior.pathname !== route.pathname) throw new Error('asset route case collision');
    records.set(key, route);
  }
  return [...records.values()];
}
