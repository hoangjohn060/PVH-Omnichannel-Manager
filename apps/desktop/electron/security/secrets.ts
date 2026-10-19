import { safeStorage } from 'electron';
// Main-process-only boundary. Never imported into preload or renderer.
export function encryptSecret(value: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption unavailable');
  return safeStorage.encryptString(value);
}
export function decryptSecret(value: Buffer): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption unavailable');
  return safeStorage.decryptString(value);
}