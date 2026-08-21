import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Webhooks and probes have nothing to index and shouldn't be crawled.
      disallow: "/api/",
    },
    sitemap: `${site.url}/sitemap.xml`,
  };
}
