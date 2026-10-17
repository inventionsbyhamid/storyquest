import { randomInt } from 'node:crypto';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
// No 0, 1, i, l or o: share slugs get read aloud and typed from a TV screen.
const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export type IdPrefix = 'tr' | 'nd' | 'st' | 'id' | 'jb';

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomString(ID_ALPHABET, 16)}`;
}

export function newShareSlug(): string {
  return randomString(SLUG_ALPHABET, 8);
}

export function newFileTag(): string {
  return randomString(ID_ALPHABET, 6);
}

export const PATH_ID = /^[a-z]{2}_[0-9a-z]{16}$/;
export const SLUG = /^[2-9a-hjkmnp-z]{8}$/;
