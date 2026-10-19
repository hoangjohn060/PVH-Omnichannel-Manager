export const hex = (input: ArrayBuffer): string => Array.from(new Uint8Array(input), byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
export async function digest(text: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', bytes(text))); }
export function randomSecret(): string { return hex(crypto.getRandomValues(new Uint8Array(32)).buffer); }
export async function hmac(secret: string, body: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, body);
}
// Compare fixed-length digests rather than branching on secret characters.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))]);
  const native = (crypto.subtle as SubtleCrypto & { timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean }).timingSafeEqual;
  if (native) return native.call(crypto.subtle, x, y);
  // Node fixture runtime lacks Workers' extension. Web Crypto verifies HMAC in native code.
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return crypto.subtle.verify('HMAC', key, await crypto.subtle.sign('HMAC', key, x), y);
}
export async function validSignature(secret: string, raw: ArrayBuffer, signature: string | null): Promise<boolean> {
  if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(`sha256=${hex(await hmac(secret, raw))}`, signature);
}
async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(secret: string, text: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes(context) }, await encryptionKey(secret), bytes(text));
  return `v1.${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...new Uint8Array(data)))}`;
}
export async function decrypt(secret: string, text: string, context: string): Promise<string> {
  const [version, iv, data] = text.split('.');
  if (version !== 'v1' || !iv || !data) throw new Error('INVALID_CIPHERTEXT');
  const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(iv), c => c.charCodeAt(0)), additionalData: bytes(context) }, await encryptionKey(secret), Uint8Array.from(atob(data), c => c.charCodeAt(0)));
  return new TextDecoder().decode(decoded);
}
export async function boundedBody(request: Request, limit = 262144): Promise<ArrayBuffer> {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('BODY_TOO_LARGE');
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(part.value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}