/**
 * Shared HTTP plumbing for the API.
 *
 * Small on purpose. The interesting code is in `_core.ts`; this file only
 * deals with headers, methods and the shape of an error response.
 */

import type { ApiRequest, ApiResponse } from './_core.ts';

/** Headers every response carries. */
export function applyCommonHeaders(res: ApiResponse): void {
  // The demo is public and the payload is public market data, so anyone may
  // read it. The API key is never involved here: this server holds no key.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Answer a preflight.
 *
 * Returns true when the request was an OPTIONS and has been answered.
 */
export function handlePreflight(req: ApiRequest, res: ApiResponse): boolean {
  if ((req.method ?? 'GET').toUpperCase() !== 'OPTIONS') return false;
  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(204).json(null);
  return true;
}

/** Send an error in the same shape for every endpoint. */
export function sendError(res: ApiResponse, status: number, message: string, extra?: unknown): void {
  applyCommonHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json({ error: message, ...(extra ? { detail: extra } : {}) });
}
