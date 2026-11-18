# AACTIVATED Rx landing pages (Concepts v2, Nov 17 2026)

Six pages from *AACTIVATED_Rx_Landing_Pages_v2_2026-11-17.pdf*, each in its own folder
so it gets its own sub URL on **aactivatedrx.com**. No links go to `pure.aactivatedrx.com`.

| Page | Folder | Live URL once uploaded |
| --- | --- | --- |
| GLP-1 Medical Weight Loss | `glp-1-weight-loss/` | https://aactivatedrx.com/glp-1-weight-loss/ |
| NAD+ Energy and Longevity | `nad-plus/` | https://aactivatedrx.com/nad-plus/ |
| TB-500/BPC-157 Recovery | `tb-500-bpc-157-recovery/` | https://aactivatedrx.com/tb-500-bpc-157-recovery/ |
| Tretinoin + GHK-Cu Serum | `tretinoin-ghk-cu-serum/` | https://aactivatedrx.com/tretinoin-ghk-cu-serum/ |
| BPC-157 / TB-500 / GHK-Cu / KPV Injection | `bpc-157-tb-500-ghk-cu-kpv/` | https://aactivatedrx.com/bpc-157-tb-500-ghk-cu-kpv/ |
| Free Membership | `join-free/` | https://aactivatedrx.com/join-free/ |

`landing-pages/` is an index of all six (noindex). `lp-assets/` holds the shared CSS, JS and images.

## Deploy

Copy the contents of this folder to the web root of aactivatedrx.com so the folders above,
plus `lp-assets/`, sit next to the existing pages. Assets are referenced relatively
(`../lp-assets/`), so the pages also work from any other host for preview.
None of these slugs exist on the live site yet (all returned 404 on Nov 18 2026).

## Where the buttons go

| Button | Destination |
| --- | --- |
| Main CTA, top bar "Start today", option "Continue with…", closing CTA | GLP-1: `/find-my-program` (the 2 minute quiz) and `/weight-loss` for the plan options. NAD+: `/rx/nad-injection`. TB-500/BPC-157: `/rx/tb-500-bpc-157`. Tretinoin + GHK-Cu Serum: `/rx/glow-serum`. BPC-157 / TB-500 / GHK-Cu / KPV: `/rx/klow` (these are the live site's existing addresses) |
| See Why It Is Legal | `#why` on the same page |
| Why Telehealth / Products (nav) | `#why` / `#lineup` on the same page |
| Join Free (nav, members note), Join Free Now | `/become-a-member` |
| Continue with Premium (membership tab) | `/member-checkout?plan=premium` (pre-selects Premium) |
| Compare Memberships | `#plans` on the same page |
| Shop All Programs | `/shop` |
| Lineup "View product" cards | each product's live page above |
| "You are here" card | `#options` on the same page |
| Footer | privacy, terms, telehealth consent, shipping, refund, contact (+ member agreement, income disclaimer on the membership page) |

All destinations were checked and return 200 on aactivatedrx.com.
If a visitor lands with `am_id`, `sam_id` or `utm_*` in the URL, those are copied onto every
aactivatedrx.com link so referral credit carries through to checkout.

## Naming (compliance)

Products are named by their compounds, not brand nicknames: the serum page is
**Tretinoin 0.025% + GHK-Cu 0.2% Serum** and the four-peptide page is
**BPC-157 / TB-500 / GHK-Cu / KPV Injection** (15 / 15 / 50 / 15 mg per vial). Formulations
come from the product data on aactivatedrx.com (Nov 18 2026); confirm with the pharmacy before launch.
Photos showing the old brand labels on vials were removed.

## Still to fill before launch (placeholders from the PDF)

- `[PRICE]` on every option card
- `[REAL MEMBER REVIEW 1-3]`

The PDF only showed the first FAQ answer on each page; the other answers were written from
copy already in the PDF and on aactivatedrx.com. Premium membership details ($89/mo and
benefits) come from aactivatedrx.com/become-a-member.

## Editing

Pages are generated. Change copy, links or prices in `tools/build_aactivatedrx_landing.py`, then run:

```sh
python3 tools/build_aactivatedrx_landing.py
```
