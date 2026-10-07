import {
  OPTION_SLOTS,
  PACK_OPTION_NAME,
  PACK_VALUES,
  REVIEW_COLUMNS,
  getDiscountPercent,
  calculateDiscountedPrice,
  getUniqueProducts,
  isVariantRow,
  isVariantColumn,
} from './process.js';

function optionValues(row, slots) {
  return slots.map((n) => row[`Option${n} Value`]).join(' / ');
}

// Columns the processor is allowed to change on a row copied from the source.
function changedColumns(product) {
  const columns = ['Variant Price', 'Variant Compare At Price'];
  if (product.canAddPack) {
    columns.push('Variant SKU', `Option${product.packSlot} Name`, `Option${product.packSlot} Value`);
  }
  return columns;
}

// Pairs every output row with the source row it came from.
function pairRows(product, outputRows) {
  if (!product.canAddPack) return outputRows.map((row, i) => ({ source: product.rows[i], row, isNew: false }));

  const pairs = [];
  let sourceIndex = -1;
  for (const row of outputRows) {
    const isNew = isVariantRow(row) && row[`Option${product.packSlot} Value`] !== PACK_VALUES[0];
    if (!isNew) sourceIndex++;
    pairs.push({ source: product.rows[sourceIndex], row, isNew });
  }
  return pairs;
}

export function validateProducts(headers, inputRows, result) {
  const checks = [];
  const check = (name, failures) => checks.push({ name, pass: failures.length === 0, failures });

  const inputProducts = getUniqueProducts(inputRows);
  const outputRowsByHandle = new Map(getUniqueProducts(result.rows).map((p) => [p.handle, p.rows]));
  const outputHandles = [...outputRowsByHandle.keys()];

  check(
    `${inputProducts.length} unique products (by Handle), same order as the source`,
    inputProducts.filter((p, i) => outputHandles[i] !== p.handle).map((p) => `#${p.number} ${p.handle}`)
      .concat(outputHandles.length !== inputProducts.length ? [`${outputHandles.length} products in output`] : [])
  );

  const failures = {
    discount: [], sameDiscount: [], price: [], originalPrice: [], unchanged: [],
    sizes: [], pack: [], duplicates: [], empty: [],
  };

  for (const product of inputProducts) {
    const outputRows = outputRowsByHandle.get(product.handle) ?? [];
    const label = `#${product.number} ${product.handle}`;
    const expectedDiscount = getDiscountPercent(product.number);

    if (outputRows.some((r) => r['Discount %'] !== expectedDiscount || r['Product No.'] !== product.number)) {
      failures.discount.push(`${label}: expected ${expectedDiscount}%`);
    }
    if (new Set(outputRows.map((r) => r['Discount %'])).size > 1) failures.sameDiscount.push(label);

    const pairs = pairRows(product, outputRows);
    const allowed = changedColumns(product);

    for (const { source, row, isNew } of pairs) {
      if (!source) {
        failures.unchanged.push(`${label}: output row with no source row`);
        continue;
      }
      // Copied rows must match the source in every column except the allowed ones;
      // new Pack rows must match its variant columns and leave product columns empty.
      for (const h of headers) {
        if (h === 'Handle' || allowed.includes(h)) continue;
        const expected = isNew && !isVariantColumn(h) ? '' : source[h];
        if (row[h] !== expected) failures.unchanged.push(`${label} ${optionValues(row, OPTION_SLOTS)}: ${h}`);
      }
      if (row.Handle !== source.Handle) failures.unchanged.push(`${label}: Handle`);

      if (!isVariantRow(source)) continue;

      const originalPrice = source['Variant Price'];
      const discounted = Number(originalPrice) - Number(originalPrice) * (expectedDiscount / 100);
      const compareAt = Number(source['Variant Compare At Price']) > Number(originalPrice)
        ? source['Variant Compare At Price']
        : originalPrice;
      if (
        Math.abs(Number(row['Discounted Price']) - discounted) >= 0.005 ||
        row['Discounted Price'] !== calculateDiscountedPrice(originalPrice, expectedDiscount) ||
        row['Variant Price'] !== row['Discounted Price'] ||
        row['Variant Compare At Price'] !== compareAt
      ) {
        failures.price.push(`${label} ${optionValues(row, OPTION_SLOTS)}: ${originalPrice} → ${row['Variant Price']}`);
      }
      if (row['Original Price'] !== originalPrice || row['Original Compare At Price'] !== source['Variant Compare At Price']) {
        failures.originalPrice.push(`${label} ${optionValues(row, OPTION_SLOTS)}`);
      }
    }

    const sizeSlots = product.sizeSlots.length ? product.sizeSlots : [1];
    const inputVariants = product.rows.filter(isVariantRow);
    const outputVariants = outputRows.filter(isVariantRow);
    const inputSizes = inputVariants.map((r) => optionValues(r, sizeSlots));
    const outputSizes = [...new Set(outputVariants.map((r) => optionValues(r, sizeSlots)))];
    if (inputSizes.join() !== outputSizes.join()) failures.sizes.push(`${label}: ${inputSizes} → ${outputSizes}`);

    const optionSlots = OPTION_SLOTS.filter((n) => outputRows[0]?.[`Option${n} Name`]);
    const combinations = outputVariants.map((r) => optionValues(r, optionSlots));
    if (new Set(combinations).size !== combinations.length) failures.duplicates.push(label);

    for (const row of outputVariants) {
      if (optionSlots.some((n) => !row[`Option${n} Value`]) || row['Variant Price'] === '') {
        failures.empty.push(`${label}: ${optionValues(row, optionSlots)}`);
      }
    }

    if (product.canAddPack) {
      const packColumn = `Option${product.packSlot} Value`;
      if (outputRows[0][`Option${product.packSlot} Name`] !== PACK_OPTION_NAME) failures.pack.push(`${label}: no Pack option name`);
      for (const size of inputSizes) {
        for (const pack of PACK_VALUES) {
          const count = outputVariants.filter((r) => optionValues(r, sizeSlots) === size && r[packColumn] === pack).length;
          if (count !== 1) failures.pack.push(`${label}: ${size} / ${pack} found ${count} times`);
        }
      }
      if (outputVariants.length !== inputVariants.length * PACK_VALUES.length) failures.pack.push(`${label}: unexpected variant count`);
    } else if (outputVariants.length !== inputVariants.length) {
      failures.pack.push(`${label}: variants added to a product that cannot take Pack`);
    }
  }

  check('Discount matches product number (1–10: 5%, 11–20: 10%, 21+: 15%)', failures.discount);
  check('Every row of a product has the same discount', failures.sameDiscount);
  check('Discounted price = original − original × discount%, set as Variant Price', failures.price);
  check('Original price and compare-at price kept in review columns', failures.originalPrice);
  check('Every other field matches the source row (product fields, images, metafields, options)', failures.unchanged);
  check('Existing Size values unchanged and in the same order', failures.sizes);
  check('Pack of 2 and Pack of 3 exactly once per Size where Pack can be added', failures.pack);
  check('No duplicate option combinations within a product', failures.duplicates);
  check('No variant row with an empty option value or price', failures.empty);

  const skus = result.rows.filter(isVariantRow).map((r) => r['Variant SKU']).filter(Boolean);
  check('Variant SKUs are unique', [...new Set(skus.filter((s, i) => skus.indexOf(s) !== i))]);

  const allowedColumns = new Set([...headers, ...REVIEW_COLUMNS]);
  check(
    'Rows use only the original Shopify columns plus the review columns',
    [...new Set(result.rows.flatMap((r) => Object.keys(r).filter((k) => !allowedColumns.has(k))))]
  );

  return checks;
}

// Problems already in the source export. Reported, not fixed.
export function findSourceIssues(rows, blankRows = 0) {
  const issues = new Map();
  const note = (issue, label) => {
    if (!issues.has(issue)) issues.set(issue, []);
    if (label) issues.get(issue).push(label);
  };
  if (blankRows) note(`${blankRows} blank row(s) skipped`);

  const seen = new Set();
  rows.forEach((row, i) => {
    if (i > 0 && row.Handle !== rows[i - 1].Handle && seen.has(row.Handle)) note('Rows of a product are not next to each other', row.Handle);
    seen.add(row.Handle);
  });

  const skuOwner = new Map();
  for (const p of getUniqueProducts(rows)) {
    const label = `#${p.number}`;
    const variants = p.rows.filter(isVariantRow);
    const skus = variants.map((r) => r['Variant SKU']);
    const prices = [...new Set(variants.map((r) => r['Variant Price']))];
    const compareAt = variants.map((r) => r['Variant Compare At Price']);

    if (/^\d+$/.test(p.handle)) note(`Handle is only a number ("${p.handle}", title "${p.title}")`, label);
    if (skus.some((s) => !s)) note('Missing Variant SKU (left blank, not invented)', label);
    if (variants.length > 1 && skus[0] && new Set(skus).size === 1) note('One SKU shared by all Size variants', label);
    for (const sku of new Set(skus.filter(Boolean))) {
      if (skuOwner.has(sku)) note(`SKU "${sku}" used by more than one product`, `${skuOwner.get(sku)}, ${label}`);
      skuOwner.set(sku, label);
    }
    if (variants.some((r) => r['Variant Price'] === '')) note('Variant with no price (left undiscounted)', label);
    if (prices.length > 1) note('Price differs between sizes (each size keeps its own price)', `${label} (${prices.join(' / ')})`);

    if (compareAt.includes('0.00')) note('Compare At Price is 0.00', label);
    if (compareAt.some((c, i) => Number(c) > 0 && Number(c) < Number(variants[i]['Variant Price']))) {
      note('Compare At Price below the selling price (Shopify does not show it)', label);
    }
    if (compareAt.some((c, i) => Number(c) > Number(variants[i]['Variant Price']))) {
      note('Compare At Price above the selling price (kept as the struck-through price)', label);
    }
    if (compareAt.includes('') && compareAt.some((c) => c !== '')) note('Compare At Price filled on some sizes only', label);

    if (p.sizeSlots.length === 0) note(`No Size option (only "${p.optionNames.join(', ')}") – Pack not added`, label);
    else if (p.packSlot === undefined) note(`All 3 option slots used (${p.optionNames.join(', ')}) – Pack not added`, label);
  }

  return [...issues].map(([issue, labels]) => (labels.length ? `${issue}: ${labels.join(', ')}` : issue));
}
