export function missingConfirmedSpecies(
  confirmed: string[],
  region: string[],
  captive: string[],
) {
  const candidates = new Set(
    [...region, ...captive].map((name) => name.trim()).filter(Boolean),
  )
  return [...new Set(confirmed.map((name) => name.trim()).filter(Boolean))]
    .filter((name) => !candidates.has(name))
    .sort((a, b) => a.localeCompare(b))
}
