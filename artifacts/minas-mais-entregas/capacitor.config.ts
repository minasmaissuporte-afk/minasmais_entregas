import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.drogariasminasmais.entregas",
  appName: "Minas Mais Entregas",
  webDir: "dist/public",
  android: {
    useLegacyBridge: true,
    backgroundColor: "#f4f3f1",
  },
  server: {
    androidScheme: "https",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
