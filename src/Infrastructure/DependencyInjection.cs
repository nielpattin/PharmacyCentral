using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PharmacyCentral.Application.Abstractions.Identity;
using PharmacyCentral.Application.Abstractions.Persistence;
using PharmacyCentral.Application.Audit.ListAuditLogEntries;
using PharmacyCentral.Application.Audit;
using PharmacyCentral.Application.Auth.Login;
using PharmacyCentral.Application.Auth.RegisterUser;
using PharmacyCentral.Application.Dashboard.GetDashboardSummary;
using PharmacyCentral.Application.Finance.GetFinanceSummary;
using PharmacyCentral.Application.GoodsReceipts.CreateGoodsReceipt;
using PharmacyCentral.Application.GoodsReceipts.GetGoodsReceiptById;
using PharmacyCentral.Application.GoodsReceipts.ListGoodsReceipts;
using PharmacyCentral.Application.Inventory.FefoAllocate;
using PharmacyCentral.Application.Inventory.ListInventoryBalances;
using PharmacyCentral.Application.Inventory.ListStockLedgerEntries;
using PharmacyCentral.Application.Inventory.RecordStockMovement;
using PharmacyCentral.Application.Inventory.Shared;
using PharmacyCentral.Application.Prescriptions.CancelPrescription;
using PharmacyCentral.Application.Prescriptions.CreatePrescription;
using PharmacyCentral.Application.Prescriptions.DispensePrescription;
using PharmacyCentral.Application.Prescriptions.GetPrescriptionById;
using PharmacyCentral.Application.Prescriptions.ListPrescriptions;
using PharmacyCentral.Application.Prescriptions.ListCounterTransactions;
using PharmacyCentral.Application.Pricing.CreatePrice;
using PharmacyCentral.Application.Pricing.GetActivePrice;
using PharmacyCentral.Application.Pricing.ListPrices;
using PharmacyCentral.Application.Pricing.UpdatePriceStatus;
using PharmacyCentral.Application.Procurement.CreatePurchaseOrder;
using PharmacyCentral.Application.Procurement.GetPurchaseOrderById;
using PharmacyCentral.Application.Procurement.ListPurchaseOrders;
using PharmacyCentral.Application.Procurement.UpdatePurchaseOrderStatus;
using PharmacyCentral.Application.Products.CreateProduct;
using PharmacyCentral.Application.Products.DeleteProduct;
using PharmacyCentral.Application.Products.GetProductById;
using PharmacyCentral.Application.Products.ListProducts;
using PharmacyCentral.Application.Products.UpdateProduct;
using PharmacyCentral.Application.Quality.ReviewProductBatchQuality;
using PharmacyCentral.Application.Recalls.CreateRecall;
using PharmacyCentral.Application.Recalls.ListRecalls;
using PharmacyCentral.Application.Recalls.UpdateAffectedBatch;
using PharmacyCentral.Application.Recalls.UpdateRecallStatus;
using PharmacyCentral.Application.Payments.ConfirmPayment;
using PharmacyCentral.Application.Payments.CreatePrescriptionPayment;
using PharmacyCentral.Application.Payments.GetPaymentStatus;
using PharmacyCentral.Application.Payments.GetPrintableInvoice;
using PharmacyCentral.Application.Payments.Shared;
using PharmacyCentral.Application.Payments.ConfirmCounterPayment;
using PharmacyCentral.Application.Payments.RefundPayment;
using PharmacyCentral.Application.Returns.CreateReturn;
using PharmacyCentral.Application.Replenishment.CancelReplenishmentRequest;
using PharmacyCentral.Application.Replenishment.CreateReplenishmentRequest;
using PharmacyCentral.Application.Replenishment.GetReplenishmentRequestById;
using PharmacyCentral.Application.Replenishment.ListReplenishmentRequests;
using PharmacyCentral.Application.Replenishment.ReviewReplenishmentRequest;
using PharmacyCentral.Application.Sites.CreateSite;
using PharmacyCentral.Application.Sites.DeleteSite;
using PharmacyCentral.Application.Sites.GetSiteById;
using PharmacyCentral.Application.Sites.ListSites;
using PharmacyCentral.Application.Sites.UpdateSite;
using PharmacyCentral.Application.Stocktakes.ApproveAdjustment;
using PharmacyCentral.Application.Stocktakes.CreateStockAdjustment;
using PharmacyCentral.Application.Stocktakes.CreateStocktakeSession;
using PharmacyCentral.Application.Stocktakes.GetStocktakeSessionById;
using PharmacyCentral.Application.Stocktakes.ListStockAdjustments;
using PharmacyCentral.Application.Stocktakes.ListStocktakeSessions;
using PharmacyCentral.Application.Stocktakes.PostAdjustments;
using PharmacyCentral.Application.Stocktakes.RecordCount;
using PharmacyCentral.Application.Stocktakes.Shared;
using PharmacyCentral.Application.StorageLocations.CreateStorageLocation;
using PharmacyCentral.Application.StorageLocations.DeleteStorageLocation;
using PharmacyCentral.Application.StorageLocations.GetStorageLocationById;
using PharmacyCentral.Application.StorageLocations.ListStorageLocations;
using PharmacyCentral.Application.StorageLocations.UpdateStorageLocation;
using PharmacyCentral.Application.Suppliers.CreateSupplier;
using PharmacyCentral.Application.Suppliers.DeleteSupplier;
using PharmacyCentral.Application.Suppliers.GetSupplierById;
using PharmacyCentral.Application.Suppliers.ListSuppliers;
using PharmacyCentral.Application.Suppliers.UpdateSupplier;
using PharmacyCentral.Application.Transfers.ApproveTransfer;
using PharmacyCentral.Application.Transfers.CancelTransfer;
using PharmacyCentral.Application.Transfers.CreateTransfer;
using PharmacyCentral.Application.Transfers.GetTransferById;
using PharmacyCentral.Application.Transfers.ListTransfers;
using PharmacyCentral.Application.Transfers.ReceiveTransfer;
using PharmacyCentral.Application.Transfers.ShipTransfer;
using PharmacyCentral.Infrastructure.Authorization;
using PharmacyCentral.Infrastructure.Identity;
using PharmacyCentral.Infrastructure.Payments.SePay;
using PharmacyCentral.Infrastructure.Persistence;
using PharmacyCentral.Infrastructure.Seeding;

namespace PharmacyCentral.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        string connectionString = configuration.GetConnectionString("PharmacyCentral")
            ?? throw new InvalidOperationException("Connection string 'PharmacyCentral' was not found.");

        services.AddDbContext<PharmacyCentralDbContext>(options =>
        {
            options.UseNpgsql(connectionString, npgsqlOptions =>
                npgsqlOptions.MigrationsAssembly(typeof(PharmacyCentralDbContext).Assembly.FullName!));
            options.ConfigureWarnings(warnings =>
                warnings.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning));
        });

        services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<PharmacyCentralDbContext>());

        services.AddIdentity<UserAccount, IdentityRole<Guid>>(options =>
        {
            options.Password.RequiredLength = 8;
            options.Password.RequireDigit = true;
            options.Password.RequireLowercase = true;
            options.Password.RequireUppercase = true;
            options.Password.RequireNonAlphanumeric = true;

            options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            options.Lockout.MaxFailedAccessAttempts = 5;
            options.Lockout.AllowedForNewUsers = true;

            options.User.RequireUniqueEmail = true;
            options.SignIn.RequireConfirmedAccount = false;
        })
        .AddEntityFrameworkStores<PharmacyCentralDbContext>()
        .AddDefaultTokenProviders();

        services.AddScoped<IPasswordHasher<UserAccount>, Argon2idPasswordHasher<UserAccount>>();

        services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-CSRF-TOKEN";
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
        });

        services.Configure<SecurityStampValidatorOptions>(options =>
        {
            options.ValidationInterval = TimeSpan.Zero;
        });

        services.ConfigureApplicationCookie(options =>
        {
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.ExpireTimeSpan = TimeSpan.FromDays(1);
            options.SlidingExpiration = true;
            options.Events.OnRedirectToLogin = context =>
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            };
            options.Events.OnRedirectToAccessDenied = context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                return Task.CompletedTask;
            };
        });

        services.AddAuthorizationBuilder()
            .AddPolicy(Policies.AnyRole, policy =>
                policy.RequireRole("Platform Admin", "Pharmacy Manager", "Pharmacist", "Warehouse Staff"))
            .AddPolicy(Policies.Management, policy =>
                policy.RequireRole("Platform Admin", "Pharmacy Manager"))
            .AddPolicy(Policies.PlatformAdmin, policy =>
                policy.RequireRole("Platform Admin"))
            .AddPolicy(Policies.SiteScopedAccess, policy =>
                policy.Requirements.Add(new SiteScopeRequirement()))
            .AddPolicy(Policies.CounterSale, policy =>
                policy.RequireRole("Pharmacist"))
            .AddPolicy(Policies.Warehouse, policy =>
                policy.RequireRole("Platform Admin", "Warehouse Staff"))
            .AddPolicy(Policies.Replenishment, policy =>
                policy.RequireRole("Platform Admin", "Pharmacist", "Warehouse Staff"));

        services.AddScoped<IAuthorizationHandler, SiteScopeAuthorizationHandler>();
        services.AddScoped<IIdentityService, IdentityService>();
        services.AddHttpContextAccessor();

        services.AddScoped<AuditLogService>();
        services.AddScoped<ListAuditLogEntriesQueryHandler>();
        services.AddScoped<GetDashboardSummaryQueryHandler>();
        services.AddScoped<GetFinanceSummaryHandler>();
        services.AddScoped<LoginHandler>();
        services.AddScoped<RegisterUserHandler>();
        services.AddScoped<CreateSiteCommandHandler>();
        services.AddScoped<DeleteSiteCommandHandler>();
        services.AddScoped<GetSiteByIdQueryHandler>();
        services.AddScoped<ListSitesQueryHandler>();
        services.AddScoped<UpdateSiteCommandHandler>();
        services.AddScoped<CreateStorageLocationCommandHandler>();
        services.AddScoped<DeleteStorageLocationCommandHandler>();
        services.AddScoped<GetStorageLocationByIdQueryHandler>();
        services.AddScoped<ListStorageLocationsQueryHandler>();
        services.AddScoped<UpdateStorageLocationCommandHandler>();
        services.AddScoped<CreateProductCommandHandler>();
        services.AddScoped<DeleteProductCommandHandler>();
        services.AddScoped<GetProductByIdQueryHandler>();
        services.AddScoped<ListProductsQueryHandler>();
        services.AddScoped<CreatePriceHandler>();
        services.AddScoped<ListPricesHandler>();
        services.AddScoped<GetActivePriceHandler>();
        services.AddScoped<UpdatePriceStatusHandler>();
        services.AddScoped<UpdateProductCommandHandler>();
        services.AddScoped<StockMovementRecorder>();
        services.AddScoped<StockReservationService>();
        services.AddScoped<RecordStockMovementCommandHandler>();
        services.AddScoped<FefoAllocateCommandHandler>();
        services.AddScoped<ListInventoryBalancesQueryHandler>();
        services.AddScoped<ListStockLedgerEntriesQueryHandler>();
        services.AddScoped<ReviewProductBatchQualityHandler>();
        services.AddScoped<CreateRecallHandler>();
        services.AddScoped<ListRecallsHandler>();
        services.AddScoped<UpdateRecallStatusHandler>();
        services.AddScoped<UpdateAffectedBatchHandler>();
        services.AddScoped<CreateReturnHandler>();
        services.AddScoped<CreateSupplierCommandHandler>();
        services.AddScoped<DeleteSupplierCommandHandler>();
        services.AddScoped<GetSupplierByIdQueryHandler>();
        services.AddScoped<ListSuppliersQueryHandler>();
        services.AddScoped<UpdateSupplierCommandHandler>();
        services.AddScoped<CreatePurchaseOrderHandler>();
        services.AddScoped<GetPurchaseOrderByIdHandler>();
        services.AddScoped<ListPurchaseOrdersHandler>();
        services.AddScoped<UpdatePurchaseOrderStatusHandler>();
        services.AddScoped<CreateGoodsReceiptCommandHandler>();
        services.AddScoped<GetGoodsReceiptByIdQueryHandler>();
        services.AddScoped<ListGoodsReceiptsQueryHandler>();
        services.AddScoped<StockAdjustmentMovementService>();
        services.AddScoped<CreateStocktakeSessionHandler>();
        services.AddScoped<RecordCountHandler>();
        services.AddScoped<PostStocktakeAdjustmentsHandler>();
        services.AddScoped<CreateStockAdjustmentHandler>();
        services.AddScoped<ApproveAdjustmentHandler>();
        services.AddScoped<GetStocktakeSessionByIdQueryHandler>();
        services.AddScoped<ListStocktakeSessionsQueryHandler>();
        services.AddScoped<ListStockAdjustmentsQueryHandler>();
        services.AddScoped<CreateTransferHandler>();
        services.AddScoped<ApproveTransferHandler>();
        services.AddScoped<ShipTransferHandler>();
        services.AddScoped<ReceiveTransferHandler>();
        services.AddScoped<CancelTransferHandler>();
        services.AddScoped<GetTransferByIdQueryHandler>();
        services.AddScoped<ListTransfersQueryHandler>();
        services.AddScoped<CreatePrescriptionHandler>();
        services.AddScoped<DispensePrescriptionHandler>();
        services.AddScoped<CancelPrescriptionHandler>();
        services.AddScoped<GetPrescriptionByIdQueryHandler>();
        services.AddScoped<ListPrescriptionsQueryHandler>();
        services.AddScoped<ListCounterTransactionsQueryHandler>();
        services.AddScoped<CreateReplenishmentRequestHandler>();
        services.AddScoped<GetReplenishmentRequestByIdHandler>();
        services.AddScoped<ListReplenishmentRequestsHandler>();
        services.AddScoped<ReviewReplenishmentRequestHandler>();
        services.AddScoped<CancelReplenishmentRequestHandler>();
        // Payment services
        services.AddScoped<PaymentCodeGenerator>();
        services.AddScoped<CreatePrescriptionPaymentHandler>();
        services.AddScoped<GetPaymentStatusHandler>();
        services.AddScoped<GetPrintableInvoiceHandler>();
        services.AddScoped<ConfirmPaymentHandler>();
        services.AddScoped<ConfirmCounterPaymentHandler>();
        services.AddScoped<RefundPaymentHandler>();

        // SePay adapter
        services.AddOptions<SePayOptions>()
            .Bind(configuration.GetSection(SePayOptions.SectionName))
            .ValidateDataAnnotations()
            .ValidateOnStart();
        services.PostConfigure<SePayOptions>(options =>
        {
            options.Enabled = configuration.GetValue<bool?>("PHARMACY_PAYMENT_SEPAY_ENABLED") ?? options.Enabled;
            options.Bank = configuration.GetValue<string>("PHARMACY_PAYMENT_SEPAY_BANK") ?? options.Bank;
            options.AccountNumber = configuration.GetValue<string>("PHARMACY_PAYMENT_SEPAY_ACCOUNT_NUMBER") ?? options.AccountNumber;
            options.Prefix = configuration.GetValue<string>("PHARMACY_PAYMENT_SEPAY_PREFIX") ?? options.Prefix;
            options.QrBaseUrl = configuration.GetValue<string>("PHARMACY_PAYMENT_SEPAY_QR_BASE_URL") ?? options.QrBaseUrl;
            options.WebhookSecret = configuration.GetValue<string>("PHARMACY_PAYMENT_SEPAY_WEBHOOK_SECRET") ?? options.WebhookSecret;
        });
        services.AddScoped<SePayQrCodeGenerator>();
        services.AddScoped<SePayWebhookVerifier>();

        services.AddHostedService<DatabaseSeederHostedService>();

        return services;
    }
}
