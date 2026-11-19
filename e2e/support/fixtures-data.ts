/**
 * Dados fictícios usados pela bateria E2E. Tudo que a bateria cria usa o
 * prefixo `e2e-` (ids) ou `E2E ` (nomes), e é removido pela limpeza.
 */
export type RoleKey = "admin" | "developer" | "central" | "manager" | "supervisor" | "courier" | "courierB" | "courierC" | "pending";

export const users: Record<
  RoleKey,
  { email: string; name: string; role: string; storeId?: string; courierId?: string; supervisedStores?: string[] }
> = {
  admin: { email: "e2e-admin@example.com", name: "E2E Administradora", role: "ADMIN" },
  developer: { email: "e2e-dev@example.com", name: "E2E Desenvolvedora", role: "DEVELOPER" },
  // "central": supervisor regional de todas as filiais de teste (opera como a antiga Central).
  central: {
    email: "e2e-central@example.com",
    name: "E2E Central",
    role: "REGIONAL_SUPERVISOR",
    supervisedStores: ["e2e-store-a", "e2e-store-b", "e2e-store-zero", "e2e-store-inactive"],
  },
  manager: {
    email: "e2e-gerente@example.com",
    name: "E2E Gerente Savassi",
    role: "STORE_MANAGER",
    storeId: "e2e-store-a",
  },
  // Supervisor regional só da filial B (Contagem): não vê a filial A nem os motoboys de Belo Horizonte.
  supervisor: {
    email: "e2e-supervisor@example.com",
    name: "E2E Supervisor Contagem",
    role: "REGIONAL_SUPERVISOR",
    supervisedStores: ["e2e-store-b"],
  },
  courier: {
    email: "e2e-motoboy@example.com",
    name: "E2E João Motoboy",
    role: "COURIER",
    courierId: "e2e-courier-1",
  },
  // Roteiro da nova versão: A (courier) e B na cidade da filial A (Belo Horizonte); C em outra cidade.
  courierB: {
    email: "e2e-motoboy-b@example.com",
    name: "E2E Bruno Motoboy",
    role: "COURIER",
    courierId: "e2e-courier-b",
  },
  courierC: {
    email: "e2e-motoboy-c@example.com",
    name: "E2E Carla Motoboy",
    role: "COURIER",
    courierId: "e2e-courier-c",
  },
  pending: { email: "e2e-pendente@example.com", name: "E2E Pendente", role: "PENDING" },
};

/** Cidade em que cada motoboy recebe entregas (a da filial A é Belo Horizonte). */
export const courierCities: Record<string, string> = {
  "e2e-courier-1": "Belo Horizonte",
  "e2e-courier-2": "Belo Horizonte",
  "e2e-courier-b": "Belo Horizonte",
  "e2e-courier-c": "Contagem",
};

/** Motoboy extra sem login (só no banco) para cenários com dois motoboys. */
export const secondCourier = {
  appUserId: "e2e-user-courier-2",
  email: "e2e-motoboy2@example.com",
  name: "E2E Maria Motoboy",
  courierId: "e2e-courier-2",
};

// Coordenadas em Belo Horizonte / Contagem (MG).
export const stores = {
  a: {
    id: "e2e-store-a",
    code: "E2E-A",
    name: "E2E Drogaria Savassi",
    city: "Belo Horizonte",
    address: "Rua Pernambuco, 1000 - Savassi, Belo Horizonte - MG",
    lat: -19.9365,
    lng: -43.9351,
    feeCents: 850,
  },
  b: {
    id: "e2e-store-b",
    code: "E2E-B",
    name: "E2E Drogaria Contagem",
    city: "Contagem",
    address: "Av. João César de Oliveira, 2000 - Eldorado, Contagem - MG",
    lat: -19.9386,
    lng: -44.0529,
    feeCents: 1000,
  },
  zeroFee: {
    id: "e2e-store-zero",
    code: "E2E-Z",
    name: "E2E Filial Sem Tarifa",
    city: "Belo Horizonte",
    address: "Av. Afonso Pena, 1500 - Centro, Belo Horizonte - MG",
    lat: -19.9245,
    lng: -43.9352,
    feeCents: 0,
  },
  inactive: {
    id: "e2e-store-inactive",
    code: "E2E-I",
    name: "E2E Filial Inativa",
    city: "Belo Horizonte",
    address: "Rua da Bahia, 900 - Centro, Belo Horizonte - MG",
    lat: -19.9208,
    lng: -43.9378,
    feeCents: 900,
  },
} as const;

/** Destinos de clientes fictícios em BH. */
export const destinations = [
  { address: "Rua Cláudio Manoel, 500 - Funcionários, Belo Horizonte - MG", lat: -19.9335, lng: -43.9321 },
  { address: "Av. do Contorno, 6000 - Savassi, Belo Horizonte - MG", lat: -19.9409, lng: -43.9381 },
  { address: "Rua Paraíba, 1200 - Savassi, Belo Horizonte - MG", lat: -19.9377, lng: -43.9297 },
];

export const BH_POSITION = { latitude: -19.9367, longitude: -43.9345 };
