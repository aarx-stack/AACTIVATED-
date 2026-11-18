#!/usr/bin/env python3
"""Build the AACTIVATED Rx landing pages (Landing Page Concepts v2, Nov 17 2026).

Writes one folder per page into ../aactivatedrx/<slug>/index.html so each page
gets its own sub URL on aactivatedrx.com, e.g. https://aactivatedrx.com/klow-blend/

Every outbound link points at https://aactivatedrx.com (never pure.aactivatedrx.com).
Edit the PAGES data below (prices, copy, links) and re-run:

    python3 tools/build_aactivatedrx_landing.py
"""
from html import escape
from pathlib import Path

SITE = "https://aactivatedrx.com"
OUT = Path(__file__).resolve().parent.parent / "aactivatedrx"
A = "../lp-assets"  # shared assets, relative so the folder works anywhere

# ---- destinations on the live site (all verified 200 on aactivatedrx.com) ----
FIND_PROGRAM = f"{SITE}/find-my-program"   # the 2 minute quiz
SHOP = f"{SITE}/shop"
JOIN = f"{SITE}/become-a-member"
PREMIUM_CHECKOUT = f"{SITE}/member-checkout?plan=premium"
MEMBER_AGREEMENT = f"{SITE}/member-agreement"
PRODUCT = {
    "glp1": f"{SITE}/weight-loss",
    "nad": f"{SITE}/rx/nad-injection",
    "nad_nasal": f"{SITE}/rx/nad-nasal-spray",
    "tb": f"{SITE}/rx/tb-500-bpc-157",
    "glow": f"{SITE}/rx/glow-serum",
    "klow": f"{SITE}/rx/klow",
}
PRICE = '<span class="ph">[PRICE]</span>'  # placeholder per the concept doc

LINEUP = [
    ("glp1", "GLP-1 Weight Loss", "Provider guided weight loss", "glp1-vial.jpg"),
    ("nad", "NAD+", "Cellular energy support", "nad-vials.jpg"),
    ("tb", "TB-500/BPC-157", "Recovery and repair", "tb500-bpc157-vial.jpg"),
    ("glow", "GLOW+", "Skin, hair and beauty", "glow-vial.jpg"),
    ("klow", "KLOW", "Signature four peptide blend", "klow-kit.jpg"),
]

LEGAL_ANSWER = (
    "Yes. A licensed U.S. provider evaluates you through telehealth. If treatment is right for you, "
    "a prescription is written in your name and a state licensed 503A pharmacy prepares it for you. "
    "That is the difference from sites that sell vials labeled “research use only, not for human consumption.”"
)
SHIP_ANSWER = (
    "If prescribed, your medication is prepared by a licensed 503A pharmacy and shipped cold and overnight, "
    "so it arrives the way the pharmacy made it."
)

PAGES = [
    dict(
        key="glp1", slug="glp-1-weight-loss",
        title="GLP-1 Medical Weight Loss | AACTIVATED Rx",
        desc="Compounded Semaglutide and Tirzepatide programs, prescribed after a private online visit and shipped cold, overnight, from a licensed 503A pharmacy.",
        cta=("Start My 2 Minute Quiz", FIND_PROGRAM),
        eyebrow="Medical Weight Loss Program",
        h1="Weight loss guided by a licensed provider. Delivered to your door.",
        lede="Compounded Semaglutide and Tirzepatide programs, prescribed after a private online visit and shipped cold, overnight, from a licensed 503A pharmacy.",
        gallery=[("glp1-vial.jpg", "AACTIVATED Rx GLP-1 vial"), ("woman-app.jpg", "Member checking progress in the app"), ("cold-chain.jpg", "Vial packed in a cold shipping box")],
        members_img=("couple-fitness.jpg", "Two members smiling after a workout"),
        points=[
            ("Provider led, start to finish", "A licensed provider reviews your history and adjusts your plan with you."),
            ("Try 1 month first", "Start with a single month starter option before a longer plan."),
            ("Subscribe and save 10%", "Auto renewing plans cost 10% less than a single purchase. Cancel any time."),
            ("Track every win", "The GetClear Health app keeps your progress and check ins in one place."),
        ],
        options=[
            ("Single purchase", "Try 1 Month", "Starter supply for new patients", PRODUCT["glp1"]),
            ("Most popular", "Subscribe", "10% off, renews automatically, cancel any time", PRODUCT["glp1"]),
        ],
        faq=[
            ("Do I need a prescription already?", "No. Your online visit is how a licensed provider decides whether a prescription is right for you."),
            ("Which option should I start with?", "Many new patients start with Try 1 Month. If you already plan to continue, Subscribe costs 10% less and you can cancel any time. Your provider confirms everything during your online visit."),
            ("How is it shipped?", SHIP_ANSWER),
            ("Is this legal?", LEGAL_ANSWER),
        ],
        closer="Your next chapter starts with a 2 minute quiz.",
        closer_img=("glp1-vial.jpg", "AACTIVATED Rx GLP-1 vial"),
    ),
    dict(
        key="nad", slug="nad-plus",
        title="NAD+ Energy and Longevity | AACTIVATED Rx",
        desc="Provider guided NAD+ designed to support cellular energy and healthy aging. Injection or nasal, prescribed through telehealth.",
        cta=("Start My Online Visit", PRODUCT["nad"]),
        eyebrow="Energy and Longevity",
        h1="Fuel the way your cells make energy.",
        lede="NAD+ is a coenzyme in every cell, and research suggests levels decline with age. Our provider guided NAD+ is designed to support cellular energy and healthy aging.",
        gallery=[("nad-vials.jpg", "AACTIVATED Rx NAD+ vial and nasal spray"), ("man-laptop.jpg", "Member working at a laptop"), ("cells.jpg", "Illustration of cells")],
        members_img=("man-laptop.jpg", "Member working at a laptop"),
        points=[
            ("Cellular energy support", "NAD+ plays a central role in turning food into usable energy."),
            ("Healthy aging focus", "Studied for its role in cellular repair processes that slow over time."),
            ("Injection or nasal", "Two formats. Your provider helps you pick the one that fits your routine."),
            ("Clarity and focus", "Members pair NAD+ with sleep, training and nutrition for a sharper day."),
        ],
        options=[
            ("One vial", "Single Purchase", "No commitment", PRODUCT["nad"]),
            ("Most popular", "Subscribe", "10% off, ships on your schedule", PRODUCT["nad"]),
        ],
        faq=[
            ("Is NAD+ right for me?", "A licensed provider reviews your history during your online visit and makes that decision."),
            ("Injection or nasal?", f'Both are available: <a href="{PRODUCT["nad"]}">NAD+ Injection</a> and <a href="{PRODUCT["nad_nasal"]}">NAD+ Nasal Spray</a>. Your provider helps you pick the format that fits your routine.'),
            ("Can I pause my subscription?", "You can cancel any time in your patient portal before your next charge. For any other change, contact support at <a href=\"mailto:contact@aactivatedrx.com\">contact@aactivatedrx.com</a>, 8am to 5pm."),
            ("Is this legal?", LEGAL_ANSWER),
        ],
        closer="Feel the difference real energy makes.",
        closer_img=("nad-vials.jpg", "AACTIVATED Rx NAD+ vial and nasal spray"),
    ),
    dict(
        key="tb", slug="tb-500-bpc-157-recovery",
        title="TB-500/BPC-157 Recovery | AACTIVATED Rx",
        desc="TB-500/BPC-157 Injection pairs two of the most researched recovery peptides in one provider guided protocol.",
        cta=("Start My Online Visit", PRODUCT["tb"]),
        eyebrow="Recovery and Performance",
        h1="Train hard. Recover smarter.",
        lede="TB-500/BPC-157 Injection pairs two of the most researched recovery peptides in one provider guided protocol, designed to support tissue repair so you get back to work.",
        gallery=[("tb500-bpc157-vial.jpg", "AACTIVATED Rx TB-500/BPC-157 vial"), ("man-training.jpg", "Athlete lifting in the gym"), ("woman-stretch.jpg", "Runner stretching outdoors")],
        members_img=("woman-stretch.jpg", "Runner stretching outdoors"),
        points=[
            ("Two peptides, one protocol", "BPC-157 and TB-500 are studied for their roles in tendon, ligament and muscle repair."),
            ("Built for active people", "For lifters, runners, weekend athletes and anyone whose body takes a beating."),
            ("Provider guided", "A licensed provider reviews your goals and history before anything ships."),
            ("Pairs with your training", "Recovery works best beside sleep, nutrition and smart programming."),
        ],
        options=[
            ("One vial", "Single Purchase", "Try it once", PRODUCT["tb"]),
            ("Best value", "Subscribe", "10% off, auto renews, cancel any time", PRODUCT["tb"]),
        ],
        faq=[
            ("Who is this for?", "Active adults focused on recovery. Your provider confirms whether it fits you."),
            ("What does the research say?", "BPC-157 and TB-500 are studied for their roles in tendon, ligament and muscle repair. Much of that research is early, and compounded medications are not FDA approved. Your provider walks you through what is known and whether it fits your goals."),
            ("How does it arrive?", SHIP_ANSWER),
            ("Is this legal?", LEGAL_ANSWER),
        ],
        closer="Your best session starts with recovery.",
        closer_img=("tb500-bpc157-vial.jpg", "AACTIVATED Rx TB-500/BPC-157 vial"),
    ),
    dict(
        key="glow", slug="glow-plus",
        title="GLOW+ Skin, Hair and Beauty | AACTIVATED Rx",
        desc="GLOW+ is our provider guided beauty formula, designed to support collagen, skin firmness and healthy hair.",
        cta=("Get My GLOW+", PRODUCT["glow"]),
        eyebrow="Skin, Hair and Beauty",
        h1="Glow from the inside out.",
        lede="GLOW+ is our provider guided beauty formula, designed to support collagen, skin firmness and healthy hair as part of your routine.",
        gallery=[("glow-vial.jpg", "AACTIVATED Rx GLOW+ vial"), ("woman-skin.jpg", "Woman with glowing skin"), ("man-skin.jpg", "Man with clear skin")],
        members_img=("woman-skin.jpg", "Woman with glowing skin"),
        points=[
            ("Collagen support", "Copper peptides are studied for their role in collagen production and skin repair."),
            ("Firmness and tone", "Designed to support smoother, firmer looking skin over time."),
            ("Hair and scalp", "Research suggests a role in supporting healthy hair follicles."),
            ("For everyone", 'Built for women and men who want to support skin and hair health. <span class="ph">[CONFIRM GLOW+ FORMULA]</span>'),
        ],
        options=[
            ("One vial", "Single Purchase", "Try GLOW+", PRODUCT["glow"]),
            ("Every 2 months", "Subscribe", "10% off, ships automatically", PRODUCT["glow"]),
        ],
        faq=[
            ("When will I notice a difference?", "Everyone is different. Skin changes take consistent use over weeks, not days."),
            ("Can men use GLOW+?", "Yes. GLOW+ is built for women and men who want to support skin and hair health. Your provider confirms whether it is right for you."),
            ("Do I need a prescription?", "GLOW+ is a prescription product, but you do not need one before you start. Your online visit is how a licensed provider decides whether it is right for you."),
            ("Is this legal?", LEGAL_ANSWER),
        ],
        closer="Your skin keeps score. Give it support.",
        closer_img=("glow-vial.jpg", "AACTIVATED Rx GLOW+ vial"),
    ),
    dict(
        key="klow", slug="klow-blend",
        title="KLOW Signature Blend | AACTIVATED Rx",
        desc="KLOW brings recovery and skin support peptides together in one provider guided protocol.",
        cta=("Start With KLOW", PRODUCT["klow"]),
        eyebrow="Signature Blend",
        h1="KLOW. Four peptides. One complete routine.",
        lede="Our signature blend brings recovery and skin support peptides together in one provider guided protocol, for people who want performance and appearance in a single plan.",
        gallery=[("klow-kit.jpg", "AACTIVATED Rx KLOW two vial kit"), ("couple-fitness.jpg", "Two members smiling after a workout"), ("man-training.jpg", "Athlete lifting in the gym")],
        members_img=("couple-fitness.jpg", "Two members smiling after a workout"),
        points=[
            ("Recovery and repair", 'Includes BPC-157 and TB-500, studied for tissue repair. <span class="ph">[CONFIRM KLOW FORMULA]</span>'),
            ("Skin and collagen", "Includes GHK-Cu, studied for collagen support and skin renewal."),
            ("Calm from within", "Includes KPV, studied for supporting a balanced inflammatory response."),
            ("One simple plan", "Four peptides in one protocol means fewer products and one routine."),
        ],
        options=[
            ("2 vial pack", "Single Purchase", "No commitment", PRODUCT["klow"]),
            ("Best value", "Subscribe", "10% off, auto renews", PRODUCT["klow"]),
        ],
        faq=[
            ("Why a blend?", "One protocol covers recovery and skin support instead of buying products separately."),
            ("Who is KLOW for?", "People who want recovery and skin support in a single plan. A licensed provider reviews your goals and history before anything ships."),
            ("How is it shipped?", SHIP_ANSWER),
            ("Is this legal?", LEGAL_ANSWER),
        ],
        closer="One blend. Every goal.",
        closer_img=("klow-kit.jpg", "AACTIVATED Rx KLOW two vial kit"),
    ),
]

MEMBERSHIP = dict(
    key="join", slug="join-free",
    title="Free Membership | AACTIVATED Rx",
    desc="Create your free AACTIVATED Rx membership in under a minute. 10% off every product, the GetClear Health app at no cost, and monthly member rewards.",
    cta=("Join Free", JOIN),
)

# ---------------------------------------------------------------------------

CHECK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>'
CROSS = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>'
ARROW = '<svg class="arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>'


def e(s):
    return escape(s, quote=True)


def img(name, alt, cls="", eager=False):
    c = f' class="{cls}"' if cls else ""
    load = "" if eager else ' loading="lazy"'
    return f'<img{c} src="{A}/img/{name}" alt="{e(alt)}"{load} decoding="async">'


def head(p):
    url = f"{SITE}/{p['slug']}/"
    og = p.get("gallery", [("members-group.jpg", "")])[0][0]
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(p['title'])}</title>
<meta name="description" content="{e(p['desc'])}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AACTIVATED Rx">
<meta property="og:title" content="{e(p['title'])}">
<meta property="og:description" content="{e(p['desc'])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/lp-assets/img/{og}">
<meta name="theme-color" content="#000000">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="{A}/lp.css">
</head>
<body>
"""


def header(cta):
    label, href = cta
    return f"""<div class="topbar">Licensed telehealth. Real prescriptions. Prepared by U.S. 503A pharmacies.<a href="{href}">Start today</a></div>
<header class="header">
  <div class="wrap">
    <a class="logo" href="{SITE}/">AACTIVATED <span>Rx</span></a>
    <nav class="nav" aria-label="Main">
      <a href="#why">Why Telehealth</a>
      <a href="#lineup">Products</a>
      <a href="{JOIN}">Join Free</a>
      <a class="btn btn--primary btn--sm" href="{href}">{e(label)}</a>
    </nav>
  </div>
</header>
<main>
"""


def gallery(items):
    main_src, main_alt = items[0]
    thumbs = "".join(
        f'<button class="thumb" type="button" aria-pressed="{str(i == 0).lower()}" aria-label="Show image {i + 1}" '
        f'data-src="{A}/img/{s}" data-alt="{e(a)}">{img(s, "", eager=True)}</button>'
        for i, (s, a) in enumerate(items)
    )
    return f"""<div class="gallery" data-gallery>
        <div class="gallery__main">{img(main_src, main_alt, eager=True)}</div>
        <div class="gallery__thumbs">{thumbs}</div>
      </div>"""


def hero(eyebrow, h1, lede, primary, secondary, checks, items):
    checks_html = "".join(f"<li>{CHECK}{e(c)}</li>" for c in checks)
    return f"""<section class="hero">
  <div class="wrap">
    <div>
      <p class="eyebrow">{e(eyebrow)}</p>
      <h1>{e(h1)}</h1>
      <p class="lede">{e(lede)}</p>
      <div class="cta-row">
        <a class="btn btn--primary" href="{primary[1]}">{e(primary[0])} {ARROW}</a>
        <a class="btn btn--ghost" href="{secondary[1]}">{e(secondary[0])}</a>
      </div>
      <ul class="checks">{checks_html}</ul>
    </div>
    {gallery(items)}
  </div>
</section>
"""


def why():
    rows = [
        ("Evaluated by a licensed provider", "Yes", "No"),
        ("Prescription written in your name", "Yes", "No"),
        ("Prepared by a state licensed 503A pharmacy", "Yes", "Unknown source"),
        ("Labeled for human use", "Yes", "“Not for human consumption”"),
        ("Cold shipped overnight", "Yes", "Often not"),
        ("Ongoing provider support", "Yes", "No"),
    ]
    trs = "".join(
        f'<tr><td>{e(a)}</td><td><span class="yes">{CHECK}{e(b)}</span></td><td><span class="no">{CROSS}{e(c)}</span></td></tr>'
        for a, b, c in rows
    )
    cards = [
        ("telehealth-visit.jpg", "Patient on a video visit with a provider", "A real telehealth visit", "Meet a licensed U.S. provider online from home. No waiting room, no guesswork."),
        ("pharmacy.jpg", "Pharmacist compounding in a clean room", "A licensed 503A pharmacy", "Your prescription is compounded for you by a state licensed pharmacy, not shipped from a warehouse."),
        ("cold-chain.jpg", "Vial packed in a cold shipping box", "Cold chain to your door", "Shipped cold and overnight so it arrives the way the pharmacy made it."),
    ]
    return f"""<section class="section section--alt" id="why">
  <div class="wrap">
    <p class="eyebrow">Why AACTIVATED Rx</p>
    <h2>The legal, provider guided way to get peptides.</h2>
    <p class="lede">Many peptide websites sell vials labeled “research use only, not for human consumption.” We do it the right way: a licensed provider evaluates you through telehealth, a prescription is written in your name, and a state licensed 503A pharmacy prepares it for you.</p>
    {cards_html(cards)}
    <div class="compare">
      <table>
        <thead><tr><th scope="col">What you get</th><th scope="col">AACTIVATED Rx telehealth</th><th scope="col">“Research use only” sites</th></tr></thead>
        <tbody>{trs}</tbody>
      </table>
    </div>
  </div>
</section>
"""


def cards_html(cards):
    return '<div class="grid3">' + "".join(
        f'<article class="card">{img(s, a, "card__img")}<div class="card__body"><h3>{e(t)}</h3><p>{e(d)}</p></div></article>'
        for s, a, t, d in cards
    ) + "</div>"


def members_choose(image, points):
    lis = "".join(
        f'<li><span class="num">{i}</span><div><h3>{e(t)}</h3><p>{d}</p></div></li>'
        for i, (t, d) in enumerate(points, 1)
    )
    return f"""<section class="section">
  <div class="wrap split">
    <div class="split__img">{img(*image)}</div>
    <div>
      <h2>Why members choose it</h2>
      <ol class="points">{lis}</ol>
    </div>
  </div>
</section>
"""


def options(opts):
    btns = []
    for i, (tag, name, note, href) in enumerate(opts):
        on = i == len(opts) - 1  # subscribe is pre-selected, as in the concept
        btns.append(
            f'<button class="option" type="button" role="radio" aria-checked="{str(on).lower()}" tabindex="{0 if on else -1}" '
            f'data-label="{e(name)}" data-href="{href}">'
            f'<span class="option__tag"><span class="radio" aria-hidden="true"></span>{e(tag)}</span>'
            f'<span class="option__name">{e(name)}</span><span class="option__price">{PRICE}</span>'
            f'<span class="option__note">{e(note)}</span></button>'
        )
    last = opts[-1]
    return f"""<section class="section section--alt" id="options">
  <div class="wrap">
    <h2>Choose how you start</h2>
    <p class="sub">Tap an option. Your provider confirms everything during your online visit.</p>
    <div class="options" role="radiogroup" aria-label="Purchase options" data-options="continue-btn">{''.join(btns)}</div>
    <a class="btn btn--primary" id="continue-btn" href="{last[3]}">Continue with {e(last[1])}</a>
    <p class="members-note">Members save more: 10% off with MEMBER10 on a free membership, 35% off with PREMIUM35 on Premium. <a href="{JOIN}">Join free</a></p>
  </div>
</section>
"""


def steps(items, title="Start in three simple steps"):
    s = "".join(
        f'<div class="step"><p class="eyebrow">Step {i}</p><h3>{e(t)}</h3><p>{e(d)}</p></div>'
        for i, (t, d) in enumerate(items, 1)
    )
    return f"""<section class="section">
  <div class="wrap">
    <h2>{e(title)}</h2>
    <div class="steps">{s}</div>
  </div>
</section>
"""


RX_STEPS = [
    ("Take the 2 minute quiz", "Answer a few questions so we can match you to the right program."),
    ("Complete your online visit", "A licensed provider reviews your intake and decides whether treatment is right for you."),
    ("Receive it at home", "If prescribed, it ships cold and overnight from a licensed 503A pharmacy."),
]


def lineup(here, subtitle):
    cards = []
    for key, name, sub, pic in LINEUP:
        is_here = key == here
        href = "#options" if is_here else PRODUCT[key]
        cls = "product product--here" if is_here else "product"
        label = "You are here" if is_here else "View product"
        cards.append(
            f'<a class="{cls}" href="{href}">{img(pic, name + " product image")}'
            f'<span class="product__body"><strong>{e(name)}</strong><span>{e(sub)}</span><em>{label}</em></span></a>'
        )
    return f"""<section class="section section--alt" id="lineup">
  <div class="wrap">
    <div class="lineup-head">
      <div>
        <h2>Explore the lineup</h2>
        <p class="sub">{e(subtitle)}</p>
      </div>
      <a class="btn btn--ghost btn--sm" href="{SHOP}">Shop All Programs</a>
    </div>
    <div class="lineup">{''.join(cards)}</div>
  </div>
</section>
"""


def reviews():
    r = "".join(
        f'<div class="review ph">[REAL MEMBER REVIEW {i}: verified quote, first name and city, used with written permission]</div>'
        for i in (1, 2, 3)
    )
    return f"""<section class="section">
  <div class="wrap">
    <h2>What members say</h2>
    <div class="reviews">{r}</div>
  </div>
</section>
"""


def faq(items, closer, closer_img, cta):
    d = "".join(
        f'<details{" open" if i == 0 else ""}><summary>{e(q)}</summary><div class="answer">{a}</div></details>'
        for i, (q, a) in enumerate(items)
    )
    return f"""<section class="section" style="padding-top:0">
  <div class="wrap">
    <h2>Questions, answered</h2>
    <div class="faq">{d}</div>
  </div>
</section>
<section class="section" style="padding-top:0">
  <div class="wrap">
    <div class="closer">
      <div class="closer__copy">
        <h2>{e(closer)}</h2>
        <p>Licensed providers. Real prescriptions. Delivered cold to your door.</p>
        <a class="btn btn--white" href="{cta[1]}">{e(cta[0])}</a>
      </div>
      <div class="closer__img">{img(*closer_img)}</div>
    </div>
  </div>
</section>
"""


def footer(disclaimer, extra_links=()):
    links = [
        ("Privacy Policy", f"{SITE}/privacy-policy"), ("Terms", f"{SITE}/terms"),
        ("Telehealth Consent", f"{SITE}/telehealth-consent"), ("Shipping Policy", f"{SITE}/shipping-policy"),
        ("Refund Policy", f"{SITE}/refund-policy"), *extra_links, ("Contact", f"{SITE}/contact"),
    ]
    l = "".join(f'<a href="{h}">{e(t)}</a>' for t, h in links)
    return f"""</main>
<footer class="footer">
  <div class="wrap">
    <p>{e(disclaimer)}</p>
    <p>AACTIVATED Rx is a DBA of AACTIVATED, LLC. Support: <a href="mailto:contact@aactivatedrx.com">contact@aactivatedrx.com</a>, 8am to 5pm.</p>
    <nav class="footer__links" aria-label="Legal">{l}</nav>
  </div>
</footer>
<script src="{A}/lp.js" defer></script>
</body>
</html>
"""


RX_DISCLAIMER = (
    "Prescription products require an online evaluation by a licensed medical provider, who decides whether treatment is "
    "appropriate. Compounded medications are prepared by licensed 503A pharmacies for individual patients and are not FDA "
    "approved. This page is for education and does not replace medical advice. Individual results vary."
)


def product_page(p):
    return "".join([
        head(p),
        header(p["cta"]),
        hero(p["eyebrow"], p["h1"], p["lede"], p["cta"], ("See Why It Is Legal", "#why"),
             ["Licensed U.S. providers", "503A compounding pharmacies", "Cold overnight shipping"], p["gallery"]),
        why(),
        members_choose(p["members_img"], p["points"]),
        options(p["options"]),
        steps(RX_STEPS),
        lineup(p["key"], "Every product is prescribed through telehealth and prepared by a licensed 503A pharmacy."),
        reviews(),
        faq(p["faq"], p["closer"], p["closer_img"], p["cta"]),
        footer(RX_DISCLAIMER),
    ])


def membership_page(p):
    join = ("Join Free Now", JOIN)
    free_ticks = [
        "10% off every product with MEMBER10",
        "GetClear Health app included",
        "Member portal with your own Shop and Join links",
        "Welcome course and HIPAA training",
        "Earn $15 a month for each Premium member you personally enroll",
    ]
    prem_ticks = [
        "Everything in Free Member",
        "35% off every product with PREMIUM35",
        "GetClear Health app subscription, with a peptide blood panel",
        "Earn $30 a month for each Premium member you personally enroll",
        "Level 2 to 4 member rewards: $10 / $10 / $5 a month per active Premium member",
        "All member training: New Member Quick Start, HIPAA and Peptide Academy certification",
        "Priority support: booking calendar and back office support chat",
    ]
    t = lambda xs: "".join(f"<li>{CHECK}<span>{e(x)}</span></li>" for x in xs)
    plans = f"""<section class="section section--alt" id="plans">
  <div class="wrap">
    <h2>Start free. Upgrade when you are ready.</h2>
    <p class="sub">Tap a membership to compare.</p>
    <div class="tabs" role="tablist" aria-label="Memberships">
      <button class="tab" type="button" role="tab" id="tab-free" aria-controls="plan-free" aria-selected="true">Free Member</button>
      <button class="tab" type="button" role="tab" id="tab-premium" aria-controls="plan-premium" aria-selected="false" tabindex="-1">Premium Member</button>
    </div>
    <div class="plan" id="plan-free" role="tabpanel" aria-labelledby="tab-free">
      <div>
        <p class="eyebrow">Start here</p>
        <p class="plan__name">Free Member</p>
        <p class="plan__price">$0</p>
        <a class="btn btn--primary" href="{JOIN}">Join Free Now</a>
      </div>
      <ul class="ticks">{t(free_ticks)}</ul>
    </div>
    <div class="plan" id="plan-premium" role="tabpanel" aria-labelledby="tab-premium" hidden>
      <div>
        <p class="eyebrow">Full access</p>
        <p class="plan__name">Premium Member</p>
        <p class="plan__price">$89<small>/mo</small></p>
        <a class="btn btn--primary" href="{PREMIUM_CHECKOUT}">Continue with Premium</a>
        <p class="plan__fine">Billed monthly, cancel any time. The 35% discount applies only while your Premium membership is active and paid.</p>
      </div>
      <ul class="ticks">{t(prem_ticks)}</ul>
    </div>
  </div>
</section>
"""
    why_cards = f"""<section class="section" id="why">
  <div class="wrap">
    <h2>Why smart members start at $0</h2>
    {cards_html([
        ("woman-savings.jpg", "Member celebrating savings on her phone", "Real savings, every order", "Free members take 10% off every product. Premium members take 35% off."),
        ("app-phone.jpg", "GetClear Health app on a phone", "GetClear Health app, free", "Track your health, goals and progress in one app, included with your free membership."),
        ("telehealth-visit.jpg", "Patient on a video visit with a provider", "The legal way to get peptides", "Every product is prescribed through a licensed telehealth visit and prepared by a 503A pharmacy, never “research use only.”"),
    ])}
  </div>
</section>
"""
    faq_items = [
        ("Is it really free?", "Yes. The free membership costs $0, needs no card, and you can upgrade to Premium any time."),
        ("How do member rewards work?", f'Your portal gives you a Join link to share. When someone you personally enroll becomes an active, paid Premium member, you earn a monthly member reward: $15 a month as a Free member, or $30 a month as a Premium member. Rewards are paid only on active Premium memberships as described in the <a href="{MEMBER_AGREEMENT}">Member Agreement</a>. Prescription products, consultations and labs never earn a reward.'),
        ("Do I have to sell anything?", "No. There is no inventory, no selling scripts and no minimums. You share your links, and we handle checkout, fulfillment, support and payouts."),
        ("Are the products legal?", LEGAL_ANSWER),
    ]
    disclaimer = (
        "Compensation subject to change. Earnings are not guaranteed and depend on individual effort. Member rewards are paid on "
        "active, paid Premium memberships as described in the Member Agreement. Prescription products require an online "
        "evaluation by a licensed medical provider. Compounded medications are not FDA approved."
    )
    p = dict(p, gallery=[("members-group.jpg", "Friends comparing savings on their phones"), ("app-phone.jpg", "GetClear Health app on a phone"), ("woman-savings.jpg", "Member celebrating savings on her phone")])
    return "".join([
        head(p),
        header(p["cta"]),
        hero("Free Membership", "Join free. Save on every order. Earn when you share.",
             "Create your free AACTIVATED Rx membership in under a minute. Get 10% off every product, the GetClear Health app at no cost, and monthly rewards when people you refer go Premium.",
             join, ("Compare Memberships", "#plans"),
             ["$0 to join", "No credit card required", "10% off with MEMBER10"], p["gallery"]),
        why_cards,
        plans,
        steps([
            ("Join free", "Fill out the short member form. No card needed."),
            ("Get your links", "Your portal gives you a Shop link and a Join link to share."),
            ("Save and earn", "Shop at 10% off and earn monthly rewards when your referrals go Premium."),
        ], "Three steps to start"),
        lineup(None, "Shop the lineup at member pricing. Every product is prescribed through telehealth."),
        reviews(),
        faq(faq_items, "Your membership is free. Your savings start today.", ("members-group.jpg", "Friends comparing savings on their phones"), join),
        footer(disclaimer, [("Member Agreement", MEMBER_AGREEMENT), ("Income Disclaimer", f"{SITE}/income-disclaimer")]),
    ])


def index_page(all_pages):
    rows = "".join(
        f'<li><a href="../{p["slug"]}/">{e(p["title"].split(" | ")[0])}</a><code>{SITE}/{p["slug"]}/</code></li>'
        for p in all_pages
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AACTIVATED Rx Landing Pages</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="{A}/lp.css">
<style>.hub{{padding:64px 0}}.hub ul{{list-style:none;display:grid;gap:14px;margin-top:28px}}.hub li{{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 22px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px}}.hub a{{font-weight:700;font-size:18px;color:#fff}}.hub code{{color:var(--muted);word-break:break-all}}</style>
</head><body><main class="hub"><div class="wrap"><p class="eyebrow">Landing Page Concepts v2</p><h2>AACTIVATED Rx landing pages</h2>
<p class="sub">Five product pages and one free membership page. Each lives at its own sub URL on aactivatedrx.com.</p>
<ul>{rows}</ul></div></main></body></html>
"""


def main():
    built = []
    for p in PAGES:
        write(p["slug"], product_page(p))
        built.append(p)
    write(MEMBERSHIP["slug"], membership_page(MEMBERSHIP))
    built.append(MEMBERSHIP)
    write("landing-pages", index_page(built))
    for p in built:
        print(f"{SITE}/{p['slug']}/")


def write(slug, html):
    d = OUT / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
