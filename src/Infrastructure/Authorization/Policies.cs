namespace PharmacyCentral.Infrastructure.Authorization;

public static class Policies
{
    public const string AnyRole = "AnyRole";

    public const string Management = "Management";

    public const string PlatformAdmin = "PlatformAdmin";

    public const string SiteScopedAccess = "SiteScopedAccess";

    public const string CounterSale = "CounterSale";

    public const string Warehouse = "Warehouse";
}
