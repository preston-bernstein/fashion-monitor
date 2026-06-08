export function normalizeVestiaire(item: Record<string, unknown>) {
  const price = item.price as { cents: number; currency: string } | undefined;
  const brand = item.brand as { name: string } | undefined;
  const size = item.size as { name: string } | undefined;
  const pictures = item.pictures as Array<{ url: string }> | undefined;

  return {
    id: String(item.id),
    platform: "vestiaire" as const,
    title: String(item.name ?? ""),
    description: String(item.description ?? ""),
    price: price ? price.cents / 100 : 0,
    currency: price?.currency ?? "USD",
    size: size?.name ?? "",
    brand: brand?.name ?? null,
    url: `https://www.vestiairecollective.com${String(item.link ?? "")}`,
    imageUrl: pictures?.[0]?.url ?? null,
    listedAt: item.createdAt ? new Date(String(item.createdAt)) : null,
    condition: (item.condition as { name: string } | undefined)?.name ?? null,
    raw: item,
  };
}
