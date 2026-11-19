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
    // O app instalado abre o sistema publicado na Vercel: atualizações chegam sem nova versão na loja.
    url: "https://minas-mais-entregas.vercel.app/user-portal",
    allowNavigation: [
      "minas-mais-entregas.vercel.app",
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
