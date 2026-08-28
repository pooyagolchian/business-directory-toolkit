# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via
[GitHub Security Advisories](https://github.com/pooyagolchian/business-directory-toolkit/security/advisories/new),
or email **hello@pooyagolchian.com** with the subject `SECURITY`.

You can expect an acknowledgement within 3 business days and an assessment
within 10 business days.

## Scope

In scope:

- The pipeline and web code in this repository
- The deployed site at `directory.pooyagolchian.com`
- Secret handling and IAM configuration in `sst.config.ts`

Out of scope:

- Vulnerabilities in SearchApi, Google Maps, or AWS themselves
- Findings that require a compromised AWS account to exploit
- Automated scanner output with no demonstrated impact

## Secrets

This project must never contain credentials in source. Specifically:

- `.env` is git-ignored; only `.env.example` is committed
- Deployed credentials live in **AWS SSM Parameter Store**, set via
  `npx sst secret set SearchApiKey <value>` — never in code, never in CI logs
- CI authenticates to AWS via **OIDC role assumption**, not long-lived access keys
- No crawled dataset is committed, so no listing data can leak through git history

If you find a credential committed to this repository, treat it as a live
incident: report it privately using the process above so it can be rotated
before disclosure.
