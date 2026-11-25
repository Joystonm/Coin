/**
 * GET /api/provenance — the receipts.
 *
 * Every endpoint this project called, the query it sent, the status it got
 * back, CoinMarketCap's own error code, the credits it charged and how long it
 * took. This is the endpoint the brief asks for: the API calls, named, with
 * the evidence.
 *
 * The array is not reconstructed after the fact. It is the array the puller
 * appended to as it went, so it is a record of what actually happened.
 */

import { buildProvenance, type ApiRequest, type ApiResponse } from './_core.ts';
import { applyCommonHeaders, handlePreflight } from './_http.ts';

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (handlePreflight(req, res)) return;

  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // The snapshot only changes when it is refreshed, so this can be cached
  // briefly and revalidated cheaply.
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');

  const provenance = buildProvenance();
  res.setHeader('X-Snapshot-Source', provenance.source);
  res.setHeader('X-Snapshot-Generated-At', provenance.generatedAt);
  res.status(200).json(provenance);
}
