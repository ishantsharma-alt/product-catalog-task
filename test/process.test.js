import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv, toCsv } from '../src/csv.js';
import { getDiscountPercent, calculateDiscountedPrice, generateVariantSku, processProducts } from '../src/process.js';
import { validateProducts } from '../src/validate.js';
import { processCsv } from '../src/pipeline.js';

const HEADERS = ['Handle', 'Title', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
  'Option3 Name', 'Option3 Value', 'Variant SKU', 'Variant Price', 'Variant Compare At Price', 'Image Src'];

function product(handle, { sku = 'SKU', sizes = ['S', 'M'], price = '1000.00', compareAt = '', optionName = 'Size' } = {}) {
  return sizes.map((size, i) => ({
    ...Object.fromEntries(HEADERS.map((h) => [h, ''])),
    Handle: handle,
    Title: i === 0 ? handle.toUpperCase() : '',
    'Option1 Name': i === 0 ? optionName : '',
    'Option1 Value': size,
    'Variant SKU': sku,
    'Variant Price': price,
    'Variant Compare At Price': compareAt,
  }));
}

const failedChecks = (rows, result) =>
  validateProducts(HEADERS, rows, result).filter((c) => !c.pass).map((c) => c.name);

test('discount tiers follow product number', () => {
  assert.deepEqual([1, 10, 11, 20, 21, 50].map(getDiscountPercent), [5, 5, 10, 10, 15, 15]);
});

test('discounted price = original − original × discount, to the paisa', () => {
  assert.equal(calculateDiscountedPrice('37500.00', 5), '35625.00');
  assert.equal(calculateDiscountedPrice('19500.00', 15), '16575.00');
  assert.equal(calculateDiscountedPrice('199.99', 10), '179.99');
});

test('SKU is ORIGINAL-SIZE-PACK and never reused', () => {
  const used = new Set();
  assert.equal(generateVariantSku('CLTP 6', ['Custom Size'], 'Pack of 3', used), 'CLTP 6-CUSTOM-P3');
  assert.equal(generateVariantSku('BSK 46', ['S', 'XL'], 'Pack of 2', used), 'BSK 46-S-XL-P2');
  assert.equal(generateVariantSku('BSK 46', ['S', 'XL'], 'Pack of 2', used), 'BSK 46-S-XL-P2-2');
  assert.equal(generateVariantSku('', ['S'], 'Pack of 2', used), '');
});

test('discount is per product, not per row', () => {
  const rows = Array.from({ length: 12 }, (_, i) => product(`p${i + 1}`, { sku: `SKU${i + 1}`, sizes: ['S', 'M', 'L'] })).flat();
  const result = processProducts(HEADERS, rows);
  const p11 = result.rows.filter((r) => r.Handle === 'p11');
  assert.equal(p11.length, 6);
  assert.ok(p11.every((r) => r['Discount %'] === 10 && r['Variant Price'] === '900.00'));
  assert.deepEqual(failedChecks(rows, result), []);
});

test('two products sharing a base SKU still get unique SKUs', () => {
  const rows = [...product('a', { sku: 'DUP' }), ...product('b', { sku: 'DUP' })];
  const result = processProducts(HEADERS, rows);
  assert.equal(new Set(result.rows.map((r) => r['Variant SKU'])).size, 8);
  assert.deepEqual(failedChecks(rows, result), []);
});

test('an existing compare-at above the price is kept; otherwise the original price is used', () => {
  const rows = [...product('higher', { compareAt: '1200.00' }), ...product('lower', { sku: 'L', compareAt: '500.00' })];
  const result = processProducts(HEADERS, rows);
  assert.equal(result.rows[0]['Variant Compare At Price'], '1200.00');
  assert.equal(result.rows[4]['Variant Compare At Price'], '1000.00');
  assert.equal(result.rows[4]['Original Compare At Price'], '500.00');
  assert.deepEqual(failedChecks(rows, result), []);
});

test('products without Size or without a free option slot are discounted but keep their variants', () => {
  const noSize = product('stole', { sku: 'ST', sizes: ['Default Title'], optionName: 'Title' });
  const allSlotsUsed = product('set', { sku: '', sizes: ['S'], optionName: 'Top Size' });
  Object.assign(allSlotsUsed[0], {
    'Option2 Name': 'Bottom Size', 'Option2 Value': 'S', 'Option3 Name': 'Stole Option', 'Option3 Value': 'Without Stole',
  });
  const rows = [...noSize, ...allSlotsUsed];
  const result = processProducts(HEADERS, rows);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1]['Option3 Value'], 'Without Stole');
  assert.ok(result.rows.every((r) => r['Variant Price'] === '950.00'));
  assert.deepEqual(failedChecks(rows, result), []);
});

test('validation catches a changed product field or a wrong price', () => {
  const rows = product('a');
  const changedTitle = processProducts(HEADERS, rows);
  changedTitle.rows[0].Title = 'Edited';
  assert.ok(failedChecks(rows, changedTitle).some((name) => name.startsWith('Every other field')));

  const wrongPrice = processProducts(HEADERS, rows);
  wrongPrice.rows[1]['Variant Price'] = '1000.00';
  assert.ok(failedChecks(rows, wrongPrice).some((name) => name.startsWith('Discounted price')));
});

test('CSV round-trips quoted commas, quotes and line breaks', () => {
  const rows = [{ A: 'x, "y"', B: 'line1\nline2' }];
  assert.deepEqual(parseCsv(toCsv(['A', 'B'], rows)).rows, rows);
});

test('a file without Shopify columns is rejected', () => {
  assert.throws(() => processCsv('Name,Price\nShirt,10\n'), /missing columns: Handle/);
});

test('provided export: 50 products, 10/10/30 discounts, 664 Size × Pack variants, all checks pass', () => {
  const output = processCsv(readFileSync(new URL('../data/products_export.csv', import.meta.url), 'utf8'));
  assert.equal(output.summary.uniqueProducts, 50);
  assert.deepEqual(output.summary.discountCounts, { 5: 10, 10: 10, 15: 30 });
  assert.equal(output.summary.sizePackCombinations, 664);
  assert.deepEqual(output.checks.filter((c) => !c.pass), []);
});
