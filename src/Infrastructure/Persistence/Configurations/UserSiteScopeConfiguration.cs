using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PharmacyCentral.Infrastructure.Identity;

namespace PharmacyCentral.Infrastructure.Persistence.Configurations;

internal sealed class UserSiteScopeConfiguration : IEntityTypeConfiguration<UserSiteScope>
{
    public void Configure(EntityTypeBuilder<UserSiteScope> builder)
    {
        builder.ToTable("user_site_scopes");

        builder.HasKey(scope => scope.Id);

        builder.Property(scope => scope.Id)
            .HasColumnName("id");

        builder.Property(scope => scope.UserId)
            .HasColumnName("user_id")
            .IsRequired();

        builder.Property(scope => scope.SiteId)
            .HasColumnName("site_id")
            .IsRequired();

        builder.HasIndex(scope => new { scope.UserId, scope.SiteId })
            .IsUnique();

        builder.HasIndex(scope => scope.SiteId);

        builder.HasOne(scope => scope.User)
            .WithMany(user => user.SiteScopes)
            .HasForeignKey(scope => scope.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(scope => scope.Site)
            .WithMany()
            .HasForeignKey(scope => scope.SiteId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
