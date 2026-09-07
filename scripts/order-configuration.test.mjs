import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/orderConfiguration.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { buildOrderConfiguration, CONFIGURATION_LIMIT } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const option = { id: 'winch', name: 'Лебёдка', price: 1000 };
const item = { product: { name: 'Росомаха' }, variant: { name: 'Тимкен', price: 10000 }, color: { name: 'Зелёный' }, quantity: 2, options: [option] };

test('передаёт все позиции, допы и суммы с учётом количества', () => {
  const result = buildOrderConfiguration([item, { ...item, product: { name: 'Пикап' }, quantity: 1, options: [] }]);
  for (const value of ['1. Росомаха', '2. Пикап', 'Тимкен', 'Зелёный', 'Количество: 2 шт.', 'Лебёдка', 'Не выбрано']) assert.ok(result.includes(value), value);
  assert.match(result.replace(/\s/g, ''), /Суммапозиции:22000₽/);
  assert.match(result.replace(/\s/g, ''), /Итогопокорзине:32000₽/);
});
test('не обрезает длинный состав после прежнего лимита 2400', () => {
  const options = Array.from({ length: 50 }, (_, index) => ({ ...option, name: `Дополнительное оснащение номер ${index}: ${'а'.repeat(35)}` }));
  const result = buildOrderConfiguration([{ ...item, options }]);
  assert.ok(result.length > 2400);
  assert.ok(result.includes('номер 49'));
  assert.ok(result.includes('Итого по корзине'));
});
test('явно отклоняет состав больше backend лимита', () => {
  assert.throws(() => buildOrderConfiguration([{ ...item, options: [{ ...option, name: 'а'.repeat(CONFIGURATION_LIMIT) }] }]), /Разделите заказ/);
});
test('отдельный доп без выдуманной модели и без общей суммы', () => {
  const result = buildOrderConfiguration([], option);
  assert.ok(result.includes('Лебёдка'));
  assert.ok(result.includes('Модель и количество нужно уточнить'));
  assert.ok(!result.includes('Итого по корзине'));
});
test('удалённые опции отсутствуют, обычная заявка без корзины допустима', () => {
  assert.ok(!buildOrderConfiguration([{ ...item, options: [] }]).includes('Лебёдка'));
  assert.equal(buildOrderConfiguration([]), '');
});
