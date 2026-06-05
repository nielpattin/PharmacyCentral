namespace PharmacyCentral.Application.Dashboard.Shared;

public sealed record DashboardSummaryDetails(
    int TotalSites,
    int ActiveSites,
    int TotalStorageLocations,
    int ActiveStorageLocations,
    int TotalProducts,
    int TotalSuppliers,
    decimal TotalQuantityOnHand,
    decimal TotalQuantityReserved,
    int LowStockBatchCount,
    int ExpiringBatchCount,
    int PendingTransferCount,
    int OpenPrescriptionCount,
    int OpenStocktakeCount,
    int PendingAdjustmentCount,
    IReadOnlyList<DashboardActivityDetails> RecentActivity);
