import type { Article } from "@/data/articles";
import { canonicalArticles } from "@/data/canonical-articles";

export const ALL_ARTICLES_CATEGORY = "Все статьи";

function buildCategories(articles: Article[]): string[] {
  const orderedCategories = new Set<string>([ALL_ARTICLES_CATEGORY]);

  for (const article of articles) {
    if (article.category) {
      orderedCategories.add(article.category);
    }
  }

  return Array.from(orderedCategories);
}

export function useArticles() {
  const articles = canonicalArticles;
  const categories = buildCategories(articles);

  return {
    articles,
    categories,
    loading: false,
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
