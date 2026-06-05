namespace PharmacyCentral.Application.Finance.Shared;

public sealed record FinanceSummaryDetails(
    Guid? SiteId,
    DateOnly From,
    DateOnly To,
    decimal TotalQuantityOnHand,
    decimal TotalQuantityReserved,
    decimal InventoryValue,
    decimal ReservedValue,
    int BalanceCount,
    int MissingPriceCount,
    int ReceiptCount,
    decimal ReceiptQuantity,
    decimal DispensedQuantity,
    decimal ReturnQuantity,
    decimal AdjustmentQuantity,
    decimal TransferOutQuantity,
    decimal TransferInQuantity,
    IReadOnlyList<FinanceInventoryValuationLine> ValuationLines,
    IReadOnlyList<FinanceActivityLine> ActivityLines);

public sealed record FinanceInventoryValuationLine(
    Guid ProductId,
    string ProductSku,
    string ProductName,
    Guid ProductBatchId,
    string BatchNumber,
    Guid SiteId,
    string SiteName,
    Guid StorageLocationId,
    string StorageLocationName,
    decimal QuantityOnHand,
    decimal QuantityReserved,
    decimal AvailableQuantity,
    decimal? UnitPrice,
    string Currency,
    decimal ValueOnHand,
    decimal ReservedValue,
    string PriceStatus);

public sealed record FinanceActivityLine(
    string ActivityType,
    int Count,
    decimal QuantityIn,
    decimal QuantityOut,
    DateTimeOffset? LatestActivityAtUtc);
