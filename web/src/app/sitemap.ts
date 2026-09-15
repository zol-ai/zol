import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/*
  One URL. The waitlist page is deliberately not here — it is reachable by
  link but not something to be found; see `waitlistPath` in lib/site.ts.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site.url,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
