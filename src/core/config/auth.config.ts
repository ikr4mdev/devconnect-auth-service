import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function requiredEnv(name: string) {
  const value: unknown = process.env[name];

  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (typeof value !== 'string') {
    throw new Error(`Env var ${name} must be a string, got ${typeof value}`);
  }
  if (value.trim() === '') {
    throw new Error(`Env var ${name} must not be blank`);
  }

  return value;
}

function requiredEnvList(name: string): string[] {
  const values = requiredEnv(name)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (values.length == 0)
    throw new Error(`Env var ${name} must contain at least one value`);

  return values;
}

export const authConfig = {
  privateKey: readFileSync(
    resolve(process.cwd(), '.keys/jwt-private.pem'),
    'utf8',
  ),
  publicKey: readFileSync(
    resolve(process.cwd(), '.keys/jwt-public.pem'),
    'utf8',
  ),
  audience: requiredEnvList('JWT_AUDIENCE'),
  issuer: requiredEnv('JWT_ISSUER'),
  expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
} as const;
