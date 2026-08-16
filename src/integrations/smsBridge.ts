import { registerPlugin } from '@capacitor/core';

/**
 * Native bridge to the centre's own Android device.
 * Provider neutral: whatever SIM/network is active in the device is used.
 */
export interface SmsBridgePlugin {
  checkPermission(): Promise<{ granted: boolean; telephony: boolean }>;
  requestPermission(): Promise<void>;
  send(options: { phone: string; message: string }): Promise<{ queued: boolean; phone: string }>;
  schedule(options: { phone: string; message: string; atEpochMs: number }): Promise<{ scheduled: boolean; atEpochMs: number; requestCode: number }>;
  checkCallPermission(): Promise<{ granted: boolean; telephony: boolean }>;
  requestCallPermission(): Promise<void>;
  call(options: { phone: string }): Promise<{ placed: boolean; mode: 'call' | 'dialer' }>;
}

export const SmsBridge = registerPlugin<SmsBridgePlugin>('SmsBridge');
