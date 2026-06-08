import type { Platform } from "../core/types.js";

const PLATFORM_IMAGE_HOSTS: Record<Platform, RegExp[]> = {
  ebay: [/\.ebayimg\.com$/i],
  grailed: [/\.grailed\.com$/i, /^media-assets\.grailed\.com$/i],
  depop: [/\.depop\.com$/i],
  poshmark: [/\.poshmark\.com$/i, /^di2ponv0v5otw\.cloudfront\.net$/i],
  vestiaire: [/\.vestiairecollective\.com$/i],
  vinted: [/\.vinted\.com$/i, /^images\d*\.vinted\.com$/i],
};

const ALL_HOST_PATTERNS = Object.values(PLATFORM_IMAGE_HOSTS).flat();

export function imageUrlHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isAllowedImageHost(platform: Platform, hostname: string): boolean {
  return PLATFORM_IMAGE_HOSTS[platform].some((pattern) => pattern.test(hostname));
}

export function isAllowedImageUrl(platform: Platform, url: string): boolean {
  const hostname = imageUrlHostname(url);
  if (!hostname) return false;
  return isAllowedImageHost(platform, hostname);
}

/** Validate a user-supplied URL against any known marketplace image host. */
export function isAllowedCuratedImageUrl(url: string): boolean {
  const hostname = imageUrlHostname(url);
  if (!hostname) return false;
  return ALL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}
