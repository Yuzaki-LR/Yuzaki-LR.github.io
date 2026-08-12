import { loadSiteRepository } from '../../../lib/content/repository.mjs';
import { assetStem, listStaticAssetRoutes } from '../../../lib/content/asset-routes.mjs';
import type { APIContext } from 'astro';

interface Asset { kind: 'project' | 'site'; name: string; relativeSource: string; bytes: Uint8Array; }

export async function getStaticPaths() {
  const repository = await loadSiteRepository();
  return listStaticAssetRoutes(repository).filter((asset: Asset) => asset.kind === 'site').map((asset: Asset) => ({
    params: { name: assetStem(asset.relativeSource, 'site') }, props: { asset },
  }));
}

export function GET({ props, params }: APIContext) {
  const { asset } = props as { asset: Asset };
  if (asset.kind !== 'site' || params.name !== assetStem(asset.relativeSource, 'site')) return new Response(null, { status: 404 });
  const body = asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(asset.bytes.length) } });
}
