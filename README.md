# Pic To Link

**Every image can take you somewhere.**

Pic To Link is a camera-first visual link discovery and registration website. This repository is the first interactive frontend build, with a midnight-navy color palette, soft-violet primary actions, and electric-teal secondary details. The brand spelling is **Pic To Link**, regardless of the GitHub repository name.

## What's working in this preview

- Responsive camera-first interface with an immediate camera-permission request, manual scan option, and continuous throttled recognition attempts.
- Image upload from a phone or computer.
- Browser-local image registration and destination URL edits.
- One new free registration per month in the local preview, with previously registered links retained.
- Browse, pause, resume, and edit registered images in My Toolbox.
- Pricing view with monthly/yearly toggle: Free, $3.99/10, $9.99/50, $29.99/600 and two months free annually.
- Conceptual admin invitation form and complimentary account controls.
- Add-to-home-screen manifest and service worker.

## Important limitations

This is a **preview**, not a live multi-user registry. It keeps images and registrations in the browser's local storage. A registration on one phone does not become available on another phone. No payment is charged, no real email or temporary-password account is created, and the owner dashboard is illustrative only.

The image matcher is a basic 64-bit perceptual difference hash. It is useful for identical or similar digital artwork in this preview, but **is not sufficiently reliable for arbitrary physical T-shirts, distortions, lighting, partial views, or large datasets**. The production system will need a validated image-embedding and geometric-verification pipeline.

The input URL check currently rejects unsafe schemes and some obvious invalid destinations; it is **not** an adult-content, malware, or phishing moderation system. Do not invite public registrations without production-grade destination review and rights-dispute mechanisms.

## Deploy the static preview with Cloudflare Pages

1. Connect GitHub repository `ogdeig/pictosite` to Cloudflare Pages.
2. Choose a static site (no framework).
3. Leave the build command empty.
4. Set the build output directory to `public`.
5. Deploy over HTTPS for camera permissions.

No API keys are required for the static preview. The same `public` directory can be served by any static file server.

## Full production platform — next implementation stage

The agreed production architecture is:

- Cloudflare Worker for authenticated API, matching, URL reviews, and Stripe webhooks.
- Cloudflare D1 for users, sessions, plans, claims, URLs, scan events, and monthly quotas.
- Cloudflare R2 for compressed original artwork and previews.
- Cloudflare Vectorize (plus a tested multimodal vision model) for nearest-neighbor visual matching and confidence checks.
- Stripe Checkout/Billing for the three paid plans with monthly and yearly subscriptions.
- Secure email/password accounts, temporary-password VIP invitations (forced password reset), owner-only admin access, and role-based authorization.
- Ownership verification/dispute workflows and URL safety moderation.
- Scheduled 30-day paid-registration recovery after subscription expiration; preserve free-origin links.

Production pricing:

| Plan | Monthly | Yearly | Image allowance | Analytics |
|---|---:|---:|---|---|
| Free | $0 | $0 | One newly linked image per month | No |
| Starter | $3.99 | $39.90 | 10 active paid registrations | No |
| Creator | $9.99 | $99.90 | 50 active paid registrations | Yes |
| Pro | $29.99 | $299.90 | 600 active paid registrations | Yes |
| Complimentary VIP | Admin granted | Admin granted | Configurable, including unlimited | Yes |

Unlimited anonymous scans are free on every plan. URL edits do not consume image registrations. Free-origin images stay active; canceled paid-origin images pause after the paid-through date and remain recoverable for 30 days.

Do not treat the static preview as a production-ready paid product.
