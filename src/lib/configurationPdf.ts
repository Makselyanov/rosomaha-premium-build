import type {
  Product,
  ProductColor,
  ProductOption,
  ProductVariant,
} from '@/data/products';
import { officePhone, primaryPhone } from '@/data/contactInfo';
import { resolveMediaUrl } from '@/lib/media';

export interface ConfigurationPdfInput {
  product: Product;
  variant: ProductVariant;
  color: ProductColor;
  options: ProductOption[];
  totalPrice: number;
  imageUrl?: string;
}

export type ConfigurationShareResult = 'shared' | 'downloaded';

const formatPrice = (price: number) =>
  `${new Intl.NumberFormat('ru-RU').format(price)} ₽`;

const setStyles = (element: HTMLElement, styles: Partial<CSSStyleDeclaration>) => {
  Object.assign(element.style, styles);
};

const createText = (
  parent: HTMLElement,
  text: string,
  styles: Partial<CSSStyleDeclaration> = {},
) => {
  const element = document.createElement('div');
  element.textContent = text;
  setStyles(element, styles);
  parent.appendChild(element);
  return element;
};

const createSectionTitle = (parent: HTMLElement, title: string) => {
  const wrapper = document.createElement('div');
  setStyles(wrapper, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '30px 0 14px',
  });

  const marker = document.createElement('div');
  setStyles(marker, {
    width: '30px',
    height: '4px',
    borderRadius: '99px',
    background: '#f97316',
    flexShrink: '0',
  });
  wrapper.appendChild(marker);

  createText(wrapper, title.toUpperCase(), {
    color: '#111827',
    fontSize: '15px',
    fontWeight: '800',
    letterSpacing: '1.4px',
  });
  parent.appendChild(wrapper);
};

const createInfoRow = (
  parent: HTMLElement,
  label: string,
  value: string,
  accent = false,
) => {
  const row = document.createElement('div');
  setStyles(row, {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: '20px',
    padding: '10px 0',
    borderBottom: '1px solid #e5e7eb',
  });

  createText(row, label, {
    color: '#6b7280',
    fontSize: '14px',
    lineHeight: '1.35',
  });
  createText(row, value, {
    color: accent ? '#ea580c' : '#111827',
    fontSize: accent ? '17px' : '14px',
    fontWeight: accent ? '800' : '700',
    lineHeight: '1.35',
    textAlign: 'right',
    maxWidth: '360px',
  });

  parent.appendChild(row);
};

const waitForImage = (image: HTMLImageElement) => {
  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => resolve(), { once: true });
  });
};

const getSpecificationRows = (product: Product) => {
  const specs = product.specs;
  return [
    ['Длина', specs.length && `${specs.length} мм`],
    ['Ширина', specs.width && `${specs.width} мм`],
    ['Высота', specs.height && `${specs.height} мм`],
    ['Диаметр колёс', specs.wheelDiameter && `${specs.wheelDiameter} мм`],
    ['Клиренс', specs.clearance && `${specs.clearance} мм`],
    ['Масса', specs.weight && `${specs.weight} кг`],
    ['Максимальная скорость', specs.speed && `${specs.speed} км/ч`],
    ['Двигатель', specs.engine],
    ['Объём двигателя', specs.engineVolume && `${specs.engineVolume} см³`],
    ['Мощность', specs.power && `${specs.power} л.с.`],
    ['Мосты', specs.axles],
  ].filter((row): row is [string, string] => Boolean(row[1]));
};

const buildConfigurationSheet = (input: ConfigurationPdfInput) => {
  const sheet = document.createElement('section');
  sheet.dataset.configurationPdf = 'true';
  setStyles(sheet, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '794px',
    boxSizing: 'border-box',
    padding: '46px 50px 42px',
    background: '#f7f5f1',
    color: '#111827',
    fontFamily: 'Arial, sans-serif',
    lineHeight: '1.4',
    zIndex: '-1',
  });

  const header = document.createElement('div');
  setStyles(header, {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'start',
    gap: '24px',
    paddingBottom: '24px',
    borderBottom: '4px solid #111827',
  });
  const brand = document.createElement('div');
  createText(brand, 'РОСОМАХА', {
    color: '#111827',
    fontSize: '34px',
    fontWeight: '900',
    letterSpacing: '2px',
    lineHeight: '1',
  });
  createText(brand, 'Завод снегоболотоходов', {
    color: '#ea580c',
    fontSize: '13px',
    fontWeight: '800',
    letterSpacing: '1.2px',
    marginTop: '8px',
    textTransform: 'uppercase',
  });
  header.appendChild(brand);
  createText(header, `Конфигурация · ${new Date().toLocaleDateString('ru-RU')}`, {
    color: '#6b7280',
    fontSize: '13px',
    fontWeight: '700',
    textAlign: 'right',
  });
  sheet.appendChild(header);

  const hero = document.createElement('div');
  setStyles(hero, {
    display: 'grid',
    gridTemplateColumns: '1.05fr 0.95fr',
    gap: '26px',
    alignItems: 'stretch',
    marginTop: '28px',
  });

  const heroCopy = document.createElement('div');
  createText(heroCopy, input.product.categoryName.toUpperCase(), {
    color: '#ea580c',
    fontSize: '12px',
    fontWeight: '800',
    letterSpacing: '1.5px',
    marginBottom: '10px',
  });
  createText(heroCopy, input.product.name, {
    color: '#111827',
    fontSize: '28px',
    fontWeight: '900',
    lineHeight: '1.12',
  });
  createText(heroCopy, input.variant.name, {
    color: '#4b5563',
    fontSize: '16px',
    fontWeight: '700',
    marginTop: '14px',
  });
  createText(heroCopy, `Итого: ${formatPrice(input.totalPrice)}`, {
    color: '#ffffff',
    background: '#111827',
    borderRadius: '12px',
    display: 'inline-block',
    fontSize: '21px',
    fontWeight: '900',
    marginTop: '22px',
    padding: '12px 16px',
  });
  hero.appendChild(heroCopy);

  const imageFrame = document.createElement('div');
  setStyles(imageFrame, {
    minHeight: '225px',
    borderRadius: '18px',
    overflow: 'hidden',
    background: '#e5e7eb',
    border: '1px solid #d1d5db',
  });
  const image = document.createElement('img');
  const resolvedImage = resolveMediaUrl(input.imageUrl || input.product.gallery[0]);
  image.src = resolvedImage
    ? new URL(resolvedImage, window.location.origin).toString()
    : new URL('/media/company/rosomaha-deep-mud.jpg', window.location.origin).toString();
  image.alt = input.product.name;
  image.crossOrigin = 'anonymous';
  setStyles(image, {
    width: '100%',
    height: '100%',
    minHeight: '225px',
    objectFit: 'cover',
    display: 'block',
  });
  imageFrame.appendChild(image);
  hero.appendChild(imageFrame);
  sheet.appendChild(hero);

  createSectionTitle(sheet, 'Выбранная комплектация');
  createInfoRow(sheet, 'Модель и исполнение', input.variant.name);
  createInfoRow(sheet, 'Базовая стоимость', input.variant.priceFormatted);
  createInfoRow(sheet, 'Цвет кузова', `${input.color.ral} · ${input.color.name}`);

  if (input.options.length > 0) {
    createSectionTitle(sheet, 'Дополнительные опции');
    input.options.forEach((option) => {
      createInfoRow(sheet, option.name, option.priceFormatted);
    });
  }

  createSectionTitle(sheet, 'Технические характеристики');
  const specsGrid = document.createElement('div');
  setStyles(specsGrid, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0 26px',
  });
  getSpecificationRows(input.product).forEach(([label, value]) => {
    createInfoRow(specsGrid, label, value);
  });
  sheet.appendChild(specsGrid);

  const total = document.createElement('div');
  setStyles(total, {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: '20px',
    marginTop: '32px',
    padding: '22px 24px',
    borderRadius: '16px',
    background: '#f97316',
    color: '#ffffff',
  });
  createText(total, 'ИТОГОВАЯ СТОИМОСТЬ', {
    fontSize: '16px',
    fontWeight: '900',
    letterSpacing: '1px',
  });
  createText(total, formatPrice(input.totalPrice), {
    fontSize: '26px',
    fontWeight: '900',
    textAlign: 'right',
  });
  sheet.appendChild(total);

  const footer = document.createElement('div');
  setStyles(footer, {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '28px',
    marginTop: '28px',
    paddingTop: '20px',
    borderTop: '1px solid #d1d5db',
  });
  const contacts = document.createElement('div');
  createText(contacts, primaryPhone.display, {
    color: '#111827',
    fontSize: '16px',
    fontWeight: '900',
  });
  createText(contacts, `${primaryPhone.label} · офис ${officePhone.display}`, {
    color: '#6b7280',
    fontSize: '12px',
    marginTop: '5px',
  });
  createText(contacts, 'https://росомаха.site', {
    color: '#ea580c',
    fontSize: '13px',
    fontWeight: '800',
    marginTop: '5px',
  });
  footer.appendChild(contacts);
  createText(
    footer,
    'Расчёт сформирован по ценам каталога. Итоговую стоимость, наличие и срок изготовления фиксирует менеджер после подтверждения заказа.',
    {
      color: '#6b7280',
      fontSize: '11px',
      lineHeight: '1.45',
      textAlign: 'right',
    },
  );
  sheet.appendChild(footer);

  return { sheet, image };
};

const buildConfigurationPdfFile = async (input: ConfigurationPdfInput) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const { sheet, image } = buildConfigurationSheet(input);
  document.body.appendChild(sheet);

  try {
    await Promise.all([document.fonts.ready, waitForImage(image)]);
    const canvas = await html2canvas(sheet, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f7f5f1',
      logging: false,
      imageTimeout: 8000,
    });

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const pageHeightPx = Math.floor(canvas.width * (pageHeightMm / pageWidthMm));

    if (canvas.height <= pageHeightPx * 1.2) {
      const fittedWidthMm = (canvas.width * pageHeightMm) / canvas.height;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        (pageWidthMm - fittedWidthMm) / 2,
        0,
        fittedWidthMm,
        pageHeightMm,
        undefined,
        'FAST',
      );
    } else for (let top = 0, page = 0; top < canvas.height; top += pageHeightPx, page += 1) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - top);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const context = pageCanvas.getContext('2d');
      if (!context) {
        throw new Error('Не удалось подготовить страницу PDF');
      }
      context.drawImage(
        canvas,
        0,
        top,
        canvas.width,
        sliceHeight,
        0,
        0,
        canvas.width,
        sliceHeight,
      );

      if (page > 0) {
        pdf.addPage();
      }
      const sliceHeightMm = (sliceHeight * pageWidthMm) / canvas.width;
      pdf.addImage(
        pageCanvas.toDataURL('image/jpeg', 0.92),
        'JPEG',
        0,
        0,
        pageWidthMm,
        sliceHeightMm,
        undefined,
        'FAST',
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    const fileName = `rosomaha-${input.product.slug}-${date}.pdf`;
    return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
  } finally {
    sheet.remove();
  }
};

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadConfigurationPdf = async (input: ConfigurationPdfInput) => {
  const file = await buildConfigurationPdfFile(input);
  downloadFile(file);
};

export const shareConfigurationPdf = async (
  input: ConfigurationPdfInput,
): Promise<ConfigurationShareResult> => {
  const file = await buildConfigurationPdfFile(input);
  const shareData: ShareData = {
    title: `Конфигурация — ${input.product.name}`,
    text: `Конфигурация ${input.variant.name} на сумму ${formatPrice(input.totalPrice)}`,
    files: [file],
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    await navigator.share(shareData);
    return 'shared';
  }

  downloadFile(file);
  return 'downloaded';
};
