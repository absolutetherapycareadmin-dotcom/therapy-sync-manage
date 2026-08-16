import { registerPlugin } from '@capacitor/core';

export interface SmsBridgePlugin {
  checkPermission(): Promise<{ granted: boolean; telephony: boolean }>;
  requestPermission(): Promise<void>;
  send(options: { phone: string; message: string }): Promise<{ queued: boolean; phone: string }>;
  schedule(options: { phone: string; message: string; atEpochMs: number }): Promise<{ scheduled: boolean; atEpochMs: number; requestCode: number }>;
}

export const SmsBridge = registerPlugin<SmsBridgePlugin>('SmsBridge');
