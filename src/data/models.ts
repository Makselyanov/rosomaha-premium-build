export interface VehicleModel {
  id: string;
  slug: string;
  name: string;
  category: 'classic' | 'pickup' | 'trailer' | 'sixwheel';
  categoryName: string;
  price: number;
  priceFormatted: string;
  available: boolean;
  badge?: 'new' | 'hit' | 'recommended';
  image: string;
  images: string[];
  specs: {
    engine: string;
    power: string;
    axles: string;
  };
  description: string;
}

export interface Dealer {
  id: string;
  region: string;
  city: string;
  address: string;
  phone: string;
  phone2?: string;
  email?: string;
  website?: string;
  workHours: string;
  coordinates: { lat: number; lng: number };
}

export interface CartItem {
  model: VehicleModel;
  quantity: number;
}

export const vehicleCategories = [
  { id: 'all', name: 'Все модели' },
  { id: 'classic', name: 'Классические' },
  { id: 'pickup', name: 'Пикапы' },
  { id: 'trailer', name: 'Прицепы' },
  { id: 'sixwheel', name: 'Шестиколёсники' },
];

export const models: VehicleModel[] = [
  {
    id: 'eger-1',
    slug: 'rosomaha-eger-1',
    name: 'Росомаха Егерь-1',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 850000,
    priceFormatted: 'от 850 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/71f/4mst9p11f3ljlilp39q0i2ri76npymcv.png',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/71f/4mst9p11f3ljlilp39q0i2ri76npymcv.png',
      'https://rosomaha-rus.ru/upload/iblock/789/z7wy86u7zyxjearnfvy5kocknb8bmca4.jpg',
    ],
    specs: {
      engine: 'ДВС 30 л.с.',
      power: '30 л.с.',
      axles: 'Мосты Волга',
    },
    description: 'Экономичный вариант на базе мостов "Волга" с двигателем 30 л.с. Идеален для лёгких задач и начинающих пользователей.',
  },
  {
    id: 'standart-plus-jimny',
    slug: 'rosomaha-standart-plus',
    name: 'Росомаха Стандарт ПЛЮС',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 1300000,
    priceFormatted: 'от 1 300 000 ₽',
    available: true,
    badge: 'hit',
    image: 'https://rosomaha-rus.ru/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      'https://rosomaha-rus.ru/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      'https://rosomaha-rus.ru/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты Suzuki Jimny',
    },
    description: 'Оптимальное сочетание цены и возможностей. Мосты Suzuki Jimny обеспечивают надёжность и хорошую проходимость.',
  },
  {
    id: 'standart-plus-uaz',
    slug: 'rosomaha-standart-plus-uaz',
    name: 'Росомаха Стандарт ПЛЮС УАЗ',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 1400000,
    priceFormatted: 'от 1 400 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/bfe/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/bfe/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      'https://rosomaha-rus.ru/upload/iblock/c05/sbgm44vkpdqigphyvecm4w5scqt5h9l2.jpg',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты УАЗ Тимкен',
    },
    description: 'Усиленная версия с мостами УАЗ Тимкен для серьёзных нагрузок и экстремальных условий.',
  },
  {
    id: 'extrime-uaz',
    slug: 'rosomaha-extrime-uaz',
    name: 'Росомаха Экстрим',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 1800000,
    priceFormatted: 'от 1 800 000 ₽',
    available: true,
    badge: 'recommended',
    image: 'https://rosomaha-rus.ru/upload/iblock/5f8/lqgshzfsjgagdxjudqnfcdqfsmcv2ngj.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/5f8/lqgshzfsjgagdxjudqnfcdqfsmcv2ngj.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b2b/zxs24n86j5hvb8hxdmjx2l66uidrx7td.jpg',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты УАЗ',
    },
    description: 'Для тех, кто не ищет компромиссов. Усиленная рама, улучшенная подвеска, максимальная проходимость.',
  },
  {
    id: 'extrime-toyota',
    slug: 'rosomaha-extrime-toyota',
    name: 'Росомаха Экстрим Toyota',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 2050000,
    priceFormatted: 'от 2 050 000 ₽',
    available: true,
    badge: 'recommended',
    image: 'https://rosomaha-rus.ru/upload/iblock/a0f/kxl6zw9ysq3chfhjlwf90hg6c2r7k5wn.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/a0f/kxl6zw9ysq3chfhjlwf90hg6c2r7k5wn.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты Toyota',
    },
    description: 'Премиальная версия с надёжными японскими мостами Toyota для максимальной надёжности.',
  },
  {
    id: 'extrime-plus',
    slug: 'rosomaha-extrime-plus',
    name: 'Росомаха Экстрим ПЛЮС',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 2150000,
    priceFormatted: 'от 2 150 000 ₽',
    available: true,
    badge: 'recommended',
    image: 'https://rosomaha-rus.ru/upload/iblock/ddf/b6rlqvb3e6gpwzw8j2bflnjz41xgtblq.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/ddf/b6rlqvb3e6gpwzw8j2bflnjz41xgtblq.jpg',
      'https://rosomaha-rus.ru/upload/iblock/a2f/xpxqf4s67l99gmq3cz2ufhqycjm88vw5.jpg',
    ],
    specs: {
      engine: '1.8 литра',
      power: '1ZZ-FE',
      axles: 'Мосты Toyota',
    },
    description: 'Флагман линейки с увеличенным объёмом двигателя 1.8л и мостами Toyota.',
  },
  {
    id: 'hunter',
    slug: 'rosomaha-hunter',
    name: 'Росомаха Хантер',
    category: 'classic',
    categoryName: 'Классические модели',
    price: 2180000,
    priceFormatted: 'от 2 180 000 ₽',
    available: true,
    badge: 'recommended',
    image: 'https://rosomaha-rus.ru/upload/iblock/3b6/fuhfx86rfvslwsdjqkf65oc9w3y8j0xa.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/3b6/fuhfx86rfvslwsdjqkf65oc9w3y8j0xa.jpg',
      'https://rosomaha-rus.ru/upload/iblock/bc7/7h1r9h9e19hy5dhlpxujhfv56gzphpg7.jpg',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты Toyota',
    },
    description: 'Специальная версия для охотников с улучшенной эргономикой и дополнительными креплениями.',
  },
  {
    id: 'pickup-uaz-timken',
    slug: 'rosomaha-pickup-uaz-timken',
    name: 'Росомаха Пикап УАЗ',
    category: 'pickup',
    categoryName: 'Пикапы',
    price: 1700000,
    priceFormatted: 'от 1 700 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/8a9/b85x0qunl22t96aetvxvv81o2ejzr8wt.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/8a9/b85x0qunl22t96aetvxvv81o2ejzr8wt.jpg',
      'https://rosomaha-rus.ru/upload/iblock/d1f/yzx7d21n8gk5l2t5e5nxqspcvkf6n4w1.jpg',
    ],
    specs: {
      engine: '1.5 литра',
      power: '1NZ-FE',
      axles: 'Мосты УАЗ Тимкен',
    },
    description: 'Грузовая версия с кузовом-пикап для перевозки снаряжения и оборудования.',
  },
  {
    id: 'pickup-uaz-18',
    slug: 'rosomaha-pickup-uaz-18',
    name: 'Росомаха Пикап 1.8л',
    category: 'pickup',
    categoryName: 'Пикапы',
    price: 2250000,
    priceFormatted: 'от 2 250 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/d2f/c7jkf1ylnpb9u5m4kx3w8hq2r0v6z9at.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/d2f/c7jkf1ylnpb9u5m4kx3w8hq2r0v6z9at.jpg',
      'https://rosomaha-rus.ru/upload/iblock/8a9/b85x0qunl22t96aetvxvv81o2ejzr8wt.jpg',
    ],
    specs: {
      engine: '1.8 литра',
      power: '1ZZ-FE',
      axles: 'Мосты УАЗ',
    },
    description: 'Мощный грузовой вариант с двигателем 1.8л для тяжёлых грузов.',
  },
  {
    id: 'pickup-toyota',
    slug: 'rosomaha-pickup-toyota',
    name: 'Росомаха Пикап Toyota',
    category: 'pickup',
    categoryName: 'Пикапы',
    price: 2450000,
    priceFormatted: 'от 2 450 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/1a3/s7k2n5p8x3q9w1r4t6y0u2i5o8.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/1a3/s7k2n5p8x3q9w1r4t6y0u2i5o8.jpg',
      'https://rosomaha-rus.ru/upload/iblock/d2f/c7jkf1ylnpb9u5m4kx3w8hq2r0v6z9at.jpg',
    ],
    specs: {
      engine: '1.8 литра',
      power: '1ZZ-FE',
      axles: 'Мосты Toyota',
    },
    description: 'Премиальный пикап с японскими компонентами высочайшего качества.',
  },
  {
    id: 'sixwheel',
    slug: 'rosomaha-6x6',
    name: 'Росомаха Шестиколёсник',
    category: 'sixwheel',
    categoryName: 'Шестиколёсники',
    price: 3100000,
    priceFormatted: 'от 3 100 000 ₽',
    available: true,
    badge: 'new',
    image: 'https://rosomaha-rus.ru/upload/iblock/8c4/vkhqjf9p2n5l1x7w3r6t0y4u8i2o5.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/8c4/vkhqjf9p2n5l1x7w3r6t0y4u8i2o5.jpg',
      'https://rosomaha-rus.ru/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
    ],
    specs: {
      engine: '1.8 литра',
      power: '1ZZ-FE',
      axles: 'Мосты Toyota',
    },
    description: 'Шесть колёс = максимальная проходимость. Для самых сложных маршрутов и тяжёлых грузов.',
  },
  {
    id: 'trailer',
    slug: 'rosomaha-trailer',
    name: 'Прицеп плавающий',
    category: 'trailer',
    categoryName: 'Прицепы',
    price: 200000,
    priceFormatted: '200 000 ₽',
    available: true,
    image: 'https://rosomaha-rus.ru/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    images: [
      'https://rosomaha-rus.ru/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    specs: {
      engine: '-',
      power: '-',
      axles: 'На ободирышах',
    },
    description: 'Плавающий прицеп для перевозки дополнительного груза по любой местности.',
  },
];

export const dealers: Dealer[] = [
  {
    id: 'factory',
    region: 'Тюменская область',
    city: 'п. Московский',
    address: 'ул. Бурлаки 29В',
    phone: '+7 (922) 071 11-74',
    phone2: '+7 (3452) 564-164',
    workHours: 'Пн-Пт с 9:00 до 18:00',
    coordinates: { lat: 57.1058, lng: 68.1231 },
  },
  {
    id: 'tyumen-club',
    region: 'Тюменская область',
    city: 'Тюмень',
    address: 'Кипарисовый проезд, 12',
    phone: '+7 (952) 678-66-66',
    email: 'rosomaha_club@icloud.com',
    website: 'https://www.rosomaha-club.ru',
    workHours: 'Пн-Пт с 9:00 до 18:00',
    coordinates: { lat: 57.1522, lng: 68.2583 },
  },
  {
    id: 'barnaul',
    region: 'Алтайский край',
    city: 'Барнаул',
    address: 'ул. Павловский тракт, 52',
    phone: '+7 (3852) 205-596',
    workHours: 'Пн-Чт: 08:00-21:00, Пт-Сб: 10:00-18:00',
    coordinates: { lat: 53.3547, lng: 83.7697 },
  },
  {
    id: 'blagoveshchensk',
    region: 'Амурская область',
    city: 'Благовещенск',
    address: 'ул. Промышленная, 10',
    phone: '+7 (962) 284-81-55',
    workHours: 'Пн-Пт: 08:00-21:00',
    coordinates: { lat: 50.2905, lng: 127.5272 },
  },
  {
    id: 'krasnoyarsk',
    region: 'Красноярский край',
    city: 'Красноярск',
    address: 'ул. Брянская, 11',
    phone: '+7 (913) 181-91-97',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 56.0097, lng: 92.8525 },
  },
  {
    id: 'murmansk',
    region: 'Мурманская область',
    city: 'Мурманск',
    address: 'Верхне-Ростинское шоссе, д. 55А',
    phone: '+7 (8152) 24-50-40',
    workHours: 'Пн-Пт: 08:00-21:00',
    coordinates: { lat: 68.9730, lng: 33.0945 },
  },
  {
    id: 'perm',
    region: 'Пермский край',
    city: 'Пермь',
    address: 'ул. Борцов Революции, 154',
    phone: '+7 (342) 257-69-69',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 58.0297, lng: 56.2668 },
  },
  {
    id: 'ufa',
    region: 'Республика Башкортостан',
    city: 'Уфа',
    address: 'п. Зинино, ул. Пригородная, 55, ТК "Караван"',
    phone: '+7 (905) 181-42-22',
    website: 'http://aktivniy-otdyh.com/',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 54.7388, lng: 55.9721 },
  },
  {
    id: 'ekaterinburg',
    region: 'Свердловская область',
    city: 'Екатеринбург',
    address: 'Екатеринбург',
    phone: '+7 (343) 000-00-00',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 56.8389, lng: 60.6057 },
  },
  {
    id: 'chelyabinsk',
    region: 'Челябинская область',
    city: 'Челябинск',
    address: 'Челябинск',
    phone: '+7 (351) 000-00-00',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 55.1644, lng: 61.4368 },
  },
  {
    id: 'salekhard',
    region: 'Ямало-Ненецкий АО',
    city: 'Салехард',
    address: 'Салехард',
    phone: '+7 (34922) 0-00-00',
    workHours: 'Пн-Пт: 9:00-18:00',
    coordinates: { lat: 66.5300, lng: 66.6019 },
  },
];

export const accessories = [
  {
    id: 'tire-bagira',
    name: 'Шина "Багира" (1200 х 530)',
    category: 'Шины',
    price: 60000,
    priceFormatted: '60 000 ₽',
    available: true,
    image: 'https://rosomaha-rus.ru/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-max',
    name: 'Шина AVTOROS MAX-TRIM (1300 х 700)',
    category: 'Шины',
    price: 70300,
    priceFormatted: '70 300 ₽',
    available: true,
    image: 'https://rosomaha-rus.ru/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-mx',
    name: 'Шина AVTOROS MX-PLUS (1130 х 530)',
    category: 'Шины',
    price: 55900,
    priceFormatted: '55 900 ₽',
    available: true,
    image: 'https://rosomaha-rus.ru/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-xtrim',
    name: 'Шина AVTOROS X-TRIM (1200 х 600)',
    category: 'Шины',
    price: 59700,
    priceFormatted: '59 700 ₽',
    available: true,
    image: 'https://rosomaha-rus.ru/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
];
