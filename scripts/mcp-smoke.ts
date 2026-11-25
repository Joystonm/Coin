/**
 * A smoke test for the MCP server: connect as a real client, call every tool,
 * print what came back. Not part of the shipped product — it exists so the
 * server is verified to work, not just to compile.
 *
 *   npx tsx scripts/mcp-smoke.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', join(process.cwd(), 'mcp', 'server.ts')],
  stderr: 'inherit',
});

const client = new Client({ name: 'smoke', version: '0.1.0' });

function text(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.map((c) => c.text ?? '').join('\n');
}

function head(s: string, n = 12): string {
  const lines = s.split('\n');
  return lines.length > n ? `${lines.slice(0, n).join('\n')}\n… ${lines.length - n} more lines` : s;
}

await client.connect(transport);

const tools = await client.listTools();
console.log(`TOOLS: ${tools.tools.map((t) => t.name).join(', ')}\n`);

const calls: [string, Record<string, unknown>][] = [
  ['list_assets', {}],
  ['judge_spread', { asset: 'NVDA', sizeUsd: 100000 }],
  ['judge_spread', { asset: 'NVDA', sizeUsd: 5000000 }],
  ['judge_spread', { asset: 'NOPE' }],
  ['get_asset', { asset: 'GOLD' }],
  ['find_traps', {}],
  ['price_impact', { asset: 'GOLD', wrapper: 'PAXG', sizeUsd: 100000 }],
  ['price_impact', { asset: 'GOLD', wrapper: 'NOPE', sizeUsd: 100000 }],
  ['list_findings', {}],
  ['list_calls', { failedOnly: true }],
];

for (const [name, args] of calls) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const body = text(res);
    console.log(`--- ${name} ${JSON.stringify(args)} ---`);
    console.log(head(body, 14));
    console.log('');
  } catch (error) {
    console.log(`--- ${name} ${JSON.stringify(args)} ---`);
    console.log(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

await client.close();
console.log('MCP SMOKE TEST COMPLETE');
