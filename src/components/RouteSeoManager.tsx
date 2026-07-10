import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { applications } from "@/data/applications";
import { articles } from "@/data/articles";
import { catalogFaqs, catalogModels } from "@/data/catalog";
import { dealers } from "@/data/models";
import { productFaqs } from "@/data/product-detail-content";
import { products } from "@/data/products";
import { getArticleHeroImage } from "@/lib/article-media";
import { resolveMediaUrl } from "@/lib/media";

const SITE_URL = "https://xn--80aa8ahaki9a.site";
const SITE_NAME = "РОСОМАХА";
const DEFAULT_IMAGE = "/media/company/rosomaha-deep-mud.jpg";
const COMPANY_EMAIL = "rosomaha-rus@mail.ru";
const PRIMARY_PHONE = "+7 922 071-11-74";
const OFFICE_PHONE = "+7 3452 564-164";
const FACTORY_ADDRESS = {
  streetAddress: "ул. Бурлаки, 29В",
  addressLocality: "п. Московский",
  addressRegion: "Тюменская область",
  postalCode: "625501",
  addressCountry: "RU",
};
const FACTORY_GEO = {
  latitude: 57.1063,
  longitude: 65.4417,
};

type OgType = "website" | "article" | "product";

type SeoPayload = {
  title: string;
  description: string;
  canonicalPath: string;
  image?: string;
  ogType?: OgType;
  robots?: string;
  schema: Record<string, unknown> | Array<Record<string, unknown>>;
};

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "") || "/";
}

function toAbsoluteUrl(value: string) {
  const resolvedValue = resolveMediaUrl(value);

  if (/^https?:\/\//i.test(resolvedValue)) {
    return resolvedValue;
  }

  return `${SITE_URL}${resolvedValue.startsWith("/") ? resolvedValue : `/${resolvedValue}`}`;
}

function inferImageType(imageUrl: string) {
  const lower = imageUrl.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function truncateDescription(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function upsertMetaByName(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);

  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }

  element.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }

  element.setAttribute("href", href);
}

function upsertJsonLd(id: string, payload: Record<string, unknown> | Array<Record<string, unknown>>) {
  let element = document.head.querySelector<HTMLScriptElement>(`script#${id}`);

  if (!element) {
    element = document.createElement("script");
    element.id = id;
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify(payload);
}

function buildWebPageSchema(payload: SeoPayload) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: payload.title,
    description: payload.description,
    url: toAbsoluteUrl(payload.canonicalPath),
    inLanguage: "ru-RU",
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    inLanguage: "ru-RU",
    publisher: {
      "@id": `${SITE_URL}/#organization`,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/catalog?search={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": ["Organization", "LocalBusiness"],
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    alternateName: "Росомаха",
    legalName: "ООО ТПК «РОСОМАХА»",
    description: "Тюменский производитель снегоболотоходов и вездеходов на шинах низкого давления с доставкой по России.",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/favicon.ico`,
    image: toAbsoluteUrl(DEFAULT_IMAGE),
    email: COMPANY_EMAIL,
    telephone: [PRIMARY_PHONE, OFFICE_PHONE],
    address: {
      "@type": "PostalAddress",
      ...FACTORY_ADDRESS,
    },
    geo: {
      "@type": "GeoCoordinates",
      ...FACTORY_GEO,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
    ],
    areaServed: [
      {
        "@type": "Country",
        name: "Россия",
      },
      {
        "@type": "AdministrativeArea",
        name: "Тюменская область",
      },
    ],
    knowsAbout: [
      "снегоболотоходы",
      "болотоходы",
      "вездеходы на шинах низкого давления",
      "плавающие прицепы",
      "вездеходы для охоты и рыбалки",
      "вездеходы для вахты и геологоразведки",
      "доставка техники по России",
    ],
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        telephone: PRIMARY_PHONE,
        availableLanguage: "ru",
        areaServed: "RU",
      },
      {
        "@type": "ContactPoint",
        contactType: "office",
        telephone: OFFICE_PHONE,
        availableLanguage: "ru",
        areaServed: "RU",
      },
    ],
    sameAs: [
      "https://t.me/rosomaha_site",
      "https://t.me/rosomahaclub",
      "https://vk.com/rosomaha_service",
      "https://www.youtube.com/@Rosomaha_Club",
      "https://rutube.ru/channel/54061535/",
    ],
  };
}

function buildDealerListSchema() {
  const dealerItems = dealers.map((dealer, index) => ({
    "@type": "ListItem",
    position: index + 1,
    item: {
      "@type": ["Organization", "LocalBusiness"],
      name: dealer.type === "factory" ? `${SITE_NAME} - производство` : `Дилер ${SITE_NAME} - ${dealer.city}`,
      address: {
        "@type": "PostalAddress",
        streetAddress: dealer.address,
        addressLocality: dealer.city,
        addressRegion: dealer.region,
        addressCountry: "RU",
      },
      telephone: [dealer.phone, dealer.phone2].filter(Boolean),
      email: dealer.email,
      url: dealer.website || `${SITE_URL}/dealers`,
      geo: {
        "@type": "GeoCoordinates",
        latitude: dealer.coordinates.lat,
        longitude: dealer.coordinates.lng,
      },
      openingHours: dealer.workHours,
    },
  }));

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Дилеры и представительства РОСОМАХА",
    itemListElement: dealerItems,
  };
}

function buildArticleSchema(
  payload: SeoPayload,
  article: { title: string; excerpt: string; date: string; content?: string; image?: string; coverImage?: string; heroImage?: string },
) {
  const image = getArticleHeroImage(article) || DEFAULT_IMAGE;

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    dateModified: article.date,
    mainEntityOfPage: toAbsoluteUrl(payload.canonicalPath),
    image: [toAbsoluteUrl(image)],
    author: {
      "@type": "Organization",
      name: SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/favicon.ico`,
      },
    },
  };
}

function buildProductSchema(
  payload: SeoPayload,
  product: { name: string; description: string; basePrice: number; gallery: string[]; available: boolean },
) {
  const image = product.gallery[0] || DEFAULT_IMAGE;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: payload.canonicalPath.replace("/catalog/", ""),
    image: [toAbsoluteUrl(image)],
    brand: {
      "@type": "Brand",
      name: SITE_NAME,
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "RUB",
      price: product.basePrice,
      availability: product.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
      url: toAbsoluteUrl(payload.canonicalPath),
      seller: {
        "@id": `${SITE_URL}/#organization`,
      },
    },
    category: "Снегоболотоход",
  };
}

function buildBreadcrumbSchema(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.path),
    })),
  };
}

function buildFaqSchema(faqs: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildCatalogSchema(payload: SeoPayload) {
  return [
    buildWebPageSchema(payload),
    buildBreadcrumbSchema([
      { name: "Главная", path: "/" },
      { name: "Каталог", path: "/catalog" },
    ]),
    buildFaqSchema(catalogFaqs),
    {
      "@context": "https://schema.org",
      "@type": "OfferCatalog",
      name: "Снегоболотоходы и вездеходы Росомаха",
      url: toAbsoluteUrl("/catalog"),
      itemListElement: catalogModels.slice(0, 12).map((model) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Product",
          name: model.name,
          image: toAbsoluteUrl(model.image),
          url: toAbsoluteUrl(`/catalog/${model.slug}`),
          brand: {
            "@type": "Brand",
            name: SITE_NAME,
          },
        },
        priceCurrency: "RUB",
        price: model.price,
        availability: model.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
        url: toAbsoluteUrl(`/catalog/${model.slug}`),
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Каталог снегоболотоходов Росомаха",
      itemListElement: catalogModels.slice(0, 12).map((model, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: toAbsoluteUrl(`/catalog/${model.slug}`),
        item: {
          "@type": "Product",
          name: model.name,
          image: toAbsoluteUrl(model.image),
          offers: {
            "@type": "Offer",
            priceCurrency: "RUB",
            price: model.price,
            availability: model.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
            url: toAbsoluteUrl(`/catalog/${model.slug}`),
          },
        },
      })),
    },
  ];
}

function getStaticSeo(pathname: string): SeoPayload | null {
  const staticRoutes: Record<string, Omit<SeoPayload, "schema">> = {
    "/": {
      title: "Снегоболотоходы «Росомаха» — каталог и калькулятор",
      description: "Снегоболотоходы «Росомаха»: модели, комплектации, статьи, контакты и доставка от производителя.",
      canonicalPath: "/",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/catalog": {
      title: "Каталог снегоболотоходов «Росомаха» | Модели и цены",
      description: "Каталог моделей «Росомаха»: снегоболотоходы, пикапы, шестиколесники и прицепы. Сравните комплектации и цены.",
      canonicalPath: "/catalog",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/options": {
      title: "Дополнительные опции для снегоболотоходов «Росомаха» | Лебёдки, тенты, кофры",
      description: "Каталог дополнительных опций для техники «Росомаха»: лебёдки, тенты, кофры, отопители, защита, освещение и оснащение под маршрут.",
      canonicalPath: "/options",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/company": {
      title: "О компании «Росомаха» | Производитель снегоболотоходов",
      description: "Российский производитель снегоболотоходов «Росомаха»: производство, подход к технике и опыт эксплуатации в тяжелых условиях.",
      canonicalPath: "/company",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/dealers": {
      title: "Дилеры «Росомаха» | Где купить снегоболотоход",
      description: "Официальные дилеры «Росомаха» в регионах России. Контакты, адреса и точки продаж снегоболотоходов.",
      canonicalPath: "/dealers",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/contacts": {
      title: "Контакты «Росомаха» | Связаться с производителем",
      description: "Контакты компании «Росомаха»: телефоны, адрес, форма связи и информация для заказа снегоболотоходов.",
      canonicalPath: "/contacts",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/delivery": {
      title: "Доставка снегоболотоходов «Росомаха» | Условия и регионы",
      description: "Условия доставки снегоболотоходов «Росомаха» по России: логистика, сроки и сопровождение заказа.",
      canonicalPath: "/delivery",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/order": {
      title: "Заказать снегоболотоход «Росомаха» | Заявка на подбор",
      description: "Оставьте заявку на подбор комплектации снегоболотохода «Росомаха». Поможем подобрать модель под ваши задачи.",
      canonicalPath: "/order",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/articles": {
      title: "Статьи о снегоболотоходах «Росомаха» | Эксплуатация и выбор",
      description: "Статьи о выборе, эксплуатации, обслуживании и реальном использовании снегоболотоходов «Росомаха».",
      canonicalPath: "/articles",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/media": {
      title: "Видео и обзоры техники «Росомаха» | Rosomaha Club, Telegram и RUTUBE",
      description: "Видеообзоры, тест-драйвы и полевые материалы о вездеходах «Росомаха»: YouTube Rosomaha Club, Telegram и RUTUBE.",
      canonicalPath: "/media",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/applications": {
      title: "Сферы применения снегоболотоходов «Росомаха»",
      description: "Решения «Росомаха» для вахты, рыбалки, охоты, туризма, спасработ и доставки грузов по бездорожью.",
      canonicalPath: "/applications",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/privacy": {
      title: "Политика конфиденциальности | «Росомаха»",
      description: "Общая политика конфиденциальности сайтов «Росомаха».",
      canonicalPath: "/politika-konfidencialnosti",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
    "/politika-konfidencialnosti": {
      title: "Политика конфиденциальности | «Росомаха»",
      description: "Общая политика конфиденциальности сайтов «Росомаха».",
      canonicalPath: "/politika-konfidencialnosti",
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
    },
  };

  const staticPayload = staticRoutes[pathname];

  if (!staticPayload) {
    return null;
  }

  if (pathname === "/catalog") {
    return {
      ...staticPayload,
      schema: buildCatalogSchema({
        ...staticPayload,
        schema: {},
      }),
    };
  }

  if (pathname === "/dealers") {
    return {
      ...staticPayload,
      schema: [
        buildWebPageSchema({
          ...staticPayload,
          schema: {},
        }),
        buildDealerListSchema(),
      ],
    };
  }

  return {
    ...staticPayload,
    schema: buildWebPageSchema({
      ...staticPayload,
      schema: {},
    }),
  };
}

function getDynamicSeo(pathname: string): SeoPayload | null {
  if (pathname.startsWith("/articles/")) {
    const slug = pathname.replace("/articles/", "");
    const article = articles.find((entry) => entry.slug === slug);

    if (!article) {
      return null;
    }

    const payload: SeoPayload = {
      title: `${article.title} | Статьи «Росомаха»`,
      description: truncateDescription(article.excerpt || article.title),
      canonicalPath: `/articles/${article.slug}`,
      image: getArticleHeroImage(article) || DEFAULT_IMAGE,
      ogType: "article",
      robots: "index,follow",
      schema: {},
    };

    payload.schema = [
      buildArticleSchema(payload, article),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Статьи", path: "/articles" },
        { name: article.title, path: `/articles/${article.slug}` },
      ]),
    ];
    return payload;
  }

  if (pathname.startsWith("/applications/")) {
    const slug = pathname.replace("/applications/", "");
    const application = applications.find((entry) => entry.slug === slug);

    if (!application) {
      return null;
    }

    const payload: SeoPayload = {
      title: application.metaTitle,
      description: truncateDescription(application.metaDescription),
      canonicalPath: `/applications/${application.slug}`,
      image: application.image || DEFAULT_IMAGE,
      ogType: "website",
      robots: "index,follow",
      schema: {},
    };

    payload.schema = [
      buildWebPageSchema(payload),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Сферы применения", path: "/applications" },
        { name: application.shortTitle || application.title, path: `/applications/${application.slug}` },
      ]),
      ...(application.faqs?.length ? [buildFaqSchema(application.faqs)] : []),
    ];
    return payload;
  }

  if (pathname.startsWith("/catalog/")) {
    const slug = pathname.replace("/catalog/", "");
    const product = products.find((entry) => entry.slug === slug);

    if (!product) {
      return null;
    }

    const payload: SeoPayload = {
      title: `${product.name} | Купить снегоболотоход «Росомаха»`,
      description: truncateDescription(product.description),
      canonicalPath: `/catalog/${product.slug}`,
      image: product.gallery[0] || DEFAULT_IMAGE,
      ogType: "product",
      robots: "index,follow",
      schema: {},
    };

    payload.schema = [
      buildProductSchema(payload, product),
      buildFaqSchema(productFaqs),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Каталог", path: "/catalog" },
        { name: product.name, path: `/catalog/${product.slug}` },
      ]),
    ];
    return payload;
  }

  return null;
}

function getFallbackSeo(pathname: string): SeoPayload {
  return {
    title: "Страница не найдена | «Росомаха»",
    description: "Запрошенная страница не найдена на сайте «Росомаха».",
    canonicalPath: pathname,
    image: DEFAULT_IMAGE,
    ogType: "website",
    robots: "noindex,follow",
    schema: buildWebPageSchema({
      title: "Страница не найдена | «Росомаха»",
      description: "Запрошенная страница не найдена на сайте «Росомаха».",
      canonicalPath: pathname,
      image: DEFAULT_IMAGE,
      ogType: "website",
      robots: "noindex,follow",
      schema: {},
    }),
  };
}

export default function RouteSeoManager() {
  const location = useLocation();

  useEffect(() => {
    const pathname = normalizePath(location.pathname);
    const payload = getDynamicSeo(pathname) || getStaticSeo(pathname) || getFallbackSeo(pathname);

    const canonicalUrl = toAbsoluteUrl(payload.canonicalPath);
    const imageUrl = toAbsoluteUrl(payload.image || DEFAULT_IMAGE);
    const description = truncateDescription(payload.description);
    const robots = payload.robots || "index,follow";
    const ogType = payload.ogType || "website";

    document.title = payload.title;
    document.documentElement.lang = "ru";

    upsertMetaByName("description", description);
    upsertMetaByName("robots", robots);
    upsertMetaByName("googlebot", robots);
    upsertMetaByName("bingbot", robots);
    upsertMetaByName("twitter:card", "summary_large_image");
    upsertMetaByName("twitter:title", payload.title);
    upsertMetaByName("twitter:description", description);
    upsertMetaByName("twitter:image", imageUrl);

    upsertMetaByProperty("og:type", ogType);
    upsertMetaByProperty("og:site_name", SITE_NAME);
    upsertMetaByProperty("og:locale", "ru_RU");
    upsertMetaByProperty("og:title", payload.title);
    upsertMetaByProperty("og:description", description);
    upsertMetaByProperty("og:url", canonicalUrl);
    upsertMetaByProperty("og:image", imageUrl);
    upsertMetaByProperty("og:image:width", "1200");
    upsertMetaByProperty("og:image:height", "630");
    upsertMetaByProperty("og:image:type", inferImageType(imageUrl));

    upsertCanonical(canonicalUrl);
    upsertJsonLd("website-json-ld", buildWebSiteSchema());
    upsertJsonLd("organization-json-ld", buildOrganizationSchema());
    upsertJsonLd("page-json-ld", payload.schema);
  }, [location.pathname]);

  return null;
}
