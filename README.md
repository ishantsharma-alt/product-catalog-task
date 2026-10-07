# Product catalog task: discounts and Size × Pack variants

This project processes a Shopify product export (`data/products_export.csv`, 346 rows, 50 products). It:

1. gives each product a discount based on its position in the sheet, and
2. adds **Pack** (`Pack of 2`, `Pack of 3`) as a second variant option next to the existing **Size** option.

It writes a CSV you can upload to Shopify and an Excel workbook for review, and it validates the result against the source file.

## Assignment rules

| Products | Discount |
|---|---|
| 1–10 | 5% |
| 11–20 | 10% |
| 21 onwards | 15% |

- Products are counted as unique products, not as rows.
- Every variant of a product gets the same discount.
- Existing Size values stay exactly as they are.
- Each Size gets `Pack of 2` and `Pack of 3`.
- SKUs must be unique.
- All other product data is preserved.

## How it works

**Finding unique products.** In a Shopify export, one product spans several rows: one per variant, plus extra image rows. All of a product's rows share its `Handle`. Products are numbered by the order in which each Handle first appears, so each one gets its discount from that number, not from a row number.

**Discount.** `discountedPrice = originalPrice − originalPrice × discount%`. It is calculated in paise (hundredths of a rupee) and rounded to 2 decimals. Every source price is a whole hundred, so every result is exact.

- `Variant Price` is set to the discounted price.
- `Variant Compare At Price` is set to the original price, which Shopify shows struck through.
- If the source already had a compare-at price **higher** than the original price, that value is kept instead. This applies to three rows: the Custom Size rows of #7, #8 and #13.
- All other existing compare-at values were blank, 0.00, equal to the price or below it, so Shopify was not displaying them.
- The source CSV itself is never modified.

**Size × Pack.** For each product with a Size option, Pack goes into the next free option slot:

- **Normal products:** Option1 = Size, Option2 = Pack.
- **The six two-piece sets** (#31, #34, #37, #40, #43, #46): these already use Option1 and Option2 for two sizes (e.g. shirt size × skirt size), so Pack goes in Option3.

Each existing size row becomes `Pack of 2`. It keeps its product fields and its image. A `Pack of 3` row is inserted directly below it, carrying only the variant columns, the way Shopify exports extra variants. The result reads S / Pack of 2, S / Pack of 3, M / Pack of 2, and so on. Every existing size is included: S, M, L, XL, Custom Size and Free Size.

**Pack pricing (assumption).** The source has no pack-specific prices and the assignment gives no rule. So both packs **keep the existing price of their size**, and nothing is multiplied by 2 or 3. If a pack rule is supplied later, the place to apply it is `generatePackVariants` in `src/process.js`.

**SKU strategy.** The format is `ORIGINAL-SKU-SIZE-P2` / `-P3`.

- Examples: `CLTP 6-M-P2`, `CLTP 6-CUSTOM-P3`, and `BSK 46-S-XL-P2` for a set.
- This is needed because in the source one SKU is shared by every size of a product (e.g. all five sizes of #1 are `CLTP 6`).
- If a generated SKU is already taken, for example because two products share a base SKU, a `-2` suffix is added.
- Products without a source SKU (#27, #50) keep blank SKUs. Nothing is invented.

### Products where Pack is not added

| Product | Reason |
|---|---|
| #18–#22 (stoles) | No Size option, only Shopify's default `Title / Default Title` variant. There is no Size to combine Pack with. |
| #50 (`25000`, "Navy Blue Skirt Set \| SATT") | Already uses all 3 option slots (`Top Size`, `Bottom Size`, `Stole Option`). Shopify allows only 3 options. |

These products are still discounted, and their variants are otherwise unchanged.

## Run

Requires Node 18+.

```bash
npm install
npm run process        # data/products_export.csv -> output/
npm test
```

You can process another file with `node src/cli.js path/to/export.csv output-dir`. The script prints the summary, the validation results and any source-data issues. It exits with code 1 if any check fails.

### Browser interface

```bash
python3 -m http.server 8000      # any static server works; ES modules need http://
```

Open http://localhost:8000 and choose the CSV. The page shows the summary, the validation checks and the source issues, and has buttons to download the CSV and the workbook. It runs the same code as the CLI. ExcelJS is loaded from jsDelivr.

## Output

| File | Contents |
|---|---|
| `output/products_updated.csv` | **Upload file.** Same 78 columns, in the same order, as the original export. |
| `output/products_updated.xlsx` | **Review workbook.** The `Products` sheet has the upload data plus the review columns `Product No.`, `Original Price`, `Discount %`, `Discounted Price` and `Original Compare At Price` (green). Changed columns are yellow. The `Summary` sheet has the counts, validation results and source issues. |

## Results

- 50 unique products: 10 at 5%, 10 at 10%, 30 at 15%.
- 44 products given Pack, making **664 Size × Pack variants**. Rows go from 346 to 678.
- All 13 validation checks pass, and all 11 tests pass.

Validation (`src/validate.js`) pairs every output row with the source row it came from and compares **every column**. Only `Variant Price`, `Variant Compare At Price`, `Variant SKU` and the Pack option columns may differ. The checks cover:

- product count and order
- the discount tier for each product, the same on every row of the product
- the price maths, with the original price traceable to the source
- Size values unchanged
- each Size × Pack exactly once
- no duplicate option combinations
- no empty variant rows
- unique SKUs
- no unexpected columns
- the CSV reading back with the original header

### Issues found in the source file

- 42 products use one SKU for every size.
- #27 and #50 have no SKU.
- #50's handle is the number `25000`, which looks like a price entered as the handle.
- Compare-at prices:
  - below the selling price on 14 products
  - 0.00 on 3 products
  - filled for only some sizes on 6 products
- #6 and #30 charge more for Custom Size. Each size keeps its own price.

## Code

| File | Responsibility |
|---|---|
| `src/process.js` | `getUniqueProducts`, `getDiscountPercent`, `calculateDiscountedPrice`, `generatePackVariants`, `generateVariantSku`, `processProducts` |
| `src/validate.js` | `validateProducts` (source vs output comparison) and `findSourceIssues` |
| `src/pipeline.js` | parse → process → validate. Used by the CLI and the browser page. |
| `src/csv.js` | CSV reader/writer. It handles quoted commas, quotes and line breaks in Body HTML. |
| `src/workbook.js` | Review workbook (ExcelJS) |
| `src/cli.js`, `index.html` + `src/app.js` | Node and browser entry points |
| `test/process.test.js` | Unit tests, edge cases, and a full run on the provided export |
