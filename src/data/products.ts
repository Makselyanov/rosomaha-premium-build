// Расширенная модель данных товаров с реальными URL изображений с rosomaha-rus.ru
// Локальные изображения для Егерь-1
import eger1Ral6003 from '@/assets/eger1-ral6003.jpg';
import eger1Ral7006 from '@/assets/eger1-ral7006.png';
import eger1Ral7022 from '@/assets/eger1-ral7022.png';
import eger1Ral8011 from '@/assets/eger1-ral8011.png';
import eger1Ral9010 from '@/assets/eger1-ral9010.png';

// Локальные изображения для новых моделей
import modelPikapUaz from '@/assets/model-pikap-uaz.png';
import modelExtrimePlus from '@/assets/model-extrime-plus.png';
import modelHunter from '@/assets/model-hunter.jpg';
import modelPikap18l from '@/assets/model-pikap-18l.jpg';
import modelPikapToyota from '@/assets/model-pikap-toyota.jpg';
import modelPro1 from '@/assets/model-pro-1.jpg';
import modelPro2 from '@/assets/model-pro-2.jpg';
import modelPro3 from '@/assets/model-pro-3.jpg';
import modelPro4 from '@/assets/model-pro-4.jpg';
import modelPro5 from '@/assets/model-pro-5.jpg';
import modelPro6 from '@/assets/model-pro-6.jpg';
import modelPro7 from '@/assets/model-pro-7.jpg';
import modelPro8 from '@/assets/model-pro-8.jpg';
import modelPro9 from '@/assets/model-pro-9.jpg';
import modelPro10 from '@/assets/model-pro-10.jpg';
import modelPro11 from '@/assets/model-pro-11.jpg';
import modelPro12 from '@/assets/model-pro-12.jpg';
import modelPro13 from '@/assets/model-pro-13.jpg';
import modelPro14 from '@/assets/model-pro-14.jpg';

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
  imageFit?: 'cover' | 'contain';
  imageWidth?: number;
  imageHeight?: number;
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
  { id: 'ral9010', name: 'Белый', ral: 'RAL 9010', hex: '#FFFFFF', image: '/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png' },
  { id: 'ral1002', name: 'Песочно-жёлтый', ral: 'RAL 1002', hex: '#D2AA6D', image: '/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg' },
  { id: 'ral2000', name: 'Жёлто-оранжевый', ral: 'RAL 2000', hex: '#ED760E', image: '/upload/iblock/f23/fsjwurbhdxokiwtt4e2hraykou0lge5y.png' },
  { id: 'ral3020', name: 'Транспортный красный', ral: 'RAL 3020', hex: '#CC0605', image: '/upload/iblock/7ce/vwc9ic3vmki2q8clnq7a5pysc521wdwq.jpg' },
  { id: 'ral5013', name: 'Кобальтово-синий', ral: 'RAL 5013', hex: '#1E3A5F', image: '/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png' },
  { id: 'ral5005', name: 'Сигнальный синий', ral: 'RAL 5005', hex: '#005387', image: '/upload/iblock/789/z7wy86u7zyxjearnfvy5kocknb8bmca4.jpg' },
  { id: 'ral7022', name: 'Серая Умбра', ral: 'RAL 7022', hex: '#4C4A44', image: '/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png' },
  { id: 'ral7006', name: 'Бежево-серый', ral: 'RAL 7006', hex: '#756F61', image: '/upload/iblock/234/f4dow1nnjv0d03zowcy979eqv7gjcp3i.png' },
  { id: 'ral6003', name: 'Оливково-зеленый', ral: 'RAL 6003', hex: '#4C5D3D', image: '/upload/iblock/706/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg' },
  { id: 'ral7013', name: 'Коричнево-серый', ral: 'RAL 7013', hex: '#575044', image: '/upload/iblock/190/1blxzkyg24rzxojpycxgiq6xanlste1p.png' },
  { id: 'ral8011', name: 'Орехово-коричневый', ral: 'RAL 8011', hex: '#5A3D30', image: '/upload/iblock/70a/arvm500pi0v2vn6b6cokpewo1tdvxezg.jpg' },
  { id: 'ral9011', name: 'Графитно-чёрный', ral: 'RAL 9011', hex: '#27292B', image: '/upload/iblock/120/z5q84tbm8djjahtkvda0r4bhba54lk80.png' },
];

// Для Егерь-1 используем локально скачанные изображения.
const eger1Colors: ProductColor[] = [
  { id: 'ral6003', name: 'Оливково-зеленый', ral: 'RAL 6003', hex: '#4A5240', image: eger1Ral6003 },
  { id: 'ral7006', name: 'Бежево-серый', ral: 'RAL 7006', hex: '#756F61', image: eger1Ral7006 },
  // Эти цвета ранее были с одной и той же заглушкой — даём каждому свой источник изображения,
  // чтобы при выборе цвета менялась фотография.
  { id: 'ral7013', name: 'Коричнево-серый', ral: 'RAL 7013', hex: '#575044', image: productColors.find(c => c.id === 'ral7013')?.image },
  { id: 'ral7022', name: 'Серая умбра', ral: 'RAL 7022', hex: '#4B4D46', image: eger1Ral7022 },
  { id: 'ral8011', name: 'Орехово-коричневый', ral: 'RAL 8011', hex: '#5A3826', image: eger1Ral8011 },
  { id: 'ral9010', name: 'Белый', ral: 'RAL 9010', hex: '#FFFFFF', image: eger1Ral9010 },
  { id: 'ral9011', name: 'Графитно-чёрный', ral: 'RAL 9011', hex: '#27292B', image: productColors.find(c => c.id === 'ral9011')?.image },
  { id: 'ral1002', name: 'Песочно-жёлтый', ral: 'RAL 1002', hex: '#D2AA6D', image: productColors.find(c => c.id === 'ral1002')?.image },
  { id: 'ral2000', name: 'Жёлто-оранжевый', ral: 'RAL 2000', hex: '#DD7907', image: productColors.find(c => c.id === 'ral2000')?.image },
  { id: 'ral3020', name: 'Красный насыщенный', ral: 'RAL 3020', hex: '#C1121C', image: productColors.find(c => c.id === 'ral3020')?.image },
  { id: 'ral5013', name: 'Кобальтово-синий', ral: 'RAL 5013', hex: '#232C3F', image: productColors.find(c => c.id === 'ral5013')?.image },
  { id: 'ral5005', name: 'Сигнальный синий', ral: 'RAL 5005', hex: '#005387', image: productColors.find(c => c.id === 'ral5005')?.image },
];

// Варианты комплектаций (одинаковые для классических моделей)
export const classicVariants: ProductVariant[] = [
  { id: 'pro-4x4-toyota', name: 'ПРО 4х4 (Toyota 1.8л)', slug: 'snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota', price: 4800000, priceFormatted: 'от 4 800 000 ₽' },
  { id: 'eger-1', name: 'Егерь-1 (Волга)', slug: 'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-', price: 850000, priceFormatted: 'от 850 000 ₽' },
  { id: 'standart-plus-suzuki', name: 'Стандарт ПЛЮС (Suzuki)', slug: 'standart-plus-1-5-litra', price: 1350000, priceFormatted: 'от 1 350 000 ₽' },
  { id: 'standart-plus-uaz', name: 'Стандарт ПЛЮС (УАЗ)', slug: 'rosomakha-standart-plyus-uaz-timken', price: 1450000, priceFormatted: 'от 1 450 000 ₽' },
  { id: 'extrime-uaz', name: 'Экстрим (УАЗ)', slug: 'extrime-s-1-5l-dvs-1nz-fe', price: 1850000, priceFormatted: 'от 1 850 000 ₽' },
  { id: 'extrime-toyota', name: 'Экстрим (Toyota)', slug: 'extrime-1-5-litra-mosty-toyota', price: 2100000, priceFormatted: 'от 2 100 000 ₽' },
  { id: 'extrime-plus-toyota', name: 'Экстрим ПЛЮС (Toyota)', slug: 'extrime-plus-s-1-8l-dvs-1zz-fe', price: 2200000, priceFormatted: 'от 2 200 000 ₽' },
  { id: 'hunter-toyota', name: 'Хантер (Toyota)', slug: 'hunter-s-1-5l-dvs-1nz-fe', price: 2230000, priceFormatted: 'от 2 230 000 ₽' },
  { id: 'pickup-uaz-timken', name: 'Пикап (УАЗ Тимкен)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken', price: 1850000, priceFormatted: 'от 1 850 000 ₽' },
  { id: 'pickup-uaz-18', name: 'Пикап (УАЗ)', slug: 'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz', price: 2300000, priceFormatted: 'от 2 300 000 ₽' },
  { id: 'pickup-toyota', name: 'Пикап (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 2500000, priceFormatted: 'от 2 500 000 ₽' },
  { id: 'sixwheel-toyota', name: 'Шестиколёсник (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 3500000, priceFormatted: 'от 3 500 000 ₽' },
];

// Дополнительные опции (общие для всех моделей)
export const productOptions: ProductOption[] = [
  {
    id: 'trailer',
    name: 'Прицеп к квадроциклу плавающий',
    price: 230000,
    priceFormatted: '230 000 ₽',
    image: '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    specs: { 'Длина, мм': '3100', 'Ширина, мм': '2000', 'Высота, мм': '1200', 'Диаметр колес, мм': '1100', 'Масса, кг': '250' },
  },
  {
    id: 'tires-avtoros',
    name: 'Шины низкого давления AVTOROS MX-PLUS 2 слоя корда (1130 х 530)',
    price: 150000,
    priceFormatted: '150 000 ₽',
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-bagira',
    name: 'Шина «Багира» (1200 х 530)',
    price: 150000,
    priceFormatted: '150 000 ₽',
    image: '/upload/iblock/c8d/6dlcx3pwtzxz7ib6wf7jl4vg331jzle0.jpeg',
  },
  {
    id: 'kofr-side-improved',
    name: 'Боковые кофры, улучшенные 2 шт.',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: '/upload/iblock/c50/fdwrdsctw6aswo2qi74zw1jias3yn937.jpg',
  },
  {
    id: 'kofr-side-standard',
    name: 'Боковые кофры, стандартные 2 шт',
    price: 10000,
    priceFormatted: '10 000 ₽',
    image: '/upload/iblock/12c/80nurbxxkbqyyb7380hfr0aj7bas1jn1.jpg',
  },
  {
    id: 'kofr-front',
    name: 'Передний кофр, тканевый',
    price: 25000,
    priceFormatted: '25 000 ₽',
    image: '/upload/iblock/a43/hofkcng7ypdnp1tqedud338ms38w6uyp.jpg',
  },
  {
    id: 'kofr-rear-fabric',
    name: 'Задний кофр, тканевый (каркасный)',
    price: 35000,
    priceFormatted: '35 000 ₽',
    image: '/upload/iblock/197/nciwzbl48bhvyrsg7n5sk4bibq5kot2i.jpg',
  },
  {
    id: 'kofr-rear-plastic',
    name: 'Задний кофр, пластиковый',
    price: 45000,
    priceFormatted: '45 000 ₽',
    image: '/upload/iblock/910/e3qm3pj32vuxuvh2f25pbkgg0y016yxx.jpg',
  },
  {
    id: 'kofr-rear-triple',
    name: 'Задний кофр, пластиковый трехсекционный СТАНДАРТ',
    price: 60000,
    priceFormatted: '60 000 ₽',
    image: '/upload/iblock/5e6/x1t4q7uc0g75g3n4a1olnckzge8uiy0k.jpg',
  },
  {
    id: 'frame-tent',
    name: 'Каркас металлический с тентом',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: '/upload/iblock/b26/kijowx7q1w6zpsx2m1z5f906j40hqeme.jpeg',
  },
  {
    id: 'winch-stationary',
    name: 'Электрическая лебедка стационарная',
    price: 55000,
    priceFormatted: '55 000 ₽',
    image: '/upload/iblock/9fe/bayhb19qeymuxd0hmxti9mhla61b4udw.jpg',
    specs: { 'Тяговое усилие (lbs)': '5000' },
  },
  {
    id: 'winch-removable',
    name: 'Электрическая лебедка съемная',
    price: 70000,
    priceFormatted: '70 000 ₽',
    image: '/upload/iblock/21e/cpk6xegjud7wodvxpbsy5tbj8wpe4y4c.jpg',
    specs: { 'Тяговое усилие (lbs)': '5000' },
  },
  {
    id: 'light-bar',
    name: 'Балка дополнительного света Светодиодная',
    price: 8000,
    priceFormatted: '8 000 ₽',
    image: '/upload/iblock/b92/wa1abwd0kc4f1gqfp4aj4fnzz1ubbaep.jpg',
  },
  {
    id: 'canister-double',
    name: 'Две канистры для топлива',
    price: 12000,
    priceFormatted: '12 000 ₽',
    image: '/upload/iblock/8ac/cj20b0jb0fw3rgay1cvbwyc4xgxzkyds.jpg',
  },
  {
    id: 'canister-single',
    name: 'Канистра для топлива',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: '/upload/iblock/a5d/dd14qzhphippeaw3mg8jj2a203y38d6i.jpg',
  },
  {
    id: 'seat-heat-driver',
    name: 'Сидение с подогревом (водитель)',
    price: 25000,
    priceFormatted: '25 000 ₽',
    image: '/upload/iblock/4e1/cl14j2bidjgk6os41usx3v0234x7cdfu.jpg',
  },
  {
    id: 'seat-heat-both',
    name: 'Сидение с подогревом (водитель+пассажир)',
    price: 29000,
    priceFormatted: '29 000 ₽',
    image: '/upload/iblock/4e1/cl14j2bidjgk6os41usx3v0234x7cdfu.jpg',
  },
  {
    id: 'radiator-mount',
    name: 'Вынос радиатора "Росомаха"',
    price: 75000,
    priceFormatted: '75 000 ₽',
    image: '/upload/iblock/ece/h99bsb6jra5a4nh3wzhegfop04df8f3e.jpg',
  },
  {
    id: 'akpp-cooling',
    name: 'Доп охлаждение АКПП',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: '/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'gur-cooling',
    name: 'Доп охлаждение ГУР',
    price: 18000,
    priceFormatted: '18 000 ₽',
    image: '/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'pnevmo-lock-both',
    name: 'Комплект пневмо блокировок на оба моста',
    price: 130000,
    priceFormatted: '130 000 ₽',
    image: '/media/options/pnevmo-lock-both-generated.png',
  },
  {
    id: 'pnevmo-lock-one',
    name: 'Комплект пневмо блокировок на один мост',
    price: 65000,
    priceFormatted: '65 000 ₽',
    image: '/media/options/pnevmo-lock-one-generated.png',
  },
  {
    id: 'electric-lock-both',
    name: 'Электрическая блокировка дифференциала на оба моста',
    price: 130000,
    priceFormatted: '130 000 ₽',
    image: '/media/options/electric-lock-both-generated.png',
  },
  {
    id: 'electric-lock-rear',
    name: 'Электрическая блокировка дифференциала заднего моста',
    price: 65000,
    priceFormatted: '65 000 ₽',
    image: '/media/options/electric-lock-rear-generated.png',
  },
  {
    id: 'mech-lock-rear',
    name: 'Механическая самоблокировка дифференциала заднего моста ИЖ Техно',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: '/media/options/mech-lock-rear-generated.png',
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
    image: '/media/options/zip-generated.png',
  },
  {
    id: 'preheater',
    name: 'Предпусковой подогреватель двигателя (DEFA 220в)',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: '/upload/iblock/bad/dc2ed65nh5dpcg7addo1v1trgt09a4w6.jpg',
  },
  {
    id: 'manometer',
    name: 'Манометр',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: '/upload/iblock/858/iuwj1dppx60g7390cceyee07xd157l7u.jpg',
  },
  {
    id: 'gun-mount',
    name: 'Крепление под ружье (комплект 2 шт.)',
    price: 9000,
    priceFormatted: '9 000 ₽',
    image: '/upload/iblock/29e/11x5w160uaq11246cfid0s3h36l8cr9n.jpg',
  },
  {
    id: 'mudguards',
    name: 'Брызговики, комплект 2 шт.',
    price: 6000,
    priceFormatted: '6 000 ₽',
    image: '/upload/iblock/aa9/lqkaa1rycv0fgeck3px3ef14rbloaqfx.jpg',
  },
  {
    id: 'front-protection',
    name: 'Защита передняя алюминиевая',
    price: 20000,
    priceFormatted: '20 000 ₽',
    image: '/upload/iblock/48d/uug7xlkn53lquoage0yufljq57f6ve1n.jpg',
  },
  {
    id: 'frame-tent-trailer',
    name: 'Каркас металлический + тент (прицеп плавающий)',
    price: 40000,
    priceFormatted: '40 000 ₽',
    image: '/upload/iblock/b6e/jm7k3um291ds41m52watt14ei7xet5ck.jpg',
  },
  {
    id: 'frame-tent-eger-cabin',
    name: 'Каркас металлический + тент для Егеря (кабина)',
    price: 64000,
    priceFormatted: '64 000 ₽',
    image: '/upload/resize_cache/iblock/706/520_520_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
  },
  {
    id: 'frame-tent-eger-bed',
    name: 'Каркас металлический + тент для Егеря (кузов)',
    price: 62000,
    priceFormatted: '62 000 ₽',
    image: '',
  },
  {
    id: 'frame-tent-pickup',
    name: 'Каркас металлический + тент для Росомахи (пикап)',
    price: 120000,
    priceFormatted: '120 000 ₽',
    image: '/upload/iblock/601/p4vopcgsru6wiiv2h6hspncvhaauuwxe.jpg',
  },
  {
    id: 'frame-tent-sixwheel',
    name: 'Каркас металлический + тент для Росомахи (Шестиколёсник)',
    price: 180000,
    priceFormatted: '180 000 ₽',
    image: '/upload/iblock/4ef/1m6l7v3hye2tr24rgxcqn73tj0d7o0ol.jpg',
  },
  {
    id: 'winch-stationary-6000',
    name: 'Электрическая лебедка стационарная (6000 LBS)',
    price: 60000,
    priceFormatted: '60 000 ₽',
    image: '/upload/iblock/ae2/a1wo9g0qs2hc0jyuvp7ulq5r0nw045b2.jpg',
    specs: { 'Тяговое усилие (lbs)': '6000' },
  },
  {
    id: 'winch-stationary-8000',
    name: 'Электрическая лебедка стационарная (8000 LBS)',
    price: 75000,
    priceFormatted: '75 000 ₽',
    image: '/upload/iblock/b83/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
    specs: { 'Тяговое усилие (lbs)': '8000' },
  },
  {
    id: 'winch-removable-6000',
    name: 'Электрическая лебедка съемная (6000 LBS)',
    price: 70000,
    priceFormatted: '70 000 ₽',
    image: '/upload/iblock/2bc/r7nerg1as2vd772rsi5ml0byuhml3hyl.jpg',
    specs: { 'Тяговое усилие (lbs)': '6000' },
  },
  {
    id: 'winch-removable-8000',
    name: 'Электрическая лебедка съемная (8000 LBS)',
    price: 80000,
    priceFormatted: '80 000 ₽',
    image: '/upload/iblock/21e/cpk6xegjud7wodvxpbsy5tbj8wpe4y4c.jpg',
    specs: { 'Тяговое усилие (lbs)': '8000' },
  },
  {
    id: 'radiator-double',
    name: 'Радиатор двойной',
    price: 50000,
    priceFormatted: '50 000 ₽',
    image: '/upload/iblock/21f/e9kdyfnnfgjsxfprd0zuh66c7qrx7hmx.jpg',
  },
  {
    id: 'mech-lock-front',
    name: 'Механическая самоблокировка дифференциала переднего моста',
    price: 65000,
    priceFormatted: '65 000 ₽',
    image: '/media/options/mech-lock-front-generated.png',
  },
  {
    id: 'autonomous-air-heater',
    name: 'Отопитель воздушный автономный',
    price: 95000,
    priceFormatted: '95 000 ₽',
    image: '/media/options/autonomous-air-heater-generated.png',
  },
  {
    id: 'side-seats-wings',
    name: 'Сидения боковые (на крылья 2 шт)',
    price: 17000,
    priceFormatted: '17 000 ₽',
    image: '/upload/iblock/f6b/mkmqc06oo9qrxfmu0cc7eqeg5mx13n7i.JPG',
  },
  {
    id: 'rear-soft-seats-sleeper',
    name: 'Сидения со спинкой мягкие + спальное место',
    price: 45000,
    priceFormatted: '45 000 ₽',
    image: '/media/options/rear-soft-seats-sleeper-generated.png',
  },
  {
    id: 'rear-soft-seats-bed',
    name: 'Сидения со спинкой мягкие в кузов (2 шт.)',
    price: 22000,
    priceFormatted: '22 000 ₽',
    image: '',
  },
  {
    id: 'folding-table',
    name: 'Стол откидной',
    price: 23000,
    priceFormatted: '23 000 ₽',
    image: '/upload/iblock/d72/p1ttqc7ar7b825elymyen3066fh49fvq.jpg',
  },
];

export const extremeRearCofferOption: ProductOption = {
  id: 'kofr-rear-triple-extreme',
  name: 'Задний кофр, пластиковый трехсекционный ЭКСТРИМ',
  price: 75000,
  priceFormatted: '75 000 ₽',
  image: '/media/options/extreme-three-section-coffer-dimensions.jpg',
  imageFit: 'contain',
  imageWidth: 3000,
  imageHeight: 2636,
  specs: {
    'Габаритная длина, мм': '1940',
    'Габаритная высота, мм': '1067',
    'Глубина, мм': '351',
  },
};

export const extremeProductOptions: ProductOption[] = [...productOptions, extremeRearCofferOption];
export const allProductOptions: ProductOption[] = [...productOptions, extremeRearCofferOption];

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
    id: 'pro-4x4-toyota',
    slug: 'rosomaha-pro-4x4',
    name: 'Росомаха ПРО 4х4 (1.8 литра, мосты Toyota)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 4800000,
    priceFormatted: 'от 4 800 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      modelPro1, modelPro2, modelPro3, modelPro4,
      modelPro5, modelPro6, modelPro7, modelPro8,
      modelPro9, modelPro10, modelPro11, modelPro12,
      modelPro13, modelPro14,
    ],
    thumbnails: [
      modelPro1, modelPro2, modelPro3, modelPro4, modelPro5,
    ],
    variants: [
      { id: 'pro-4x4-toyota', name: 'ПРО 4х4 (Toyota 1.8л)', slug: 'snegobolotokhod-rosomakha-model-pro-4kh4-s-dvs-1zz-fe-1-8-litra-mosty-toyota', price: 4800000, priceFormatted: 'от 4 800 000 ₽' },
    ],
    colors: productColors,
    options: [
      { id: 'winch-rear', name: 'Электрическая лебёдка задняя (6000–8000 LBS)', price: 55000, priceFormatted: '55 000 ₽', image: '/upload/iblock/21e/cpk6xegjud7wodvxpbsy5tbj8wpe4y4c.jpg' },
      { id: 'winch-front', name: 'Электрическая лебёдка передняя (6000–8000 LBS)', price: 55000, priceFormatted: '55 000 ₽', image: '/upload/iblock/e77/cvm3ayx4rtsye2ua6l2hrurhhivcei1d.jpg' },
      { id: 'light-bar-led', name: 'Балка светодиодная', price: 8000, priceFormatted: '8 000 ₽', image: '/upload/iblock/b92/wa1abwd0kc4f1gqfp4aj4fnzz1ubbaep.jpg' },
      { id: 'air-conditioner', name: 'Кондиционер', price: 120000, priceFormatted: '120 000 ₽', image: '' },
      { id: 'rear-camera', name: 'Камеры заднего вида', price: 15000, priceFormatted: '15 000 ₽', image: '' },
      { id: 'additional-heater', name: 'Дополнительный обогреватель', price: 25000, priceFormatted: '25 000 ₽', image: '/media/options/additional-heater-generated.png' },
      { id: 'heated-mirrors', name: 'Зеркала с подогревом', price: 10000, priceFormatted: '10 000 ₽', image: '' },
      { id: 'roof-hatch', name: 'Пластиковый люк в крыше (600×750 мм)', price: 35000, priceFormatted: '35 000 ₽', image: '' },
      { id: 'preheater-autonomous', name: 'Автономный воздушный обогреватель', price: 60000, priceFormatted: '60 000 ₽', image: '/media/options/autonomous-air-heater-generated.png' },
    ],
    specs: {
      length: '5050',
      width: '2400',
      height: '2750',
      wheelDiameter: '1450',
      clearance: '500',
      weight: '1999',
      speed: 'до 80',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Тойота',
      configuration: 'ПРО (Toyota)',
    },
    baseEquipment: [
      'Шины AVTOROS SALAMANDRA (1450×650)',
      'Электронный паспорт самоходной машины (ЭПСМ)',
      'Шланг подкачки колёс',
      'Расширители для арок',
      'Светотехника полная (фары, повороты, задний ход)',
      'Электронная блокировка дифференциала (2 моста)',
      'Раздаточная коробка',
      'Зеркала заднего вида (2 шт.)',
    ],
    description: 'Флагманская модель с двигателем Toyota 1ZZ-FE 1.8 литра и мостами Toyota. Максимальная проходимость и надёжность для самых сложных условий. Клиренс 500 мм, скорость до 80 км/ч.',
  },
  {
    id: 'standart-plus-suzuki',
    slug: 'rosomaha-standart-plus',
    name: 'Росомаха Стандарт ПЛЮС (1.5 литра, мосты Suzuki Jimny)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 1350000,
    priceFormatted: 'от 1 350 000 ₽',
    available: true,
    badge: 'hit',
    gallery: [
      '/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      '/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      '/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      '/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
      '/upload/iblock/f23/fsjwurbhdxokiwtt4e2hraykou0lge5y.png',
      '/upload/iblock/234/f4dow1nnjv0d03zowcy979eqv7gjcp3i.png',
      '/upload/iblock/190/1blxzkyg24rzxojpycxgiq6xanlste1p.png',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/6ae/50_50_140cd750bba9870f18aada2478b24840a/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      '/upload/resize_cache/iblock/d89/50_50_140cd750bba9870f18aada2478b24840a/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      '/upload/resize_cache/iblock/b74/50_50_140cd750bba9870f18aada2478b24840a/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      '/upload/resize_cache/iblock/826/50_50_140cd750bba9870f18aada2478b24840a/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
      '/upload/resize_cache/iblock/f23/50_50_140cd750bba9870f18aada2478b24840a/fsjwurbhdxokiwtt4e2hraykou0lge5y.png',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3000',
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
      '/upload/resize_cache/iblock/706/520_520_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
      '/upload/iblock/a4b/117cfmpwa6uf8byc0cp7tjkinmms7gqk.JPG',
      '/upload/iblock/9ee/ufr81fg7opg8y5cy161jvur0a1y3mm82.JPG',
      '/upload/iblock/3fc/n340fo0p74ke3rbpka6dr92544dxks4u.JPG',
      '/upload/iblock/d9d/zntr11sgitpap63sighnhxxbzayoxa09.jpg',
      '/upload/iblock/097/a2wltj4wgolb19b69qhmtwcflsa3aqgu.jpg',
      '/upload/iblock/b11/blocsyyh6bmzutjrjh3v8ecgaurqdue9.jpg',
      '/upload/iblock/ce7/124e1a2sbfjjtz8ob3syvtcdskrkybqf.jpg',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/706/50_50_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
      '/upload/resize_cache/iblock/a4b/50_50_140cd750bba9870f18aada2478b24840a/117cfmpwa6uf8byc0cp7tjkinmms7gqk.JPG',
      '/upload/resize_cache/iblock/9ee/50_50_140cd750bba9870f18aada2478b24840a/ufr81fg7opg8y5cy161jvur0a1y3mm82.JPG',
    ],
    variants: classicVariants,
    colors: eger1Colors,
    options: productOptions,
    specs: {
      length: '4000',
      width: '2180',
      height: '1650 (с тентом 2420)',
      wheelDiameter: '1200',
      clearance: '400',
      weight: '700',
      engine: 'LONCIN',
      power: '30',
      axles: 'Волга',
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
    basePrice: 1450000,
    priceFormatted: 'от 1 450 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      '/upload/resize_cache/iblock/bfe/2000_2000_140cd750bba9870f18aada2478b24840a/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      '/upload/iblock/091/b5cbgwfkqhzrbgtvltammfr116hrbjvv.JPG',
      '/upload/resize_cache/iblock/df3/2000_2000_140cd750bba9870f18aada2478b24840a/s3tn1t4eh9t0ckijidomsqz7ofn1q0vf.JPG',
      '/upload/resize_cache/iblock/b99/2000_2000_140cd750bba9870f18aada2478b24840a/dqvj2ncqmtn7xkehdimg3ppx2ttdu35w.JPG',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/bfe/50_50_140cd750bba9870f18aada2478b24840a/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      '/upload/resize_cache/iblock/091/50_50_140cd750bba9870f18aada2478b24840a/b5cbgwfkqhzrbgtvltammfr116hrbjvv.JPG',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3000',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '700',
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
    basePrice: 1850000,
    priceFormatted: 'от 1 850 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [
      '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      '/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      '/upload/resize_cache/iblock/44b/2000_2000_140cd750bba9870f18aada2478b24840a/juwpyfhlr74jixlhaqr56u087uweyrhn.jpg',
      '/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/120/50_50_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      '/upload/resize_cache/iblock/e3f/50_50_140cd750bba9870f18aada2478b24840a/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
    ],
    variants: classicVariants,
    colors: productColors,
    options: extremeProductOptions,
    specs: {
      length: '3100',
      width: '2250',
      height: '1700',
      wheelDiameter: '1200',
      clearance: '450',
      weight: '1100',
      speed: 'до 80',
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
    basePrice: 2100000,
    priceFormatted: 'от 2 100 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [
      '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      '/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      '/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/120/50_50_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
    ],
    variants: classicVariants,
    colors: productColors,
    options: extremeProductOptions,
    specs: {
      length: '3100',
      width: '2250',
      height: '1700',
      wheelDiameter: '1200',
      clearance: '450',
      weight: '1100',
      speed: 'до 80',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Тойота',
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
    basePrice: 3500000,
    priceFormatted: 'от 3 500 000 ₽',
    available: true,
    badge: 'new',
    gallery: [
      '/upload/iblock/8ad/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
      '/upload/iblock/b83/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
      '/upload/iblock/95f/10w5enpf5nujwdm1mdig9sd2643kf9cl.jpg',
      '/upload/iblock/eb1/d54ssc71qb1qow7rg7yhrjr3q9bbohni.jpg',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/8ad/50_50_140cd750bba9870f18aada2478b24840a/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
      '/upload/resize_cache/iblock/b83/50_50_140cd750bba9870f18aada2478b24840a/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
    ],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '5950',
      width: '2350',
      height: '2760',
      wheelDiameter: '1450',
      clearance: '600',
      speed: 'до 80',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Тойота',
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
    basePrice: 230000,
    priceFormatted: '230 000 ₽',
    available: true,
    gallery: [
      '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/edf/50_50_140cd750bba9870f18aada2478b24840a/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    variants: [
      {
        id: 'trailer',
        name: 'Прицеп плавающий универсальный',
        slug: 'pritsep-k-kvadrotsiklu-plavayushchiy-na-obdiryshakh',
        price: 230000,
        priceFormatted: '230 000 ₽',
      },
    ],
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
  // ======= НОВЫЕ МОДЕЛИ =======
  {
    id: 'pickup-uaz-timken',
    slug: 'rosomaha-pickup-uaz-timken',
    name: 'Росомаха Пикап УАЗ',
    category: 'pickup',
    categoryName: 'Пикапы',
    basePrice: 1850000,
    priceFormatted: 'от 1 850 000 ₽',
    available: true,
    badge: 'new',
    gallery: [modelPikapUaz],
    thumbnails: [modelPikapUaz],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3500',
      width: '2000',
      height: '1670',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '1250',
      speed: 'до 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'УАЗ Тимкен',
      configuration: 'Пикап (УАЗ Тимкен)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Пикап на базе мостов УАЗ Тимкен с грузовой платформой для перевозки снаряжения и оборудования.',
  },
  {
    id: 'pickup-uaz-18',
    slug: 'rosomaha-pickup-uaz-18',
    name: 'Росомаха Пикап 1.8л',
    category: 'pickup',
    categoryName: 'Пикапы',
    basePrice: 2300000,
    priceFormatted: 'от 2 300 000 ₽',
    available: true,
    badge: 'new',
    gallery: [modelPikap18l],
    thumbnails: [modelPikap18l],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3850',
      width: '2250',
      height: '1750',
      wheelDiameter: '1200',
      clearance: '500',
      weight: '1450',
      speed: 'до 80',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'УАЗ',
      configuration: 'Пикап (УАЗ)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Мощный грузовой вариант с двигателем 1.8л для тяжёлых грузов.',
  },
  {
    id: 'pickup-toyota',
    slug: 'rosomaha-pickup-toyota',
    name: 'Росомаха Пикап Toyota',
    category: 'pickup',
    categoryName: 'Пикапы',
    basePrice: 2500000,
    priceFormatted: 'от 2 500 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [modelPikapToyota],
    thumbnails: [modelPikapToyota],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3850',
      width: '2250',
      height: '1750',
      wheelDiameter: '1200',
      clearance: '500',
      weight: '1450',
      speed: 'до 80',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Тойота',
      configuration: 'Пикап (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Топовый пикап с японскими мостами Toyota и двигателем 1.8 литра. Надёжность и грузоподъёмность.',
  },
  {
    id: 'extrime-plus-toyota',
    slug: 'rosomaha-extrime-plus',
    name: 'Росомаха Экстрим ПЛЮС (Toyota)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 2200000,
    priceFormatted: 'от 2 200 000 ₽',
    available: true,
    badge: 'hit',
    gallery: [modelExtrimePlus],
    thumbnails: [modelExtrimePlus],
    variants: classicVariants,
    colors: productColors,
    options: extremeProductOptions,
    specs: {
      length: '3200',
      width: '2400',
      height: '1850',
      wheelDiameter: '1300',
      clearance: '500',
      weight: '1300',
      speed: 'до 80',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Тойота',
      configuration: 'Экстрим ПЛЮС (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Топовая комплектация с двигателем 1.8 литра и японскими мостами Toyota. Максимальная проходимость и надёжность.',
  },
  {
    id: 'hunter-toyota',
    slug: 'rosomaha-hunter',
    name: 'Росомаха Хантер (Toyota)',
    category: 'classic',
    categoryName: 'Классические модели',
    basePrice: 2230000,
    priceFormatted: 'от 2 230 000 ₽',
    available: true,
    badge: 'recommended',
    gallery: [modelHunter],
    thumbnails: [modelHunter],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3100',
      width: '2000',
      height: '1700',
      wheelDiameter: '1200',
      clearance: '450',
      weight: '1100',
      speed: 'до 80',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Тойота',
      configuration: 'Хантер (Toyota)',
    },
    baseEquipment: [...standardPlusEquipment, 'Усиленная защита днища', 'Увеличенный топливный бак'],
    description: 'Модель для охотников с усиленной защитой и увеличенным топливным баком для длительных экспедиций.',
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
