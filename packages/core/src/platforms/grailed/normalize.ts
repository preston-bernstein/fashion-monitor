export function normalizeGrailed(hit: Record<string, unknown>) {
  const designer = hit.designer as { name: string } | undefined;
  const coverPhoto = hit.cover_photo as { url: string } | undefined;
  const createdAt = hit.created_at as number | undefined;

  return {
    id: String(hit.id),
    platform: "grailed" as const,
    title: String(hit.title ?? ""),
    description: String(hit.description ?? ""),
    price: parseFloat(String(hit.price_i ?? 0)),
    currency: "USD",
    size: String(hit.size ?? ""),
    brand: designer?.name ?? null,
    url: `https://www.grailed.com/listings/${hit.id}`,
    imageUrl: coverPhoto?.url ?? null,
    listedAt: createdAt ? new Date(createdAt * 1000) : null,
    condition: hit.condition ? String(hit.condition) : null,
    raw: hit,
  };
}
