import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function httpsOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password ? value! : null;
  } catch { return null; }
}

export function readGateway(directory: string): string | null {
  try { return httpsOrigin(JSON.parse(readFileSync(join(directory, 'gateway.json'), 'utf8')).origin); }
  catch { return null; }
}

export function writeGateway(directory: string, value: string): void {
  const origin = httpsOrigin(value);
  if (!origin) throw new Error('INVALID_GATEWAY_ORIGIN');
  const filename = join(directory, 'gateway.json');
  writeFileSync(filename + '.tmp', JSON.stringify({ origin }), { mode: 0o600 });
  renameSync(filename + '.tmp', filename);
}