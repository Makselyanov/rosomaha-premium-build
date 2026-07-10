import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const sourceDir = path.join(rootDir, "src", "data");
const baseUrl = "https://xn--80aa8ahaki9a.site";
const defaultImage = "/media/company/rosomaha-deep-mud.jpg";
const legacyMediaOriginPattern = /^https?:\/\/(?:www\.)?rosomaha-rus\.ru/i;
const catalogFaqs = [
  {
    question: "Как выбрать снегоболотоход под охоту, рыбалку и работу?",
    answer:
      "Сначала определяют задачу: сколько людей и груза нужно везти, есть ли болота, глубокий снег, броды и нужна ли грузовая платформа. Для универсального сценария подойдут классические модели, для снабжения и сервиса удобнее пикапы, а для тяжёлых маршрутов и большой загрузки лучше смотреть шестиколёсник.",
  },
  {
    question: "Какие модели подойдут для тяжёлых условий и дальних маршрутов?",
    answer:
      "Если приоритет — запас проходимости, устойчивость под загрузкой и возможность уверенно идти по сложному рельефу, стоит смотреть Росомаху 6х6 и старшие версии Экстрим. Они рассчитаны на суровые условия, работу с грузом и длинные экспедиционные маршруты.",
  },
  {
    question: "Можно ли подобрать комплектацию под конкретную задачу?",
    answer:
      "Да. В линейке есть разные базы, мосты, двигатели и наборы опций, поэтому снегоболотоход подбирается под маршрут, тип груза, количество людей и сезон эксплуатации. Если задача нестандартная, лучше сразу идти в расчёт или консультацию, чтобы не переплачивать за лишнее и не недобрать по оснащению.",
  },
];
const productFaqs = [
  {
    question: "Какие документы я получу при покупке снегоболотохода?",
    answer:
      "При покупке снегоболотохода «Росомаха» вы получаете договор купли-продажи, ЭПСМ, сертификат соответствия, акт приема-передачи и руководство по эксплуатации.",
  },
  {
    question: "Какая схема работы по договору?",
    answer:
      "Вы оставляете заявку, мы согласовываем комплектацию и сроки, после чего отправляем договор и счет. Для техники под сборку обычно требуется предоплата 50%, для техники в наличии — 100%. После готовности подписываются документы, и вы забираете технику лично, через доверенное лицо или отправкой транспортной компанией.",
  },
  {
    question: "Какие узлы и агрегаты устанавливаются на «Росомаху»?",
    answer:
      "В зависимости от модели используются тщательно проверенные мосты Suzuki Jimny, Toyota Land Cruiser или УАЗ, а также силовые агрегаты Toyota. Перед установкой узлы проходят диагностику и дефектовку.",
  },
];

function normalizePath(routePath) {
  if (!routePath || routePath === "/") {
    return "/";
  }

  return routePath.replace(/\/+$/, "");
}

function resolveMediaUrl(value) {
  if (!value) {
    return "";
  }

  const normalized = String(value).trim().replace(legacyMediaOriginPattern, "");

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("/upload/")) {
    return normalized;
  }

  if (normalized.startsWith("upload/")) {
    return `/${normalized}`;
  }

  return normalized;
}

function extractMarkdownImageUrls(content = "") {
  return [...String(content).matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
}

function getArticleHeroImage(article) {
  return article.heroImage || article.coverImage || extractMarkdownImageUrls(article.content)[0] || article.image || "";
}

function toAbsoluteUrl(value) {
  const resolvedValue = resolveMediaUrl(value);

  if (/^https?:\/\//i.test(resolvedValue)) {
    return resolvedValue;
  }

  return `${baseUrl}${resolvedValue.startsWith("/") ? resolvedValue : `/${resolvedValue}`}`;
}

function inferImageType(imageUrl) {
  const lower = imageUrl.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

function truncateDescription(value, maxLength = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function buildWebPageSchema(meta) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: meta.title,
    description: meta.description,
    url: meta.canonical,
    inLanguage: "ru-RU",
    isPartOf: {
      "@type": "WebSite",
      name: "РОСОМАХА",
      url: baseUrl,
    },
  };
}

function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}/#website`,
    name: "РОСОМАХА",
    url: `${baseUrl}/`,
    inLanguage: "ru-RU",
    publisher: {
      "@id": `${baseUrl}/#organization`,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl}/catalog?search={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

function buildArticleSchema(meta, article) {
  const image = getArticleHeroImage(article) || defaultImage;

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.title,
    description: article.excerpt,
    datePublished: article.date,
    dateModified: article.date,
    image: [toAbsoluteUrl(image)],
    mainEntityOfPage: meta.canonical,
    author: {
      "@type": "Organization",
      name: "РОСОМАХА",
    },
    publisher: {
      "@type": "Organization",
      name: "РОСОМАХА",
      logo: {
        "@type": "ImageObject",
        url: `${baseUrl}/favicon.ico`,
      },
    },
  };
}

function buildProductSchema(meta, model) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: model.name,
    description: model.description,
    sku: model.slug,
    image: [toAbsoluteUrl(model.image || defaultImage)],
    brand: {
      "@type": "Brand",
      name: "РОСОМАХА",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "RUB",
      price: model.basePrice,
      availability: model.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
      url: meta.canonical,
      seller: {
        "@id": `${baseUrl}/#organization`,
      },
    },
    category: "Снегоболотоход",
  };
}

function buildBreadcrumbSchema(items) {
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

function buildFaqSchema(faqs) {
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

function buildCatalogSchema(meta, items) {
  return [
    buildWebPageSchema(meta),
    buildBreadcrumbSchema([
      { name: "Главная", path: "/" },
      { name: "Каталог", path: "/catalog" },
    ]),
    buildFaqSchema(catalogFaqs),
    {
      "@context": "https://schema.org",
      "@type": "OfferCatalog",
      name: "Снегоболотоходы и вездеходы Росомаха",
      url: `${baseUrl}/catalog`,
      itemListElement: items.slice(0, 12).map((item) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Product",
          name: item.name,
          image: [toAbsoluteUrl(item.image || defaultImage)],
          url: toAbsoluteUrl(`/catalog/${item.slug}`),
          brand: {
            "@type": "Brand",
            name: "РОСОМАХА",
          },
        },
        priceCurrency: "RUB",
        price: item.basePrice,
        availability: item.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
        url: toAbsoluteUrl(`/catalog/${item.slug}`),
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Каталог снегоболотоходов Росомаха",
      itemListElement: items.slice(0, 12).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: toAbsoluteUrl(`/catalog/${item.slug}`),
        item: {
          "@type": "Product",
          name: item.name,
          image: [toAbsoluteUrl(item.image || defaultImage)],
          offers: {
            "@type": "Offer",
            priceCurrency: "RUB",
            price: item.basePrice,
            availability: item.available ? "https://schema.org/InStock" : "https://schema.org/PreOrder",
            url: toAbsoluteUrl(`/catalog/${item.slug}`),
          },
        },
      })),
    },
  ];
}

function buildDealerListSchema(dealers, listName = "Дилеры и представительства РОСОМАХА") {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    itemListElement: dealers.map((dealer, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": ["Organization", "LocalBusiness"],
        name: dealer.type === "factory" ? "РОСОМАХА - производство" : `Дилер РОСОМАХА - ${dealer.city}`,
        address: {
          "@type": "PostalAddress",
          streetAddress: dealer.address,
          addressLocality: dealer.city,
          addressRegion: dealer.region,
          addressCountry: "RU",
        },
        telephone: [dealer.phone, dealer.phone2].filter(Boolean),
        email: dealer.email,
        url: dealer.website || `${baseUrl}${dealer.region === "Тюменская область" ? "/dealers/tyumen" : "/dealers"}`,
        geo: dealer.coordinates
          ? {
              "@type": "GeoCoordinates",
              latitude: dealer.coordinates.lat,
              longitude: dealer.coordinates.lng,
            }
          : undefined,
        openingHours: dealer.workHours,
      },
    })),
  };
}

function parseApplications() {
  const source = readText(path.join(sourceDir, "applications.ts"));
  const matches = [
    ...source.matchAll(/slug:\s*'([^']+)'.*?image:\s*'([^']+)'.*?metaTitle:\s*'([^']+)'.*?metaDescription:\s*'([^']+)'/gs),
  ];

  return matches.map((match) => ({
    slug: match[1],
    image: match[2],
    title: match[3],
    description: match[4],
    }));
}

function parseDealers() {
  const source = readText(path.join(sourceDir, "models.ts"));
  const dealersArray = extractArrayBody(source, "export const dealers: Dealer[] = [");
  const dealerBlocks = extractObjectBlocks(dealersArray);

  return dealerBlocks
    .map((block) => {
      const readString = (field) => block.match(new RegExp(`${field}:\\s*'([^']+)'`))?.[1];
      const lat = block.match(/lat:\s*([0-9.]+)/)?.[1];
      const lng = block.match(/lng:\s*([0-9.]+)/)?.[1];
      const city = readString("city");
      const region = readString("region");
      const address = readString("address");

      if (!city || !region || !address) {
        return null;
      }

      return {
        type: readString("type"),
        region,
        city,
        address,
        phone: readString("phone"),
        phone2: readString("phone2"),
        email: readString("email"),
        website: readString("website"),
        workHours: readString("workHours"),
        coordinates: lat && lng ? { lat: Number.parseFloat(lat), lng: Number.parseFloat(lng) } : undefined,
      };
    })
    .filter(Boolean);
}

function extractArrayBody(source, marker) {
  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    return "";
  }

  const assignmentIndex = source.indexOf("=", markerIndex);
  const arrayStart = source.indexOf("[", assignmentIndex);

  if (arrayStart === -1) {
    return "";
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(arrayStart + 1, index);
      }
    }
  }

  return "";
}

function extractObjectBlocks(source) {
  const blocks = [];
  let depth = 0;
  let startIndex = -1;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0 && startIndex !== -1) {
        blocks.push(source.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return blocks;
}

function findDistAssetPath(fileName) {
  const assetsDir = path.join(distDir, "assets");

  if (!fs.existsSync(assetsDir)) {
    return null;
  }

  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const assetName = fs
    .readdirSync(assetsDir)
    .find((entry) => entry === fileName || (entry.startsWith(`${baseName}-`) && path.extname(entry) === extension));

  return assetName ? `/assets/${assetName}` : null;
}

function parseProductAssetImports(source) {
  return new Map(
    [...source.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+'@\/assets\/([^']+)'/g)]
      .map((match) => [match[1], findDistAssetPath(match[2])])
      .filter(([, assetPath]) => Boolean(assetPath)),
  );
}

function resolveProductImage(rawToken, assetImports) {
  if (!rawToken) {
    return null;
  }

  if (rawToken.startsWith("'")) {
    return rawToken.slice(1, -1);
  }

  return assetImports.get(rawToken) || null;
}

function parseProducts() {
  const source = readText(path.join(sourceDir, "products.ts"));
  const assetImports = parseProductAssetImports(source);
  const productsArray = extractArrayBody(source, "export const products: Product[] = [");
  const productBlocks = extractObjectBlocks(productsArray);

  return productBlocks
    .map((block) => {
      const slugMatch = block.match(/slug:\s*'([^']+)'/);
      const nameMatch = block.match(/name:\s*'([^']+)'/);
      const descriptionMatch = block.match(/description:\s*'([^']+)'/);
      const basePriceMatch = block.match(/basePrice:\s*(\d+)/);
      const availableMatch = block.match(/available:\s*(true|false)/);
      const galleryMatch = block.match(/gallery:\s*\[([\s\S]*?)\],\s*thumbnails:/);

      if (!slugMatch || !nameMatch || !descriptionMatch) {
        return null;
      }

      const galleryTokens = galleryMatch
        ? [...galleryMatch[1].matchAll(/'[^']+'|[A-Za-z_][A-Za-z0-9_]*/g)].map((match) => match[0])
        : [];

      const image = galleryTokens
        .map((token) => resolveProductImage(token, assetImports))
        .find(Boolean);

      return {
        slug: slugMatch[1],
        name: nameMatch[1],
        description: descriptionMatch[1],
        basePrice: basePriceMatch ? Number.parseInt(basePriceMatch[1], 10) : 0,
        available: availableMatch ? availableMatch[1] === "true" : true,
        image: image || defaultImage,
      };
    })
    .filter(Boolean);
}

function replaceAll(template, replacements) {
  let result = template;

  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }

  return result;
}

function writeRoute(routePath, html) {
  if (routePath === "/") {
    fs.writeFileSync(path.join(distDir, "index.html"), html, "utf8");
    return;
  }

  const routeDir = path.join(distDir, routePath.replace(/^\//, ""));
  fs.mkdirSync(routeDir, { recursive: true });
  fs.writeFileSync(path.join(routeDir, "index.html"), html, "utf8");
}

const templatePath = path.join(distDir, "index.html");
const template = readText(templatePath);
const articles = readJson(path.join(rootDir, "public", "api", "articles.json"));
const applications = parseApplications();
const dealers = parseDealers();
const products = parseProducts();

const routes = [
  {
    path: "/",
    title: "Снегоболотоходы «Росомаха» — каталог и калькулятор",
    description: "Снегоболотоходы «Росомаха»: модели, комплектации, статьи, контакты и доставка от производителя.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: buildWebPageSchema({
      title: "Снегоболотоходы «Росомаха» — каталог и калькулятор",
      description: "Снегоболотоходы «Росомаха»: модели, комплектации, статьи, контакты и доставка от производителя.",
      canonical: `${baseUrl}/`,
    }),
  },
  {
    path: "/catalog",
    title: "Каталог снегоболотоходов «Росомаха» | Модели и цены",
    description: "Каталог моделей «Росомаха»: снегоболотоходы, пикапы, шестиколесники и прицепы. Сравните комплектации и цены.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: buildCatalogSchema(
      {
        title: "Каталог снегоболотоходов «Росомаха» | Модели и цены",
        description:
          "Каталог моделей «Росомаха»: снегоболотоходы, пикапы, шестиколёсники и прицепы. Сравните комплектации и цены.",
        canonical: `${baseUrl}/catalog`,
      },
      products,
    ),
  },
  {
    path: "/options",
    title: "Дополнительные опции для снегоболотоходов «Росомаха» | Лебёдки, тенты, кофры",
    description: "Каталог дополнительных опций для техники «Росомаха»: лебёдки, тенты, кофры, отопители, защита, освещение и оснащение под маршрут.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: buildWebPageSchema({
      title: "Дополнительные опции для снегоболотоходов «Росомаха» | Лебёдки, тенты, кофры",
      description: "Каталог дополнительных опций для техники «Росомаха»: лебёдки, тенты, кофры, отопители, защита, освещение и оснащение под маршрут.",
      canonical: `${baseUrl}/options`,
    }),
  },
  {
    path: "/articles",
    title: "Статьи о снегоболотоходах «Росомаха» | Эксплуатация и выбор",
    description: "Статьи о выборе, эксплуатации, обслуживании и реальном использовании снегоболотоходов «Росомаха».",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    canonicalPath: "/articles",
  },
  {
    path: "/media",
    title: "Видео и обзоры техники «Росомаха» | Rosomaha Club, Telegram и RUTUBE",
    description: "Видеообзоры, тест-драйвы и полевые материалы о вездеходах «Росомаха»: YouTube Rosomaha Club, Telegram и RUTUBE.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    canonicalPath: "/media",
  },
  {
    path: "/applications",
    title: "Сферы применения снегоболотоходов «Росомаха»",
    description: "Решения «Росомаха» для вахты, рыбалки, охоты, туризма, спасработ и доставки грузов по бездорожью.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    canonicalPath: "/applications",
  },
  {
    path: "/company",
    title: "О компании «Росомаха» | Производитель снегоболотоходов",
    description: "Российский производитель снегоболотоходов «Росомаха»: производство, подход к технике и опыт эксплуатации в тяжелых условиях.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
  },
  {
    path: "/dealers",
    title: "Дилеры «Росомаха» | Где купить снегоболотоход",
    description: "Официальные дилеры «Росомаха» в регионах России. Контакты, адреса и точки продаж снегоболотоходов.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: [
      buildWebPageSchema({
        title: "Дилеры «Росомаха» | Где купить снегоболотоход",
        description: "Официальные дилеры «Росомаха» в регионах России. Контакты, адреса и точки продаж снегоболотоходов.",
        canonical: `${baseUrl}/dealers`,
      }),
      buildDealerListSchema(dealers),
    ],
  },
  {
    path: "/dealers/tyumen",
    title: "Снегоболотоходы «Росомаха» в Тюмени | Завод и партнёр",
    description: "Где купить снегоболотоход «Росомаха» в Тюмени: производство в посёлке Московский, партнёр в городе, телефоны, адреса и заявка на подбор.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: [
      buildWebPageSchema({
        title: "Снегоболотоходы «Росомаха» в Тюмени | Завод и партнёр",
        description: "Где купить снегоболотоход «Росомаха» в Тюмени: производство в посёлке Московский, партнёр в городе, телефоны, адреса и заявка на подбор.",
        canonical: `${baseUrl}/dealers/tyumen`,
      }),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Дилеры", path: "/dealers" },
        { name: "Тюмень", path: "/dealers/tyumen" },
      ]),
      buildDealerListSchema(
        dealers.filter((dealer) => dealer.region === "Тюменская область"),
        "Производство и партнёры РОСОМАХА в Тюменской области",
      ),
    ],
  },
  {
    path: "/contacts",
    title: "Контакты «Росомаха» | Связаться с производителем",
    description: "Контакты компании «Росомаха»: телефоны, адрес, форма связи и информация для заказа снегоболотоходов.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
  },
  {
    path: "/delivery",
    title: "Доставка снегоболотоходов «Росомаха» | Условия и регионы",
    description: "Условия доставки снегоболотоходов «Росомаха» по России: логистика, сроки и сопровождение заказа.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
  },
  {
    path: "/order",
    title: "Заказать снегоболотоход «Росомаха» | Заявка на подбор",
    description: "Оставьте заявку на подбор комплектации снегоболотохода «Росомаха». Поможем подобрать модель под ваши задачи.",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
  },
  {
    path: "/privacy",
    title: "Политика конфиденциальности | «Росомаха»",
    description: "Общая политика конфиденциальности сайтов «Росомаха».",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    canonicalPath: "/politika-konfidencialnosti",
  },
  {
    path: "/politika-konfidencialnosti",
    title: "Политика конфиденциальности | «Росомаха»",
    description: "Общая политика конфиденциальности сайтов «Росомаха».",
    image: defaultImage,
    ogType: "website",
    robots: "index,follow",
    canonicalPath: "/politika-konfidencialnosti",
  },
];

for (const article of articles) {
  const description = truncateDescription(article.excerpt || article.title);
  const pathName = `/articles/${article.slug}`;
  const canonical = `${baseUrl}${pathName}`;

  routes.push({
    path: pathName,
    title: `${article.title} | Статьи «Росомаха»`,
    description,
    image: getArticleHeroImage(article) || defaultImage,
    ogType: "article",
    robots: "index,follow",
    schema: [
      buildArticleSchema(
      {
        canonical,
        title: `${article.title} | Статьи «Росомаха»`,
        description,
      },
      article,
      ),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Статьи", path: "/articles" },
        { name: article.title, path: pathName },
      ]),
    ],
  });
}

for (const application of applications) {
  routes.push({
    path: `/applications/${application.slug}`,
    title: application.title,
    description: truncateDescription(application.description),
    image: application.image || defaultImage,
    ogType: "website",
    robots: "index,follow",
    schema: [
      buildWebPageSchema({
        title: application.title,
        description: truncateDescription(application.description),
        canonical: `${baseUrl}/applications/${application.slug}`,
      }),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Сферы применения", path: "/applications" },
        { name: application.title, path: `/applications/${application.slug}` },
      ]),
    ],
  });
}

for (const product of products) {
  const pathName = `/catalog/${product.slug}`;
  const title = `${product.name} | Купить снегоболотоход «Росомаха»`;
  const description = truncateDescription(product.description || `Модель ${product.name} из каталога «Росомаха».`);

  routes.push({
    path: pathName,
    title,
    description,
    image: product.image || defaultImage,
    ogType: "product",
    robots: "index,follow",
    schema: [
      buildProductSchema(
      {
        canonical: `${baseUrl}${pathName}`,
        title,
        description,
      },
      product,
      ),
      buildFaqSchema(productFaqs),
      buildBreadcrumbSchema([
        { name: "Главная", path: "/" },
        { name: "Каталог", path: "/catalog" },
        { name: product.name, path: pathName },
      ]),
    ],
  });
}

for (const route of routes) {
  const routePath = normalizePath(route.path);
  const canonicalPath = route.canonicalPath || routePath;
  const canonical = `${baseUrl}${canonicalPath === "/" ? "/" : canonicalPath}`;
  const image = toAbsoluteUrl(route.image || defaultImage);
  const description = truncateDescription(route.description);
  const routeSchema = route.schema || buildWebPageSchema({ title: route.title, description, canonical });
  const schema = Array.isArray(routeSchema)
    ? [buildWebSiteSchema(), ...routeSchema]
    : [buildWebSiteSchema(), routeSchema];

  const html = replaceAll(template, {
    "__SEO_TITLE__": route.title,
    "__SEO_DESCRIPTION__": description,
    "__SEO_ROBOTS__": route.robots || "index,follow",
    "__SEO_CANONICAL__": canonical,
    "__SEO_OG_TYPE__": route.ogType || "website",
    "__SEO_OG_TITLE__": route.title,
    "__SEO_OG_DESCRIPTION__": description,
    "__SEO_OG_URL__": canonical,
    "__SEO_OG_IMAGE__": image,
    "__SEO_OG_IMAGE_TYPE__": inferImageType(image),
    "__SEO_TWITTER_TITLE__": route.title,
    "__SEO_TWITTER_DESCRIPTION__": description,
    "__SEO_TWITTER_IMAGE__": image,
    "__SEO_JSON_LD__": JSON.stringify(schema),
  });

  writeRoute(routePath, html);
}
