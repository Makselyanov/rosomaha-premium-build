type ArticleMedia = {
  content?: string;
  coverImage?: string;
  heroImage?: string;
  image?: string;
};

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

export function extractMarkdownImageUrls(content?: string): string[] {
  if (!content) {
    return [];
  }

  return [...content.matchAll(MARKDOWN_IMAGE_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

export function getArticleHeroImage(article: ArticleMedia): string | undefined {
  const explicitHero = article.heroImage || article.coverImage;

  if (explicitHero) {
    return explicitHero;
  }

  const contentImage = extractMarkdownImageUrls(article.content)[0];
  return contentImage || article.image;
}
