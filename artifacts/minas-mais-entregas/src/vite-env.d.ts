/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NATIVE_API_BASE_URL?: string;
  /** Chave do navegador da Maps JavaScript API (restrita por domínio no Google Cloud). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  /** Map ID do Google Cloud; sem ele usa DEMO_MAP_ID (só para desenvolvimento). */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Legacy name for the publishable key, accepted as a fallback. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
