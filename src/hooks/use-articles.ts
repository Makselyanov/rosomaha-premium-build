import { useQuery } from "@tanstack/react-query";

import { articleCategories as fallbackCategories, articles as fallbackArticles, type Article } from "@/data/articles";

const ARTICLES_API_PATH = "/api/articles.json";

export const ALL_ARTICLES_CATEGORY = fallbackCategories[0] ?? "Все статьи";

function sanitizeArticle(value: unknown): Article | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.slug !== "string" || candidate.slug.length === 0) {
    return null;
  }

  return {
    id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : candidate.slug,
    slug: candidate.slug,
    title: typeof candidate.title === "string" ? candidate.title : "",
    excerpt: typeof candidate.excerpt === "string" ? candidate.excerpt : "",
    content: typeof candidate.content === "string" ? candidate.content : "",
    date: typeof candidate.date === "string" ? candidate.date : "",
    category: typeof candidate.category === "string" ? candidate.category : "Без категории",
    image: typeof candidate.image === "string" ? candidate.image : undefined,
    heroImage: typeof candidate.heroImage === "string" ? candidate.heroImage : undefined,
    coverImage:
      typeof candidate.coverImage === "string"
        ? candidate.coverImage
        : typeof candidate.heroImage === "string"
          ? candidate.heroImage
          : undefined,
    video: typeof candidate.video === "string" ? candidate.video : undefined,
    videoIsPortrait: typeof candidate.videoIsPortrait === "boolean" ? candidate.videoIsPortrait : undefined,
  };
}

async function fetchArticles(): Promise<Article[]> {
  const response = await fetch(ARTICLES_API_PATH);

  if (!response.ok) {
    throw new Error(`Failed to load articles: ${response.status}`);
  }

  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("Invalid articles payload");
  }

  return payload
    .map((item) => sanitizeArticle(item))
    .filter((item): item is Article => item !== null);
}

function mergeArticles(primaryArticles: Article[], secondaryArticles: Article[]): Article[] {
  const merged = new Map<string, Article>();

  for (const article of primaryArticles) {
    merged.set(article.slug, article);
  }

  for (const article of secondaryArticles) {
    if (!merged.has(article.slug)) {
      merged.set(article.slug, article);
    }
  }

  return Array.from(merged.values());
}

function buildCategories(articles: Article[]): string[] {
  const orderedCategories = new Set<string>([ALL_ARTICLES_CATEGORY, ...fallbackCategories.slice(1)]);

  for (const article of articles) {
    if (article.category) {
      orderedCategories.add(article.category);
    }
  }

  return Array.from(orderedCategories);
}

export function useArticles() {
  const { data: remoteArticles, isPending } = useQuery({
    queryKey: ["articles"],
    queryFn: fetchArticles,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const articles = mergeArticles(remoteArticles ?? [], fallbackArticles);
  const categories = buildCategories(articles);

  return {
    articles,
    categories,
    loading: isPending,
    allCategory: ALL_ARTICLES_CATEGORY,
    findBySlug: (slug?: string) => {
      if (!slug) {
        return undefined;
      }

      return articles.find((article) => article.slug === slug);
    },
    filterByCategory: (category: string) => {
      if (category === ALL_ARTICLES_CATEGORY) {
        return articles;
      }

      return articles.filter((article) => article.category === category);
    },
  };
}
