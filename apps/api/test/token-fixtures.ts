import { generateKeyPair, SignJWT } from 'jose';

export async function tokenWithInvalidSignature(issuer: string, subject: string) {
  const response = await fetch(`${issuer}/protocol/openid-connect/certs`);
  const jwks = (await response.json()) as { keys: { kid: string; alg?: string; use?: string }[] };
  const kid = jwks.keys.find((key) => key.alg === 'RS256' && key.use === 'sig')?.kid;
  if (!kid) throw new Error('Expected local RSA signing key');
  const { privateKey } = await generateKeyPair('RS256');
  return new SignJWT({ scope: 'task:read task:write', typ: 'Bearer' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setSubject(subject)
    .setAudience('acc-api')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}
