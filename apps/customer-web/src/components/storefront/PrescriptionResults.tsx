import { Alert, Badge, Button, Card, CardHeader, CardTitle, Dialog, Disclosure, cn } from "@pharmacy/ui";
import { useState } from "react";

import type {
  CatalogPrice,
  CatalogProduct,
  CatalogUnit,
  PrescriptionConsultationLine,
  PrescriptionIntakeLine,
  PrescriptionIntakeMatch,
  PrescriptionIntakeResult,
} from "../../customer-api.ts";
import { activeUnit, priceFor, productMetadataLabel } from "../../storefront/catalog.ts";
import { formatMoney } from "../../storefront/format.ts";
import { Link } from "./Link.tsx";
import { PharmacistRequestCard } from "./PharmacistRequestCard.tsx";
import { ProductTile } from "./ProductTile.tsx";

type CatalogContext = {
  priceIndex: Map<string, CatalogPrice>;
  pricesPending: boolean;
  stockIndex: Map<string, boolean>;
  addingProductId: string | undefined;
  onAdd: (product: CatalogProduct, unit: CatalogUnit) => void;
};

type BestPick = { product: CatalogProduct; unit: CatalogUnit; price: CatalogPrice | undefined };

type PrescriptionResultsProps = CatalogContext & {
  result: PrescriptionIntakeResult;
  /** Adds one unit of every pick and resolves with how many the cart accepted. */
  onAddMany: (picks: Array<{ product: CatalogProduct; unit: CatalogUnit }>) => Promise<number>;
  /** Files the read prescription with the pharmacists; rejects when it was not filed. */
  onAskPharmacist: (input: {
    requestKey: string;
    note: string | null;
    lines: PrescriptionConsultationLine[];
  }) => Promise<void>;
};

const SUMMARY_FIELDS = [
  ["Mã đơn", "code"],
  ["Bệnh nhân", "patientName"],
  ["Bác sĩ", "doctorName"],
  ["Ngày kê đơn", "issuedOn"],
] as const;

/** Known to differ from the prescribed line in strength, dosage form or composition, so it cannot fill it as written. */
const differsFromLine = (match: PrescriptionIntakeMatch): boolean =>
  match.strengthMatch === false || match.dosageFormMatch === false || match.ingredientsMatch === false;

/**
 * The catalog already ranks every product that differs from the line last. Within that order a product the chosen
 * store has run out of goes after the ones it can sell, so the first suggestion is the one the shopper can buy now.
 * The store is chosen on this page, which is why the catalog cannot order by stock itself.
 */
const orderForStore = (
  matches: PrescriptionIntakeMatch[],
  stockIndex: Map<string, boolean>,
): PrescriptionIntakeMatch[] => {
  const tier = (match: PrescriptionIntakeMatch): number =>
    differsFromLine(match) ? 2 : stockIndex.get(match.product.id) === false ? 1 : 0;
  return [...matches].sort((left, right) => tier(left) - tier(right));
};

const SuggestionRow = ({
  match,
  highlighted,
  priceIndex,
  pricesPending,
  stockIndex,
  addingProductId,
  onAdd,
}: CatalogContext & { match: PrescriptionIntakeMatch; highlighted: boolean }): React.JSX.Element => {
  const { product } = match;
  const unit = activeUnit(product);
  const price = unit ? priceFor(priceIndex, product.id, unit.id) : undefined;
  const inStock = stockIndex.get(product.id);
  const unavailable = inStock === false;
  const details = [productMetadataLabel(product), product.manufacturer].filter(Boolean).join(" · ");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center",
        highlighted ? "border-primary/30 bg-primary-soft/40" : "border-line bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <Link className="shrink-0" href={`/san-pham/${product.id}`}>
          <ProductTile
            name={product.name}
            seed={product.sku}
            imageUrl={product.imageUrl}
            className="size-14"
            monogramClassName="text-lg"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap gap-1">
            <Badge variant={match.matchType === "name" ? "primary" : "secondary"}>
              {match.matchType === "name" ? "Đúng tên" : "Cùng hoạt chất"}
            </Badge>
            {match.strengthMatch === true ? <Badge variant="primary">Đúng hàm lượng</Badge> : null}
            {match.strengthMatch === false ? <Badge variant="outline">Khác hàm lượng</Badge> : null}
            {match.dosageFormMatch === false ? <Badge variant="outline">Khác dạng bào chế</Badge> : null}
            {match.ingredientsMatch === false ? <Badge variant="outline">Khác thành phần</Badge> : null}
            {product.prescriptionRequired ? <Badge variant="danger">Thuốc kê đơn</Badge> : null}
          </div>
          <h5 className="line-clamp-2 text-sm font-medium text-ink" title={product.name}>
            <Link className="hover:text-primary" href={`/san-pham/${product.id}`}>
              {product.name}
            </Link>
          </h5>
          {details ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted" title={details}>
              {details}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:w-36 sm:shrink-0 sm:flex-col sm:items-end sm:justify-center">
        <div className="sm:text-right">
          {price && unit ? (
            <p className={cn("text-base font-semibold", unavailable ? "text-muted" : "text-danger")}>
              {formatMoney(price.unitPrice, price.currency)}
              <span className="text-xs font-normal text-muted"> / {unit.unitName}</span>
            </p>
          ) : pricesPending ? (
            <span className="block h-6 w-20 animate-pulse rounded bg-surface-soft" aria-hidden="true" />
          ) : (
            <p className="text-sm font-medium text-muted">Liên hệ báo giá</p>
          )}
          <p className="mt-0.5">
            {unavailable ? (
              <Badge variant="danger">Hết hàng</Badge>
            ) : inStock === true ? (
              <span className="text-xs text-muted">Còn hàng</span>
            ) : (
              <Badge variant="outline">Đang cập nhật</Badge>
            )}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 sm:w-full"
          variant={unavailable ? "secondary" : "primary"}
          disabled={addingProductId === product.id || !unit || product.prescriptionRequired}
          onClick={() => unit && onAdd(product, unit)}
        >
          {product.prescriptionRequired
            ? "Cần đơn thuốc"
            : addingProductId === product.id
              ? "Đang thêm..."
              : "Chọn mua"}
        </Button>
      </div>
    </div>
  );
};

const PrescribedMedicine = ({
  extracted,
  position,
}: {
  extracted: PrescriptionIntakeLine["extracted"];
  position: number;
}): React.JSX.Element => {
  const name = extracted.name ?? extracted.rawText;
  const form = [extracted.strength, extracted.dosageForm].filter(Boolean).join(" · ");
  const quantity =
    extracted.quantity !== null ? `${extracted.quantity}${extracted.unit ? ` ${extracted.unit}` : ""}` : undefined;
  return (
    <div className="flex min-w-0 gap-3">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-soft text-xs font-semibold text-muted"
      >
        {position}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-ink" title={extracted.rawText}>
          {name}
        </h4>
        {form ? <p className="mt-0.5 text-xs text-muted">{form}</p> : null}
        {extracted.activeIngredients.length > 0 ? (
          <p className="mt-0.5 text-xs text-muted">Hoạt chất: {extracted.activeIngredients.join(", ")}</p>
        ) : null}
        {quantity || extracted.usage ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink">
            {quantity ? <Badge variant="secondary">SL: {quantity}</Badge> : null}
            {extracted.usage ? <span>{extracted.usage}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
};

const MedicineRow = ({
  line,
  matches,
  position,
  ...catalog
}: CatalogContext & {
  line: PrescriptionIntakeLine;
  matches: PrescriptionIntakeMatch[];
  position: number;
}): React.JSX.Element => {
  const [best, ...alternatives] = matches;
  const exact = best !== undefined && !differsFromLine(best);
  return (
    <li
      className={cn(
        "grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-5",
        !exact && "bg-surface-soft/60",
      )}
    >
      <PrescribedMedicine extracted={line.extracted} position={position} />
      <div className="min-w-0">
        {best ? (
          <>
            {exact ? null : (
              <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge variant="outline">Chưa có thuốc đúng đơn</Badge>
                Các sản phẩm dưới đây khác với đơn, chỉ dùng khi dược sĩ đồng ý.
              </p>
            )}
            <SuggestionRow match={best} highlighted={exact} {...catalog} />
            {alternatives.length > 0 ? (
              <Disclosure
                className="mt-1"
                closedLabel={`Xem ${alternatives.length} lựa chọn khác`}
                openLabel="Ẩn các lựa chọn khác"
              >
                <div className="space-y-2">
                  {alternatives.map((match) => (
                    <SuggestionRow key={match.product.id} match={match} highlighted={false} {...catalog} />
                  ))}
                </div>
              </Disclosure>
            ) : null}
          </>
        ) : (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-line bg-surface px-3 py-3 text-sm text-muted">
            <Badge variant="outline">Chưa có gợi ý</Badge>
            Chưa tìm thấy thuốc tương ứng trong nhà thuốc
          </p>
        )}
      </div>
    </li>
  );
};

export const PrescriptionResults = ({
  result,
  onAddMany,
  onAskPharmacist,
  ...catalog
}: PrescriptionResultsProps): React.JSX.Element => {
  const [bulkStep, setBulkStep] = useState<"closed" | "confirm" | "adding" | "done">("closed");
  const [addedCount, setAddedCount] = useState(0);

  const { prescription, lines } = result;
  const fields = SUMMARY_FIELDS.flatMap(([label, key]) => {
    const value = prescription[key];
    return value ? [{ label, value }] : [];
  });
  const context = [
    prescription.diagnosis ? `Chẩn đoán: ${prescription.diagnosis}` : null,
    prescription.facilityName ? `Cơ sở khám: ${prescription.facilityName}` : null,
  ].filter(Boolean);

  const orderedMatches = lines.map((line) => orderForStore(line.matches, catalog.stockIndex));
  // What each line would be filled with: its first suggestion that differs from it in nothing, is not out of stock
  // at the chosen store and has a unit to sell. A line with none is one the pharmacists are asked about. A
  // prescription-only product is never picked, because it cannot go into the cart (BR-ORD-011).
  const linePicks = orderedMatches.map((matches): BestPick | undefined => {
    for (const match of matches) {
      const unit = activeUnit(match.product);
      if (
        unit &&
        !match.product.prescriptionRequired &&
        !differsFromLine(match) &&
        catalog.stockIndex.get(match.product.id) !== false
      ) {
        return { product: match.product, unit, price: priceFor(catalog.priceIndex, match.product.id, unit.id) };
      }
    }
    return undefined;
  });
  const picks = linePicks.filter(
    (pick, index): pick is BestPick =>
      pick !== undefined && linePicks.findIndex((other) => other?.product.id === pick.product.id) === index,
  );
  const helpLines = lines.filter((_line, index) => !linePicks[index]);

  const addAll = async (): Promise<void> => {
    setBulkStep("adding");
    setAddedCount(await onAddMany(picks));
    setBulkStep("done");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Đơn thuốc đã đọc</CardTitle>
            <p className="mt-1 text-sm text-muted">
              <span className="font-medium text-ink">{lines.length} thuốc</span>
              {" · "}
              {lines.length - helpLines.length} có gợi ý đúng đơn
              {helpLines.length > 0 ? ` · ${helpLines.length} cần dược sĩ hỗ trợ` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={result.source === "qr" ? "primary" : "secondary"}>
              {result.source === "qr" ? "Đọc từ mã QR" : "Đọc từ ảnh bằng AI"}
            </Badge>
            {picks.length > 0 ? (
              <Button size="sm" onClick={() => setBulkStep("confirm")}>
                Thêm {picks.length} gợi ý đúng đơn vào giỏ
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {fields.length > 0 || context.length > 0 ? (
          <div className="space-y-2 px-5 py-3">
            {fields.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-4">
                {fields.map((field) => (
                  <div key={field.label} className="min-w-0">
                    <dt className="text-xs text-muted">{field.label}</dt>
                    <dd className="truncate font-medium text-ink" title={field.value}>
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {context.length > 0 ? <p className="text-xs text-muted">{context.join(" · ")}</p> : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <ol className="divide-y divide-line">
          {lines.map((line, index) => (
            <MedicineRow
              key={index}
              line={line}
              matches={orderedMatches[index] ?? []}
              position={index + 1}
              {...catalog}
            />
          ))}
        </ol>
      </Card>

      {helpLines.length > 0 ? (
        <PharmacistRequestCard
          helpNames={helpLines.map((line) => line.extracted.name ?? line.extracted.rawText)}
          onSend={({ requestKey, note }) =>
            onAskPharmacist({
              requestKey,
              note,
              lines: lines.map((line, index) => ({ ...line.extracted, needsHelp: !linePicks[index] })),
            })
          }
        />
      ) : null}

      <Alert>
        Gợi ý chỉ mang tính tham khảo. Với thuốc kê đơn, dược sĩ sẽ xác nhận đơn trước khi bán. Ảnh đơn thuốc bạn tải
        lên không được lưu lại.
      </Alert>

      <Dialog
        open={bulkStep !== "closed"}
        onClose={() => bulkStep !== "adding" && setBulkStep("closed")}
        title={bulkStep === "done" ? "Đã xử lý giỏ hàng" : "Thêm các gợi ý đúng đơn vào giỏ?"}
      >
        {bulkStep === "done" ? (
          <>
            <p className="text-sm text-ink" role="status">
              Đã thêm {addedCount}/{picks.length} sản phẩm vào giỏ hàng.
              {addedCount < picks.length ? " Một số sản phẩm chưa thêm được, bạn có thể thử lại từng sản phẩm." : ""}
            </p>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setBulkStep("closed")}>Đóng</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Mỗi sản phẩm được thêm 1 đơn vị, bạn có thể chỉnh số lượng trong giỏ hàng. Dược sĩ sẽ xác nhận trước khi
              bán.
              {helpLines.length > 0 ? ` ${helpLines.length} thuốc chưa có sản phẩm đúng đơn nên không được thêm.` : ""}
            </p>
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {picks.map(({ product, unit, price }) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-ink" title={product.name}>
                    {product.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted">
                    {price ? `${formatMoney(price.unitPrice, price.currency)} / ${unit.unitName}` : "Liên hệ báo giá"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" disabled={bulkStep === "adding"} onClick={() => setBulkStep("closed")}>
                Hủy
              </Button>
              <Button disabled={bulkStep === "adding"} onClick={() => void addAll()}>
                {bulkStep === "adding" ? "Đang thêm..." : `Thêm ${picks.length} sản phẩm`}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
};
