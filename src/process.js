export const PACK_OPTION_NAME = 'Pack';
export const PACK_VALUES = ['Pack of 2', 'Pack of 3'];
export const OPTION_SLOTS = [1, 2, 3];

export const REQUIRED_COLUMNS = ['Handle', 'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Price', 'Variant Compare At Price'];

// Review columns, added to the workbook only. The import CSV keeps the
// original Shopify header so it can be uploaded as-is.
export const REVIEW_COLUMNS = ['Product No.', 'Original Price', 'Discount %', 'Discounted Price', 'Original Compare At Price'];

export function findMissingColumns(headers) {
  return REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
}

export function getDiscountPercent(productNumber) {
  if (productNumber <= 10) return 5;
  if (productNumber <= 20) return 10;
  return 15;
}

// Worked in paise so floating point never gives 18524.999...
export function calculateDiscountedPrice(price, discountPercent) {
  const paise = Math.round(Number(price) * 100);
  const discounted = paise - (paise * discountPercent) / 100;
  return (Math.round(discounted) / 100).toFixed(2);
}

// In a Shopify export every variant row has Option1 Value; extra image rows don't.
export function isVariantRow(row) {
  return row['Option1 Value'] !== '';
}

// Columns that belong to a variant (copied onto a new Pack row). Everything
// else is product-level and only appears on the product's first row.
export function isVariantColumn(column) {
  return (
    /^Option\d Value$/.test(column) ||
    column.startsWith('Variant ') ||
    column.startsWith('Unit Price ') ||
    column.startsWith('Price / ') ||
    column.startsWith('Compare At Price / ') ||
    column === 'Cost per item'
  );
}

function isSizeOption(name) {
  return name === 'Size' || name.endsWith('(Size)') || name.endsWith(' Size');
}

// Products are identified by Handle and numbered in the order they first appear.
export function getUniqueProducts(rows) {
  const rowsByHandle = new Map();
  for (const row of rows) {
    if (!rowsByHandle.has(row.Handle)) rowsByHandle.set(row.Handle, []);
    rowsByHandle.get(row.Handle).push(row);
  }

  return [...rowsByHandle].map(([handle, productRows], i) => {
    const first = productRows[0];
    const sizeSlots = OPTION_SLOTS.filter((n) => isSizeOption(first[`Option${n} Name`]));
    const packSlot = OPTION_SLOTS.find((n) => !first[`Option${n} Name`]);
    return {
      number: i + 1,
      handle,
      title: first.Title,
      rows: productRows,
      optionNames: OPTION_SLOTS.map((n) => first[`Option${n} Name`]).filter(Boolean),
      sizeSlots,
      packSlot,
      canAddPack: sizeSlots.length > 0 && packSlot !== undefined,
    };
  });
}

function sizeCode(size) {
  return size.toUpperCase().replace(/ SIZE$/, '').replace(/\s+/g, '');
}

// ORIGINAL-SKU-SIZE-P2, e.g. "CLTP 6-M-P2" or "BSK 46-S-XL-P3" for two-size sets.
// A numeric suffix is added only if that SKU was already taken.
export function generateVariantSku(baseSku, sizes, pack, usedSkus) {
  if (!baseSku) return '';
  const sku = [baseSku, ...sizes.map(sizeCode), 'P' + pack.replace(/\D/g, '')].join('-');
  let unique = sku;
  for (let n = 2; usedSkus.has(unique); n++) unique = `${sku}-${n}`;
  usedSkus.add(unique);
  return unique;
}

function applyDiscount(row, product) {
  const discountPercent = getDiscountPercent(product.number);
  row['Product No.'] = product.number;
  row['Discount %'] = discountPercent;
  if (!isVariantRow(row) || row['Variant Price'] === '') return;

  const originalPrice = row['Variant Price'];
  const originalCompareAt = row['Variant Compare At Price'];
  row['Original Price'] = originalPrice;
  row['Original Compare At Price'] = originalCompareAt;
  row['Discounted Price'] = calculateDiscountedPrice(originalPrice, discountPercent);
  row['Variant Price'] = row['Discounted Price'];
  // Shopify shows Compare At Price as the struck-through price. Keep an existing
  // compare-at that is above the original price; otherwise use the original price.
  row['Variant Compare At Price'] =
    Number(originalCompareAt) > Number(originalPrice) ? originalCompareAt : originalPrice;
}

// One source Size row becomes one row per pack. The source row keeps its
// product fields and image as Pack of 2; Pack of 3 copies only the variant columns.
export function generatePackVariants(headers, product, sourceRow, isFirstRow, usedSkus) {
  const sizes = product.sizeSlots.map((n) => sourceRow[`Option${n} Value`]);

  return PACK_VALUES.map((pack, i) => {
    const row = i === 0 ? { ...sourceRow } : Object.fromEntries(headers.map((h) => [h, isVariantColumn(h) ? sourceRow[h] : '']));
    row.Handle = sourceRow.Handle;
    if (isFirstRow && i === 0) row[`Option${product.packSlot} Name`] = PACK_OPTION_NAME;
    row[`Option${product.packSlot} Value`] = pack;
    row['Variant SKU'] = generateVariantSku(sourceRow['Variant SKU'], sizes, pack, usedSkus);
    return row;
  });
}

export function processProducts(headers, rows) {
  const products = getUniqueProducts(rows);
  const output = [];

  // SKUs kept unchanged on products without Pack must not be reused.
  const usedSkus = new Set(
    products.filter((p) => !p.canAddPack).flatMap((p) => p.rows.map((r) => r['Variant SKU']).filter(Boolean))
  );

  for (const product of products) {
    product.rows.forEach((sourceRow, i) => {
      const newRows =
        product.canAddPack && isVariantRow(sourceRow)
          ? generatePackVariants(headers, product, sourceRow, i === 0, usedSkus)
          : [{ ...sourceRow }];
      for (const row of newRows) {
        applyDiscount(row, product);
        output.push(row);
      }
    });
  }

  return { products, rows: output };
}

export function summarize(result) {
  const discountCounts = { 5: 0, 10: 0, 15: 0 };
  for (const p of result.products) discountCounts[getDiscountPercent(p.number)]++;
  const packHandles = new Set(result.products.filter((p) => p.canAddPack).map((p) => p.handle));

  return {
    uniqueProducts: result.products.length,
    discountCounts,
    productsWithPack: packHandles.size,
    productsWithoutPack: result.products.filter((p) => !p.canAddPack).map((p) => `#${p.number} ${p.handle}`),
    sizePackCombinations: result.rows.filter((r) => isVariantRow(r) && packHandles.has(r.Handle)).length,
    rowsIn: result.products.reduce((n, p) => n + p.rows.length, 0),
    rowsOut: result.rows.length,
  };
}
