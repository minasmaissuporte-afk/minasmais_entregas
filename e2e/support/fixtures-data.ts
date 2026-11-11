/**
 * Dados fictícios usados pela bateria E2E. Tudo que a bateria cria usa o
 * prefixo `e2e-` (ids) ou `E2E ` (nomes), e é removido pela limpeza.
 */
export type RoleKey = "admin" | "central" | "manager" | "staff" | "courier" | "pending";

export const users: Record<
  RoleKey,
  { email: string; name: string; role: string; storeId?: string; courierId?: string }
> = {
  admin: { email: "e2e-admin@example.com", name: "E2E Administradora", role: "ADMIN" },
  central: { email: "e2e-central@example.com", name: "E2E Central", role: "CENTRAL" },
  manager: {
    email: "e2e-gerente@example.com",
    name: "E2E Gerente Savassi",
    role: "STORE_MANAGER",
    storeId: "e2e-store-a",
  },
  staff: {
    email: "e2e-atendente@example.com",
    name: "E2E Atendente Contagem",
    role: "STORE_STAFF",
    storeId: "e2e-store-b",
  },
  courier: {
    email: "e2e-motoboy@example.com",
    name: "E2E João Motoboy",
    role: "COURIER",
    courierId: "e2e-courier-1",
  },
  pending: { email: "e2e-pendente@example.com", name: "E2E Pendente", role: "PENDING" },
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
