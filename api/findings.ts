/**
 * GET /api/findings — the problems the API itself has.
 *
 * Two lists, kept apart on purpose:
 *
 *   findings   derived from the data we pulled — a wrapper with a null price,
 *              two wrappers quoted in different units, a stale print, an
 *              endpoint that would tell us where these assets really trade but
 *              is refused on our plan
 *   apiIssues  the same thing, recorded at pull time, including the calls that
 *              were refused outright
 *
 * Every finding carries a `repro` a reader can run. None of them carry a key.
 */

import { findingsFor, type ApiRequest, type ApiResponse } from './_core.ts';
import { applyCommonHeaders, handlePreflight } from './_http.ts';

export default function handler(req: ApiRequest, res: ApiResponse): void {
  if (handlePreflight(req, res)) return;

  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');

  const { findings, apiIssues } = findingsFor();
  res.status(200).json({
    findings,
    apiIssues,
    counts: {
      findings: findings.length,
      apiIssues: apiIssues.length,
      bySeverity: {
        3: findings.filter((f) => f.severity === 3).length,
        2: findings.filter((f) => f.severity === 2).length,
        1: findings.filter((f) => f.severity === 1).length,
      },
    },
  });
}
