/**
 * Hash routing.
 *
 * No router dependency: the URL hash is the route, so the built site works
 * from any static file server and a judge can paste a link to an asset.
 */

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'radar' }
  | { name: 'asset'; symbol: string }
  | { name: 'findings' }
  | { name: 'method' };

export const ROUTE_LABELS: Record<Route['name'], string> = {
  radar: 'Radar',
  asset: 'Asset',
  findings: 'Findings',
  method: 'Method',
};

/** Turn a hash into a route. Unknown hashes fall back to the radar. */
export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').trim();
  if (clean === '') return { name: 'radar' };
  const [head, ...rest] = clean.split('/');
  const tail = rest.join('/');
  switch (head) {
    case 'asset':
      return tail ? { name: 'asset', symbol: decodeURIComponent(tail) } : { name: 'radar' };
    case 'findings':
      return { name: 'findings' };
    case 'method':
      return { name: 'method' };
    case 'radar':
      return { name: 'radar' };
    default:
      return { name: 'radar' };
  }
}

export function assetHref(symbol: string): string {
  return `#/asset/${encodeURIComponent(symbol)}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getHash(): string {
  return window.location.hash;
}

/** The current route, re-rendered whenever the hash changes. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, getHash);
  return parseRoute(hash);
}
