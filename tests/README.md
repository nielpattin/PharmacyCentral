# Tests

This folder contains the permanent automated tests for Pharmacy Central.

## Run

From the repository root:

```bash
dotnet test PharmacyCentral.sln --artifacts-path .tmp/tests/dotnet-artifacts
```

## Scope

The current xUnit suite covers backend logic that can be tested directly without browser automation, external provider callbacks, or local tunnel setup:

- payment code generation
- invoice line snapshot shape
- provider-neutral payment transaction shape
- SePay HMAC-SHA256 verification
- provider QR URL generation

Do not add ad-hoc Node smoke scripts under `tests/`. For product-flow verification, use focused runtime checks for the feature being changed and keep those checks out of the permanent test suite unless they are converted into real automated tests.
