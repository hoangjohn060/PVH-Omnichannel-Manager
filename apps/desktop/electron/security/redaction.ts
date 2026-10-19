export function redactLog(value: unknown): string {
  return String(value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(Bearer)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/((?:access_?token|refresh_?token|password|cookie|secret|authorization)["']?\s*[:=]\s*)[^\r\n,}]+/gi, '$1[REDACTED]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[TOKEN_REDACTED]')
    .slice(0, 2000);
}