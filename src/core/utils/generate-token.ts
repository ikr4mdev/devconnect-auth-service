import { createHash, randomBytes } from 'crypto';

export function generateToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  return {
    token,
    tokenHash,
  };
}
