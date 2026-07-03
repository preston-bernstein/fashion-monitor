import type { Listing } from "../core/types.js";
import { isAllowedImageUrl } from "./allowlist.js";
import { normalizeImageUrl } from "./url-hash.js";

export interface ExtractedImage {
  url: string;
  position: number;
  width?: number;
  height?: number;
}

function pushUnique(
  images: ExtractedImage[],
  seen: Set<string>,
  url: unknown,
  position: number,
  width?: number,
  height?: number,
): void {
  if (typeof url !== "string") return;
  const normalized = normalizeImageUrl(url);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  images.push({ url: normalized, position, width, height });
}

export function extractListingImages(listing: Listing): ExtractedImage[] {
  const seen = new Set<string>();
  const images: ExtractedImage[] = [];
  const raw = listing.raw;

  if (listing.imageUrl) {
    pushUnique(images, seen, listing.imageUrl, 0);
  }

  switch (listing.platform) {
    case "ebay": {
      const additional = (raw.additionalImages as Array<{ imageUrl?: string }> | undefined) ?? [];
      additional.forEach((img, i) => pushUnique(images, seen, img.imageUrl, i + 1));
      break;
    }
    case "grailed": {
      const photos = (raw.photos as Array<{ url?: string }> | undefined) ?? [];
      photos.forEach((photo, i) => pushUnique(images, seen, photo.url, images.length + i));
      break;
    }
    case "depop": {
      const preview = raw.preview;
      if (Array.isArray(preview)) {
        preview.forEach((entry, i) =>
          pushUnique(images, seen, (entry as { url?: string }).url, images.length + i),
        );
      } else if (preview && typeof preview === "object") {
        for (const key of ["640", "1280", "480", "320"]) {
          pushUnique(images, seen, (preview as Record<string, string>)[key], images.length);
        }
      }
      const pictures =
        (raw.pictures as
          | Array<{ formats?: { P0?: { url?: string; width?: number; height?: number } } }>
          | undefined) ?? [];
      pictures.forEach((pic) => {
        const fmt = pic.formats?.P0;
        pushUnique(images, seen, fmt?.url, images.length, fmt?.width, fmt?.height);
      });
      break;
    }
    case "vestiaire": {
      const pictures = (raw.pictures as Array<{ url?: string }> | undefined) ?? [];
      pictures.forEach((pic, i) => pushUnique(images, seen, pic.url, images.length + i));
      break;
    }
    case "poshmark":
      break;
    case "vinted":
      break;
  }

  return images
    .filter((img) => isAllowedImageUrl(listing.platform, img.url))
    .map((img, index) => ({ ...img, position: index }));
}
