import type { CartItemConfig } from '../store/cartStore';
import type { ProductOption } from '../data/products';

export const CONFIGURATION_LIMIT = 20000;
const money = (value: number) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';

export function buildOrderConfiguration(items: CartItemConfig[], requestedOption?: ProductOption) {
  const sections = items.map((item, index) => {
    const optionsTotal = item.options.reduce((sum, option) => sum + option.price, 0);
    return [
      `${index + 1}. ${item.product.name}`,
      `Комплектация: ${item.variant.name}`,
      `Цвет: ${item.color.name}`,
      `Количество: ${item.quantity} шт.`,
      `Базовая цена за единицу: ${money(item.variant.price)}`,
      'Дополнительное оснащение (цена за единицу техники):',
      ...(item.options.length ? item.options.map(option => `• ${option.name}: ${money(option.price)}`) : ['Не выбрано']),
      `Сумма позиции: ${money((item.variant.price + optionsTotal) * item.quantity)}`,
    ].join('\n');
  });
  if (items.length) {
    const total = items.reduce((sum, item) => sum + (item.variant.price + item.options.reduce((subtotal, option) => subtotal + option.price, 0)) * item.quantity, 0);
    sections.push(`Итого по корзине: ${money(total)}`);
  }
  if (requestedOption) {
    sections.push(`Отдельный запрос на дополнительное оснащение:\n${requestedOption.name}: ${money(requestedOption.price)}\nМодель и количество нужно уточнить. В итог корзины не включено.`);
  }
  const configuration = sections.join('\n\n');
  if (configuration.length > CONFIGURATION_LIMIT) {
    throw new Error('В заявке слишком много позиций. Разделите заказ на несколько заявок — полный состав не помещается в одну.');
  }
  return configuration;
}
