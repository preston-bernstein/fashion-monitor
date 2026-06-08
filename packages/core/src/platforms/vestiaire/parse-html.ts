import * as cheerio from "cheerio";

export function extractVestiaireProductsFromHtml(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  const rawJson = $("#__NEXT_DATA__").text();
  if (!rawJson) {
    throw new Error("Vestiaire __NEXT_DATA__ not found");
  }
  const data = JSON.parse(rawJson) as {
    props?: { pageProps?: { initialData?: { items?: Record<string, unknown>[] } } };
  };
  return data?.props?.pageProps?.initialData?.items ?? [];
}
