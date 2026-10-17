import { getDeviceId } from '../api/deviceId';
import type { IapKind, IapService, IapUser } from './types';

function randomHex(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

export function fakeReceiptId(): string {
  const hex = randomHex(32);
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `fake-${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

// Stands in for Amazon IAP on the web and on devices without the IAP service. Only a server in
// fake mode accepts these receipts, so real servers simply turn purchases off.
export class SimulatedIap implements IapService {
  readonly kind: IapKind = 'simulated';
  private user: IapUser | null = null;

  constructor(private readonly deviceId: () => Promise<string> = getDeviceId) {}

  async init(): Promise<IapUser | null> {
    const deviceId = await this.deviceId();
    this.user = { userId: `fake-user-${deviceId}`, marketplace: null };
    return this.user;
  }

  async getProducts(): Promise<Record<string, never>> {
    return {};
  }

  async purchase(sku: string) {
    const user = this.user ?? (await this.init());
    if (!user) return { status: 'unavailable' as const };
    return { status: 'purchased' as const, receiptId: fakeReceiptId(), sku, userId: user.userId, marketplace: null };
  }

  async pendingReceipts() {
    return [];
  }

  async fulfill(): Promise<void> {}
}
