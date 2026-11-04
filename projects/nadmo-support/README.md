# NADMO SUPPORT — Beta v1

Standalone support links and live-overlay product for PT Nadmo Studio Indonesia.

## Production Cloudflare
- Worker: `nadmo-support`
- Custom domain: `https://support.nadmo.id`
- D1 database: `nadmo-support` (binding `DB`; id `6bb12d44-70a0-4d59-89bd-2018545a137b`)
- Payments: **DISABLED** until DANA Bisnis verification, credential setup, payout authorization, webhook verification, idempotency tests and approved commercial model.

## Implemented
- Landing, registration/login with PBKDF2 passwords, D1 sessions, rate limiting
- Creator dashboard with bio, theme, goal, profile links (including Saweria and SociaBuzz)
- Public slug-based creator page
- OBS browser overlay polling *verified, consented* `paid` events only
- Payment endpoint explicitly 503; no fabricated transactions

## Must finish before public launch
1. Turnstile/CAPTCHA, email verification and password reset.
2. Verify host access and end-to-end signup/profile tests.
3. DANA partnership approval for a multi-creator marketplace model; securely set environment secrets.
4. Order creation, server-to-server callback signature and status validation, idempotency, refunds, payouts, accounting, tax and reconciliation.
5. Privacy policy, terms, creator content moderation/reporting, KYC/AML and legal review.
6. Confirm economics before choosing a platform fee. No 3% fee hardcoded.

## Architecture
Cloudflare Worker, D1, browser page+overlay. All client POST state changes require JSON and same-origin checks. Cookies HttpOnly/Secure. DANA callback is intentionally not functional yet. Do not accept client payment success status.

## Source note
This branch is a backup/source checkpoint. Live Worker was deployed via Cloudflare API, and this branch is **not** connected to automatic deploy.
