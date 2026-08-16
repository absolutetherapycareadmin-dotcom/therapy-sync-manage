import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.therapycare.app",
  appName: "Therapy Care",
  webDir: "public",
  android: {
    backgroundColor: "#ffffff",
  },
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: false,
        androidScheme: "https",
      }
    : undefined,
};

export default config;
