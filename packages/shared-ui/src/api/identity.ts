// The Amazon IAP user id, once known. Wallets belong to it, so every request carries it.
let iapUserId: string | null = null;

export function setIapUserId(id: string | null): void {
  iapUserId = id;
}

export function getIapUserId(): string | null {
  return iapUserId;
}
