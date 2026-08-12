import path from 'node:path';

export function normalizedPrivacyText(value) {
  return value.normalize('NFKC').replace(/[\s\p{Z}]+/gu, ' ').trim();
}

function decodedPrivacyText(value) {
  let decoded = normalizedPrivacyText(value);
  for (let round = 0; round < 4; round += 1) {
    if (/%[0-9A-Za-z]{2}/.test(decoded) && /%(?![0-9A-Fa-f]{2})[0-9A-Za-z]{2}/.test(decoded)) return null;
    let changed = false;
    try {
      decoded = decoded.replace(/(?:%[0-9A-Fa-f]{2})+/g, (sequence) => {
        const next = decodeURIComponent(sequence);
        changed ||= next !== sequence;
        return next;
      }).normalize('NFKC');
    } catch {
      return null;
    }
    if (!changed) break;
  }
  if (/(?:%[0-9A-Fa-f]{2})+/.test(decoded)) return null;
  return decoded;
}

function externalWebUrl(value) {
  const candidate = normalizedPrivacyText(value);
  if (candidate === '' || /[\s\p{Z}]/u.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return /^(?:http|https):$/i.test(url.protocol) && url.hostname !== '' ? url : null;
  } catch {
    return null;
  }
}

export function absoluteLocalPath(value) {
  const candidate = decodedPrivacyText(value);
  if (candidate === null) return 'invalid percent encoding';
  if (candidate === '') return null;
  const separator = '[\\\\/]';
  const fileUriPattern = /(?<![A-Za-z0-9+.-])file:(?:\/{2,}|\\{2,})/i;
  const drivePattern = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:${separator}`, 'i');
  const uncPattern = /\\\\[A-Za-z0-9][A-Za-z0-9._-]*\\[A-Za-z0-9$][A-Za-z0-9$._-]*(?:\\|$)/i;
  const devicePattern = /\\\\[?.]\\(?:[A-Za-z]:\\|[A-Za-z0-9][A-Za-z0-9._-]*\\)/i;
  const roots = ['Users', 'home', 'tmp', 'var', 'private', 'mnt', 'rds', 'workspace'].join('|');
  const posixLocalRootPattern = new RegExp(`(?<![A-Za-z0-9._~-])/(?:${roots})(?:/|$)`, 'i');
  const direct = candidate.match(fileUriPattern) ?? candidate.match(drivePattern) ?? candidate.match(uncPattern) ?? candidate.match(devicePattern);
  if (direct) return direct[0];
  const webUrl = externalWebUrl(candidate);
  if (webUrl) return `${webUrl.search}\n${webUrl.hash}`.match(posixLocalRootPattern)?.[0] ?? null;
  return candidate.match(posixLocalRootPattern)?.[0] ?? null;
}

export async function trackedTextSurfaces(paths, { readIndex, readWorking }) {
  const surfaces = [];
  for (const relativePath of paths) {
    const indexSource = await readIndex(relativePath);
    surfaces.push({ relativePath, source: indexSource, kind: 'index' });
    const workingSource = await readWorking(relativePath);
    if (workingSource !== undefined && workingSource !== indexSource) surfaces.push({ relativePath, source: workingSource, kind: 'working' });
  }
  return surfaces;
}

export function normalizeSiteBase(href) {
  const url = new URL(href, 'https://generated-site.invalid');
  if (url.origin !== 'https://generated-site.invalid' || url.search || url.hash) throw new Error('site base must be an internal root URL');
  const pathname = decodeURIComponent(url.pathname);
  return pathname === '/' ? '/' : `/${pathname.replace(/^\/+|\/+$/g, '')}/`;
}

export function documentSiteBase(identityHref, canonicalBase) {
  const normalized = normalizeSiteBase(identityHref);
  if (normalized !== normalizeSiteBase(canonicalBase)) throw new Error('document site base must match canonical homepage base');
  return normalized;
}

export function stripSiteBase(pathname, base) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) throw new Error('internal path must be absolute');
  const normalizedBase = normalizeSiteBase(base);
  if (normalizedBase === '/') return pathname;
  if (pathname !== normalizedBase.slice(0, -1) && !pathname.startsWith(normalizedBase)) throw new Error('internal path escapes emitted site base');
  const relative = pathname.slice(normalizedBase.length - 1);
  return relative === '' ? '/' : relative;
}

export function expandSiteBase(pathname, base) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) throw new Error('canonical path must be root-relative');
  const normalizedBase = normalizeSiteBase(base);
  return normalizedBase === '/' ? pathname : `${normalizedBase.slice(0, -1)}${pathname}`;
}

export async function inventoryBuildInputs(root, io) {
  const canonicalRoot = await io.realpath(root);
  const pathApi = io.path ?? path;
  const withinRoot = (target) => {
    const relative = pathApi.relative(canonicalRoot, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
  };
  async function inspect(target, relativePath) {
    const info = await io.lstat(target);
    if (info.isSymbolicLink()) throw new Error(`build input ${relativePath} is a reparse escape`);
    const canonical = await io.realpath(target);
    if (!withinRoot(canonical)) throw new Error(`build input ${relativePath} escapes project root`);
    if (info.isFile()) return [{ relativePath, mtimeMs: info.mtimeMs }];
    if (!info.isDirectory()) throw new Error(`build input ${relativePath} is unsupported`);
    const files = [];
    for (const name of await io.readdir(target)) {
      files.push(...await inspect(`${target.replace(/[\\/]$/, '')}/${name}`, relativePath ? `${relativePath}/${name}` : name));
    }
    return files;
  }
  const inputs = [];
  for (const relativePath of ['astro.config.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'public', 'src', 'tsconfig.json']) {
    inputs.push(...await inspect(`${root.replace(/[\\/]$/, '')}/${relativePath}`, relativePath));
  }
  return inputs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
