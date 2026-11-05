const genericCourierNames = new Set([
  "motoboy",
  "motobói",
  "entregador",
  "courier",
  "driver",
]);

export function getCourierDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const candidate = name?.trim() ?? "";
  const normalized = candidate.toLocaleLowerCase("pt-BR");
  const isPlaceholder =
    !candidate ||
    candidate.includes("@") ||
    genericCourierNames.has(normalized) ||
    /^motoboy\s+\d+$/i.test(candidate);
  if (!isPlaceholder) return candidate;

  const localPart = email?.trim().split("@")[0]?.trim() ?? "";
  if (!localPart) return "Sem nome cadastrado";
  return localPart.charAt(0).toLocaleUpperCase("pt-BR") + localPart.slice(1);
}

export function getOptionalCourierDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (!name?.trim() && !email?.trim()) return null;
  return getCourierDisplayName(name, email);
}

export function getCourierFirstName(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  return getCourierDisplayName(name, email).split(/\s+/)[0] || "Sem nome cadastrado";
}

export function getCourierInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-BR"))
    .join("");
}
