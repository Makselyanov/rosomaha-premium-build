import { products, type Product } from '@/data/products';
import { resolveMediaUrl } from '@/lib/media';

export type CatalogCategoryId = 'all' | Product['category'];

export interface CatalogCardModel {
  id: string;
  slug: string;
  name: string;
  category: Product['category'];
  categoryName: string;
  price: number;
  priceFormatted: string;
  available: boolean;
  badge?: Product['badge'];
  image: string;
  description: string;
  specs: {
    engine: string;
    axles: string;
  };
}

export interface CatalogCategory {
  id: CatalogCategoryId;
  name: string;
  summary: string;
}

export interface CatalogUseCase {
  id: string;
  title: string;
  description: string;
  href: string;
  label: string;
}

export interface CatalogCategoryShowcase {
  id: Product['category'];
  title: string;
  summary: string;
  buyerHint: string;
  modelSlugs: string[];
}

export interface CatalogFaq {
  question: string;
  answer: string;
}

const fallbackImage = '/media/company/rosomaha-deep-mud.jpg';

function toCatalogCardModel(product: Product): CatalogCardModel {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    categoryName: product.categoryName,
    price: product.basePrice,
    priceFormatted: product.priceFormatted,
    available: product.available,
    badge: product.badge,
    image: resolveMediaUrl(product.gallery[0] || product.thumbnails[0] || fallbackImage),
    description: product.description,
    specs: {
      engine: product.specs.engine || product.specs.engineVolume || 'Под задачу',
      axles: product.specs.axles || 'Под задачу',
    },
  };
}

const catalogOrder = [
  'pro-4x4-toyota',
  'eger-1',
  'standart-plus-suzuki',
  'standart-plus-uaz',
  'extrime-uaz',
  'extrime-toyota',
  'extrime-plus-toyota',
  'hunter-toyota',
  'pickup-uaz-timken',
  'pickup-uaz-18',
  'pickup-toyota',
  'sixwheel-toyota',
  'trailer',
] as const;

const productsById = new Map(products.map((product) => [product.id, product]));

export const catalogModels = catalogOrder
  .map((id) => productsById.get(id))
  .filter((product): product is Product => Boolean(product))
  .map(toCatalogCardModel);

export const featuredCatalogModels = catalogModels.slice(0, 12);

export const catalogCategories: CatalogCategory[] = [
  {
    id: 'all',
    name: 'Все модели',
    summary: 'Полная линейка снегоболотоходов, пикапов, шестиколёсников и прицепов для работы и экспедиций.',
  },
  {
    id: 'classic',
    name: 'Классические',
    summary: 'Универсальные снегоболотоходы под охоту, рыбалку, маршрутную работу и семейные выезды.',
  },
  {
    id: 'pickup',
    name: 'Пикапы',
    summary: 'Версии с грузовой платформой для снабжения, инструмента, топлива и экспедиционного снаряжения.',
  },
  {
    id: 'sixwheel',
    name: 'Шестиколёсники',
    summary: 'Максимальная тяга и запас проходимости для тяжёлых маршрутов и загрузки.',
  },
  {
    id: 'trailer',
    name: 'Прицепы',
    summary: 'Дополнение к технике для перевозки груза там, где обычный прицеп не доезжает.',
  },
];

export const catalogUseCases: CatalogUseCase[] = [
  {
    id: 'vakhta',
    title: 'Вахта и снабжение',
    description: 'Подбор конфигураций для удалённых объектов, бригад и маршрутов без дороги.',
    href: '/applications/vakhta-snabzhenie',
    label: 'Решения для вахты',
  },
  {
    id: 'okhota',
    title: 'Охота и рыбалка',
    description: 'Компоновки с автономностью, тёплой кабиной и запасом тяги под тяжёлое снаряжение.',
    href: '/applications/okhota',
    label: 'Под задачи охоты',
  },
  {
    id: 'gruz',
    title: 'Доставка грузов',
    description: 'Пикапы и шестиколёсники для топлива, инструмента, лагерного и сервисного оборудования.',
    href: '/applications/dostavka-gruzov',
    label: 'Решения для перевозки',
  },
  {
    id: 'turizm',
    title: 'Экспедиции и туризм',
    description: 'Маршруты для удалённых локаций, фото-туров, семейных выездов и зимнего отдыха.',
    href: '/applications/turizm',
    label: 'Маршруты для отдыха',
  },
];

export const catalogCategoryShowcase: CatalogCategoryShowcase[] = [
  {
    id: 'classic',
    title: 'Классические снегоболотоходы',
    summary: 'Базовый выбор для тех, кому нужен универсальный вездеход под охоту, рыбалку, экспедиции и повседневную работу вне дорог.',
    buyerHint: 'Если нужна одна машина под разные сценарии, начинать стоит именно с этого класса.',
    modelSlugs: ['rosomaha-standart-plus', 'rosomaha-extrime-plus', 'rosomaha-hunter'],
  },
  {
    id: 'pickup',
    title: 'Пикапы для снабжения',
    summary: 'Когда важно возить не только людей, но и генераторы, инструмент, ГСМ, лагерь или сервисное оборудование.',
    buyerHint: 'Подходят для хозяйственных задач, сервисных выездов и маршрутов с большой полезной нагрузкой.',
    modelSlugs: ['rosomaha-pickup-uaz-timken', 'rosomaha-pickup-toyota'],
  },
  {
    id: 'sixwheel',
    title: 'Шестиколёсники для тяжёлых условий',
    summary: 'Максимальный запас проходимости и устойчивости, когда маршрут длинный, загрузка серьёзная, а поверхность нестабильна.',
    buyerHint: 'Лучший вариант для тяжёлых участков, болот, глубокой колеи и дальних экспедиций.',
    modelSlugs: ['rosomaha-6x6'],
  },
  {
    id: 'trailer',
    title: 'Плавающий прицеп',
    summary: 'Дополняет технику там, где важно забрать больше груза и не потерять проходимость на заболоченных маршрутах.',
    buyerHint: 'Имеет смысл, если вы регулярно возите лагерь, добычу, топливо или комплект инструмента.',
    modelSlugs: ['rosomaha-trailer'],
  },
];

export const catalogFaqs: CatalogFaq[] = [
  {
    question: 'Как выбрать снегоболотоход под охоту, рыбалку и работу?',
    answer: 'Сначала определяют задачу: сколько людей и груза нужно везти, есть ли болота, глубокий снег, броды и нужна ли грузовая платформа. Для универсального сценария подойдут классические модели, для снабжения и сервиса удобнее пикапы, а для тяжёлых маршрутов и большой загрузки лучше смотреть шестиколёсник.',
  },
  {
    question: 'Какие модели подойдут для тяжёлых условий и дальних маршрутов?',
    answer: 'Если приоритет — запас проходимости, устойчивость под загрузкой и возможность уверенно идти по сложному рельефу, стоит смотреть Росомаху 6х6 и старшие версии Экстрим. Они рассчитаны на суровые условия, работу с грузом и длинные экспедиционные маршруты.',
  },
  {
    question: 'Можно ли подобрать комплектацию под конкретную задачу?',
    answer: 'Да. В линейке есть разные базы, мосты, двигатели и наборы опций, поэтому снегоболотоход подбирается под маршрут, тип груза, количество людей и сезон эксплуатации. Если задача нестандартная, лучше сразу идти в расчёт или консультацию, чтобы не переплачивать за лишнее и не недобрать по оснащению.',
  },
];
