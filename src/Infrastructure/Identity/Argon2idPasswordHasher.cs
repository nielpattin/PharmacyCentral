using System.Buffers.Binary;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using NSec.Cryptography;

namespace PharmacyCentral.Infrastructure.Identity;

public sealed class Argon2idPasswordHasher<TUser> : IPasswordHasher<TUser>
    where TUser : class
{
    private const int SaltSize = 16;
    private const int HashSize = 32;
    private const long MemorySizeKB = 65536;
    private const long NumberOfPasses = 3;
    private const int DegreeOfParallelism = 1;
    private const byte FormatVersion = 0x01;

    public string HashPassword(TUser user, string password)
    {
        byte[] salt = new byte[SaltSize];
        RandomNumberGenerator.Fill(salt);

        byte[] hash = DeriveHash(password, salt, MemorySizeKB, NumberOfPasses, DegreeOfParallelism);

        return EncodeHash(salt, hash, MemorySizeKB, NumberOfPasses, DegreeOfParallelism);
    }

    public PasswordVerificationResult VerifyHashedPassword(TUser user, string hashedPassword, string providedPassword)
    {
        if (!TryDecodeHash(hashedPassword, out byte[] salt, out byte[] expectedHash,
                out long memorySizeKB, out long passes, out int parallelism))
        {
            return PasswordVerificationResult.Failed;
        }

        byte[] providedHash = DeriveHash(providedPassword, salt, memorySizeKB, passes, parallelism);

        bool match = CryptographicOperations.FixedTimeEquals(expectedHash, providedHash);
        if (!match)
        {
            return PasswordVerificationResult.Failed;
        }

        bool needsRehash = memorySizeKB != MemorySizeKB || passes != NumberOfPasses || parallelism != DegreeOfParallelism;
        return needsRehash ? PasswordVerificationResult.SuccessRehashNeeded : PasswordVerificationResult.Success;
    }

    private static byte[] DeriveHash(string password, byte[] salt, long memorySizeKB, long passes, int parallelism)
    {
        Argon2id algorithm = PasswordBasedKeyDerivationAlgorithm.Argon2id(new Argon2Parameters
        {
            MemorySize = memorySizeKB,
            NumberOfPasses = passes,
            DegreeOfParallelism = parallelism
        });

        return algorithm.DeriveBytes(System.Text.Encoding.UTF8.GetBytes(password), salt, HashSize);
    }

    private static string EncodeHash(byte[] salt, byte[] hash, long memorySizeKB, long passes, int parallelism)
    {
        byte[] output = new byte[1 + SaltSize + HashSize + 12];
        output[0] = FormatVersion;
        salt.CopyTo(output.AsSpan(1));
        hash.CopyTo(output.AsSpan(1 + SaltSize));

        Span<byte> paramSpan = output.AsSpan(1 + SaltSize + HashSize);
        BinaryPrimitives.WriteInt32LittleEndian(paramSpan[..4], (int)memorySizeKB);
        BinaryPrimitives.WriteInt32LittleEndian(paramSpan[4..8], (int)passes);
        BinaryPrimitives.WriteInt32LittleEndian(paramSpan[8..12], parallelism);

        return Convert.ToBase64String(output);
    }

    private static bool TryDecodeHash(string encoded, out byte[] salt, out byte[] hash,
        out long memorySizeKB, out long passes, out int parallelism)
    {
        salt = [];
        hash = [];
        memorySizeKB = 0;
        passes = 0;
        parallelism = 0;

        byte[] data;
        try
        {
            data = Convert.FromBase64String(encoded);
        }
        catch (FormatException)
        {
            return false;
        }

        if (data.Length != 1 + SaltSize + HashSize + 12 || data[0] != FormatVersion)
        {
            return false;
        }

        salt = data[1..(1 + SaltSize)];
        hash = data[(1 + SaltSize)..(1 + SaltSize + HashSize)];

        Span<byte> paramSpan = data.AsSpan(1 + SaltSize + HashSize);
        memorySizeKB = BinaryPrimitives.ReadInt32LittleEndian(paramSpan[..4]);
        passes = BinaryPrimitives.ReadInt32LittleEndian(paramSpan[4..8]);
        parallelism = BinaryPrimitives.ReadInt32LittleEndian(paramSpan[8..12]);

        return true;
    }
}
