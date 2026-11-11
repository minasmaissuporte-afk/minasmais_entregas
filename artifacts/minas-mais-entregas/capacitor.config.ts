import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.drogariasminasmais.entregas",
  appName: "Minas Mais Entregas",
  webDir: "dist/public",
  android: {
    useLegacyBridge: true,
    backgroundColor: "#E20210",
  },
  server: {
    androidScheme: "https",
    url: "https://minas-mais-entregas.replit.app/user-portal",
    allowNavigation: [
      "minas-mais-entregas.replit.app",
      "*.minas-mais-entregas.replit.app",
      // Supabase Auth (login, códigos por e-mail e redefinição de senha).
      "*.supabase.co",
    ],
    errorPath: "native-offline.html",
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
