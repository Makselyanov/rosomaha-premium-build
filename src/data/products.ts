// Расширенная модель данных товаров с реальными URL изображений с rosomaha-rus.ru
// Локальные изображения для Егерь-1
import eger1Ral6003 from '@/assets/eger1-ral6003.jpg';
import eger1Ral7006 from '@/assets/eger1-ral7006.png';
import eger1Ral7022 from '@/assets/eger1-ral7022.png';
import eger1Ral8011 from '@/assets/eger1-ral8011.png';
import eger1Ral9010 from '@/assets/eger1-ral9010.png';

export interface ProductVariant {
  id: string;
  name: string;
  slug: string;
  price: number;
  priceFormatted: string;
}

export interface ProductColor {
  id: string;
  name: string;
  ral: string;
  hex: string;
  image?: string;
}

export interface ProductOption {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image: string;
  specs?: Record<string, string>;
}

export interface ProductSpecs {
  length?: string;
  width?: string;
  height?: string;
  wheelDiameter?: string;
  clearance?: string;
  weight?: string;
  speed?: string;
  engine?: string;
  engineVolume?: string;
  power?: string;
  axles?: string;
  configuration?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  category: 'classic' | 'pickup' | 'trailer' | 'sixwheel';
  categoryName: string;
  basePrice: number;
  priceFormatted: string;
  available: boolean;
  badge?: 'new' | 'hit' | 'recommended';
  gallery: string[];
  thumbnails: string[];
  variants: ProductVariant[];
  colors: ProductColor[];
  options: ProductOption[];
  specs: ProductSpecs;
  baseEquipment: string[];
  description: string;
}

// Общие цвета для всех моделей с изображениями по цветам (где доступны)
export const productColors: ProductColor[] = [
  { id: 'ral9010', name: 'Белый', ral: 'RAL 9010', hex: '#FFFFFF', image: 'https://rosomaha-rus.ru/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png' },
  { id: 'ral1002', name: 'Песочно-жёлтый', ral: 'RAL 1002', hex: '#D2AA6D', image: 'https://rosomaha-rus.ru/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg' },
  { id: 'ral2000', name: 'Жёлто-оранжевый', ral: 'RAL 2000', hex: '#ED760E', image: 'https://rosomaha-rus.ru/upload/iblock/f23/fsjwurbhdxokiwtt4e2hraykou0lge5y.png' },
  { id: 'ral3020', name: 'Транспортный красный', ral: 'RAL 3020', hex: '#CC0605', image: 'https://rosomaha-rus.ru/upload/iblock/7ce/vwc9ic3vmki2q8clnq7a5pysc521wdwq.jpg' },
  { id: 'ral5013', name: 'Кобальтово-синий', ral: 'RAL 5013', hex: '#1E3A5F', image: 'https://rosomaha-rus.ru/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png' },
  { id: 'ral5005', name: 'Сигнальный синий', ral: 'RAL 5005', hex: '#005387', image: 'https://rosomaha-rus.ru/upload/iblock/789/z7wy86u7zyxjearnfvy5kocknb8bmca4.jpg' },
  { id: 'ral7022', name: 'Серая Умбра', ral: 'RAL 7022', hex: '#4C4A44', image: 'https://rosomaha-rus.ru/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png' },
  { id: 'ral7006', name: 'Бежево-серый', ral: 'RAL 7006', hex: '#756F61', image: 'https://rosomaha-rus.ru/upload/iblock/234/f4dow1nnjv0d03zowcy979eqv7gjcp3i.png' },
  { id: 'ral6003', name: 'Оливково-зеленый', ral: 'RAL 6003', hex: '#4C5D3D', image: 'https://rosomaha-rus.ru/upload/iblock/706/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg' },
  { id: 'ral7013', name: 'Коричнево-серый', ral: 'RAL 7013', hex: '#575044', image: 'https://rosomaha-rus.ru/upload/iblock/190/1blxzkyg24rzxojpycxgiq6xanlste1p.png' },
  { id: 'ral8011', name: 'Орехово-коричневый', ral: 'RAL 8011', hex: '#5A3D30', image: 'https://rosomaha-rus.ru/upload/iblock/70a/arvm500pi0v2vn6b6cokpewo1tdvxezg.jpg' },
  { id: 'ral9011', name: 'Графитно-чёрный', ral: 'RAL 9011', hex: '#27292B', image: 'https://rosomaha-rus.ru/upload/iblock/120/z5q84tbm8djjahtkvda0r4bhba54lk80.png' },
];

// Для Егерь-1 используем локально скачанные изображения.
const eger1Colors: ProductColor[] = [
  { id: 'ral6003', name: 'Оливково-зеленый', ral: 'RAL 6003', hex: '#4A5240', image: eger1Ral6003 },
  { id: 'ral7006', name: 'Бежево-серый', ral: 'RAL 7006', hex: '#756F61', image: eger1Ral7006 },
  { id: 'ral7013', name: 'Коричнево-серый', ral: 'RAL 7013', hex: '#575044', image: eger1Ral6003 },
  { id: 'ral7022', name: 'Серая умбра', ral: 'RAL 7022', hex: '#4B4D46', image: eger1Ral7022 },
  { id: 'ral8011', name: 'Орехово-коричневый', ral: 'RAL 8011', hex: '#5A3826', image: eger1Ral8011 },
  { id: 'ral9010', name: 'Белый', ral: 'RAL 9010', hex: '#FFFFFF', image: eger1Ral9010 },
  { id: 'ral9011', name: 'Графитно-чёрный', ral: 'RAL 9011', hex: '#27292B', image: eger1Ral6003 },
  { id: 'ral1002', name: 'Песочно-жёлтый', ral: 'RAL 1002', hex: '#D2AA6D', image: eger1Ral6003 },
  { id: 'ral2000', name: 'Жёлто-оранжевый', ral: 'RAL 2000', hex: '#DD7907', image: eger1Ral6003 },
  { id: 'ral3020', name: 'Красный насыщенный', ral: 'RAL 3020', hex: '#C1121C', image: eger1Ral6003 },
  { id: 'ral5013', name: 'Кобальтово-синий', ral: 'RAL 5013', hex: '#232C3F', image: eger1Ral6003 },
  { id: 'ral5005', name: 'Сигнальный синий', ral: 'RAL 5005', hex: '#005387', image: eger1Ral6003 },
];

// Варианты комплектаций (одинаковые для классических моделей)
export const classicVariants: ProductVariant[] = [
  { id: 'eger-1', name: 'Егерь-1 (Волга)', slug: 'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-', price: 850000, priceFormatted: 'от 850 000 ₽' },
  { id: 'standart-plus-suzuki', name: 'Стандарт ПЛЮС (Suzuki)', slug: 'standart-plus-1-5-litra', price: 1300000, priceFormatted: 'от 1 300 000 ₽' },
  { id: 'extrime-uaz', name: 'Экстрим (УАЗ)', slug: 'extrime-s-1-5l-dvs-1nz-fe', price: 1800000, priceFormatted: 'от 1 800 000 ₽' },
  { id: 'extrime-toyota', name: 'Экстрим (Toyota)', slug: 'extrime-1-5-litra-mosty-toyota', price: 2050000, priceFormatted: 'от 2 050 000 ₽' },
  { id: 'extrime-plus-toyota', name: 'Экстрим ПЛЮС (Toyota)', slug: 'extrime-plus-s-1-8l-dvs-1zz-fe', price: 2150000, priceFormatted: 'от 2 150 000 ₽' },
  { id: 'hunter-toyota', name: 'Хантер (Toyota)', slug: 'hunter-s-1-5l-dvs-1nz-fe', price: 2180000, priceFormatted: 'от 2 180 000 ₽' },
  { id: 'pickup-uaz-timken', name: 'Пикап (УАЗ Тимкен)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken', price: 1700000, priceFormatted: 'от 1 700 000 ₽' },
  { id: 'standart-plus-uaz', name: 'Стандарт ПЛЮС (УАЗ)', slug: 'rosomakha-standart-plyus-uaz-timken', price: 1400000, priceFormatted: 'от 1 400 000 ₽' },
  { id: 'pickup-toyota', name: 'Пикап (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 2450000, priceFormatted: 'от 2 450 000 ₽' },
  { id: 'pickup-uaz', name: 'Пикап (УАЗ)', slug: 'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz', price: 2250000, priceFormatted: 'от 2 250 000 ₽' },
  { id: 'sixwheel-toyota', name: 'Шестиколёсник (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 3100000, priceFormatted: 'от 3 100 000 ₽' },
];

// Дополнительные опции (общие для всех моделей)
export const productOptions: ProductOption[] = [
  {
    id: 'trailer',
    name: 'Прицеп к квадроциклу плавающий',
    price: 200000,
    priceFormatted: '200 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    specs: { 'Длина, мм': '3100', 'Ширина, мм': '2000', 'Высота, мм': '1200', 'Диаметр колес, мм': '1100', 'Масса, кг': '250' },
  },
  {
    id: 'tires-avtoros',
    name: 'Шины низкого давления AVTOROS MX-PLUS 2 слоя корда (1130 х 530)',
    price: 150000,
    priceFormatted: '150 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'kofr-side-improved',
    name: 'Боковые кофры, улучшенные 2 шт.',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/c50/fdwrdsctw6aswo2qi74zw1jias3yn937.jpg',
  },
  {
    id: 'kofr-side-standard',
    name: 'Боковые кофры, стандартные 2 шт',
    price: 10000,
    priceFormatted: '10 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/12c/80nurbxxkbqyyb7380hfr0aj7bas1jn1.jpg',
  },
  {
    id: 'kofr-front',
    name: 'Передний кофр, тканевый',
    price: 25000,
    priceFormatted: '25 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/a43/hofkcng7ypdnp1tqedud338ms38w6uyp.jpg',
  },
  {
    id: 'kofr-rear-fabric',
    name: 'Задний кофр, тканевый (каркасный)',
    price: 35000,
    priceFormatted: '35 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/197/nciwzbl48bhvyrsg7n5sk4bibq5kot2i.jpg',
  },
  {
    id: 'kofr-rear-plastic',
    name: 'Задний кофр, пластиковый',
    price: 45000,
    priceFormatted: '45 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/910/e3qm3pj32vuxuvh2f25pbkgg0y016yxx.jpg',
  },
  {
    id: 'kofr-rear-triple',
    name: 'Задний кофр, пластиковый трехсекционный СТАНДАРТ',
    price: 60000,
    priceFormatted: '60 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/5e6/x1t4q7uc0g75g3n4a1olnckzge8uiy0k.jpg',
  },
  {
    id: 'frame-tent',
    name: 'Каркас металлический с тентом',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/b26/kijowx7q1w6zpsx2m1z5f906j40hqeme.jpeg',
  },
  {
    id: 'winch-stationary',
    name: 'Электрическая лебедка стационарная',
    price: 55000,
    priceFormatted: '55 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/9fe/bayhb19qeymuxd0hmxti9mhla61b4udw.jpg',
    specs: { 'Тяговое усилие (lbs)': '5000' },
  },
  {
    id: 'winch-removable',
    name: 'Электрическая лебедка съемная',
    price: 70000,
    priceFormatted: '70 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/21e/cpk6xegjud7wodvxpbsy5tbj8wpe4y4c.jpg',
    specs: { 'Тяговое усилие (lbs)': '5000' },
  },
  {
    id: 'light-bar',
    name: 'Балка дополнительного света Светодиодная',
    price: 8000,
    priceFormatted: '8 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/b92/wa1abwd0kc4f1gqfp4aj4fnzz1ubbaep.jpg',
  },
  {
    id: 'canister-double',
    name: 'Две канистры для топлива',
    price: 12000,
    priceFormatted: '12 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/8ac/cj20b0jb0fw3rgay1cvbwyc4xgxzkyds.jpg',
  },
  {
    id: 'canister-single',
    name: 'Канистра для топлива',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/a5d/dd14qzhphippeaw3mg8jj2a203y38d6i.jpg',
  },
  {
    id: 'seat-heat-driver',
    name: 'Подогрев сидения (водитель)',
    price: 5000,
    priceFormatted: '5 000 ₽',
    image: '',
  },
  {
    id: 'seat-heat-both',
    name: 'Подогрев сидения (водитель+пассажир)',
    price: 10000,
    priceFormatted: '10 000 ₽',
    image: '',
  },
  {
    id: 'radiator-mount',
    name: 'Вынос радиатора "Росомаха"',
    price: 75000,
    priceFormatted: '75 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/ece/h99bsb6jra5a4nh3wzhegfop04df8f3e.jpg',
  },
  {
    id: 'akpp-cooling',
    name: 'Доп охлаждение АКПП',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'gur-cooling',
    name: 'Доп охлаждение ГУР',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'pnevmo-lock-both',
    name: 'Комплект пневмо блокировок на оба моста',
    price: 130000,
    priceFormatted: '130 000 ₽',
    image: '',
  },
  {
    id: 'pnevmo-lock-one',
    name: 'Комплект пневмо блокировок на один мост',
    price: 65000,
    priceFormatted: '65 000 ₽',
    image: '',
  },
  {
    id: 'electric-lock-both',
    name: 'Электрическая блокировка дифференциала на оба моста',
    price: 130000,
    priceFormatted: '130 000 ₽',
    image: '',
  },
  {
    id: 'electric-lock-rear',
    name: 'Электрическая блокировка дифференциала заднего моста',
    price: 65000,
    priceFormatted: '65 000 ₽',
    image: '',
  },
  {
    id: 'mech-lock-rear',
    name: 'Механическая самоблокировка дифференциала заднего моста ИЖ Техно',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: '',
  },
  {
    id: 'tent-parking',
    name: 'Тент стояночный',
    price: 15000,
    priceFormatted: '15 000 ₽',
    image: '',
  },
  {
    id: 'zip',
    name: 'ЗИП (запасные инструменты)',
    price: 15000,
    priceFormatted: '15 000 ₽',
    image: '',
  },
  {
    id: 'preheater',
    name: 'Предпусковой подогреватель двигателя (DEFA 220в)',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/bad/dc2ed65nh5dpcg7addo1v1trgt09a4w6.jpg',
  },
  {
    id: 'manometer',
    name: 'Манометр',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/858/iuwj1dppx60g7390cceyee07xd157l7u.jpg',
  },
  {
    id: 'gun-mount',
    name: 'Крепление под ружье (комплект 2 шт.)',
    price: 9000,
    priceFormatted: '9 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/29e/11x5w160uaq11246cfid0s3h36l8cr9n.jpg',
  },
  {
    id: 'mudguards',
    name: 'Брызговики, комплект 2 шт.',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/aa9/lqkaa1rycv0fgeck3px3ef14rbloaqfx.jpg',
  },
  {
    id: 'front-protection',
    name: 'Защита передняя алюминиевая',
    price: 20000,
    priceFormatted: '20 000 ₽',
    image: 'https://rosomaha-rus.ru/upload/iblock/48d/uug7xlkn53lquoage0yufljq57f6ve1n.jpg',
  },
];

// Базовая комплектация Стандарт ПЛЮС
const standardPlusEquipment = [
  'Шины Урал (обдирыши 1100х500)',
  'Электронный паспорт самоходной машины (ЭПСМ)',
  'Задний багажник',
  'Передний багажник',
  'Шланг подкачки колес',
  'Ручки руля с подогревом',
  'Курок газа с подогревом',
  'Ручки для пассажира',
  'Ветровое стекло',
  'Зеркало заднего вида, 2 шт.',
  'Расширители для арок',
  'Светотехника (фары ближнего света, повороты, фара заднего хода)',
];

// Каталог товаров
export const products: Product[] = [
  {
    id: 'standart-plus-suzuki',
    slug: 'rosomaha-standart-plus',
    name: 'Росомаха Стандарт ПЛЮС (1.5 литра, мосты Suzuki Jimny)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 1300000,
    priceFormatted: 'от 1 300 000 ₽',
    available: true,
    badge: 'hit',
    gallery: [
      'https://rosomaha-rus.ru/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      'https://rosomaha-rus.ru/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      'https://rosomaha-rus.ru/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
      'https://rosomaha-rus.ru/upload/iblock/f23/fsjwurbhdxokiwtt4e2hraykou0lge5y.png',
      'https://rosomaha-rus.ru/upload/iblock/234/f4dow1nnjv0d03zowcy979eqv7gjcp3i.png',
      'https://rosomaha-rus.ru/upload/iblock/190/1blxzkyg24rzxojpycxgiq6xanlste1p.png',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/6ae/50_50_140cd750bba9870f18aada2478b24840a/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/d89/50_50_140cd750bba9870f18aada2478b24840a/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/b74/50_50_140cd750bba9870f18aada2478b24840a/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/826/50_50_140cd750bba9870f18aada2478b24840a/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/f23/50_50_140cd750bba9870f18aada2478b24840a/fsjwurbhdxokiwtt4e2hraykou0lge5y.png',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '700',
      speed: 'до 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Suzuki Jimny',
      configuration: 'Стандарт ПЛЮС (Suzuki)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Оптимальное сочетание цены и возможностей. Мосты Suzuki Jimny обеспечивают надёжность и хорошую проходимость.',
  },
  {
    id: 'eger-1',
    slug: 'rosomaha-eger-1',
    name: 'Росомаха Егерь-1 (ДВС 30 л.с., мосты Волга)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 850000,
    priceFormatted: 'от 850 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/706/520_520_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
      'https://rosomaha-rus.ru/upload/iblock/a4b/117cfmpwa6uf8byc0cp7tjkinmms7gqk.JPG',
      'https://rosomaha-rus.ru/upload/iblock/9ee/ufr81fg7opg8y5cy161jvur0a1y3mm82.JPG',
      'https://rosomaha-rus.ru/upload/iblock/3fc/n340fo0p74ke3rbpka6dr92544dxks4u.JPG',
      'https://rosomaha-rus.ru/upload/iblock/d9d/zntr11sgitpap63sighnhxxbzayoxa09.jpg',
      'https://rosomaha-rus.ru/upload/iblock/097/a2wltj4wgolb19b69qhmtwcflsa3aqgu.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b11/blocsyyh6bmzutjrjh3v8ecgaurqdue9.jpg',
      'https://rosomaha-rus.ru/upload/iblock/ce7/124e1a2sbfjjtz8ob3syvtcdskrkybqf.jpg',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/706/50_50_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/a4b/50_50_140cd750bba9870f18aada2478b24840a/117cfmpwa6uf8byc0cp7tjkinmms7gqk.JPG',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/9ee/50_50_140cd750bba9870f18aada2478b24840a/ufr81fg7opg8y5cy161jvur0a1y3mm82.JPG',
    ],
    variants: classicVariants,
    colors: eger1Colors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '350',
      weight: '650',
      speed: 'до 45',
      engine: 'ДВС',
      engineVolume: '653',
      power: '30',
      axles: 'Мосты Волга',
      configuration: 'Егерь-1 (Волга)',
    },
    baseEquipment: [
      'Шины Урал (обдирыши 1100х500)',
      'Задний багажник',
      'Передний багажник',
      'Ветровое стекло',
      'Зеркало заднего вида, 2 шт.',
    ],
    description: 'Экономичный вариант на базе мостов "Волга" с двигателем 30 л.с. Идеален для лёгких задач и начинающих пользователей.',
  },
  {
    id: 'standart-plus-uaz',
    slug: 'rosomaha-standart-plus-uaz',
    name: 'Росомаха Стандарт ПЛЮС (1.5 литра, мосты УАЗ Тимкен)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 1400000,
    priceFormatted: 'от 1 400 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/bfe/2000_2000_140cd750bba9870f18aada2478b24840a/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      'https://rosomaha-rus.ru/upload/iblock/091/b5cbgwfkqhzrbgtvltammfr116hrbjvv.JPG',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/df3/2000_2000_140cd750bba9870f18aada2478b24840a/s3tn1t4eh9t0ckijidomsqz7ofn1q0vf.JPG',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/b99/2000_2000_140cd750bba9870f18aada2478b24840a/dqvj2ncqmtn7xkehdimg3ppx2ttdu35w.JPG',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/bfe/50_50_140cd750bba9870f18aada2478b24840a/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/091/50_50_140cd750bba9870f18aada2478b24840a/b5cbgwfkqhzrbgtvltammfr116hrbjvv.JPG',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'до 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'УАЗ Тимкен',
      configuration: 'Стандарт ПЛЮС (УАЗ)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Усиленная версия с мостами УАЗ Тимкен для серьёзных нагрузок и экстремальных условий.',
  },
  {
    id: 'extrime-uaz',
    slug: 'rosomaha-extrime-uaz',
    name: 'Росомаха Экстрим (1.5 литра, мосты УАЗ)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 1800000,
    priceFormatted: 'от 1 800 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      'https://rosomaha-rus.ru/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/44b/2000_2000_140cd750bba9870f18aada2478b24840a/juwpyfhlr74jixlhaqr56u087uweyrhn.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/120/50_50_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/e3f/50_50_140cd750bba9870f18aada2478b24840a/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'до 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'УАЗ',
      configuration: 'Экстрим (УАЗ)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Для тех, кто не ищет компромиссов. Усиленная рама, улучшенная подвеска, максимальная проходимость.',
  },
  {
    id: 'extrime-toyota',
    slug: 'rosomaha-extrime-toyota',
    name: 'Росомаха Экстрим (1.5 литра, мосты Toyota)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 2050000,
    priceFormatted: 'от 2 050 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      'https://rosomaha-rus.ru/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/120/50_50_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'до 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Toyota',
      configuration: 'Экстрим (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Премиальная версия с надёжными японскими мостами Toyota для максимальной надёжности.',
  },
  {
    id: 'sixwheel-toyota',
    slug: 'rosomaha-6x6',
    name: 'Росомаха Шестиколёсник (1.8 литра, мосты Toyota)',
    category: 'sixwheel',
    categoryName: 'Шестиколёсники',
    basePrice: 3100000,
    priceFormatted: 'от 3 100 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      'https://rosomaha-rus.ru/upload/iblock/8ad/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b83/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
      'https://rosomaha-rus.ru/upload/iblock/95f/10w5enpf5nujwdm1mdig9sd2643kf9cl.jpg',
      'https://rosomaha-rus.ru/upload/iblock/eb1/d54ssc71qb1qow7rg7yhrjr3q9bbohni.jpg',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/8ad/50_50_140cd750bba9870f18aada2478b24840a/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/b83/50_50_140cd750bba9870f18aada2478b24840a/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3500',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '950',
      speed: 'до 55',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Toyota',
      configuration: 'Шестиколёсник (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Шесть колёс = максимальная проходимость. Для самых сложных маршрутов и тяжёлых грузов.',
  },
  {
    id: 'trailer',
    slug: 'rosomaha-trailer',
    name: 'Прицеп к квадроциклу плавающий',
    category: 'trailer',
    categoryName: 'Прицепы',
    basePrice: 200000,
    priceFormatted: '200 000 ₽',
    available: true,
    gallery: [
      'https://rosomaha-rus.ru/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    thumbnails: [
      'https://rosomaha-rus.ru/upload/resize_cache/iblock/edf/50_50_140cd750bba9870f18aada2478b24840a/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    variants: [],
    colors: productColors,
    options: [],
    specs: {
      length: '3100',
      width: '2000',
      height: '1200',
      wheelDiameter: '1100',
      weight: '250',
    },
    baseEquipment: ['Колеса на ободирышах', 'Сцепное устройство'],
    description: 'Плавающий прицеп для перевозки дополнительного груза по любой местности.',
  },
];

// Функция поиска товара по slug
export function getProductBySlug(slug: string): Product | undefined {
  return products.find(p => p.slug === slug);
}

// Функция форматирования цены
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU').format(price) + ' ₽';
}
