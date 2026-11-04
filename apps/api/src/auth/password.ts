import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

let active = 0;
async function derive(password: string, salt: Buffer) {
  if (active >= 4) throw Object.assign(new Error('AUTH_BUSY'), { code: 'AUTH_BUSY' });
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, result) => (error ? reject(error) : resolve(result)),
      );
    });
  } finally {
    active--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/u.exec(encoded);
  if (!match || Buffer.byteLength(password) > 1024) return false;
  const actual = await derive(password, Buffer.from(match[1]!, 'hex'));
  return timingSafeEqual(actual, Buffer.from(match[2]!, 'hex'));
}
