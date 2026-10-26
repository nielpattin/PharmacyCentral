# Security Policy

## Supported versions

Security fixes are provided for:

- `main`
- The latest release published by the `Release application images` workflow ([.github/workflows/release.yml](.github/workflows/release.yml))

Older releases are not supported.

## Reporting a vulnerability

Do not open a public GitHub issue, pull request, or discussion for a security problem. Report it privately through GitHub private vulnerability reporting:

**https://github.com/nielpattin/PharmacyCentral/security/advisories/new**

You can also open the repository's **Security** tab and choose **Report a vulnerability**.

### What to include

- The affected component: the service, app, or deployment configuration, and the commit or release version.
- A description of the problem and its impact.
- Steps to reproduce, or a proof of concept.
- A suggested fix or mitigation, if you have one.

Do not include real customer data or live credentials in a report. Describe the problem with local or demo data.

### What to expect

We will confirm receipt, investigate, and coordinate a fix and disclosure in the advisory thread. Response times are best effort. No response or fix deadline is guaranteed.

## Scope notes

- **Secrets** live in a local `.env` file. That file is git-ignored and must never be committed. `.env.example` contains development placeholders only, and demo secrets must not be reused in production.
- **The SePay payment webhook** is verified with an HMAC signature. Reports of ways to bypass that verification are in scope.

For ordinary bugs, use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
