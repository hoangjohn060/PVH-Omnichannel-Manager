import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { httpsOrigin, readGateway, writeGateway } from '../../apps/desktop/electron/auth/configuration';
import { parseIpc } from '../../packages/shared/schemas';

it('persists a deployment-owned HTTPS origin outside application resources', () => {
  const directory=mkdtempSync(join(tmpdir(),'pvh-gateway-'));
  try {
    expect(readGateway(directory)).toBeNull();
    writeGateway(directory,'https://gateway.example.com');
    expect(readGateway(directory)).toBe('https://gateway.example.com');
    expect(parseIpc('auth:configure',{origin:readGateway(directory)})).toEqual({origin:'https://gateway.example.com'});
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

it.each(['http://localhost','https://user:password@example.com','https://example.com/','https://example.com/api','https://example.com?token=x','file:///tmp/app'])('rejects unsafe or non-origin Gateway configuration: %s', value => {
  expect(httpsOrigin(value)).toBeNull();
  expect(()=>parseIpc('auth:configure',{origin:value})).toThrow();
});