# Non-trade business kinds: how they run (tech teams, agencies, UGC, ops, equipment & assets)

Research date: 2026-11-11. Budget-limited pass (about 16 tool calls), so coverage is uneven. Every claim with a link is VERIFIED against the linked page or search summary of it. Lines marked ASSUMED/INFERRED come from general industry knowledge or reasoning, not from a source found in this pass; check them before you build on them. Most price figures come from vendor blogs that have a stake in them, so treat them as ranges.

## Q1. Mobile surveillance towers and equipment & asset tracking (the deepest gap vs. generic tools)

### Takeaway
A surveillance tower is a rented, self-powered (solar + battery, optional smart generator), cellular-connected trailer. It is billed monthly, typically about $1,000–$3,500, plus extra charges: delivery/pickup each way, moves, monitoring, data overage and dispatch per event. Operators run it as a fleet: unit health (voltage, power, network), which site each unit is at, moves, service visits, and evidence clips for customers. Rental and asset businesses in general bill on day/week/4-week rates with automatic "cheapest rate" roll-down, and run check-out/check-in by QR scan with maintenance schedules.

### Cited Findings
**Tower pricing and billing (national, 2026)**
- Rental runs $1,000–$3,500/month. Managed (live) monitoring adds $300–$600/month. Buying costs $15,000–$50,000. Guards cost $20–$35/hour, often over $10,000/month for 24/7 cover. Article dated Mar 13, 2026. — [TrueLook cost guide](https://www.truelook.com/blog/mobile-surveillance-trailer-cost-guide)
- Charges to check for (bundled or listed separately): mobilization/demobilization (delivery, setup, retrieval), often $300–$800 each way; cellular data; cloud storage/retention; software access; routine maintenance and hardware replacement; permits. — [TrueLook](https://www.truelook.com/blog/mobile-surveillance-trailer-cost-guide)
- Longer terms cut the monthly rate by 15–25% (a 6-month rental costs more per month than a 12-month one). Renting beats buying under about 18 months; break-even is 18–24 months. — [TrueLook](https://www.truelook.com/blog/mobile-surveillance-trailer-cost-guide)
- TrueLook software tiers: about $129/month entry ($99 prepaid), about $359 advanced, about $599 premium. Entry includes live view, motion detection, time-lapse and cloud storage. Higher tiers add motion alerts, AI analytics and lifetime storage. — [TrueLook](https://www.truelook.com/blog/mobile-surveillance-trailer-cost-guide)
- Quotes are usually one monthly figure, but extra charges vary: per-move repositioning, cellular data overage, per-event dispatch fees, analytics tiers. Buyers are told to ask for a set number of included moves. — [Sharpvue buyer guide](https://www.sharpvue.com/guides/questions-before-renting-a-surveillance-trailer)
- Published video retention across the category is 14–30 days, often adjustable. Buyers are told to ask for a demo evidence export in a format police and legal teams accept, and to check whether theft/vandalism replacement is excluded. — [Sharpvue](https://www.sharpvue.com/guides/questions-before-renting-a-surveillance-trailer)
- Sharpvue sells to and rents through dealers, with a Dealer Portal for "fleet health, remote diagnostics." Units are NDAA compliant and made in Chapin, SC. — [Sharpvue](https://www.sharpvue.com/guides/questions-before-renting-a-surveillance-trailer)

**Tower operations (LiveView Technologies, the national leader)**
- LVT units charge batteries from solar. Batteries can run down in long bad weather, and an optional smart generator starts automatically when voltage drops. Units switch between cellular carriers to find the strongest signal, over LVT's private cellular network. The platform alerts on low-voltage disconnects, power loss and network health, and units can correct some faults themselves. No uptime numbers or SLA are published. Blog dated Sep 3, 2026. — [LVT: How we ensure high uptimes](https://www.lvt.com/blog/how-we-ensure-high-uptimes)
- An LVT partner spec lists two 450 W solar panels and eight deep-cycle batteries (460 Ah). Units run in about an hour with no site networking. Email and SMS alerts. — search summary of [LVT partner pages](https://lvt.com/partner/hstech) and [LVT mobile units](https://lvt.com/hardware/mobile-security-cameras) (vendor-stated)
- An older Cradlepoint case study describes dual-SIM carrier switching across LVT's deployed units (older; date not checked). — [casestudies.com](https://www.casestudies.com/company/ericsson-enterprise-wireless-solutions/case-study/from-edge-to-cloud-company-securely-sends-video-footage-through-lte-solutions)

**Las Vegas tower operators**
- 360 View LLC (Las Vegas) advertises solar mobile security trailers with no wiring or hookups, 360° coverage, live monitoring, strobe alerts, setup "in 30 minutes," contract-free rentals, and quick setup for special events (marketing copy). — [360 View Google Business listing](https://business.google.com/v/360-view-llc/09673010356861098703/99ce/_/lp/1261301398258128586/)
- PPG Security (Las Vegas) is said to supply the tower, run the monitoring and send its own guards. This came from a search summary only, and a second search could not confirm it: UNVERIFIED. — search summary citing [spot.ai](https://www.spot.ai/blog/security-trailer-rent-lease-buy)
- Deep Sentinel rents guard-monitored trailers for construction and job sites. Its Las Vegas service area is not confirmed. — [Deep Sentinel](https://www.deepsentinel.com/blogs/mobile-surveillance-trailer-rental-benefits/)
- A 2026 comparison of national providers by mast height, runtime, connectivity, price and guard services is at [spot.ai providers compared](https://www.spot.ai/blog/mobile-security-trailer-providers-compared) (not fetched).

**Trailer registration (Nevada)**
- Nevada titles and registers trailers like motor vehicles, but trailers are exempt from insurance, odometer and smog rules. Registration runs 1 or 3 years. Trailers can't be registered online, and plates can't be transferred. — [NV DMV Vehicle Registration](https://dmv.nv.gov/nvreg.htm)
- Trailers of 1,000 lb unladen or less pay a flat $12 fee. Heavier trailers pay a different fee. — [NV DMV fees](https://dmv.nv.gov/regfees.htm)
- Permanent commercial trailer plates exist for semitrailers and full trailers, valid as long as the owner keeps the trailer (third-party summary). — [J.J. Keller](https://jjkellercompliancenetwork.com/regsense/vehicle-license-or-registration-nevada)
- Trailers wider than 102 inches need an NDOT permit. — search summary of NV DMV form VP 223

**Equipment rental billing**
- EquipmentShare uses daily, weekly and four-week rates on a 28-day billing cycle, and its system applies whichever option costs less as the rental runs. — search summary of [EquipmentShare rent](https://equipmentshare.com/rent)
- Rental software supports "rolldown" (a daily rental bills at the weekly rate after N days, and leftover days roll to lower rate lines). Some count a "week" as the shop's open days (for example a 6-day week, so 24 billable days a 4-week month). — [WennSoft rental module](https://docs.wennsoft.com/em2025/advanced-rental-module-setup); [Texada rental period calc](https://naoc6.texadasoftware.com:10814/resources/openclient/srmv10/appHelp/source/4071.htm)
- Rule of thumb: weekly rate about 3.5–4.5× daily, monthly about 10–14× daily (vendor blog). — search summary of [Quipli / Hapn pricing guides](https://gethapn.com/blog/the-price-is-right-how-much-to-charge-for-rental-equipment/)
- Ahern Rentals is headquartered in Las Vegas (new HQ on Rancho Dr., 2022). United Rentals agreed to buy it for about $2B in Nov 2022. In 2022 it had 60,000+ units and 106 locations, 11 of them in Nevada (2022 figures, older). — [Review-Journal](https://www.reviewjournal.com/business/las-vegas-ahern-rentals-sold-for-2b-in-cash-2676516); [Ahern HQ release](https://www.ahern.com/news/article/ahern-family-companies-begins-relocation-new-corporate-headquarters); [Power Progress](https://www.powerprogress.com/news/united-rentals-to-buy-ahern-rentals/8024725.article)

**Asset tracking software**
- EZO (EZOfficeInventory): QR/barcode scanning and batch check-in/out, a mobile app (scan with the phone camera, reserve, check out, work orders in the field), an availability calendar (available/reserved/checked out/in maintenance), a maintenance module (CMMS) with preventive schedules, label design and printing, custom fields, permissions, multiple locations. Pricing is quoted variously as $35–$48/month to start, or Essentials $40 / Premium $65 (sources disagree). — [TechnologyAdvice](https://technologyadvice.com/products/ezofficeinventory-reviews/); [Capterra](https://www.capterra.com/p/124047/EZOfficeInventory/); [toolradar](https://toolradar.com/tools/ezofficeinventory/pricing)
- ToolWatch: tool and equipment inventory, check-in/check-out, real-time tracking. Custom quote; listed as web-only. — [SafetyCulture tool mgmt list](https://safetyculture.com/app/tool-management-software/)

### Inferences
- ASSUMED: A tower's life cycle is quote → order (site, start date, term, monitoring level) → deliver (DOT-legal tow) → site survey and placement (solar exposure, cell signal, sightlines) → commission (cameras online, test alarms and strobes) → deployment report to the customer (photos, placement map, camera views) → monitored months (alerts, incident clips, monthly health/uptime report) → service visits (battery swap, panel cleaning, camera fix, generator refuel or hydrogen-cartridge swap where used) → moves within the site or to a new site (each a billable move) → pickup → shop check-in (inspection, damage noted, reset). The cited sources support the extra charges, the alerts and the evidence exports, but the order of steps is inferred.
- ASSUMED: The documents customers expect are the deployment report, monthly activity/uptime summary, incident report with clip(s) and timestamps (exported for police/insurance), damage/theft report, and the invoice with move and dispatch lines. Sharpvue's "demo export accepted by police" advice supports the incident-clip point.
- INFERRED: Kloomie's new Equipment & assets kind (commit 5dd7212) already covers status, location history, job link, QR labels and sealed combos. It lacks billing (monthly rent per unit per job, extra charges, prorating, move counts), unit health (voltage/signal readings from a vendor API or manual entry), service visits tied to a unit, and customer-facing deployment and incident reports.
- ASSUMED: Point of Rental, Samsara, Tenna and LVT's own platform were not researched in this pass. Point of Rental is the classic counter-and-contract rental system. Samsara and Tenna are telematics/GPS tracking for gear. LVT's platform is the tower vendor's own fleet health and video system.

### Gaps
- No found source on USDOT number rules for a company towing its own trailers (FMCSA: interstate commerce and combined weight over 10,001 lb generally triggers a USDOT number — ASSUMED, not checked).
- No published Las Vegas tower prices. PPG Security was not confirmed. Other likely local operators (for example national players WCCTV, Bigfoot/Mobile Video Guard, LVT dealers) were not checked in Las Vegas.
- No source on LVT's monthly price, service SLAs or field-tech model. ARA (American Rental Association) material and Point of Rental features were not reached.

## Q2. Creative and marketing agencies

### Takeaway
The pain points are retainers whose scope isn't written down (deliverable counts, revision rounds, who may ask), revisions that turn into scope changes, and hours run over and not billed. Good practice is 2–3 rounds included, a revision defined as "a change within the brief", and a review when hours hit about 110% of the retainer.

### Cited Findings
- Most retainers name the engagement type and monthly fee but don't say how many deliverables, how complex, how many revision rounds, who can make requests, or what "done" means. — [ScopeStack: agency retainer trap](https://scopestack.pages.dev/blog/agency-retainer-trap) (via search summary)
- A revision is a change within the original brief. A new direction after the first draft is a scope change. Typical practice is 2–3 rounds in the fee, with further rounds billed hourly or per round. — [Mediabistro: when does a revision become billable](https://www.mediabistro.com/be-inspired/advice-from-the-pros/when-does-a-revision-become-billable-the-question-every-agency-answers-too-late/); [Rock: never-ending revisions](https://www.rock.so/blog/never-ending-client-revisions)
- Track time against the retainer monthly, and start a scope review at about 110% of allocated hours. — [Enterprise DNA](https://enterprisedna.co/resources/guides/agencies-stop-scope-creep-retainers)
- Retainer watch-outs are scope creep and unused hours, governed with a backlog, burn-down and SLA tracking. — [Teamwork: project scoping for agencies](https://www.teamwork.com/blog/project-scoping-for-agencies/)
- 78% of agencies say they rarely or only sometimes charge for scope creep (Ignition 2025 cash-flow report, as cited). — [Ignition: preventing scope creep](https://www.ignitionapp.com/blog/preventing-agency-scope-creep)
- Las Vegas: no authoritative ranking exists. Clutch's advertising list (updated Jul 14, 2026) names Version2, MassMedia, BRAND, Schaefer and Meros Media. GoodFirms counts 130 Las Vegas digital agencies (Jul 2026; sponsored placement exists). One Nevada awards page ranks Nativz #1 (unknown method). HigherVisibility, SmartSites, Funnel Boost Media and The Bureau of Small Projects come up often. — [Clutch Las Vegas](https://clutch.co/agencies/las-vegas.md); [GoodFirms](https://www.goodfirms.co/directory/city/top-digital-marketing-companies/las-vegas); [National Marketing Awards NV](https://national-marketing-awards.pages.dev/awards/nevada)

### Inferences
- ASSUMED lifecycle: lead → discovery call → proposal/SOW (deliverables, rounds, timeline, price; signed) → deposit or first retainer invoice → kickoff + creative brief → work (internal review → client review round 1…n) → final approval (sign-off) → delivery of files → invoice (project milestone or monthly retainer; hours over billed as overage) → monthly report (for retainers) → renewal or upsell.
- ASSUMED roles: account manager/client lead, project/traffic manager, creative director, designers/writers/media buyers, freelancers; owner handles pricing.
- ASSUMED pricing: monthly retainer (fixed fee or a block of hours), fixed-price project with milestones, hourly, per deliverable; media spend passed through with a markup or management fee.
- ASSUMED software: Productive, Teamwork, Function Point and Accelo are built for agencies (budgets, retainers, time to invoice, profit per client). Monday, ClickUp and Asana are general tools that agencies bend. Proofing tools (Filestage, Ziflow) handle markup on files; HoneyBook and Dubsado serve solo creatives.
- INFERRED underserved: generic tools don't count revision rounds per deliverable, don't link a client's approval on a file version to the SOW, and don't warn on retainer burn. That is where the money leaks.

### Gaps
- Productive/Teamwork feature and price pages were not fetched. There are no Las Vegas agency ops specifics (team sizes, tools used).

## Q3. UGC creators and UGC agencies

### Takeaway
UGC runs as brief → creator applications → approve → ship product (tracking within ~2 days) → draft → up to 2 edit requests within the brief → approve → usage rights recorded → pay. Usage rights and whitelisting are the biggest price drivers (+25–100% over a $100–$300ish base video). FTC rules require a clear in-video disclosure on posted endorsements, and they make the brand responsible for monitoring creators.

### Cited Findings
- Billo: a Brief (the spec creators apply to) turns into a Task (the production unit) once the brand approves creators. Shipping, uploads, feedback and approval happen in one timeline. — [Billo vs Insense](https://billo.app/blog/billo-vs-insense/); [How Billo works](https://help.billo.app/en/articles/10368596-how-does-billo-work)
- Billo shows creator addresses after approval, and brands must ship and upload tracking within 2 days. Buyers get two edit requests if they fit the original brief. — [Influencer Marketing Hub: Billo review](https://influencermarketinghub.com/billo/)
- Insense: the brief adapts to earlier choices. Shopify integration downloads shipping details in bulk for product seeding. On approval, usage rights are recorded in a "Payments & Copyrights" step. Most brands get applications within 48 h and first assets within 14 days (vendor claim). — [Insense platform](https://insense.pro/platform); [How Insense works](https://help.insense.pro/article/4337)
- Rates (2026, vendor blogs): about $150–$300 per video typical, $100–$1,500+ range. Paid-ad usage adds +25–100% (another says 30–50%). Whitelisting adds +20–100%, or 30–100% of base per month of access. Usage and extras raise project cost 30–100%. Billo and JoinBrands include usage rights in listed prices (Oct 2026). — [inBeat UGC rates 2026](https://inbeat.agency/blog/ugc-rates); [Influee](https://influee.co/ie/blog/ugc-price); [webtonic](https://www.webtonic.io/blog/ugc-rates-2026-how-much-to-pay-for-user-generated-content); [designrevision](https://designrevision.com/blog/ugc-creator-pricing.md)
- FTC (Endorsement Guides revised 2023): disclose any material connection (payment, free product even if returned or cheap, affiliate codes). For video, the disclosure goes in the video itself, shown and said aloud if the endorsement is both. A description alone isn't enough, and platform tools don't replace it. "#ad," "Paid ad," "Gifted by [brand]" are fine; "#partner," "#ambassador" or "Gifted" alone are not. Every post needs its own disclosure. — [FTC: What people are asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
- FTC: brands are responsible for what creators say, including through agencies. They need training, monitoring and compliance programs. Pre-approving paid posts is recommended. Monitoring should continue for a reasonable time (a few months) after a contract ends. Brand-supplied scripts must not imply untrue use or experience. — [FTC FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
- FTC Consumer Reviews and Testimonials Rule (16 CFR Part 465, effective Oct 2024): bans fake/AI-faked testimonials, reviews conditioned on sentiment, undisclosed insider reviews, and buying or selling fake followers/views. Civil penalties are over $50,000 per violation (inflation-adjusted). — [NatLawReview guide to the rule](https://natlawreview.com/article/guide-ftc-consumer-review-and-testimonial-rule); [creatorsagency](https://creatorsagency.co/blog/ftc-fake-reviews-influencer-marketing)

### Inferences
- INFERRED: Most "UGC" is content the brand runs as its own ads (not posted by the creator), so the FTC posting rules apply mainly when the creator posts or the ad is whitelisted (run from the creator's handle). Whitelisted or Spark ads still present a creator endorsement, so a disclosure (the platform's "Paid partnership" label plus #ad) is the safe default. ASSUMED; the FAQ doesn't speak to whitelisting directly.
- ASSUMED contract terms: deliverables (count, length, aspect ratios, hooks/variations, raw footage), usage term (30/90/180 days, 1 year, perpetual), channels (organic, paid social, web, TV), whitelisting/Spark-code access and term, exclusivity (category, days), revision count, product kept or returned, payment terms (on approval, net-15/30), the right to edit, and a disclosure clause.
- ASSUMED roles for a UGC agency: account lead, creator manager/recruiter, strategist/scriptwriter, editor, media buyer. Creators work solo, keeping a rate card, portfolio, pitch tracker and brand CRM.
- ASSUMED software: Billo, Insense, #paid, Grin, Aspire, Upfluence, Creator.co, JoinBrands, Collabstr (marketplaces/CRMs); creators use Notion, spreadsheets, Passionfroot or Beacons for rate cards and media kits.
- INFERRED underserved: tracking when rights expire per asset (alerts before 30/90-day usage ends), Spark-code/whitelisting access dates, product-shipping status per creator, and payment-on-approval are all missing in Monday/Asana.

### Gaps
- #paid and Grin feature pages were not fetched. There are no Las Vegas UGC agency names (none found in this pass).

## Q4. Small technology and software teams

### Takeaway
Small teams run backlog → triage → cycles/sprints → PR/review → release. SOC 2 is the compliance gate for selling to bigger customers: Type 1 is a snapshot (about 3–6 months to get), Type 2 covers an observation window (about 6–12+ months). First-year all-in cost is roughly $20K–$60K for a small startup, through compliance platforms like Vanta or Drata.

### Cited Findings
- SOC 2 Type 1 is a point-in-time check. Type 2 covers an observation period and is what enterprise buyers usually want. Type 1 takes about 3–6 (to 8) months end to end, and a first Type 2 about 6–12+ months. — [SureCloud Type 1 vs 2](https://www.surecloud.com/blog-hub/soc-2-type-1-vs-type-2); [ComplyJet](https://www.complyjet.com/blog/soc-2-for-startups)
- Type 1 audit fees run about $12K–$40K. A first-year all-in budget is about $20K–$60K (others say $30K–$110K for 10–200 staff). Vanta and Drata quote prices: Vanta about $7.5K–$30K/yr; Drata about $7.5K–$100K+/yr; within 5–15% of each other for the same scope (sources conflict). — [Petronella 2026](https://petronellatech.com/blog/soc-2-compliance-cost-in-2026-what-startups-actually-pay); [getagency](https://blog.getagency.com/articles/soc-2-audit-cost-for-startups); [costbench](https://costbench.com/compare/drata-vs-vanta/)
- Las Vegas tech: StartupBlink 2026 ranks Las Vegas #67 globally and #23 in the US, with Boxabl, Filevine and Amira Learning among its top startups. The city cites 625 startups (Dealroom, 2023). Seedtable counts $1.2B raised across its top 60, led by Trustifi. — [StartupBlink](https://www.startupblink.com/top-startups/las-vegas-nv-us); [City of LV blog](https://www.lasvegasnevada.gov/News/Blog/Detail/a-best-place-to-start-and-grow-a-company); [Seedtable](https://seedtable.com/best-startups-in-las-vegas)

### Inferences
- ASSUMED day-to-day: standup (often written), triage of new bugs and requests (severity, owner), 1–2 week cycles, PR review + CI, deploy (often continuous), release notes, on-call rotation and incident write-ups for teams that run production systems. Roles: founder/PM, engineers, designer, QA (often shared), support.
- ASSUMED software: Linear (cycles, triage inbox, projects/roadmaps, GitHub sync), Jira (larger teams, enterprise customers), GitHub Projects (code-close teams); PagerDuty/incident.io for on-call; Notion/Confluence for specs; Vanta/Drata for SOC 2 evidence.
- INFERRED: SOC 2 work for a small team is mostly recurring evidence: access reviews (quarterly), onboarding/offboarding checklists, security training, vendor reviews, change management (PR approval), incident records, and policies signed every year. These recurring tasks are a good fit for a workspace (Kloomie's Tech workspace already has board, sprints, GitHub webhook, QA and releases per memory).
- INFERRED: Agencies that build software for clients bill by sprint, retainer or time and materials; product teams don't bill per task.

### Gaps
- Linear/Jira feature and price pages were not fetched. There is no on-call practice data for small teams.

## Q5. Small-business operations teams (internal projects, tasks, SOPs, CRM)

### Takeaway
No ops-specific sources were reached in this pass. What follows is inference, to be checked.

### Cited Findings
- No sources gathered for this kind in this pass (budget).

### Inferences
- ASSUMED: Ops teams keep SOPs (step-by-step how-tos, owner, review date), recurring checklists (daily open/close, weekly payroll, monthly close), onboarding/offboarding, internal projects with milestones, a sales pipeline (lead → qualified → proposal → won/lost, with value and next-step date), and a vendor/contract list with renewal dates.
- ASSUMED software: Asana/Monday/ClickUp for tasks, Notion for SOPs and wiki, HubSpot (free CRM, deal stages) or Pipedrive for sales, Trainual/Whale for SOP training.
- INFERRED underserved: tying an SOP to a recurring task (the checklist runs from the SOP and records who did it), SOP review reminders and staff acknowledgment, and the pipeline's "next step date" with nudges when a deal goes stale.

### Gaps
- No source data: HubSpot/Asana/Notion features, SOP practice and Las Vegas ops teams all still need research.

## Q6. Which workflows generic tools (Monday/Asana) underserve, and software needs per kind

### Takeaway
Generic task tools have no idea of money tied to time (retainer burn, rental days, rights terms), physical things moving between places, or approval tied to a specific version. Purpose-built kinds should carry those as first-class fields and automations.

### Cited Findings
- Agencies under-bill scope creep (78%), and retainers lack written deliverable and revision limits. — [Ignition](https://www.ignitionapp.com/blog/preventing-agency-scope-creep); [ScopeStack](https://scopestack.pages.dev/blog/agency-retainer-trap)
- Rental billing needs day/week/4-week rate roll-down and cheapest-rate logic. — [EquipmentShare](https://equipmentshare.com/rent); [WennSoft](https://docs.wennsoft.com/em2025/advanced-rental-module-setup)
- Tower rentals carry per-move, data-overage and per-event dispatch charges, plus evidence exports. — [Sharpvue](https://www.sharpvue.com/guides/questions-before-renting-a-surveillance-trailer); [TrueLook](https://www.truelook.com/blog/mobile-surveillance-trailer-cost-guide)
- UGC usage rights are recorded at approval (Insense), and whitelisting is priced per month of access. — [Insense](https://insense.pro/platform); [inBeat](https://inbeat.agency/blog/ugc-rates)

### Inferences (software needs list — INFERRED from findings above unless noted)

**Equipment & assets / surveillance towers**
- Records: Unit (tag, kind, serial, VIN/plate + registration expiry, status, current site/job, GPS spot, cameras, battery bank/solar spec, SIM/carrier, generator, purchase cost); Deployment (unit, customer, site, start/end, monthly rate, monitoring tier, included moves); Service visit (unit, reason, parts, tech, photos, readings: voltage, signal); Incident (unit, time, clip, police report #, sent to customer); Damage/loss.
- Stages: Yard → Reserved → In transit → Deployed (Commissioned) → Service needed → Picked up → Shop inspection → Ready / In repair / Lost / Retired.
- Recurring: monthly rent invoice per deployment (prorated first/last month); service schedule (battery check, panel cleaning, generator fuel); registration renewal alerts; "not checked in 30 days" (already built).
- Documents: deployment report (photos, map, camera views) sent on commissioning; monthly activity/uptime summary; incident report with clip link; delivery/pickup sign-off; rental agreement with damage/theft terms.
- Billing: monthly rate per unit, delivery/pickup each way, per-move fee after N included moves, monitoring add-on, dispatch per event, data overage; for general rentals, day/week/4-week rates with automatic cheapest roll-down.
- Automations: low-battery/offline alert (from vendor API or manual) → service visit task for nearest tech; move logged → move fee line; deployment end date → pickup task + final invoice; incident logged → customer email with clip; registration expiring → task.

**Creative & marketing agencies**
- Records: Client, SOW/Retainer (monthly fee, hours or deliverable allowance, revision rounds, start/renewal), Deliverable (versions, round count, status), Time entries.
- Stages: Lead → Proposal sent → Signed → Kickoff → In production → Client review (round n) → Approved → Delivered → Invoiced.
- Approvals: client approves a specific version (with name/time); a revision past the included rounds asks for a change order.
- Billing: retainer monthly invoice, overage hours, milestone invoices, pass-through media spend.
- Automations: retainer burn alerts at 80/100/110%; round limit hit → change-order draft; approval → invoice line; monthly client report.

**UGC creators & agencies**
- Records: Brand/Campaign brief, Creator (handle, rates, address, niche, portfolio), Deliverable (format, hooks, status), Rights (channels, term start/end, whitelisting/Spark code expiry, exclusivity), Shipment (carrier, tracking, delivered).
- Stages: Brief → Creators applied → Approved → Product shipped → Delivered → Draft submitted → Edits (max 2) → Approved → Rights active → Paid → Rights expired.
- Compliance: disclosure checklist on posted/whitelisted content (#ad in video, said aloud), claims guidance in the brief, post-contract monitoring date (FTC).
- Billing: per video + usage add-on + whitelisting per month; creator payout on approval.
- Automations: "ship within 2 days" reminder; tracking delivered → draft due date; approval → payout + rights start; 7 days before rights end → renew/pull ads alert.

**Tech teams** (largely built in Kloomie's Tech workspace): add SOC 2 recurring evidence tasks (access review, offboarding, policy sign-off), incident records with on-call owner, and release notes to customers.

**Ops teams**: SOP doc → recurring checklist with who did it; SOP review/acknowledgment; pipeline with next-step dates and stale-deal nudges; vendor contract renewals.

### Gaps
- None of the "software needs" were checked against interviews or customer data; they are design inferences.
- Ops (Q5), tech tool pages and Las Vegas UGC/ops players need a second pass.
