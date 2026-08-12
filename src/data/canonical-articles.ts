import embeddedCanonicalArticles from "virtual:canonical-articles";

import type { Article } from "@/data/articles";

// The canonical export alone defines runtime membership. In particular, an
// article that exists only in static source cannot leak into the public list.
export const canonicalArticles: Article[] = embeddedCanonicalArticles;
