import { createHmac } from 'crypto';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const RESET_TOKEN_TTL = '15m';

export type TokenType = 'access' | 'refresh' | 'password-reset';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  type: 'access';
};

export function accessTokenSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET não configurado.');
  }

  return secret;
}

function derive(purpose: string): string {
  return createHmac('sha256', accessTokenSecret())
    .update(`modeladb:${purpose}`)
    .digest('hex');
}

export function refreshTokenSecret(): string {
  return process.env.JWT_REFRESH_SECRET || derive('refresh');
}

export function resetTokenSecret(passwordHash: string): string {
  const base = process.env.JWT_RESET_SECRET || derive('password-reset');
  return `${base}:${passwordHash}`;
}

export function encryptionKeyMaterial(): string {
  return process.env.ENCRYPTION_KEY || derive('encryption');
}
