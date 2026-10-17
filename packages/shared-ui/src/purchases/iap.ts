import { SimulatedIap } from './simulatedIap';
import type { IapService } from './types';

// Amazon In App Purchasing only exists on Vega; elsewhere purchases are simulated for development.
export function createIapService(): IapService {
  return new SimulatedIap();
}
