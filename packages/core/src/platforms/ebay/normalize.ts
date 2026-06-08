type EbayAspect = { name: string; value: string };

function extractAspect(aspects: EbayAspect[], name: string): string | null {
  return aspects.find((a) => a.name === name)?.value ?? null;
}

function extractSize(aspects: EbayAspect[]): string {
  return extractAspect(aspects, "Size") ?? extractAspect(aspects, "US Size") ?? "";
}

export function normalizeEbay(item: Record<string, unknown>) {
  const price = item.price as { value: string; currency: string } | undefined;
  const aspects = (item.localizedAspects as EbayAspect[]) ?? [];
  const image = item.image as { imageUrl: string } | undefined;

  return {
    id: String(item.itemId),
    platform: "ebay" as const,
    title: String(item.title ?? ""),
    description: String(item.shortDescription ?? ""),
    price: price ? parseFloat(price.value) : 0,
    currency: price?.currency ?? "USD",
    size: extractSize(aspects),
    brand: extractAspect(aspects, "Brand"),
    url: String(item.itemWebUrl ?? ""),
    imageUrl: image?.imageUrl ?? null,
    listedAt: item.itemCreationDate ? new Date(String(item.itemCreationDate)) : null,
    condition: item.condition ? String(item.condition) : null,
    raw: item,
  };
}
