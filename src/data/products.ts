// Р В Р В°РЎРѓРЎв‚¬Р С‘РЎР‚Р ВµР Р…Р Р…Р В°РЎРЏ Р СР С•Р Т‘Р ВµР В»РЎРЉ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ РЎвЂљР С•Р Р†Р В°РЎР‚Р С•Р Р† РЎРѓ РЎР‚Р ВµР В°Р В»РЎРЉР Р…РЎвЂ№Р СР С‘ URL Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘Р в„– РЎРѓ 
// Р вЂєР С•Р С”Р В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ Р Т‘Р В»РЎРЏ Р вЂўР С–Р ВµРЎР‚РЎРЉ-1
import eger1Ral6003 from '@/assets/eger1-ral6003.jpg';
import eger1Ral7006 from '@/assets/eger1-ral7006.png';
import eger1Ral7022 from '@/assets/eger1-ral7022.png';
import eger1Ral8011 from '@/assets/eger1-ral8011.png';
import eger1Ral9010 from '@/assets/eger1-ral9010.png';

// Р вЂєР С•Р С”Р В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ Р Т‘Р В»РЎРЏ Р Р…Р С•Р Р†РЎвЂ№РЎвЂ¦ Р СР С•Р Т‘Р ВµР В»Р ВµР в„–
import modelPikapUaz from '@/assets/model-pikap-uaz.png';
import modelExtrimePlus from '@/assets/model-extrime-plus.png';
import modelHunter from '@/assets/model-hunter.jpg';
import modelRosomaha from '@/assets/model-rosomaha.jpg';
import modelPikap18l from '@/assets/model-pikap-18l.jpg';
import modelPikapToyota from '@/assets/model-pikap-toyota.jpg';

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

// Р С›Р В±РЎвЂ°Р С‘Р Вµ РЎвЂ Р Р†Р ВµРЎвЂљР В° Р Т‘Р В»РЎРЏ Р Р†РЎРѓР ВµРЎвЂ¦ Р СР С•Р Т‘Р ВµР В»Р ВµР в„– РЎРѓ Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏР СР С‘ Р С—Р С• РЎвЂ Р Р†Р ВµРЎвЂљР В°Р С (Р С–Р Т‘Р Вµ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№)
export const productColors: ProductColor[] = [
  { id: 'ral9010', name: 'Р вЂР ВµР В»РЎвЂ№Р в„–', ral: 'RAL 9010', hex: '#FFFFFF', image: '/upload/iblock/6ae/i7jt7ecrr6795jhqg6g0w5s005hwt23p.png' },
  { id: 'ral1002', name: 'Р СџР ВµРЎРѓР С•РЎвЂЎР Р…Р С•-Р В¶РЎвЂР В»РЎвЂљРЎвЂ№Р в„–', ral: 'RAL 1002', hex: '#D2AA6D', image: '/upload/iblock/d89/nnokema0bo8wqr01voblq294xo0wnxhp.jpg' },
  { id: 'ral2000', name: 'Р вЂ“РЎвЂР В»РЎвЂљР С•-Р С•РЎР‚Р В°Р Р…Р В¶Р ВµР Р†РЎвЂ№Р в„–', ral: 'RAL 2000', hex: '#ED760E', image: '/upload/iblock/f23/fsjwurbhdxokiwtt4e2hraykou0lge5y.png' },
  { id: 'ral3020', name: 'Р СћРЎР‚Р В°Р Р…РЎРѓР С—Р С•РЎР‚РЎвЂљР Р…РЎвЂ№Р в„– Р С”РЎР‚Р В°РЎРѓР Р…РЎвЂ№Р в„–', ral: 'RAL 3020', hex: '#CC0605', image: '/upload/iblock/7ce/vwc9ic3vmki2q8clnq7a5pysc521wdwq.jpg' },
  { id: 'ral5013', name: 'Р С™Р С•Р В±Р В°Р В»РЎРЉРЎвЂљР С•Р Р†Р С•-РЎРѓР С‘Р Р…Р С‘Р в„–', ral: 'RAL 5013', hex: '#1E3A5F', image: '/upload/iblock/b74/sz19nfyhxbosqgkzpowvtkctdo5kf2s1.png' },
  { id: 'ral5005', name: 'Р РЋР С‘Р С–Р Р…Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– РЎРѓР С‘Р Р…Р С‘Р в„–', ral: 'RAL 5005', hex: '#005387', image: '/upload/iblock/789/z7wy86u7zyxjearnfvy5kocknb8bmca4.jpg' },
  { id: 'ral7022', name: 'Р РЋР ВµРЎР‚Р В°РЎРЏ Р Р€Р СР В±РЎР‚Р В°', ral: 'RAL 7022', hex: '#4C4A44', image: '/upload/iblock/826/ovggeu8n6wz3ar4wn2jci2hmxxqrsk1n.png' },
  { id: 'ral7006', name: 'Р вЂР ВµР В¶Р ВµР Р†Р С•-РЎРѓР ВµРЎР‚РЎвЂ№Р в„–', ral: 'RAL 7006', hex: '#756F61', image: '/upload/iblock/234/f4dow1nnjv0d03zowcy979eqv7gjcp3i.png' },
  { id: 'ral6003', name: 'Р С›Р В»Р С‘Р Р†Р С”Р С•Р Р†Р С•-Р В·Р ВµР В»Р ВµР Р…РЎвЂ№Р в„–', ral: 'RAL 6003', hex: '#4C5D3D', image: '/upload/iblock/706/56r6ct71hj93r3wy4j0gllvo0fcykc6z.jpg' },
  { id: 'ral7013', name: 'Р С™Р С•РЎР‚Р С‘РЎвЂЎР Р…Р ВµР Р†Р С•-РЎРѓР ВµРЎР‚РЎвЂ№Р в„–', ral: 'RAL 7013', hex: '#575044', image: '/upload/iblock/190/1blxzkyg24rzxojpycxgiq6xanlste1p.png' },
  { id: 'ral8011', name: 'Р С›РЎР‚Р ВµРЎвЂ¦Р С•Р Р†Р С•-Р С”Р С•РЎР‚Р С‘РЎвЂЎР Р…Р ВµР Р†РЎвЂ№Р в„–', ral: 'RAL 8011', hex: '#5A3D30', image: '/upload/iblock/70a/arvm500pi0v2vn6b6cokpewo1tdvxezg.jpg' },
  { id: 'ral9011', name: 'Р вЂњРЎР‚Р В°РЎвЂћР С‘РЎвЂљР Р…Р С•-РЎвЂЎРЎвЂРЎР‚Р Р…РЎвЂ№Р в„–', ral: 'RAL 9011', hex: '#27292B', image: '/upload/iblock/120/z5q84tbm8djjahtkvda0r4bhba54lk80.png' },
];

// Р вЂќР В»РЎРЏ Р вЂўР С–Р ВµРЎР‚РЎРЉ-1 Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·РЎС“Р ВµР С Р В»Р С•Р С”Р В°Р В»РЎРЉР Р…Р С• РЎРѓР С”Р В°РЎвЂЎР В°Р Р…Р Р…РЎвЂ№Р Вµ Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ.
const eger1Colors: ProductColor[] = [
  { id: 'ral6003', name: 'Р С›Р В»Р С‘Р Р†Р С”Р С•Р Р†Р С•-Р В·Р ВµР В»Р ВµР Р…РЎвЂ№Р в„–', ral: 'RAL 6003', hex: '#4A5240', image: eger1Ral6003 },
  { id: 'ral7006', name: 'Р вЂР ВµР В¶Р ВµР Р†Р С•-РЎРѓР ВµРЎР‚РЎвЂ№Р в„–', ral: 'RAL 7006', hex: '#756F61', image: eger1Ral7006 },
  // Р В­РЎвЂљР С‘ РЎвЂ Р Р†Р ВµРЎвЂљР В° РЎР‚Р В°Р Р…Р ВµР Вµ Р В±РЎвЂ№Р В»Р С‘ РЎРѓ Р С•Р Т‘Р Р…Р С•Р в„– Р С‘ РЎвЂљР С•Р в„– Р В¶Р Вµ Р В·Р В°Р С–Р В»РЎС“РЎв‚¬Р С”Р С•Р в„– РІР‚вЂќ Р Т‘Р В°РЎвЂР С Р С”Р В°Р В¶Р Т‘Р С•Р СРЎС“ РЎРѓР Р†Р С•Р в„– Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С” Р С‘Р В·Р С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ,
  // РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р С—РЎР‚Р С‘ Р Р†РЎвЂ№Р В±Р С•РЎР‚Р Вµ РЎвЂ Р Р†Р ВµРЎвЂљР В° Р СР ВµР Р…РЎРЏР В»Р В°РЎРѓРЎРЉ РЎвЂћР С•РЎвЂљР С•Р С–РЎР‚Р В°РЎвЂћР С‘РЎРЏ.
  { id: 'ral7013', name: 'Р С™Р С•РЎР‚Р С‘РЎвЂЎР Р…Р ВµР Р†Р С•-РЎРѓР ВµРЎР‚РЎвЂ№Р в„–', ral: 'RAL 7013', hex: '#575044', image: productColors.find(c => c.id === 'ral7013')?.image },
  { id: 'ral7022', name: 'Р РЋР ВµРЎР‚Р В°РЎРЏ РЎС“Р СР В±РЎР‚Р В°', ral: 'RAL 7022', hex: '#4B4D46', image: eger1Ral7022 },
  { id: 'ral8011', name: 'Р С›РЎР‚Р ВµРЎвЂ¦Р С•Р Р†Р С•-Р С”Р С•РЎР‚Р С‘РЎвЂЎР Р…Р ВµР Р†РЎвЂ№Р в„–', ral: 'RAL 8011', hex: '#5A3826', image: eger1Ral8011 },
  { id: 'ral9010', name: 'Р вЂР ВµР В»РЎвЂ№Р в„–', ral: 'RAL 9010', hex: '#FFFFFF', image: eger1Ral9010 },
  { id: 'ral9011', name: 'Р вЂњРЎР‚Р В°РЎвЂћР С‘РЎвЂљР Р…Р С•-РЎвЂЎРЎвЂРЎР‚Р Р…РЎвЂ№Р в„–', ral: 'RAL 9011', hex: '#27292B', image: productColors.find(c => c.id === 'ral9011')?.image },
  { id: 'ral1002', name: 'Р СџР ВµРЎРѓР С•РЎвЂЎР Р…Р С•-Р В¶РЎвЂР В»РЎвЂљРЎвЂ№Р в„–', ral: 'RAL 1002', hex: '#D2AA6D', image: productColors.find(c => c.id === 'ral1002')?.image },
  { id: 'ral2000', name: 'Р вЂ“РЎвЂР В»РЎвЂљР С•-Р С•РЎР‚Р В°Р Р…Р В¶Р ВµР Р†РЎвЂ№Р в„–', ral: 'RAL 2000', hex: '#DD7907', image: productColors.find(c => c.id === 'ral2000')?.image },
  { id: 'ral3020', name: 'Р С™РЎР‚Р В°РЎРѓР Р…РЎвЂ№Р в„– Р Р…Р В°РЎРѓРЎвЂ№РЎвЂ°Р ВµР Р…Р Р…РЎвЂ№Р в„–', ral: 'RAL 3020', hex: '#C1121C', image: productColors.find(c => c.id === 'ral3020')?.image },
  { id: 'ral5013', name: 'Р С™Р С•Р В±Р В°Р В»РЎРЉРЎвЂљР С•Р Р†Р С•-РЎРѓР С‘Р Р…Р С‘Р в„–', ral: 'RAL 5013', hex: '#232C3F', image: productColors.find(c => c.id === 'ral5013')?.image },
  { id: 'ral5005', name: 'Р РЋР С‘Р С–Р Р…Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– РЎРѓР С‘Р Р…Р С‘Р в„–', ral: 'RAL 5005', hex: '#005387', image: productColors.find(c => c.id === 'ral5005')?.image },
];

// Р вЂ™Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљРЎвЂ№ Р С”Р С•Р СР С—Р В»Р ВµР С”РЎвЂљР В°РЎвЂ Р С‘Р в„– (Р С•Р Т‘Р С‘Р Р…Р В°Р С”Р С•Р Р†РЎвЂ№Р Вµ Р Т‘Р В»РЎРЏ Р С”Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘РЎвЂ¦ Р СР С•Р Т‘Р ВµР В»Р ВµР в„–)
export const classicVariants: ProductVariant[] = [
  { id: 'eger-1', name: 'Р вЂўР С–Р ВµРЎР‚РЎРЉ-1 (Р вЂ™Р С•Р В»Р С–Р В°)', slug: 'rosomakha-model-eger-1-dvs-30-l-s-s-mostami-volga-', price: 850000, priceFormatted: 'Р С•РЎвЂљ 850 000 РІвЂљР…' },
  { id: 'standart-plus-suzuki', name: 'Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (Suzuki)', slug: 'standart-plus-1-5-litra', price: 1300000, priceFormatted: 'Р С•РЎвЂљ 1 300 000 РІвЂљР…' },
  { id: 'extrime-uaz', name: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (Р Р€Р С’Р вЂ”)', slug: 'extrime-s-1-5l-dvs-1nz-fe', price: 1800000, priceFormatted: 'Р С•РЎвЂљ 1 800 000 РІвЂљР…' },
  { id: 'extrime-toyota', name: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (Toyota)', slug: 'extrime-1-5-litra-mosty-toyota', price: 2050000, priceFormatted: 'Р С•РЎвЂљ 2 050 000 РІвЂљР…' },
  { id: 'extrime-plus-toyota', name: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С Р СџР вЂєР В®Р РЋ (Toyota)', slug: 'extrime-plus-s-1-8l-dvs-1zz-fe', price: 2150000, priceFormatted: 'Р С•РЎвЂљ 2 150 000 РІвЂљР…' },
  { id: 'hunter-toyota', name: 'Р ТђР В°Р Р…РЎвЂљР ВµРЎР‚ (Toyota)', slug: 'hunter-s-1-5l-dvs-1nz-fe', price: 2180000, priceFormatted: 'Р С•РЎвЂљ 2 180 000 РІвЂљР…' },
  { id: 'pickup-uaz-timken', name: 'Р СџР С‘Р С”Р В°Р С— (Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р…)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1nz-fe-1-5-litra-s-mostami-uaz-timken', price: 1700000, priceFormatted: 'Р С•РЎвЂљ 1 700 000 РІвЂљР…' },
  { id: 'standart-plus-uaz', name: 'Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (Р Р€Р С’Р вЂ”)', slug: 'rosomakha-standart-plyus-uaz-timken', price: 1400000, priceFormatted: 'Р С•РЎвЂљ 1 400 000 РІвЂљР…' },
  { id: 'pickup-toyota', name: 'Р СџР С‘Р С”Р В°Р С— (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-pikap-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 2450000, priceFormatted: 'Р С•РЎвЂљ 2 450 000 РІвЂљР…' },
  { id: 'pickup-uaz', name: 'Р СџР С‘Р С”Р В°Р С— (Р Р€Р С’Р вЂ”)', slug: 'snegobolotokhod-rosomakha-pikap-dvs-1-8-litra-uaz', price: 2250000, priceFormatted: 'Р С•РЎвЂљ 2 250 000 РІвЂљР…' },
  { id: 'sixwheel-toyota', name: 'Р РЃР ВµРЎРѓРЎвЂљР С‘Р С”Р С•Р В»РЎвЂРЎРѓР Р…Р С‘Р С” (Toyota)', slug: 'snegobolotokhod-rosomakha-komplektatsiya-shestikolyesnik-s-dvs-1zz-fe-1-8-litra-s-mostami-toyota', price: 3100000, priceFormatted: 'Р С•РЎвЂљ 3 100 000 РІвЂљР…' },
];

// Р вЂќР С•Р С—Р С•Р В»Р Р…Р С‘РЎвЂљР ВµР В»РЎРЉР Р…РЎвЂ№Р Вµ Р С•Р С—РЎвЂ Р С‘Р С‘ (Р С•Р В±РЎвЂ°Р С‘Р Вµ Р Т‘Р В»РЎРЏ Р Р†РЎРѓР ВµРЎвЂ¦ Р СР С•Р Т‘Р ВµР В»Р ВµР в„–)
export const productOptions: ProductOption[] = [
  {
    id: 'trailer',
    name: 'Р СџРЎР‚Р С‘РЎвЂ Р ВµР С— Р С” Р С”Р Р†Р В°Р Т‘РЎР‚Р С•РЎвЂ Р С‘Р С”Р В»РЎС“ Р С—Р В»Р В°Р Р†Р В°РЎР‹РЎвЂ°Р С‘Р в„–',
    price: 200000,
    priceFormatted: '200 000 РІвЂљР…',
    image: '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    specs: { 'Р вЂќР В»Р С‘Р Р…Р В°, Р СР С': '3100', 'Р РЃР С‘РЎР‚Р С‘Р Р…Р В°, Р СР С': '2000', 'Р вЂ™РЎвЂ№РЎРѓР С•РЎвЂљР В°, Р СР С': '1200', 'Р вЂќР С‘Р В°Р СР ВµРЎвЂљРЎР‚ Р С”Р С•Р В»Р ВµРЎРѓ, Р СР С': '1100', 'Р СљР В°РЎРѓРЎРѓР В°, Р С”Р С–': '250' },
  },
  {
    id: 'tires-avtoros',
    name: 'Р РЃР С‘Р Р…РЎвЂ№ Р Р…Р С‘Р В·Р С”Р С•Р С–Р С• Р Т‘Р В°Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ AVTOROS MX-PLUS 2 РЎРѓР В»Р С•РЎРЏ Р С”Р С•РЎР‚Р Т‘Р В° (1130 РЎвЂ¦ 530)',
    price: 150000,
    priceFormatted: '150 000 РІвЂљР…',
    image: '/upload/iblock/73a/cc53t6mbf7qdj7ssciy503lxi4ed075s.jpg',
  },
  {
    id: 'kofr-side-improved',
    name: 'Р вЂР С•Р С”Р С•Р Р†РЎвЂ№Р Вµ Р С”Р С•РЎвЂћРЎР‚РЎвЂ№, РЎС“Р В»РЎС“РЎвЂЎРЎв‚¬Р ВµР Р…Р Р…РЎвЂ№Р Вµ 2 РЎв‚¬РЎвЂљ.',
    price: 18000,
    priceFormatted: '18 000 РІвЂљР…',
    image: '/upload/iblock/c50/fdwrdsctw6aswo2qi74zw1jias3yn937.jpg',
  },
  {
    id: 'kofr-side-standard',
    name: 'Р вЂР С•Р С”Р С•Р Р†РЎвЂ№Р Вµ Р С”Р С•РЎвЂћРЎР‚РЎвЂ№, РЎРѓРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљР Р…РЎвЂ№Р Вµ 2 РЎв‚¬РЎвЂљ',
    price: 10000,
    priceFormatted: '10 000 РІвЂљР…',
    image: '/upload/iblock/12c/80nurbxxkbqyyb7380hfr0aj7bas1jn1.jpg',
  },
  {
    id: 'kofr-front',
    name: 'Р СџР ВµРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р С”Р С•РЎвЂћРЎР‚, РЎвЂљР С”Р В°Р Р…Р ВµР Р†РЎвЂ№Р в„–',
    price: 25000,
    priceFormatted: '25 000 РІвЂљР…',
    image: '/upload/iblock/a43/hofkcng7ypdnp1tqedud338ms38w6uyp.jpg',
  },
  {
    id: 'kofr-rear-fabric',
    name: 'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р С”Р С•РЎвЂћРЎР‚, РЎвЂљР С”Р В°Р Р…Р ВµР Р†РЎвЂ№Р в„– (Р С”Р В°РЎР‚Р С”Р В°РЎРѓР Р…РЎвЂ№Р в„–)',
    price: 35000,
    priceFormatted: '35 000 РІвЂљР…',
    image: '/upload/iblock/197/nciwzbl48bhvyrsg7n5sk4bibq5kot2i.jpg',
  },
  {
    id: 'kofr-rear-plastic',
    name: 'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р С”Р С•РЎвЂћРЎР‚, Р С—Р В»Р В°РЎРѓРЎвЂљР С‘Р С”Р С•Р Р†РЎвЂ№Р в„–',
    price: 45000,
    priceFormatted: '45 000 РІвЂљР…',
    image: '/upload/iblock/910/e3qm3pj32vuxuvh2f25pbkgg0y016yxx.jpg',
  },
  {
    id: 'kofr-rear-triple',
    name: 'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р С”Р С•РЎвЂћРЎР‚, Р С—Р В»Р В°РЎРѓРЎвЂљР С‘Р С”Р С•Р Р†РЎвЂ№Р в„– РЎвЂљРЎР‚Р ВµРЎвЂ¦РЎРѓР ВµР С”РЎвЂ Р С‘Р С•Р Р…Р Р…РЎвЂ№Р в„– Р РЋР СћР С’Р СњР вЂќР С’Р В Р Сћ',
    price: 60000,
    priceFormatted: '60 000 РІвЂљР…',
    image: '/upload/iblock/5e6/x1t4q7uc0g75g3n4a1olnckzge8uiy0k.jpg',
  },
  {
    id: 'frame-tent',
    name: 'Р С™Р В°РЎР‚Р С”Р В°РЎРѓ Р СР ВµРЎвЂљР В°Р В»Р В»Р С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р в„– РЎРѓ РЎвЂљР ВµР Р…РЎвЂљР С•Р С',
    price: 40000,
    priceFormatted: '40 000 РІвЂљР…',
    image: '/upload/iblock/b26/kijowx7q1w6zpsx2m1z5f906j40hqeme.jpeg',
  },
  {
    id: 'winch-stationary',
    name: 'Р В­Р В»Р ВµР С”РЎвЂљРЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р В»Р ВµР В±Р ВµР Т‘Р С”Р В° РЎРѓРЎвЂљР В°РЎвЂ Р С‘Р С•Р Р…Р В°РЎР‚Р Р…Р В°РЎРЏ',
    price: 55000,
    priceFormatted: '55 000 РІвЂљР…',
    image: '/upload/iblock/9fe/bayhb19qeymuxd0hmxti9mhla61b4udw.jpg',
    specs: { 'Р СћРЎРЏР С–Р С•Р Р†Р С•Р Вµ РЎС“РЎРѓР С‘Р В»Р С‘Р Вµ (lbs)': '5000' },
  },
  {
    id: 'winch-removable',
    name: 'Р В­Р В»Р ВµР С”РЎвЂљРЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р В»Р ВµР В±Р ВµР Т‘Р С”Р В° РЎРѓРЎР‰Р ВµР СР Р…Р В°РЎРЏ',
    price: 70000,
    priceFormatted: '70 000 РІвЂљР…',
    image: '/upload/iblock/21e/cpk6xegjud7wodvxpbsy5tbj8wpe4y4c.jpg',
    specs: { 'Р СћРЎРЏР С–Р С•Р Р†Р С•Р Вµ РЎС“РЎРѓР С‘Р В»Р С‘Р Вµ (lbs)': '5000' },
  },
  {
    id: 'light-bar',
    name: 'Р вЂР В°Р В»Р С”Р В° Р Т‘Р С•Р С—Р С•Р В»Р Р…Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р С•Р С–Р С• РЎРѓР Р†Р ВµРЎвЂљР В° Р РЋР Р†Р ВµРЎвЂљР С•Р Т‘Р С‘Р С•Р Т‘Р Р…Р В°РЎРЏ',
    price: 8000,
    priceFormatted: '8 000 РІвЂљР…',
    image: '/upload/iblock/b92/wa1abwd0kc4f1gqfp4aj4fnzz1ubbaep.jpg',
  },
  {
    id: 'canister-double',
    name: 'Р вЂќР Р†Р Вµ Р С”Р В°Р Р…Р С‘РЎРѓРЎвЂљРЎР‚РЎвЂ№ Р Т‘Р В»РЎРЏ РЎвЂљР С•Р С—Р В»Р С‘Р Р†Р В°',
    price: 12000,
    priceFormatted: '12 000 РІвЂљР…',
    image: '/upload/iblock/8ac/cj20b0jb0fw3rgay1cvbwyc4xgxzkyds.jpg',
  },
  {
    id: 'canister-single',
    name: 'Р С™Р В°Р Р…Р С‘РЎРѓРЎвЂљРЎР‚Р В° Р Т‘Р В»РЎРЏ РЎвЂљР С•Р С—Р В»Р С‘Р Р†Р В°',
    price: 6000,
    priceFormatted: '6 000 РІвЂљР…',
    image: '/upload/iblock/a5d/dd14qzhphippeaw3mg8jj2a203y38d6i.jpg',
  },
  {
    id: 'seat-heat-driver',
    name: 'Р СџР С•Р Т‘Р С•Р С–РЎР‚Р ВµР Р† РЎРѓР С‘Р Т‘Р ВµР Р…Р С‘РЎРЏ (Р Р†Р С•Р Т‘Р С‘РЎвЂљР ВµР В»РЎРЉ)',
    price: 5000,
    priceFormatted: '5 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'seat-heat-both',
    name: 'Р СџР С•Р Т‘Р С•Р С–РЎР‚Р ВµР Р† РЎРѓР С‘Р Т‘Р ВµР Р…Р С‘РЎРЏ (Р Р†Р С•Р Т‘Р С‘РЎвЂљР ВµР В»РЎРЉ+Р С—Р В°РЎРѓРЎРѓР В°Р В¶Р С‘РЎР‚)',
    price: 10000,
    priceFormatted: '10 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'radiator-mount',
    name: 'Р вЂ™РЎвЂ№Р Р…Р С•РЎРѓ РЎР‚Р В°Р Т‘Р С‘Р В°РЎвЂљР С•РЎР‚Р В° "Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В°"',
    price: 75000,
    priceFormatted: '75 000 РІвЂљР…',
    image: '/upload/iblock/ece/h99bsb6jra5a4nh3wzhegfop04df8f3e.jpg',
  },
  {
    id: 'akpp-cooling',
    name: 'Р вЂќР С•Р С— Р С•РЎвЂ¦Р В»Р В°Р В¶Р Т‘Р ВµР Р…Р С‘Р Вµ Р С’Р С™Р СџР Сџ',
    price: 18000,
    priceFormatted: '18 000 РІвЂљР…',
    image: '/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'gur-cooling',
    name: 'Р вЂќР С•Р С— Р С•РЎвЂ¦Р В»Р В°Р В¶Р Т‘Р ВµР Р…Р С‘Р Вµ Р вЂњР Р€Р В ',
    price: 18000,
    priceFormatted: '18 000 РІвЂљР…',
    image: '/upload/iblock/0a5/0z38620otpd4t8z8j80p3cdd6vxu6pfe.jpg',
  },
  {
    id: 'pnevmo-lock-both',
    name: 'Р С™Р С•Р СР С—Р В»Р ВµР С”РЎвЂљ Р С—Р Р…Р ВµР Р†Р СР С• Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С•Р С” Р Р…Р В° Р С•Р В±Р В° Р СР С•РЎРѓРЎвЂљР В°',
    price: 130000,
    priceFormatted: '130 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'pnevmo-lock-one',
    name: 'Р С™Р С•Р СР С—Р В»Р ВµР С”РЎвЂљ Р С—Р Р…Р ВµР Р†Р СР С• Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С•Р С” Р Р…Р В° Р С•Р Т‘Р С‘Р Р… Р СР С•РЎРѓРЎвЂљ',
    price: 65000,
    priceFormatted: '65 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'electric-lock-both',
    name: 'Р В­Р В»Р ВµР С”РЎвЂљРЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р В° Р Т‘Р С‘РЎвЂћРЎвЂћР ВµРЎР‚Р ВµР Р…РЎвЂ Р С‘Р В°Р В»Р В° Р Р…Р В° Р С•Р В±Р В° Р СР С•РЎРѓРЎвЂљР В°',
    price: 130000,
    priceFormatted: '130 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'electric-lock-rear',
    name: 'Р В­Р В»Р ВµР С”РЎвЂљРЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р В° Р Т‘Р С‘РЎвЂћРЎвЂћР ВµРЎР‚Р ВµР Р…РЎвЂ Р С‘Р В°Р В»Р В° Р В·Р В°Р Т‘Р Р…Р ВµР С–Р С• Р СР С•РЎРѓРЎвЂљР В°',
    price: 65000,
    priceFormatted: '65 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'mech-lock-rear',
    name: 'Р СљР ВµРЎвЂ¦Р В°Р Р…Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ РЎРѓР В°Р СР С•Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р С”Р В° Р Т‘Р С‘РЎвЂћРЎвЂћР ВµРЎР‚Р ВµР Р…РЎвЂ Р С‘Р В°Р В»Р В° Р В·Р В°Р Т‘Р Р…Р ВµР С–Р С• Р СР С•РЎРѓРЎвЂљР В° Р ВР вЂ“ Р СћР ВµРЎвЂ¦Р Р…Р С•',
    price: 40000,
    priceFormatted: '40 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'tent-parking',
    name: 'Р СћР ВµР Р…РЎвЂљ РЎРѓРЎвЂљР С•РЎРЏР Р…Р С•РЎвЂЎР Р…РЎвЂ№Р в„–',
    price: 15000,
    priceFormatted: '15 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'zip',
    name: 'Р вЂ”Р ВР Сџ (Р В·Р В°Р С—Р В°РЎРѓР Р…РЎвЂ№Р Вµ Р С‘Р Р…РЎРѓРЎвЂљРЎР‚РЎС“Р СР ВµР Р…РЎвЂљРЎвЂ№)',
    price: 15000,
    priceFormatted: '15 000 РІвЂљР…',
    image: '',
  },
  {
    id: 'preheater',
    name: 'Р СџРЎР‚Р ВµР Т‘Р С—РЎС“РЎРѓР С”Р С•Р Р†Р С•Р в„– Р С—Р С•Р Т‘Р С•Р С–РЎР‚Р ВµР Р†Р В°РЎвЂљР ВµР В»РЎРЉ Р Т‘Р Р†Р С‘Р С–Р В°РЎвЂљР ВµР В»РЎРЏ (DEFA 220Р Р†)',
    price: 40000,
    priceFormatted: '40 000 РІвЂљР…',
    image: '/upload/iblock/bad/dc2ed65nh5dpcg7addo1v1trgt09a4w6.jpg',
  },
  {
    id: 'manometer',
    name: 'Р СљР В°Р Р…Р С•Р СР ВµРЎвЂљРЎР‚',
    price: 6000,
    priceFormatted: '6 000 РІвЂљР…',
    image: '/upload/iblock/858/iuwj1dppx60g7390cceyee07xd157l7u.jpg',
  },
  {
    id: 'gun-mount',
    name: 'Р С™РЎР‚Р ВµР С—Р В»Р ВµР Р…Р С‘Р Вµ Р С—Р С•Р Т‘ РЎР‚РЎС“Р В¶РЎРЉР Вµ (Р С”Р С•Р СР С—Р В»Р ВµР С”РЎвЂљ 2 РЎв‚¬РЎвЂљ.)',
    price: 9000,
    priceFormatted: '9 000 РІвЂљР…',
    image: '/upload/iblock/29e/11x5w160uaq11246cfid0s3h36l8cr9n.jpg',
  },
  {
    id: 'mudguards',
    name: 'Р вЂРЎР‚РЎвЂ№Р В·Р С–Р С•Р Р†Р С‘Р С”Р С‘, Р С”Р С•Р СР С—Р В»Р ВµР С”РЎвЂљ 2 РЎв‚¬РЎвЂљ.',
    price: 6000,
    priceFormatted: '6 000 РІвЂљР…',
    image: '/upload/iblock/aa9/lqkaa1rycv0fgeck3px3ef14rbloaqfx.jpg',
  },
  {
    id: 'front-protection',
    name: 'Р вЂ”Р В°РЎвЂ°Р С‘РЎвЂљР В° Р С—Р ВµРЎР‚Р ВµР Т‘Р Р…РЎРЏРЎРЏ Р В°Р В»РЎР‹Р СР С‘Р Р…Р С‘Р ВµР Р†Р В°РЎРЏ',
    price: 20000,
    priceFormatted: '20 000 РІвЂљР…',
    image: '/upload/iblock/48d/uug7xlkn53lquoage0yufljq57f6ve1n.jpg',
  },
];

// Р вЂР В°Р В·Р С•Р Р†Р В°РЎРЏ Р С”Р С•Р СР С—Р В»Р ВµР С”РЎвЂљР В°РЎвЂ Р С‘РЎРЏ Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ
const standardPlusEquipment = [
  'Р РЃР С‘Р Р…РЎвЂ№ Р Р€РЎР‚Р В°Р В» (Р С•Р В±Р Т‘Р С‘РЎР‚РЎвЂ№РЎв‚¬Р С‘ 1100РЎвЂ¦500)',
  'Р В­Р В»Р ВµР С”РЎвЂљРЎР‚Р С•Р Р…Р Р…РЎвЂ№Р в„– Р С—Р В°РЎРѓР С—Р С•РЎР‚РЎвЂљ РЎРѓР В°Р СР С•РЎвЂ¦Р С•Р Т‘Р Р…Р С•Р в„– Р СР В°РЎв‚¬Р С‘Р Р…РЎвЂ№ (Р В­Р СџР РЋР Сљ)',
  'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
  'Р СџР ВµРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
  'Р РЃР В»Р В°Р Р…Р С– Р С—Р С•Р Т‘Р С”Р В°РЎвЂЎР С”Р С‘ Р С”Р С•Р В»Р ВµРЎРѓ',
  'Р В РЎС“РЎвЂЎР С”Р С‘ РЎР‚РЎС“Р В»РЎРЏ РЎРѓ Р С—Р С•Р Т‘Р С•Р С–РЎР‚Р ВµР Р†Р С•Р С',
  'Р С™РЎС“РЎР‚Р С•Р С” Р С–Р В°Р В·Р В° РЎРѓ Р С—Р С•Р Т‘Р С•Р С–РЎР‚Р ВµР Р†Р С•Р С',
  'Р В РЎС“РЎвЂЎР С”Р С‘ Р Т‘Р В»РЎРЏ Р С—Р В°РЎРѓРЎРѓР В°Р В¶Р С‘РЎР‚Р В°',
  'Р вЂ™Р ВµРЎвЂљРЎР‚Р С•Р Р†Р С•Р Вµ РЎРѓРЎвЂљР ВµР С”Р В»Р С•',
  'Р вЂ”Р ВµРЎР‚Р С”Р В°Р В»Р С• Р В·Р В°Р Т‘Р Р…Р ВµР С–Р С• Р Р†Р С‘Р Т‘Р В°, 2 РЎв‚¬РЎвЂљ.',
  'Р В Р В°РЎРѓРЎв‚¬Р С‘РЎР‚Р С‘РЎвЂљР ВµР В»Р С‘ Р Т‘Р В»РЎРЏ Р В°РЎР‚Р С•Р С”',
  'Р РЋР Р†Р ВµРЎвЂљР С•РЎвЂљР ВµРЎвЂ¦Р Р…Р С‘Р С”Р В° (РЎвЂћР В°РЎР‚РЎвЂ№ Р В±Р В»Р С‘Р В¶Р Р…Р ВµР С–Р С• РЎРѓР Р†Р ВµРЎвЂљР В°, Р С—Р С•Р Р†Р С•РЎР‚Р С•РЎвЂљРЎвЂ№, РЎвЂћР В°РЎР‚Р В° Р В·Р В°Р Т‘Р Р…Р ВµР С–Р С• РЎвЂ¦Р С•Р Т‘Р В°)',
];

// Р С™Р В°РЎвЂљР В°Р В»Р С•Р С– РЎвЂљР С•Р Р†Р В°РЎР‚Р С•Р Р†
export const products: Product[] = [
  {
    id: 'standart-plus-suzuki',
    slug: 'rosomaha-standart-plus',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (1.5 Р В»Р С‘РЎвЂљРЎР‚Р В°, Р СР С•РЎРѓРЎвЂљРЎвЂ№ Suzuki Jimny)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 1300000,
    priceFormatted: 'Р С•РЎвЂљ 1 300 000 РІвЂљР…',
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
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '700',
      speed: 'Р Т‘Р С• 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Suzuki Jimny',
      configuration: 'Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (Suzuki)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р С›Р С—РЎвЂљР С‘Р СР В°Р В»РЎРЉР Р…Р С•Р Вµ РЎРѓР С•РЎвЂЎР ВµРЎвЂљР В°Р Р…Р С‘Р Вµ РЎвЂ Р ВµР Р…РЎвЂ№ Р С‘ Р Р†Р С•Р В·Р СР С•Р В¶Р Р…Р С•РЎРѓРЎвЂљР ВµР в„–. Р СљР С•РЎРѓРЎвЂљРЎвЂ№ Suzuki Jimny Р С•Р В±Р ВµРЎРѓР С—Р ВµРЎвЂЎР С‘Р Р†Р В°РЎР‹РЎвЂљ Р Р…Р В°Р Т‘РЎвЂР В¶Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С‘ РЎвЂ¦Р С•РЎР‚Р С•РЎв‚¬РЎС“РЎР‹ Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ.',
  },
  {
    id: 'eger-1',
    slug: 'rosomaha-eger-1',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р вЂўР С–Р ВµРЎР‚РЎРЉ-1 (Р вЂќР вЂ™Р РЋ 30 Р В».РЎРѓ., Р СР С•РЎРѓРЎвЂљРЎвЂ№ Р вЂ™Р С•Р В»Р С–Р В°)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 850000,
    priceFormatted: 'Р С•РЎвЂљ 850 000 РІвЂљР…',
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
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '350',
      weight: '650',
      speed: 'Р Т‘Р С• 45',
      engine: 'Р вЂќР вЂ™Р РЋ',
      engineVolume: '653',
      power: '30',
      axles: 'Р СљР С•РЎРѓРЎвЂљРЎвЂ№ Р вЂ™Р С•Р В»Р С–Р В°',
      configuration: 'Р вЂўР С–Р ВµРЎР‚РЎРЉ-1 (Р вЂ™Р С•Р В»Р С–Р В°)',
    },
    baseEquipment: [
      'Р РЃР С‘Р Р…РЎвЂ№ Р Р€РЎР‚Р В°Р В» (Р С•Р В±Р Т‘Р С‘РЎР‚РЎвЂ№РЎв‚¬Р С‘ 1100РЎвЂ¦500)',
      'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
      'Р СџР ВµРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
      'Р вЂ™Р ВµРЎвЂљРЎР‚Р С•Р Р†Р С•Р Вµ РЎРѓРЎвЂљР ВµР С”Р В»Р С•',
      'Р вЂ”Р ВµРЎР‚Р С”Р В°Р В»Р С• Р В·Р В°Р Т‘Р Р…Р ВµР С–Р С• Р Р†Р С‘Р Т‘Р В°, 2 РЎв‚¬РЎвЂљ.',
    ],
    description: 'Р В­Р С”Р С•Р Р…Р С•Р СР С‘РЎвЂЎР Р…РЎвЂ№Р в„– Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљ Р Р…Р В° Р В±Р В°Р В·Р Вµ Р СР С•РЎРѓРЎвЂљР С•Р Р† "Р вЂ™Р С•Р В»Р С–Р В°" РЎРѓ Р Т‘Р Р†Р С‘Р С–Р В°РЎвЂљР ВµР В»Р ВµР С 30 Р В».РЎРѓ. Р ВР Т‘Р ВµР В°Р В»Р ВµР Р… Р Т‘Р В»РЎРЏ Р В»РЎвЂР С–Р С”Р С‘РЎвЂ¦ Р В·Р В°Р Т‘Р В°РЎвЂЎ Р С‘ Р Р…Р В°РЎвЂЎР С‘Р Р…Р В°РЎР‹РЎвЂ°Р С‘РЎвЂ¦ Р С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљР ВµР В»Р ВµР в„–.',
  },
  {
    id: 'standart-plus-uaz',
    slug: 'rosomaha-standart-plus-uaz',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (1.5 Р В»Р С‘РЎвЂљРЎР‚Р В°, Р СР С•РЎРѓРЎвЂљРЎвЂ№ Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р…)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 1400000,
    priceFormatted: 'Р С•РЎвЂљ 1 400 000 РІвЂљР…',
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
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'Р Т‘Р С• 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р…',
      configuration: 'Р РЋРЎвЂљР В°Р Р…Р Т‘Р В°РЎР‚РЎвЂљ Р СџР вЂєР В®Р РЋ (Р Р€Р С’Р вЂ”)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р Р€РЎРѓР С‘Р В»Р ВµР Р…Р Р…Р В°РЎРЏ Р Р†Р ВµРЎР‚РЎРѓР С‘РЎРЏ РЎРѓ Р СР С•РЎРѓРЎвЂљР В°Р СР С‘ Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р… Р Т‘Р В»РЎРЏ РЎРѓР ВµРЎР‚РЎРЉРЎвЂР В·Р Р…РЎвЂ№РЎвЂ¦ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С•Р С” Р С‘ РЎРЊР С”РЎРѓРЎвЂљРЎР‚Р ВµР СР В°Р В»РЎРЉР Р…РЎвЂ№РЎвЂ¦ РЎС“РЎРѓР В»Р С•Р Р†Р С‘Р в„–.',
  },
  {
    id: 'extrime-uaz',
    slug: 'rosomaha-extrime-uaz',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (1.5 Р В»Р С‘РЎвЂљРЎР‚Р В°, Р СР С•РЎРѓРЎвЂљРЎвЂ№ Р Р€Р С’Р вЂ”)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 1800000,
    priceFormatted: 'Р С•РЎвЂљ 1 800 000 РІвЂљР…',
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
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'Р Т‘Р С• 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Р Р€Р С’Р вЂ”',
      configuration: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (Р Р€Р С’Р вЂ”)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р вЂќР В»РЎРЏ РЎвЂљР ВµРЎвЂ¦, Р С”РЎвЂљР С• Р Р…Р Вµ Р С‘РЎвЂ°Р ВµРЎвЂљ Р С”Р С•Р СР С—РЎР‚Р С•Р СР С‘РЎРѓРЎРѓР С•Р Р†. Р Р€РЎРѓР С‘Р В»Р ВµР Р…Р Р…Р В°РЎРЏ РЎР‚Р В°Р СР В°, РЎС“Р В»РЎС“РЎвЂЎРЎв‚¬Р ВµР Р…Р Р…Р В°РЎРЏ Р С—Р С•Р Т‘Р Р†Р ВµРЎРѓР С”Р В°, Р СР В°Р С”РЎРѓР С‘Р СР В°Р В»РЎРЉР Р…Р В°РЎРЏ Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ.',
  },
  {
    id: 'extrime-toyota',
    slug: 'rosomaha-extrime-toyota',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (1.5 Р В»Р С‘РЎвЂљРЎР‚Р В°, Р СР С•РЎРѓРЎвЂљРЎвЂ№ Toyota)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 2050000,
    priceFormatted: 'Р С•РЎвЂљ 2 050 000 РІвЂљР…',
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
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '750',
      speed: 'Р Т‘Р С• 60',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Toyota',
      configuration: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р СџРЎР‚Р ВµР СР С‘Р В°Р В»РЎРЉР Р…Р В°РЎРЏ Р Р†Р ВµРЎР‚РЎРѓР С‘РЎРЏ РЎРѓ Р Р…Р В°Р Т‘РЎвЂР В¶Р Р…РЎвЂ№Р СР С‘ РЎРЏР С—Р С•Р Р…РЎРѓР С”Р С‘Р СР С‘ Р СР С•РЎРѓРЎвЂљР В°Р СР С‘ Toyota Р Т‘Р В»РЎРЏ Р СР В°Р С”РЎРѓР С‘Р СР В°Р В»РЎРЉР Р…Р С•Р в„– Р Р…Р В°Р Т‘РЎвЂР В¶Р Р…Р С•РЎРѓРЎвЂљР С‘.',
  },
  {
    id: 'sixwheel-toyota',
    slug: 'rosomaha-6x6',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р РЃР ВµРЎРѓРЎвЂљР С‘Р С”Р С•Р В»РЎвЂРЎРѓР Р…Р С‘Р С” (1.8 Р В»Р С‘РЎвЂљРЎР‚Р В°, Р СР С•РЎРѓРЎвЂљРЎвЂ№ Toyota)',
    category: 'sixwheel',
    categoryName: 'Р РЃР ВµРЎРѓРЎвЂљР С‘Р С”Р С•Р В»РЎвЂРЎРѓР Р…Р С‘Р С”Р С‘',
    basePrice: 3100000,
    priceFormatted: 'Р С•РЎвЂљ 3 100 000 РІвЂљР…',
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
      length: '3500',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '950',
      speed: 'Р Т‘Р С• 55',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Toyota',
      configuration: 'Р РЃР ВµРЎРѓРЎвЂљР С‘Р С”Р С•Р В»РЎвЂРЎРѓР Р…Р С‘Р С” (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р РЃР ВµРЎРѓРЎвЂљРЎРЉ Р С”Р С•Р В»РЎвЂРЎРѓ = Р СР В°Р С”РЎРѓР С‘Р СР В°Р В»РЎРЉР Р…Р В°РЎРЏ Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ. Р вЂќР В»РЎРЏ РЎРѓР В°Р СРЎвЂ№РЎвЂ¦ РЎРѓР В»Р С•Р В¶Р Р…РЎвЂ№РЎвЂ¦ Р СР В°РЎР‚РЎв‚¬РЎР‚РЎС“РЎвЂљР С•Р Р† Р С‘ РЎвЂљРЎРЏР В¶РЎвЂР В»РЎвЂ№РЎвЂ¦ Р С–РЎР‚РЎС“Р В·Р С•Р Р†.',
  },
  {
    id: 'trailer',
    slug: 'rosomaha-trailer',
    name: 'Р СџРЎР‚Р С‘РЎвЂ Р ВµР С— Р С” Р С”Р Р†Р В°Р Т‘РЎР‚Р С•РЎвЂ Р С‘Р С”Р В»РЎС“ Р С—Р В»Р В°Р Р†Р В°РЎР‹РЎвЂ°Р С‘Р в„–',
    category: 'trailer',
    categoryName: 'Р СџРЎР‚Р С‘РЎвЂ Р ВµР С—РЎвЂ№',
    basePrice: 200000,
    priceFormatted: '200 000 РІвЂљР…',
    available: true,
    gallery: [
      '/upload/iblock/edf/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
    ],
    thumbnails: [
      '/upload/resize_cache/iblock/edf/50_50_140cd750bba9870f18aada2478b24840a/yu0b79nbzg322gdbs5ak00q7n3mz1iln.jpg',
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
    baseEquipment: ['Р С™Р С•Р В»Р ВµРЎРѓР В° Р Р…Р В° Р С•Р В±Р С•Р Т‘Р С‘РЎР‚РЎвЂ№РЎв‚¬Р В°РЎвЂ¦', 'Р РЋРЎвЂ Р ВµР С—Р Р…Р С•Р Вµ РЎС“РЎРѓРЎвЂљРЎР‚Р С•Р в„–РЎРѓРЎвЂљР Р†Р С•'],
    description: 'Р СџР В»Р В°Р Р†Р В°РЎР‹РЎвЂ°Р С‘Р в„– Р С—РЎР‚Р С‘РЎвЂ Р ВµР С— Р Т‘Р В»РЎРЏ Р С—Р ВµРЎР‚Р ВµР Р†Р С•Р В·Р С”Р С‘ Р Т‘Р С•Р С—Р С•Р В»Р Р…Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р С•Р С–Р С• Р С–РЎР‚РЎС“Р В·Р В° Р С—Р С• Р В»РЎР‹Р В±Р С•Р в„– Р СР ВµРЎРѓРЎвЂљР Р…Р С•РЎРѓРЎвЂљР С‘.',
  },
  // ======= Р СњР С›Р вЂ™Р В«Р вЂў Р СљР С›Р вЂќР вЂўР вЂєР В =======
  {
    id: 'pickup-uaz-timken',
    slug: 'rosomaha-pickup-uaz-timken',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р СџР С‘Р С”Р В°Р С— Р Р€Р С’Р вЂ”',
    category: 'pickup',
    categoryName: 'Р СџР С‘Р С”Р В°Р С—РЎвЂ№',
    basePrice: 1700000,
    priceFormatted: 'Р С•РЎвЂљ 1 700 000 РІвЂљР…',
    available: true,
    badge: 'new',
    gallery: [modelPikapUaz],
    thumbnails: [modelPikapUaz],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3200',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '850',
      speed: 'Р Т‘Р С• 55',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р…',
      configuration: 'Р СџР С‘Р С”Р В°Р С— (Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р…)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р СџР С‘Р С”Р В°Р С— Р Р…Р В° Р В±Р В°Р В·Р Вµ Р СР С•РЎРѓРЎвЂљР С•Р Р† Р Р€Р С’Р вЂ” Р СћР С‘Р СР С”Р ВµР Р… РЎРѓ Р С–РЎР‚РЎС“Р В·Р С•Р Р†Р С•Р в„– Р С—Р В»Р В°РЎвЂљРЎвЂћР С•РЎР‚Р СР С•Р в„– Р Т‘Р В»РЎРЏ Р С—Р ВµРЎР‚Р ВµР Р†Р С•Р В·Р С”Р С‘ РЎРѓР Р…Р В°РЎР‚РЎРЏР В¶Р ВµР Р…Р С‘РЎРЏ Р С‘ Р С•Р В±Р С•РЎР‚РЎС“Р Т‘Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ.',
  },
  {
    id: 'pickup-uaz-18',
    slug: 'rosomaha-pickup-uaz-18',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р СџР С‘Р С”Р В°Р С— 1.8Р В»',
    category: 'pickup',
    categoryName: 'Р СџР С‘Р С”Р В°Р С—РЎвЂ№',
    basePrice: 2250000,
    priceFormatted: 'Р С•РЎвЂљ 2 250 000 РІвЂљР…',
    available: true,
    badge: 'new',
    gallery: [modelPikap18l],
    thumbnails: [modelPikap18l],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3200',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '880',
      speed: 'Р Т‘Р С• 55',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Р Р€Р С’Р вЂ”',
      configuration: 'Р СџР С‘Р С”Р В°Р С— 1.8Р В» (Р Р€Р С’Р вЂ”)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р СљР С•РЎвЂ°Р Р…РЎвЂ№Р в„– Р С–РЎР‚РЎС“Р В·Р С•Р Р†Р С•Р в„– Р Р†Р В°РЎР‚Р С‘Р В°Р Р…РЎвЂљ РЎРѓ Р Т‘Р Р†Р С‘Р С–Р В°РЎвЂљР ВµР В»Р ВµР С 1.8Р В» Р Т‘Р В»РЎРЏ РЎвЂљРЎРЏР В¶РЎвЂР В»РЎвЂ№РЎвЂ¦ Р С–РЎР‚РЎС“Р В·Р С•Р Р†.',
  },
  {
    id: 'pickup-toyota',
    slug: 'rosomaha-pickup-toyota',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р СџР С‘Р С”Р В°Р С— Toyota',
    category: 'pickup',
    categoryName: 'Р СџР С‘Р С”Р В°Р С—РЎвЂ№',
    basePrice: 2450000,
    priceFormatted: 'Р С•РЎвЂљ 2 450 000 РІвЂљР…',
    available: true,
    badge: 'recommended',
    gallery: [modelPikapToyota],
    thumbnails: [modelPikapToyota],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '3200',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '900',
      speed: 'Р Т‘Р С• 55',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Toyota',
      configuration: 'Р СџР С‘Р С”Р В°Р С— (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р СћР С•Р С—Р С•Р Р†РЎвЂ№Р в„– Р С—Р С‘Р С”Р В°Р С— РЎРѓ РЎРЏР С—Р С•Р Р…РЎРѓР С”Р С‘Р СР С‘ Р СР С•РЎРѓРЎвЂљР В°Р СР С‘ Toyota Р С‘ Р Т‘Р Р†Р С‘Р С–Р В°РЎвЂљР ВµР В»Р ВµР С 1.8 Р В»Р С‘РЎвЂљРЎР‚Р В°. Р СњР В°Р Т‘РЎвЂР В¶Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С‘ Р С–РЎР‚РЎС“Р В·Р С•Р С—Р С•Р Т‘РЎР‰РЎвЂР СР Р…Р С•РЎРѓРЎвЂљРЎРЉ.',
  },
  {
    id: 'extrime-plus-toyota',
    slug: 'rosomaha-extrime-plus',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С Р СџР вЂєР В®Р РЋ (Toyota)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 2150000,
    priceFormatted: 'Р С•РЎвЂљ 2 150 000 РІвЂљР…',
    available: true,
    badge: 'hit',
    gallery: [modelExtrimePlus],
    thumbnails: [modelExtrimePlus],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '780',
      speed: 'Р Т‘Р С• 60',
      engine: '1ZZ-FE',
      engineVolume: '1794',
      power: '140',
      axles: 'Toyota',
      configuration: 'Р В­Р С”РЎРѓРЎвЂљРЎР‚Р С‘Р С Р СџР вЂєР В®Р РЋ (Toyota)',
    },
    baseEquipment: standardPlusEquipment,
    description: 'Р СћР С•Р С—Р С•Р Р†Р В°РЎРЏ Р С”Р С•Р СР С—Р В»Р ВµР С”РЎвЂљР В°РЎвЂ Р С‘РЎРЏ РЎРѓ Р Т‘Р Р†Р С‘Р С–Р В°РЎвЂљР ВµР В»Р ВµР С 1.8 Р В»Р С‘РЎвЂљРЎР‚Р В° Р С‘ РЎРЏР С—Р С•Р Р…РЎРѓР С”Р С‘Р СР С‘ Р СР С•РЎРѓРЎвЂљР В°Р СР С‘ Toyota. Р СљР В°Р С”РЎРѓР С‘Р СР В°Р В»РЎРЉР Р…Р В°РЎРЏ Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р С‘Р СР С•РЎРѓРЎвЂљРЎРЉ Р С‘ Р Р…Р В°Р Т‘РЎвЂР В¶Р Р…Р С•РЎРѓРЎвЂљРЎРЉ.',
  },
  {
    id: 'hunter-toyota',
    slug: 'rosomaha-hunter',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° Р ТђР В°Р Р…РЎвЂљР ВµРЎР‚ (Toyota)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 2180000,
    priceFormatted: 'Р С•РЎвЂљ 2 180 000 РІвЂљР…',
    available: true,
    badge: 'recommended',
    gallery: [modelHunter],
    thumbnails: [modelHunter],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1650',
      wheelDiameter: '1100',
      clearance: '400',
      weight: '800',
      speed: 'Р Т‘Р С• 55',
      engine: '1NZ-FE',
      engineVolume: '1497',
      power: '109',
      axles: 'Toyota',
      configuration: 'Р ТђР В°Р Р…РЎвЂљР ВµРЎР‚ (Toyota)',
    },
    baseEquipment: [...standardPlusEquipment, 'Р Р€РЎРѓР С‘Р В»Р ВµР Р…Р Р…Р В°РЎРЏ Р В·Р В°РЎвЂ°Р С‘РЎвЂљР В° Р Т‘Р Р…Р С‘РЎвЂ°Р В°', 'Р Р€Р Р†Р ВµР В»Р С‘РЎвЂЎР ВµР Р…Р Р…РЎвЂ№Р в„– РЎвЂљР С•Р С—Р В»Р С‘Р Р†Р Р…РЎвЂ№Р в„– Р В±Р В°Р С”'],
    description: 'Р СљР С•Р Т‘Р ВµР В»РЎРЉ Р Т‘Р В»РЎРЏ Р С•РЎвЂ¦Р С•РЎвЂљР Р…Р С‘Р С”Р С•Р Р† РЎРѓ РЎС“РЎРѓР С‘Р В»Р ВµР Р…Р Р…Р С•Р в„– Р В·Р В°РЎвЂ°Р С‘РЎвЂљР С•Р в„– Р С‘ РЎС“Р Р†Р ВµР В»Р С‘РЎвЂЎР ВµР Р…Р Р…РЎвЂ№Р С РЎвЂљР С•Р С—Р В»Р С‘Р Р†Р Р…РЎвЂ№Р С Р В±Р В°Р С”Р С•Р С Р Т‘Р В»РЎРЏ Р Т‘Р В»Р С‘РЎвЂљР ВµР В»РЎРЉР Р…РЎвЂ№РЎвЂ¦ РЎРЊР С”РЎРѓР С—Р ВµР Т‘Р С‘РЎвЂ Р С‘Р в„–.',
  },
  {
    id: 'rosomaha-base',
    slug: 'rosomaha-base',
    name: 'Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В° (Р В±Р В°Р В·Р С•Р Р†Р В°РЎРЏ Р СР С•Р Т‘Р ВµР В»РЎРЉ)',
    category: 'classic',
    categoryName: 'Р С™Р В»Р В°РЎРѓРЎРѓР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘Р Вµ Р СР С•Р Т‘Р ВµР В»Р С‘',
    basePrice: 1100000,
    priceFormatted: 'Р С•РЎвЂљ 1 100 000 РІвЂљР…',
    available: true,
    gallery: [modelRosomaha],
    thumbnails: [modelRosomaha],
    variants: classicVariants,
    colors: productColors,
    options: productOptions,
    specs: {
      length: '2850',
      width: '1950',
      height: '1600',
      wheelDiameter: '1100',
      clearance: '380',
      weight: '680',
      speed: 'Р Т‘Р С• 50',
      engine: 'Р вЂќР вЂ™Р РЋ',
      engineVolume: '800',
      power: '40',
      axles: 'Р вЂ™Р С•Р В»Р С–Р В°',
      configuration: 'Р вЂР В°Р В·Р С•Р Р†Р В°РЎРЏ',
    },
    baseEquipment: [
      'Р РЃР С‘Р Р…РЎвЂ№ Р Р€РЎР‚Р В°Р В» (Р С•Р В±Р Т‘Р С‘РЎР‚РЎвЂ№РЎв‚¬Р С‘ 1100РЎвЂ¦500)',
      'Р вЂ”Р В°Р Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
      'Р СџР ВµРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р В±Р В°Р С–Р В°Р В¶Р Р…Р С‘Р С”',
      'Р вЂ™Р ВµРЎвЂљРЎР‚Р С•Р Р†Р С•Р Вµ РЎРѓРЎвЂљР ВµР С”Р В»Р С•',
    ],
    description: 'Р вЂР В°Р В·Р С•Р Р†Р В°РЎРЏ Р СР С•Р Т‘Р ВµР В»РЎРЉ РЎРѓР Р…Р ВµР С–Р С•Р В±Р С•Р В»Р С•РЎвЂљР С•РЎвЂ¦Р С•Р Т‘Р В° Р В Р С•РЎРѓР С•Р СР В°РЎвЂ¦Р В°. Р С›Р С—РЎвЂљР С‘Р СР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– Р Р†РЎвЂ№Р В±Р С•РЎР‚ Р Т‘Р В»РЎРЏ Р Р…Р В°РЎвЂЎР С‘Р Р…Р В°РЎР‹РЎвЂ°Р С‘РЎвЂ¦ РЎРѓ Р С•РЎвЂљР В»Р С‘РЎвЂЎР Р…РЎвЂ№Р С РЎРѓР С•Р С•РЎвЂљР Р…Р С•РЎв‚¬Р ВµР Р…Р С‘Р ВµР С РЎвЂ Р ВµР Р…Р В°/Р С”Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С•.',
  },
];

// Р В¤РЎС“Р Р…Р С”РЎвЂ Р С‘РЎРЏ Р С—Р С•Р С‘РЎРѓР С”Р В° РЎвЂљР С•Р Р†Р В°РЎР‚Р В° Р С—Р С• slug
export function getProductBySlug(slug: string): Product | undefined {
  return products.find(p => p.slug === slug);
}

// Р В¤РЎС“Р Р…Р С”РЎвЂ Р С‘РЎРЏ РЎвЂћР С•РЎР‚Р СР В°РЎвЂљР С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ РЎвЂ Р ВµР Р…РЎвЂ№
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('ru-RU').format(price) + ' РІвЂљР…';
}
