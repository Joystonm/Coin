/**
 * GET /api/judge — re-judge the spreads at a notional size.
 *
 *   /api/judge                      every asset at the snapshot's own size
 *   /api/judge?asset=NVDA           one asset
 *   /api/judge?sizeUsd=250000       every asset at a different size
 *   /api/judge?asset=NVDA&sizeUsd=250000
 *
 * Cost is not linear in size, so a verdict is only true at the size it was
 * priced at. This endpoint re-runs the pairs through the same judge the CLI
 * and the MCP server use, which is why the number here and the number in a
 * terminal cannot disagree.
 */

import {
  judgeAtSize,
  parseSize,
  queryParam,
  type ApiRequest,
  type ApiResponse,
} from './_core.ts';
import { applyCommonHeaders, handlePreflight, sendError } from './_http.ts';

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (handlePreflight(req, res)) return;

  const asset = queryParam(req.query, 'asset');
  const sizeUsd = parseSize(queryParam(req.query, 'sizeUsd'));

  const result = judgeAtSize({ asset, sizeUsd });

  if (asset && result.assets.length === 0) {
    sendError(res, 404, `No asset matching "${asset}" in the snapshot.`, {
      availableAssets: result.availableAssets,
    });
    return;
  }

  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');
  res.setHeader('X-Size-Usd', String(result.sizeUsd));
  res.status(200).json(result);
}
