/**
 * GET /api/snapshot — the raw snapshot, as JSON.
 *
 * The same bytes the static site serves at `/data/snapshot.json`, served from
 * the API instead so that a caller can pull it with an `Accept: application/json`
 * header and get the provenance headers with it.
 *
 * The key is never involved. This endpoint cannot make a request to
 * CoinMarketCap; it serves a committed capture.
 */

import { SNAPSHOT, type ApiRequest, type ApiResponse } from './_core.ts';
import { applyCommonHeaders, handlePreflight } from './_http.ts';

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (handlePreflight(req, res)) return;

  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');
  res.setHeader('X-Snapshot-Source', SNAPSHOT.source);
  res.setHeader('X-Snapshot-Generated-At', SNAPSHOT.generatedAt);
  res.status(200).json(SNAPSHOT);
}
