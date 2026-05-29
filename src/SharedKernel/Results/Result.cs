namespace SharedKernel.Results;

public class Result
{
    protected Result(bool isSuccess, Error error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    public bool IsSuccess { get; }

    public bool IsFailure => !IsSuccess;

    public Error Error { get; }

    public static Result Success() => new(true, Error.None);

    public static Result Failure(Error error) => new(false, error);
}

public sealed class Result<T> : Result
{
    private Result(T value)
        : base(true, Error.None)
    {
        Value = value;
    }

    private Result(Error error)
        : base(false, error)
    {
        Value = default!;
    }

    public T Value { get; }

    public static Result<T> Success(T value) => new(value);

    public static implicit operator Result<T>(T value) => Success(value);

    public static implicit operator Result<T>(Error error) => new(error);
}
