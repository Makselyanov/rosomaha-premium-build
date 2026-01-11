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
  { id: 'all', name: 'Р’СЃРµ РјРѕРґРµР»Рё' },
  { id: 'classic', name: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ' },
  { id: 'pickup', name: 'РџРёРєР°РїС‹' },
  { id: 'trailer', name: 'РџСЂРёС†РµРїС‹' },
  { id: 'sixwheel', name: 'РЁРµСЃС‚РёРєРѕР»С‘СЃРЅРёРєРё' },
];

export const models: VehicleModel[] = [
  {
    id: 'eger-1',
    slug: 'rosomaha-eger-1',
    name: 'Р РѕСЃРѕРјР°С…Р° Р•РіРµСЂСЊ-1',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 850000,
    priceFormatted: 'РѕС‚ 850 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/resize_cache/iblock/706/520_520_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
    images: [
      '/upload/resize_cache/iblock/706/520_520_140cd750bba9870f18aada2478b24840a/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg',
      '/upload/iblock/a4b/117cfmpwa6uf8byc0cp7tjkinmms7gqk.JPG',
      '/upload/iblock/9ee/ufr81fg7opg8y5cy161jvur0a1y3mm82.JPG',
      '/upload/iblock/3fc/n340fo0p74ke3rbpka6dr92544dxks4u.JPG',
    ],
    specs: {
      engine: 'Р”Р’РЎ 30 Р».СЃ.',
      power: '30 Р».СЃ.',
      axles: 'РњРѕСЃС‚С‹ Р’РѕР»РіР°',
    },
    description: 'Р­РєРѕРЅРѕРјРёС‡РЅС‹Р№ РІР°СЂРёР°РЅС‚ РЅР° Р±Р°Р·Рµ РјРѕСЃС‚РѕРІ "Р’РѕР»РіР°" СЃ РґРІРёРіР°С‚РµР»РµРј 30 Р».СЃ. РРґРµР°Р»РµРЅ РґР»СЏ Р»С‘РіРєРёС… Р·Р°РґР°С‡ Рё РЅР°С‡РёРЅР°СЋС‰РёС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№.',
  },
  {
    id: 'standart-plus-jimny',
    slug: 'rosomaha-standart-plus',
    name: 'Р РѕСЃРѕРјР°С…Р° РЎС‚Р°РЅРґР°СЂС‚ РџР›Р®РЎ',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 1300000,
    priceFormatted: 'РѕС‚ 1 300 000 в‚Ѕ',
    available: true,
    badge: 'hit',
    image: '/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
    images: [
      '/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png',
      '/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg',
      '/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png',
      '/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ Suzuki Jimny',
    },
    description: 'РћРїС‚РёРјР°Р»СЊРЅРѕРµ СЃРѕС‡РµС‚Р°РЅРёРµ С†РµРЅС‹ Рё РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№. РњРѕСЃС‚С‹ Suzuki Jimny РѕР±РµСЃРїРµС‡РёРІР°СЋС‚ РЅР°РґС‘Р¶РЅРѕСЃС‚СЊ Рё С…РѕСЂРѕС€СѓСЋ РїСЂРѕС…РѕРґРёРјРѕСЃС‚СЊ.',
  },
  {
    id: 'standart-plus-uaz',
    slug: 'rosomaha-standart-plus-uaz',
    name: 'Р РѕСЃРѕРјР°С…Р° РЎС‚Р°РЅРґР°СЂС‚ РџР›Р®РЎ РЈРђР—',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 1400000,
    priceFormatted: 'РѕС‚ 1 400 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/iblock/bfe/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
    images: [
      '/upload/iblock/bfe/s9atpzqrdsihjm2vy57obxr8e0h5bd9h.JPG',
      '/upload/iblock/c05/sbgm44vkpdqigphyvecm4w5scqt5h9l2.jpg',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ РЈРђР— РўРёРјРєРµРЅ',
    },
    description: 'РЈСЃРёР»РµРЅРЅР°СЏ РІРµСЂСЃРёСЏ СЃ РјРѕСЃС‚Р°РјРё РЈРђР— РўРёРјРєРµРЅ РґР»СЏ СЃРµСЂСЊС‘Р·РЅС‹С… РЅР°РіСЂСѓР·РѕРє Рё СЌРєСЃС‚СЂРµРјР°Р»СЊРЅС‹С… СѓСЃР»РѕРІРёР№.',
  },
  {
    id: 'extrime-uaz',
    slug: 'rosomaha-extrime-uaz',
    name: 'Р РѕСЃРѕРјР°С…Р° Р­РєСЃС‚СЂРёРј',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 1800000,
    priceFormatted: 'РѕС‚ 1 800 000 в‚Ѕ',
    available: true,
    badge: 'recommended',
    image: '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
    images: [
      '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      '/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      '/upload/resize_cache/iblock/44b/2000_2000_140cd750bba9870f18aada2478b24840a/juwpyfhlr74jixlhaqr56u087uweyrhn.jpg',
      '/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ РЈРђР—',
    },
    description: 'Р”Р»СЏ С‚РµС…, РєС‚Рѕ РЅРµ РёС‰РµС‚ РєРѕРјРїСЂРѕРјРёСЃСЃРѕРІ. РЈСЃРёР»РµРЅРЅР°СЏ СЂР°РјР°, СѓР»СѓС‡С€РµРЅРЅР°СЏ РїРѕРґРІРµСЃРєР°, РјР°РєСЃРёРјР°Р»СЊРЅР°СЏ РїСЂРѕС…РѕРґРёРјРѕСЃС‚СЊ.',
  },
  {
    id: 'extrime-toyota',
    slug: 'rosomaha-extrime-toyota',
    name: 'Р РѕСЃРѕРјР°С…Р° Р­РєСЃС‚СЂРёРј Toyota',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 2050000,
    priceFormatted: 'РѕС‚ 2 050 000 в‚Ѕ',
    available: true,
    badge: 'recommended',
    image: '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
    images: [
      '/upload/resize_cache/iblock/120/2000_2000_140cd750bba9870f18aada2478b24840a/z5q84tbm8djjahtkvda0r4bhba54lk80.png',
      '/upload/iblock/e3f/fp29uetch26r3jkiwceu3b3cs35ebixz.jpg',
      '/upload/resize_cache/iblock/b2e/2000_2000_140cd750bba9870f18aada2478b24840a/xnndhw0nc1bpglasqxv32bxs257lrnld.png',
      '/upload/resize_cache/iblock/fae/2000_2000_140cd750bba9870f18aada2478b24840a/aysdl7kptcorpz8hhyn7b1g2hgkek031.jpg',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ Toyota',
    },
    description: 'РџСЂРµРјРёР°Р»СЊРЅР°СЏ РІРµСЂСЃРёСЏ СЃ РЅР°РґС‘Р¶РЅС‹РјРё СЏРїРѕРЅСЃРєРёРјРё РјРѕСЃС‚Р°РјРё Toyota РґР»СЏ РјР°РєСЃРёРјР°Р»СЊРЅРѕР№ РЅР°РґС‘Р¶РЅРѕСЃС‚Рё.',
  },
  {
    id: 'extrime-plus',
    slug: 'rosomaha-extrime-plus',
    name: 'Р РѕСЃРѕРјР°С…Р° Р­РєСЃС‚СЂРёРј РџР›Р®РЎ',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 2150000,
    priceFormatted: 'РѕС‚ 2 150 000 в‚Ѕ',
    available: true,
    badge: 'recommended',
    image: '/upload/iblock/70a/arvm500pi0v2vn6b6cokpewo1tdvxezg.jpg',
    images: [
      '/upload/iblock/70a/arvm500pi0v2vn6b6cokpewo1tdvxezg.jpg',
      '/upload/iblock/7ce/vwc9ic3vmki2q8clnq7a5pysc521wdwq.jpg',
      '/upload/resize_cache/iblock/faf/2000_2000_140cd750bba9870f18aada2478b24840a/28m3tnpgns3u9zszef1yf8j4jq810150.png',
      '/upload/iblock/77b/efojgm3s82rcota0qteh4zwcz85a1hen.jpg',
    ],
    specs: {
      engine: '1.8 Р»РёС‚СЂР°',
      power: '1ZZ-FE',
      axles: 'РњРѕСЃС‚С‹ Toyota',
    },
    description: 'Р¤Р»Р°РіРјР°РЅ Р»РёРЅРµР№РєРё СЃ СѓРІРµР»РёС‡РµРЅРЅС‹Рј РѕР±СЉС‘РјРѕРј РґРІРёРіР°С‚РµР»СЏ 1.8Р» Рё РјРѕСЃС‚Р°РјРё Toyota.',
  },
  {
    id: 'hunter',
    slug: 'rosomaha-hunter',
    name: 'Р РѕСЃРѕРјР°С…Р° РҐР°РЅС‚РµСЂ',
    category: 'classic',
    categoryName: 'РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РјРѕРґРµР»Рё',
    price: 2180000,
    priceFormatted: 'РѕС‚ 2 180 000 в‚Ѕ',
    available: true,
    badge: 'recommended',
    image: '/upload/iblock/312/1t1bjxwj1n1t9xzm95368ulnqngi1ni9.jpg',
    images: [
      '/upload/iblock/312/1t1bjxwj1n1t9xzm95368ulnqngi1ni9.jpg',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ Toyota',
    },
    description: 'РЎРїРµС†РёР°Р»СЊРЅР°СЏ РІРµСЂСЃРёСЏ РґР»СЏ РѕС…РѕС‚РЅРёРєРѕРІ СЃ СѓР»СѓС‡С€РµРЅРЅРѕР№ СЌСЂРіРѕРЅРѕРјРёРєРѕР№ Рё РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹РјРё РєСЂРµРїР»РµРЅРёСЏРјРё.',
  },
  {
    id: 'pickup-uaz-timken',
    slug: 'rosomaha-pickup-uaz-timken',
    name: 'Р РѕСЃРѕРјР°С…Р° РџРёРєР°Рї РЈРђР—',
    category: 'pickup',
    categoryName: 'РџРёРєР°РїС‹',
    price: 1700000,
    priceFormatted: 'РѕС‚ 1 700 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/resize_cache/iblock/a5d/2000_2000_140cd750bba9870f18aada2478b24840a/e1khyqmoxol0idrxmxevqwynbp4uj2c9.jpg',
    images: [
      '/upload/resize_cache/iblock/a5d/2000_2000_140cd750bba9870f18aada2478b24840a/e1khyqmoxol0idrxmxevqwynbp4uj2c9.jpg',
      '/upload/iblock/93d/zccgtq1szppn0768ttat60x0hw3zok0g.jpeg',
      '/upload/iblock/52f/d2tbeda8napwhdsli7hlhuc7izv021dd.jpeg',
      '/upload/iblock/d20/z87tyvu3no34u1qf0l191gauyc37h6ni.jpeg',
    ],
    specs: {
      engine: '1.5 Р»РёС‚СЂР°',
      power: '1NZ-FE',
      axles: 'РњРѕСЃС‚С‹ РЈРђР— РўРёРјРєРµРЅ',
    },
    description: 'Р“СЂСѓР·РѕРІР°СЏ РІРµСЂСЃРёСЏ СЃ РєСѓР·РѕРІРѕРј-РїРёРєР°Рї РґР»СЏ РїРµСЂРµРІРѕР·РєРё СЃРЅР°СЂСЏР¶РµРЅРёСЏ Рё РѕР±РѕСЂСѓРґРѕРІР°РЅРёСЏ.',
  },
  {
    id: 'pickup-uaz-18',
    slug: 'rosomaha-pickup-uaz-18',
    name: 'Р РѕСЃРѕРјР°С…Р° РџРёРєР°Рї 1.8Р»',
    category: 'pickup',
    categoryName: 'РџРёРєР°РїС‹',
    price: 2250000,
    priceFormatted: 'РѕС‚ 2 250 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/iblock/81a/3uqnjip9gcv95gj7z1ccyhp05hxsswof.jpg',
    images: [
      '/upload/iblock/81a/3uqnjip9gcv95gj7z1ccyhp05hxsswof.jpg',
      '/upload/resize_cache/iblock/713/2000_2000_140cd750bba9870f18aada2478b24840a/t12pnerqss6yvqs4tlwwj91pez15j8ta.JPG',
      '/upload/resize_cache/iblock/614/2000_2000_140cd750bba9870f18aada2478b24840a/wg753ye8tuif27epzhkfusfhe3n7em5w.JPG',
      '/upload/resize_cache/iblock/077/2000_2000_140cd750bba9870f18aada2478b24840a/73krjn7rr911s5twz4rdoc4gtx152uts.JPG',
    ],
    specs: {
      engine: '1.8 Р»РёС‚СЂР°',
      power: '1ZZ-FE',
      axles: 'РњРѕСЃС‚С‹ РЈРђР—',
    },
    description: 'РњРѕС‰РЅС‹Р№ РіСЂСѓР·РѕРІРѕР№ РІР°СЂРёР°РЅС‚ СЃ РґРІРёРіР°С‚РµР»РµРј 1.8Р» РґР»СЏ С‚СЏР¶С‘Р»С‹С… РіСЂСѓР·РѕРІ.',
  },
  {
    id: 'pickup-toyota',
    slug: 'rosomaha-pickup-toyota',
    name: 'Р РѕСЃРѕРјР°С…Р° РџРёРєР°Рї Toyota',
    category: 'pickup',
    categoryName: 'РџРёРєР°РїС‹',
    price: 2450000,
    priceFormatted: 'РѕС‚ 2 450 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/iblock/81a/3uqnjip9gcv95gj7z1ccyhp05hxsswof.jpg',
    images: [
      '/upload/iblock/81a/3uqnjip9gcv95gj7z1ccyhp05hxsswof.jpg',
      '/upload/resize_cache/iblock/713/2000_2000_140cd750bba9870f18aada2478b24840a/t12pnerqss6yvqs4tlwwj91pez15j8ta.JPG',
      '/upload/resize_cache/iblock/614/2000_2000_140cd750bba9870f18aada2478b24840a/wg753ye8tuif27epzhkfusfhe3n7em5w.JPG',
      '/upload/resize_cache/iblock/077/2000_2000_140cd750bba9870f18aada2478b24840a/73krjn7rr911s5twz4rdoc4gtx152uts.JPG',
    ],
    specs: {
      engine: '1.8 Р»РёС‚СЂР°',
      power: '1ZZ-FE',
      axles: 'РњРѕСЃС‚С‹ Toyota',
    },
    description: 'РџСЂРµРјРёР°Р»СЊРЅС‹Р№ РїРёРєР°Рї СЃ СЏРїРѕРЅСЃРєРёРјРё РєРѕРјРїРѕРЅРµРЅС‚Р°РјРё РІС‹СЃРѕС‡Р°Р№С€РµРіРѕ РєР°С‡РµСЃС‚РІР°.',
  },
  {
    id: 'sixwheel',
    slug: 'rosomaha-6x6',
    name: 'Р РѕСЃРѕРјР°С…Р° РЁРµСЃС‚РёРєРѕР»С‘СЃРЅРёРє',
    category: 'sixwheel',
    categoryName: 'РЁРµСЃС‚РёРєРѕР»С‘СЃРЅРёРєРё',
    price: 3100000,
    priceFormatted: 'РѕС‚ 3 100 000 в‚Ѕ',
    available: true,
    badge: 'new',
    image: '/upload/iblock/8ad/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
    images: [
      '/upload/iblock/8ad/d1941o3udkjzz13273pwepp2ddi6yj5m.jpg',
      '/upload/iblock/5cc/01om1mb8m92zoz574ws1oebyfopcqjm0.jpg',
      '/upload/iblock/b83/nq2aurtz4wwmbj5tezo3y1sblucbivo9.jpg',
      '/upload/iblock/95f/10w5enpf5nujwdm1mdig9sd2643kf9cl.jpg',
      '/upload/iblock/eb1/d54ssc71qb1qow7rg7yhrjr3q9bbohni.jpg',
    ],
    specs: {
      engine: '1.8 Р»РёС‚СЂР°',
      power: '1ZZ-FE',
      axles: 'РњРѕСЃС‚С‹ Toyota',
    },
    description: 'РЁРµСЃС‚СЊ РєРѕР»С‘СЃ = РјР°РєСЃРёРјР°Р»СЊРЅР°СЏ РїСЂРѕС…РѕРґРёРјРѕСЃС‚СЊ. Р”Р»СЏ СЃР°РјС‹С… СЃР»РѕР¶РЅС‹С… РјР°СЂС€СЂСѓС‚РѕРІ Рё С‚СЏР¶С‘Р»С‹С… РіСЂСѓР·РѕРІ.',
  },
  {
    id: 'trailer',
    slug: 'rosomaha-trailer',
    name: 'РџСЂРёС†РµРї РїР»Р°РІР°СЋС‰РёР№',
    category: 'trailer',
    categoryName: 'РџСЂРёС†РµРїС‹',
    price: 200000,
    priceFormatted: '200 000 в‚Ѕ',
    available: true,
    image: '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    images: [
      '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    specs: {
      engine: '-',
      power: '-',
      axles: 'РќР° РѕР±РѕРґРёСЂС‹С€Р°С…',
    },
    description: 'РџР»Р°РІР°СЋС‰РёР№ РїСЂРёС†РµРї РґР»СЏ РїРµСЂРµРІРѕР·РєРё РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕРіРѕ РіСЂСѓР·Р° РїРѕ Р»СЋР±РѕР№ РјРµСЃС‚РЅРѕСЃС‚Рё.',
  },
];

export const dealers: Dealer[] = [
  {
    id: 'factory',
    region: 'РўСЋРјРµРЅСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'Рї. РњРѕСЃРєРѕРІСЃРєРёР№',
    address: 'СѓР». Р‘СѓСЂР»Р°РєРё 29Р’',
    phone: '+7 (922) 071 11-74',
    phone2: '+7 (3452) 564-164',
    workHours: 'РџРЅ-РџС‚ СЃ 9:00 РґРѕ 18:00',
    coordinates: { lat: 57.1058, lng: 68.1231 },
  },
  {
    id: 'tyumen-club',
    region: 'РўСЋРјРµРЅСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'РўСЋРјРµРЅСЊ',
    address: 'РљРёРїР°СЂРёСЃРѕРІС‹Р№ РїСЂРѕРµР·Рґ, 12',
    phone: '+7 (952) 678-66-66',
    email: 'rosomaha_club@icloud.com',
    website: 'https://www.rosomaha-club.ru',
    workHours: 'РџРЅ-РџС‚ СЃ 9:00 РґРѕ 18:00',
    coordinates: { lat: 57.1522, lng: 68.2583 },
  },
  {
    id: 'barnaul',
    region: 'РђР»С‚Р°Р№СЃРєРёР№ РєСЂР°Р№',
    city: 'Р‘Р°СЂРЅР°СѓР»',
    address: 'СѓР». РџР°РІР»РѕРІСЃРєРёР№ С‚СЂР°РєС‚, 52',
    phone: '+7 (3852) 205-596',
    workHours: 'РџРЅ-Р§С‚: 08:00-21:00, РџС‚-РЎР±: 10:00-18:00',
    coordinates: { lat: 53.3547, lng: 83.7697 },
  },
  {
    id: 'blagoveshchensk',
    region: 'РђРјСѓСЂСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'Р‘Р»Р°РіРѕРІРµС‰РµРЅСЃРє',
    address: 'СѓР». РџСЂРѕРјС‹С€Р»РµРЅРЅР°СЏ, 10',
    phone: '+7 (962) 284-81-55',
    workHours: 'РџРЅ-РџС‚: 08:00-21:00',
    coordinates: { lat: 50.2905, lng: 127.5272 },
  },
  {
    id: 'krasnoyarsk',
    region: 'РљСЂР°СЃРЅРѕСЏСЂСЃРєРёР№ РєСЂР°Р№',
    city: 'РљСЂР°СЃРЅРѕСЏСЂСЃРє',
    address: 'СѓР». Р‘СЂСЏРЅСЃРєР°СЏ, 11',
    phone: '+7 (913) 181-91-97',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 56.0097, lng: 92.8525 },
  },
  {
    id: 'murmansk',
    region: 'РњСѓСЂРјР°РЅСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'РњСѓСЂРјР°РЅСЃРє',
    address: 'Р’РµСЂС…РЅРµ-Р РѕСЃС‚РёРЅСЃРєРѕРµ С€РѕСЃСЃРµ, Рґ. 55Рђ',
    phone: '+7 (8152) 24-50-40',
    workHours: 'РџРЅ-РџС‚: 08:00-21:00',
    coordinates: { lat: 68.9730, lng: 33.0945 },
  },
  {
    id: 'perm',
    region: 'РџРµСЂРјСЃРєРёР№ РєСЂР°Р№',
    city: 'РџРµСЂРјСЊ',
    address: 'СѓР». Р‘РѕСЂС†РѕРІ Р РµРІРѕР»СЋС†РёРё, 154',
    phone: '+7 (342) 257-69-69',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 58.0297, lng: 56.2668 },
  },
  {
    id: 'ufa',
    region: 'Р РµСЃРїСѓР±Р»РёРєР° Р‘Р°С€РєРѕСЂС‚РѕСЃС‚Р°РЅ',
    city: 'РЈС„Р°',
    address: 'Рї. Р—РёРЅРёРЅРѕ, СѓР». РџСЂРёРіРѕСЂРѕРґРЅР°СЏ, 55, РўРљ "РљР°СЂР°РІР°РЅ"',
    phone: '+7 (905) 181-42-22',
    website: 'http://aktivniy-otdyh.com/',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 54.7388, lng: 55.9721 },
  },
  {
    id: 'ekaterinburg',
    region: 'РЎРІРµСЂРґР»РѕРІСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'Р•РєР°С‚РµСЂРёРЅР±СѓСЂРі',
    address: 'Р•РєР°С‚РµСЂРёРЅР±СѓСЂРі',
    phone: '+7 (343) 000-00-00',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 56.8389, lng: 60.6057 },
  },
  {
    id: 'chelyabinsk',
    region: 'Р§РµР»СЏР±РёРЅСЃРєР°СЏ РѕР±Р»Р°СЃС‚СЊ',
    city: 'Р§РµР»СЏР±РёРЅСЃРє',
    address: 'Р§РµР»СЏР±РёРЅСЃРє',
    phone: '+7 (351) 000-00-00',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 55.1644, lng: 61.4368 },
  },
  {
    id: 'salekhard',
    region: 'РЇРјР°Р»Рѕ-РќРµРЅРµС†РєРёР№ РђРћ',
    city: 'РЎР°Р»РµС…Р°СЂРґ',
    address: 'РЎР°Р»РµС…Р°СЂРґ',
    phone: '+7 (34922) 0-00-00',
    workHours: 'РџРЅ-РџС‚: 9:00-18:00',
    coordinates: { lat: 66.5300, lng: 66.6019 },
  },
];

export const accessories = [
  {
    id: 'tire-bagira',
    name: 'РЁРёРЅР° "Р‘Р°РіРёСЂР°" (1200 С… 530)',
    category: 'РЁРёРЅС‹',
    price: 60000,
    priceFormatted: '60 000 в‚Ѕ',
    available: true,
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-max',
    name: 'РЁРёРЅР° AVTOROS MAX-TRIM (1300 С… 700)',
    category: 'РЁРёРЅС‹',
    price: 70300,
    priceFormatted: '70 300 в‚Ѕ',
    available: true,
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-mx',
    name: 'РЁРёРЅР° AVTOROS MX-PLUS (1130 С… 530)',
    category: 'РЁРёРЅС‹',
    price: 55900,
    priceFormatted: '55 900 в‚Ѕ',
    available: true,
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'tire-avtoros-xtrim',
    name: 'РЁРёРЅР° AVTOROS X-TRIM (1200 С… 600)',
    category: 'РЁРёРЅС‹',
    price: 59700,
    priceFormatted: '59 700 в‚Ѕ',
    available: true,
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
];
