import { Helmet } from 'react-helmet-async';

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  image?: string;
  type?: string;
  article?: {
    publishedTime?: string;
    section?: string;
  };
  noindex?: boolean;
  breadcrumbs?: BreadcrumbItem[];
}

const SITE_NAME = 'РОСОМАХА';
const BASE_URL = 'https://xn--80aa8ahaki9a.site';
const DEFAULT_IMAGE = '/media/company/rosomaha-deep-mud.jpg';

export default function SEO({
  title,
  description,
  canonical,
  image,
  type = 'website',
  article,
  noindex = false,
  breadcrumbs,
}: SEOProps) {
  const fullTitle = title === SITE_NAME ? title : `${title} — ${SITE_NAME}`;
  const fullUrl = canonical ? `${BASE_URL}${canonical}` : BASE_URL;
  const fullImage = image
    ? image.startsWith('http') ? image : `${BASE_URL}${image}`
    : `${BASE_URL}${DEFAULT_IMAGE}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}
      <link rel="canonical" href={fullUrl} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={fullUrl} />
      <meta property="og:image" content={fullImage} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="ru_RU" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={fullImage} />

      {/* Article meta */}
      {article?.publishedTime && (
        <meta property="article:published_time" content={article.publishedTime} />
      )}
      {article?.section && (
        <meta property="article:section" content={article.section} />
      )}

      {/* BreadcrumbList JSON-LD */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": breadcrumbs.map((item, index) => ({
              "@type": "ListItem",
              "position": index + 1,
              "name": item.name,
              "item": item.url.startsWith('http') ? item.url : `${BASE_URL}${item.url}`,
            })),
          })}
        </script>
      )}
    </Helmet>
  );
}
