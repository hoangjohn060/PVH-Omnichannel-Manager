export async function fetchAvatarData(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !(parsed.hostname === 'zdn.vn' || parsed.hostname.endsWith('.zdn.vn')) || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return null;
    const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(8000), credentials: 'omit' });
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !response.body || !['image/png', 'image/jpeg'].includes(mime ?? '') || Number(response.headers.get('content-length') ?? 0) > 350_000) return null;
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 350_000) { await reader.cancel(); return null; } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return `data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch { return null; }
}