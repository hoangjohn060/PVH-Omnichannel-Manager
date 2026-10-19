import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Versioned, memory-hard KDF; no custom cryptography and no plaintext persistence.
// 16 MiB, p=5. Must be exercised in workerd, not merely Node (see validation).
const prefix = 'scrypt:16384:8:5';
async function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 32,
    { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 },
    (error, key) => error ? reject(new Error('PASSWORD_KDF_UNAVAILABLE')) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `${prefix}:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts.slice(0,4).join(':') !== prefix || !/^[a-f0-9]{32}$/.test(parts[4]!) || !/^[a-f0-9]{64}$/.test(parts[5]!)) return false;
  return timingSafeEqual(await derive(password, parts[4]!), Buffer.from(parts[5]!, 'hex'));
}