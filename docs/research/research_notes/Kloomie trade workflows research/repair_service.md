# Repair and service trades in 2026: how they run (HVAC, plumbing, electrical, appliance, garage doors, locksmith, generators, water heaters/wells/septic, solar), Las Vegas first

Conventions used in these notes:
- **VERIFIED**: backed by the linked source (official sources are named as such; vendor and marketing pages are flagged).
- **ASSUMED/INFERRED**: industry-standard practice from general knowledge or my own reasoning, with no source fetched in this pass. Treat these as hypotheses to check with operators.
- Research done 2026-11-11. Most operator facts come from the companies' own marketing pages, which may be out of date.

---

## Q1. How does each trade run day to day: roles, job lifecycle, terms, documents?

### Takeaway
All nine trades follow the same basic loop: intake call/booking → dispatch with a trip/diagnostic fee → on-site diagnosis → tiered options (good-better-best) → approve and sign → fix now, or order parts and return → invoice and take payment on site → review request → maintenance-plan or reminder follow-up. What differs by trade is the **equipment record** (the unit, its serial, its readings), the **compliance documents** (refrigerant logs, permits, utility interconnection, work cards) and the **share of jobs needing a second visit** (high in appliance and solar, low in locksmith and garage doors).

### Cited Findings

**Shared lifecycle and pricing mechanics (all trades)**
- VERIFIED: The usual sequence is a flat diagnostic fee, then the problem is found, then a flat-rate or T&M repair price is quoted for the customer to accept or decline. — [Plyrium (vendor), 2026](https://www.plyrium.com/academy/hvac/flat-rate-vs-time-and-materials-pricing)
- VERIFIED: "Trip charge", "service call fee" and "diagnostic fee" are used interchangeably; HVAC shops tend to say "diagnostic fee". — [Smart Service (vendor)](https://www.smartservice.com/blog/trip-charge-minimum-fee); [FieldEdge (vendor)](https://fieldedge.com/?p=17025)
- VERIFIED: HVAC diagnostic fees cluster around $70–$90 (with $89 the most common) per one vendor, or $89–$129 per another. Many residential plumbers charge no trip fee, and those that do mostly charge $75–$100. — [Smart Service](https://webflow.smartservice.com/blog/trip-charge-minimum-fee); [Plyrium](https://www.plyrium.com/academy/hvac/flat-rate-vs-time-and-materials-pricing)
- VERIFIED: Many shops credit the diagnostic fee toward the repair once the work is approved. Emergency and after-hours calls carry higher dispatch fees or 1.5x–3x rates. — [Housecall Pro (vendor)](https://www.housecallpro.com/resources/how-to-price-plumbing-jobs/)
- VERIFIED: In ServiceTitan the tech opens the job, picks or builds a tiered estimate, and taps **Present** to show all options side by side. Member and non-member prices show when a membership discount applies. Estimates can be emailed, with a notice when the customer views or signs. — [ServiceTitan help center](https://help.servicetitan.com/docs/build-estimates-close-sales)

**HVAC**
- VERIFIED (official): Nevada license C-21 (Refrigeration and air-conditioning) has subclasses C-21a Refrigeration, C-21b Air-conditioning, C-21c Sheet metal, C-21d Maintenance, C-21e Solar air-conditioning, C-21f Chilled and hot water systems and C-21g Industrial piping. Air heating and evaporative cooling fall under C-1f (Heating, cooling and circulating air). — [NAC 624.380 / 624.190, Nevada Legislature](https://www.leg.state.nv.us/nac/NAC-624.html)
- VERIFIED (official): Clark County's "simple permits" list residential mechanical items (A/C or furnace replacement under 5 tons, condenser/pump combo, furnace under and over 100K BTU). The rule is "only (1) appliance per permit", so replacing two units takes two permits. — [Clark County Building & Fire Prevention, simple permits](https://www.clarkcountynv.gov/government/departments/building___fire_prevention/permit_issuance/building_-_simple_permits.php)
- VERIFIED (official): Clark County offers Saturday inspections for A/C (mechanical) change-outs and water heater installations. — [Clark County, schedule an inspection](https://www.clarkcountynv.gov/government/departments/building___fire_prevention/inspection/schedule_an_inspection.php)
- VERIFIED (official): From 1 Jan 2026, the EPA's AIM Act ER&R leak-repair rules cover appliances holding 15 lb or more of an HFC, or of a substitute with GWP above 53. — [EPA ER&R leak repair fact sheet, Jan 2026](https://www.epa.gov/system/files/documents/2026-01/er-r-fact-sheet-leak-repair-2026-01-13_1.pdf); [ServiceMag](https://servicemag.org/news/epa-r410a-ban-rollback-aim-act)
- VERIFIED (official): Under the older Section 608 ODS rule (50 lb or more), the leak-rate triggers are 30% for industrial process, 20% for commercial refrigeration and 10% for comfort cooling. Repair is due within 30 days, or a retrofit/retire plan within 30 days that is finished within 1 year, with initial and follow-up verification tests. — [EPA Section 608 leak repair](https://www.epa.gov/section608/stationary-refrigeration-leak-repair-requirements)
- VERIFIED: EPA announced on 23 Dec 2025 that it was pausing enforcement of the 1 Jan 2026 R-410A new-installation prohibition (Technology Transitions reconsideration proposed 3 Oct 2025). This drives the R-410A vs A2L (R-454B/R-32) equipment choice on change-outs. — [ServiceMag](https://servicemag.org/news/epa-r410a-ban-rollback-aim-act); [Baker Botts, Feb 2026](https://www.bakerbotts.com/thought-leadership/publications/2026/february/new-year-new-deadlines-does-your-hvac-and-other-refrigerant-containing-equipment)
- VERIFIED: Records are generally kept for 3 years, on paper or electronically. Refrigerant sellers record the buyer, date and quantity and check the buyer's 608/609 card. Technicians disposing of mid-size appliances record location, date of recovery and refrigerant type. — [ACHR News](https://www.achrnews.com/articles/135445-epa-608-recordkeeping-impacts-technicians); [EPA certification](https://www.epa.gov/section608/section-608-technician-certification-requirements). Note: training sites, not regulatory text, for the 3-year figure.
- ASSUMED: Roles are a CSR/dispatcher (books calls, sets "no-cool" priority), service techs (diagnose and repair, sell options and memberships), comfort advisors or sales (replacement quotes, often in-home with financing), install crews (lead installer plus helper), and an office/permit coordinator (pulls permits, books inspections, registers warranties).
- ASSUMED: Terms include tune-up / precision tune-up, no-cool / no-heat call, change-out (full replacement), SEER2/EER2, tonnage, superheat/subcool, static pressure, capacitor/contactor (the most common cheap summer failures), condensate line, Manual J load calc, A2L refrigerant, "sold job", "opportunity", "conversion rate", "average ticket".
- ASSUMED: Gas furnace jobs often include a combustion analysis and CO readings (flue CO ppm, ambient CO). Manufacturer warranties usually need **online registration within 60–90 days** of install to get the extended parts term. Vary by brand; not verified here.

**Plumbing (including water heaters)**
- VERIFIED (official): C-1 (Plumbing and heating) subclasses: C-1a Boilers, C-1b Fire sprinklers, C-1c Pipe/duct insulation, C-1d Plumbing (including water heating and solar water-heating equipment, gas supply and medical gas), C-1e Sheet metal, C-1f Heating/cooling/circulating air, C-1g Pipes and vents for gas, C-1h **Water heaters** (install, replace, repair), C-1i Chilled-water piping, C-1j Firefighter breathing air, C-1k Industrial piping. — [NAC 624.190](https://www.leg.state.nv.us/nac/NAC-624.html)
- VERIFIED (official): Clark County lists water heaters under its plumbing simple permits. — [Clark County simple permits](https://www.clarkcountynv.gov/government/departments/building___fire_prevention/permit_issuance/building_-_simple_permits.php). Third-party sites say a like-for-like replacement still needs a plumbing permit: [permitmint (third party)](https://permitmint.com/permits/nevada/las-vegas/water_heater/).
- ASSUMED: Plumbing has more true emergencies (leaks, sewer backups, no hot water) and more drain/sewer work: hydro-jetting, camera inspection with video recorded for the customer, and locating. Pricing is mostly flat-rate per task. Water heater replacement is the main "install" ticket; slab leaks and repipes are large estimates often financed.
- ASSUMED: Terms include rooter / snaking, hydro-jet, camera inspection, cleanout, PRV (pressure-reducing valve), expansion tank, T&P valve, anode rod, sediment flush, slab leak, repipe (PEX/copper), backflow test (annual, certified tester, report filed with the water purveyor).

**Electrical (including generators)**
- VERIFIED (official): C-2 (Electrical) subclasses: C-2a Electrical wiring, C-2b Integrated ceilings, C-2c Fire detection, C-2d Low voltage (≤91 V), C-2e Transmission lines, C-2f Residential wiring (≤600 V, ≤3 stories), C-2g **Photovoltaics** (PV cells, batteries and inverters, "not beyond the service panel"). — [NAC 624.200](https://www.leg.state.nv.us/nac/NAC-624.html)
- VERIFIED (official): C-38b covers appliances and equipment connected to LP or natural gas, which applies to gas standby generators' fuel side. — [NAC 624.550](https://www.leg.state.nv.us/nac/NAC-624.html)
- ASSUMED: Residential electrical service is lower-frequency, higher-ticket work: panel upgrades (often triggered by EV chargers, solar or batteries), EV charger installs, circuits, troubleshooting, whole-home surge protection and safety inspections. Most need permits. Panel and service upgrades need the utility to disconnect and reconnect (in Las Vegas, NV Energy), which means coordinating dates.
- ASSUMED: Standby generators (Generac, Kohler, Briggs) run as a sale → site survey → permits (electrical, plus gas and sometimes a setback/zoning check) → gas sizing/meter upgrade with the gas utility (Southwest Gas in Las Vegas) → install → inspection → manufacturer **activation/registration** (warranty) → annual or semi-annual maintenance contract (oil, filters, battery, load test). Generator demand in Las Vegas is likely lower than in hurricane or ice-storm markets. Not verified.
- VERIFIED (weak): Pahrump/Las Vegas-area electricians advertise standby generator installs, scheduled servicing and solar integration, but the pages found are templated lead-gen sites sharing one phone number. Low reliability. — [example template site](https://primeelectrician.vercel.app/appliance-repair/nevada/pahrump/)

**Appliance repair**
- VERIFIED (official): No dedicated NSCB classification for appliance repair turned up in NAC 624. Electrical work on appliances falls under C-2a, gas appliances under C-38b, and water heaters under C-1h. — [NAC 624](https://www.leg.state.nv.us/nac/NAC-624.html). INFERRED: plain appliance repair (no new gas or electrical lines) probably needs only a business license, but this needs checking with NSCB.
- VERIFIED (vendor claims): Missing parts are the main cause of second trips. Average first-time fix rate is claimed at 68–74% vs a best-in-class 85%+. Another vendor says 35% of HVAC/refrigeration calls arrive without the needed part. — [beancount.io](https://beancount.io/blog/2026/08/13/appliance-repair-bookkeeping-truck-stock-warranty-retail-margin-guide); [Bruviti](https://bruviti.com/s/appliance_manuf/field_service/operator-workflow.html)
- VERIFIED (vendor): Shops that are OEM-authorized deal with each network's own claim format, repair codes and payment timelines. Reconciliation is usually manual. — [fieldservicesoftware.io](https://fieldservicesoftware.io/industries/appliance-equipment-repair/)
- ASSUMED: Lifecycle is booking with brand, model, serial and symptom (often a model/serial photo up front) → diagnostic fee → diagnosis plus error codes → quote → part ordered from a distributor (Marcone, Encompass, Reliable Parts) or the OEM → **return visit** to install → invoice. Warranty jobs bill the OEM or a home-warranty company (AHS, Choice) with a deductible collected from the customer and an authorization number. The record must carry **parts on order with ETA**, plus a repair-vs-replace note.

**Garage doors**
- VERIFIED (official): NSCB C-3d (Overhead doors) covers fabrication, erection and installation of overhead door components, including tracks, counterweights and controls. — [NAC 624.210](https://www.leg.state.nv.us/nac/NAC-624.html)
- VERIFIED (marketing): Las Vegas garage door firms advertise same-day spring replacement with common sizes stocked on the truck. A spring pair is quoted at $250–$550 by one firm. Others advertise $189 spring promos that a review says weren't honored. — [example LV firm site](https://angels-garage-doors.pages.dev/services/garage-door-spring-repair); [HomeAdvisor](https://homeadvisor.com/tloc/Las-vegas-NV/Garage-Door-Repair). Precision Garage Door (national franchise) has a Las Vegas location. — [Precision Door Las Vegas](https://www.precisiondoor.net/locations/nevada/las-vegas/las-vegas)
- ASSUMED: Mostly one visit (springs, cables, rollers, openers). Door replacements need measuring and an order (1–3 weeks). Upsells are a tune-up/"safety inspection" plan, opener with battery backup and smart Wi-Fi, and high-cycle springs as a "better/best" tier. Terms: torsion vs extension springs, IPPT (inch-pounds per turn), cycles, wind/turns, reverse-safety test, photo eyes.

**Locksmith**
- VERIFIED (official): Clark County Code 6.12.650 sets rules for locksmith and mobile-locksmith business licenses, including a physical location of at least 300 sq ft, or for mobile operators shared office space in a licensed fixed locksmith. It is a **privileged license**: Personal History Form, background investigation, and employer letters naming Key Employees. — [Clark County Mobile Locksmith packet (04/2022)](https://files.clarkcountynv.gov/Doing%20Business/Divisions/Regulated%20Business/Updated%20Packets/Mobile%20Locksmith%20Packet%20(as%20of%2004.2022).pdf); [Clark County regulated license guide](https://www.clarkcountynv.gov/business/doing_business_with_clark_county/divisions/regulated_business/regulated__license_guide.php). Dated 2022.
- VERIFIED (official, City of LV): Business vehicles must show the business name and license number. Workers wear identifiable uniforms. — [City of Las Vegas Locksmith Checklist PL059](https://files.lasvegasnevada.gov/business-licensing/Locksmith-Checklist-PL059.pdf)
- VERIFIED: Technicians carry an LVMPD **work card** after a background check, starting from a Work Identification Card Referral form signed by the owner. Fees are reported differently ($45 + $45 in a Metro memo vs $62 in a law-firm page). — [Clark County/Metro memo](https://files.clarkcountynv.gov/Doing%20Business/Divisions/Liquor%20and%20Gaming/Metro%20Application%20Memo_Instructions%20rev.pdf); [Shouse Law](https://shouselawdev.wpengine.com/nv/defense/laws/work-card/). Conflicting and possibly outdated.
- ASSUMED: Mostly fast, single-visit emergency calls (lockouts for car, home or commercial), rekeys, lock installs, auto key programming and commercial access control. The key compliance step is **proof of ownership/authorization** before opening (ID matched to the address or vehicle registration, recorded on the job). The industry has a problem with bait-and-switch "lead-gen" locksmiths, so upfront quotes and verified reviews matter.

**Water wells and septic (rural Clark/Nye: Pahrump, Moapa, Logandale, Indian Springs, etc.)**
- VERIFIED (official): C-23 Well drilling: "may install and repair water wells, pressure tanks, storage tanks and pumps". C-27 Individual sewerage: "lay and install individual systems for sewage disposal". A-15 covers sewers and septic tank fabrication and erection. — [NAC 624.400 / 624.440 / 624.150](https://www.leg.state.nv.us/nac/NAC-624.html)
- ASSUMED: Well work is pump and pressure tank repair, well-water testing and treatment (softeners, RO). Nevada well drillers also need a Nevada Division of Water Resources driller license and file well logs. Septic work is pumping on a 3–5 year cycle, inspections for property sales, and repairs to the drain field. Septic permits in Southern Nevada go through the Southern Nevada Health District. Not verified this pass. No reliable Las Vegas-area septic or well operator data turned up (see Gaps).

**Solar (PV and battery)**
- VERIFIED (official): Nevada solar licensing: C-2g Photovoltaics (to the service panel), C-37 Solar (C-37a water heating, b space heating, c air-conditioning, d pool heating), and C-15a roofing for PV roof tiles. — [NAC 624.200 / 624.540](https://www.leg.state.nv.us/nac/NAC-624.html)
- VERIFIED (installer guides): NV Energy interconnection goes through the **PowerClerk** online portal with a non-refundable application fee. Documents include a single-line diagram, site plan and equipment specs, plus an interconnection agreement (and a property-transfer form if the applicant isn't the owner). Guides describe staged reviews and a final inspection before Permission to Operate. — [Solar Optimum](https://solaroptimum.com/what-is-nv-energy-interconnection-process/); [Bob's Repair solar](https://solar.bobsrepair.com/the-nv-energy-solar-application-process/)
- VERIFIED (snippet of official NV Energy deck, 16 Apr 2026): NV Energy assigns the solar rate once a project reaches **"Inspection Pending"** status in PowerClerk. A separate PowerClerk environment for Rule 15 projects of 1–20 MW was due in May 2026. — [NV Energy Solar Stakeholder Meeting PDF](https://www.nvenergy.com/publish/content/dam/nvenergy/brochures_arch/cleanenergy/Solar-Stakeholder-Meeting.pdf). (I could not extract the full PDF text.)
- ASSUMED: Lifecycle is lead → site survey (roof, shading, main panel rating) → design and proposal (financing: cash, loan, lease/PPA) → contract → HOA approval → building/electrical permit → NV Energy interconnection application → install (often 1–3 days) → city/county inspection → utility inspection/meter swap → PTO (permission to operate) → monitoring and service. Roles are sales/consultant, designer, permit/interconnection coordinator, install crew (with a NABCEP-certified lead often preferred), and service tech. It is a long, multi-party project (weeks to months), not a service call.

### Inferences
- Kloomie's existing "Jobs + Visits" model fits HVAC, plumbing, appliance, garage doors and locksmith (mostly one or two visits). Solar, generators, panel upgrades and water heater or HVAC change-outs need a **project with outside-party gates**: permit, inspection, utility, HOA.
- The one compliance-heavy *recurring* log is HVAC refrigerant (EPA 608 / AIM Act ER&R). Every other trade's compliance is mostly per-job documents (permit number, inspection result, warranty registration, utility PTO) or people documents (licenses, work cards, EPA cards).

### Gaps
- Exact Clark County permit fees and whether a like-for-like water heater swap needs a permit in every jurisdiction (City of LV, Henderson and North LV run their own permit offices). Only third-party sites were found.
- Nevada Division of Water Resources driller rules and Southern Nevada Health District septic permits were not fetched.
- No locksmith-specific statewide licensing appeared in NAC 624. Licensing appears to be local (business license and work card) only.

---

## Q2. Which Las Vegas / Clark County operators lead each trade, what do they visibly do, and who are the national leaders?

### Takeaway
Las Vegas residential HVAC and plumbing is dominated by multi-trade "air and plumbing" shops (Goettl, Sierra, Pure Plumbing & Air, Ambient Edge, Lee's Air, Sunrise) and franchises (One Hour, Mr. Rooter, Benjamin Franklin, Precision Door). Every one advertises the same four things: **24/7 or same-day service, a membership club, financing, and upfront pricing**. Nationally the field is PE-backed platforms and franchisors (Neighborly, Service Experts, Authority Brands, ARS, Wrench Group).

### Cited Findings
- VERIFIED (marketing): **Goettl** (HVAC and plumbing, Las Vegas) has the "Smart Sadie" membership with a members-only hotline and priority on emergency calls. A listing says members pay no emergency evaluation or trip fees and no after-hours or holiday rates. Upfront pricing and financing; a monitoring add-on at $19/mo. — [Goettl Las Vegas](https://www.goettl.com/location/las-vegas-nevada); [Goettl water heater repair](https://www.goettl.com/location/las-vegas-nevada/water-heater-repair)
- VERIFIED (directory listing): **Sierra Air Conditioning & Plumbing**: the S.A.M. Plan has 4 visits a year, repair discounts, priority service and extended warranties, plus financing and 24/7 emergency service. — [Lantern listing](https://lantern.llc/b/sierra-air-conditioning-plumbing-las-vegas/book)
- VERIFIED (marketing): **Ambient Edge**: financing with no down payment and a "VIP Club" membership. — [Ambient Edge AC maintenance](https://www.ambientedge.com/las-vegas/ac-maintenance)
- VERIFIED (marketing): **One Hour Heating & Air of Las Vegas** (franchise): 24/7 emergency service, upfront pricing, financing. — [One Hour Las Vegas](https://www.onehourheatandair.com/las-vegas)
- VERIFIED (marketing): **Pure Plumbing & Air**: 24/7 emergency response, "Pure Care" membership, family-owned. — [Pure Plumbing & Air](https://www.pureplumbinglv.com/water-heater-installation-las-vegas-nv)
- VERIFIED (marketing): **Mr. Rooter Plumbing of Las Vegas** (Neighborly): tank and tankless water heater repair/replace with emergency service. — [Mr. Rooter Las Vegas](https://www.mrrooter.com/las-vegas/residential-services/water-heater-repair-replacements/)
- VERIFIED (marketing): **Benjamin Franklin Plumbing** has a Las Vegas location. Its membership (shown on the Kingman AZ page) includes 24/7 emergency service at no extra cost and up to $250 toward a water heater replacement. — [Ben Franklin Las Vegas](https://www.benjaminfranklinplumbing.com/las-vegas/about-us/our-products); [Heroes Club, Kingman](https://www.benjaminfranklinplumbing.com/kingman/about-us/heroes-club/)
- VERIFIED (marketing): **NRS (nrs.vegas)**: membership at $15/month and same-day water heater replacement. — [nrs.vegas](https://nrs.vegas/plumbing/water-heater-repair-and-installation)
- VERIFIED (marketing): **Lee's Air** (HVAC/plumbing) sells plumbing maintenance plans. **Sunrise HVAC** memberships include discounts, emergency service, priority and seasonal maintenance. **Right Now Air** advertises 24/7 service, a real person answering, and maintenance plans. **Hollywood Air** has Gold $209/yr and Platinum $259/yr plans, with inconsistent "24/7" vs Mon–Sat 8am–11pm hours. — [Lee's Air](https://leesair.com/las-vegas/plumbing/plumbing-maintenance/); [Sunrise HVAC](https://www.sunrisehvac.com/?p=870); [Right Now Air listing](https://lantern.llc/b/right-now-air-las-vegas/book); [Hollywood Air preview page](https://re-work-previews.pages.dev/las-vegas-hvac/hollywood-air-hvac-heating-cooling) (low reliability)
- VERIFIED: **A-1 Mechanical** is a Carrier dealer in Las Vegas. — [Carrier dealer page](https://www.carrier.com/us/en/residential/dealers/nv/las-vegas/5985-polaris-ave-75294-loc)
- VERIFIED: Garage doors: **Precision Garage Door of Las Vegas** (franchise). — [Precision Door](https://www.precisiondoor.net/locations/nevada/las-vegas/las-vegas)
- VERIFIED (BBB listing): Electrical/solar: Allegiant Electric (A+, solar contractor category) and Friends Electric in Las Vegas. — [BBB Pahrump backup systems category](https://prod.bbb.org/us/nv/pahrump/category/electrical-power-system-backup-systems)
- VERIFIED: National: **Service Experts** (Richardson TX, founded 1996) is among the largest residential HVAC providers. It launched franchising in 2025 and was named a 2026 top new franchise. — [IFA / franchise.org, May 2026](https://www.franchise.org/2026/05/service-experts-named-one-of-2026s-top-new-and-emerging-franchises-by-entrepreneur-magazine/)
- VERIFIED: **Neighborly** brands include Mr. Rooter (230+ locations, #1 plumbing franchise 2025), Mr. Electric (220+ locations, #1 electrical 2025), Aire Serv (HVAC) and Mr. Appliance. A Neighborly rooter brand was the top plumbing franchise in Entrepreneur's 2026 Franchise 500. — [Franchising.com Neighborly](https://australia.franchising.com/neighborly) (self-reported); [Entrepreneur 2026](https://www.entrepreneur.com/buying-a-franchise/top-5-maintenance-franchises-on-the-2026-franchise-500)
- VERIFIED: Private equity owns or controls most of the largest home-services franchisors. — [CT Acquisitions (marketing)](https://ctacquisitions.com/?p=35499)
- ASSUMED: Other national players are **Authority Brands** (One Hour Heating & Air, Benjamin Franklin Plumbing, Mister Sparky), **ARS/Rescue Rooter**, **Roto-Rooter** (Chemed), **Wrench Group** and **Apex Service Partners** (PE roll-ups of local brands), and **Sears Home Services** in appliance repair. I did not verify these ownerships this pass.

### Inferences
- In Las Vegas the membership is the core retention product, and the selling points are **priority over non-members in summer, no after-hours fees, repair discounts and extra visits** (Sierra's 4 visits a year is above the national two-visit norm, likely reflecting heavy cooling use).
- Kloomie's buyers (small and trade businesses) are the independents competing with these brands. The software has to make a 3–15 person shop look like Goettl: instant booking, on-my-way texts, tiered quotes on a tablet, financing links and a membership program.

### Gaps
- No market-share data per trade in Las Vegas. "Leaders" here means visible brands in search results, not revenue-ranked.
- No reliable Las Vegas data on appliance repair, locksmith, generator, septic or well operators. Results were dominated by lead-gen template sites.
- Las Vegas solar installers (local vs national: Sunrun, Tesla, Freedom Forever, etc.) were not researched this pass.

---

## Q3. What does a maintenance-agreement / membership program look like operationally?

### Takeaway
A residential plan is usually **2 visits a year** (spring cooling, fall heating; Las Vegas shops sometimes sell 4), costs **$150–$500/yr** (or $15–$20/mo), and bundles a 10–15% repair discount, priority scheduling, waived trip or after-hours fees and sometimes extended warranties. The operational work is: generate the visits, remind and book them, bill (often monthly autopay) and renew. The target renewal rate is 85–95%.

### Cited Findings
- VERIFIED: Two visits a year (spring and fall) is the residential norm. A mid-summer visit is sometimes added for heat pumps in humid climates. Commercial is quarterly or more. — [Smart Service (vendor)](https://www.smartservice.com/blog/how-much-hvac-service-agreements); [oxmaint (vendor)](https://oxmaint.com/industries/hvac/preventive-maintenance-contract-scheduling-hvac)
- VERIFIED: Typical inclusions are 2 tune-ups, a 10–15% repair discount, priority scheduling, a filter at each visit, and a repair warranty (one example: 2 years). Most plans fall between $150 and $500/yr. — [Smart Service](https://www.smartservice.com/blog/how-much-hvac-service-agreements); [Baptist Heating & Air: $210/yr or $18.50/mo](https://bha-website.pages.dev/services/maintenance-agreements/)
- VERIFIED: Renewal target is 85–95%. Below 75% signals problems with visits, billing or perks. — [ServiceMag](https://servicemag.org/guides/maintenance-agreements-recurring-revenue)
- VERIFIED: Some plans make the customer responsible for scheduling, with the company sending reminders. — [Angi](https://angi.com/articles/are-hvac-maintenance-contracts-worth-it.htm)
- VERIFIED: ServiceTitan sells memberships from the estimate or invoice ("Sell Membership", so the selling tech gets credit on the "Memberships Sold By" report). Recurring billing needs a card on file and a first billing date that matches the sale date. — [ServiceTitan help](https://help.servicetitan.com/docs/build-estimates-close-sales)
- VERIFIED: Las Vegas examples: Sierra S.A.M. (4 visits/yr), Goettl Smart Sadie (no trip, after-hours or holiday fees; priority on emergencies), NRS ($15/mo), Hollywood Air ($209 / $259 per yr), Ben Franklin (up to $250 toward a water heater). — sources in Q2.
- VERIFIED (weak): ACCA Standard 4 (commercial maintenance) is cited as giving a defensible scope for commercial plans. — [oxmaint (vendor)](https://oxmaint.com/industries/hvac/preventive-maintenance-contract-scheduling-hvac)
- ASSUMED: Other trades' versions: plumbing annual whole-home inspection plus water heater flush (and softener check in hard-water areas), garage door annual tune-up, generator 1–2 services a year with a load test, solar annual inspection or panel cleaning plus monitoring, septic pumping every 3–5 years with a reminder, backflow annual test, and electrical annual safety inspection. Many multi-trade Las Vegas shops sell one "club" covering HVAC and plumbing.

### Inferences
- What the software needs: a **plan template** (price, billing frequency, visits per year with season or month windows, discount %, perks such as waived trip or after-hours fees), a **customer agreement** (start, renewal date, autopay card, status), auto-generated **visit tasks** placed in each season's window, **reminder sequences** (text/email "book your tune-up", then call-list escalation), member pricing applied to estimates, renewal notices about 30 days ahead, and a member flag shown to dispatch for priority.
- Spreading spring visits from February to April before the Las Vegas summer peak is a big capacity lever (INFERRED).

### Gaps
- No official ACCA material on membership operations was fetched. Benchmarks come from vendor blogs.

---

## Q4. Flat-rate pricebook vs time-and-materials: what is the practice, and how are options presented on site?

### Takeaway
Residential service has largely moved to **flat-rate (task-based) pricing from a pricebook**: each task has a fixed price built from labor hours × rate + parts markup, with member and non-member prices. T&M remains for diagnostics, uncertain scope, commercial and new construction. On site the tech presents **good-better-best** options on a tablet side by side, the customer picks and signs, and financing is offered on the bigger tiers.

### Cited Findings
- VERIFIED: Flat rate is one price per job; hourly bills the time taken. Guidance favors flat rate for common repairs and installs, and T&M for diagnostics and uncertain scope. — [ServiceTitan](https://www.servicetitan.com/blog/flat-rate-vs-hourly); [Housecall Pro](https://www.housecallpro.com/resources/how-to-price-hvac-services/)
- VERIFIED: Some flat-rate advocates argue diagnostic and trip charges are T&M leftovers and should be built into task prices. — [PMMag, Frank Blau](https://www.pmmag.com/articles/84507-diagnostic-fees-service-agreements-br-frank-blau). Counterpoint: [ACHR News "Why flat rate doesn't work"](https://www.achrnews.com/articles/92605-why-flat-rate-doesn-8217-t-work) (older article).
- VERIFIED: In ServiceTitan, Good, Better and Best are proposal types. Estimate templates are grouped into tiers under Pricebook > Templates > Proposal Templates, and appear in the mobile app only once grouped. Categories can be hidden from mobile or limited by business unit. "Pricebook Pro" content can build starter good-better-best templates automatically. — [ServiceTitan help: build estimates](https://help.servicetitan.com/docs/build-estimates-close-sales); [proposal templates](https://help.servicetitan.com/docs/proposal-templates)
- VERIFIED: ServiceTitan markets flat-rate pricebooks per trade (HVAC, plumbing) and automated price updates from supplier costs. — [ServiceTitan HVAC flat rate](https://www.servicetitan.com/industries/hvac-software/flat-rate); [automation pricing](https://www.servicetitan.com/blog/automation-pricing-for-contractors)
- ASSUMED: Third-party pricebooks (Profit Rhino, The New Flat Rate, Pricebook Pro) supply task libraries with photos and descriptions. Tiers often differ by warranty length, part quality (OEM vs universal) and add-ons (surge protector, hard-start kit, expansion tank). A "Best" tier usually bundles a membership.

### Inferences
- Kloomie needs a **pricebook** (task: code, name, customer-facing description, photo, labor hours, parts list, price, member price, category, trade), **option sets** on an estimate (2–4 columns, one picked), signature capture, deposit or financing link, and "convert the approved option to work order + parts list".

### Gaps
- No independent data on the share of shops using flat rate vs T&M in 2026.

---

## Q5. What data does a tech capture per visit?

### Takeaway
Per visit: arrival/departure times, **equipment record** (type, make, model, serial, install date, warranty status, refrigerant type and charge, location in the home), **readings** (trade-specific), before/after **photos**, findings and recommendations, **parts used** (from the truck or ordered), options presented and chosen, **customer signature** (authorization and completion), payment, and checklist results for maintenance visits.

### Cited Findings
- VERIFIED: Refrigerant records: location, date of recovery and refrigerant type for disposal of mid-size appliances. Leak-repair rules require verification tests and repair records for appliances over the threshold (50 lb ODS; 15 lb HFC from 2026). — [ACHR News](https://www.achrnews.com/articles/135445-epa-608-recordkeeping-impacts-technicians); [EPA leak repair](https://www.epa.gov/section608/stationary-refrigeration-leak-repair-requirements); [EPA ER&R fact sheet](https://www.epa.gov/system/files/documents/2026-01/er-r-fact-sheet-leak-repair-2026-01-13_1.pdf)
- VERIFIED (vendor): Checking warranty documents before the visit is recommended to cut claim rejections (appliance). — [Fieldproxy](https://www.fieldproxy.ai/blueprints/appliance-repair-parts-ordering)
- ASSUMED, per trade:
  - **HVAC**: model/serial of the condenser, air handler/furnace and coil; tonnage; refrigerant type, lbs added or recovered (cylinder ID); suction/liquid pressures, superheat/subcool; supply/return temps (delta-T); static pressure; amp draw; capacitor µF; filter size; for gas heat, combustion analysis (O2, CO2, flue CO ppm, efficiency), CO ambient and gas pressure; condensate check.
  - **Plumbing / water heaters**: water heater make/model/serial, age (decoded from the serial), fuel, gallons; house water pressure (PSI) and PRV and expansion tank status; hardness reading if testing; camera video and location of a defect; backflow test values.
  - **Electrical / generators**: panel make, amperage and space; voltage and amperage readings; GFCI/AFCI checks; generator hours, oil change, battery voltage, exercise/load test results, firmware.
  - **Appliance**: brand, model, serial, error codes, part numbers ordered, warranty authorization number.
  - **Garage door**: door size and weight, spring size (wire, ID, length) and cycles, opener model, safety-reverse test pass/fail.
  - **Locksmith**: ID or authorization proof (name, ID type, address or VIN match), key codes (kept private).
  - **Solar**: inverter and module model/serials, string voltages, production reading, monitoring ID, permit and PTO numbers.

### Inferences
- The **equipment/asset record per customer location** is the one data object that serves every trade: it holds history, warranty and readings and drives maintenance and replacement sales ("your water heater is 11 years old"). Kloomie's new Equipment & assets kind (5dd7212) is for the company's own gear. A *customer-owned equipment* record tied to the customer and address would be a separate, needed object (INFERRED).
- Readings should be **structured fields per trade checklist**, not free text, so that out-of-range values (low subcool, high CO) can raise a recommendation or flag.

### Gaps
- I did not fetch an authoritative per-trade checklist (e.g. ACCA 4 / ACCA 180 maintenance tasks, Generac maintenance schedules).

---

## Q6. Las Vegas specifics: extreme heat and no-AC priority, hard water, solar and net metering rules

### Takeaway
Las Vegas summers turn no-cool calls into same-day emergencies. Nevada treats landlord-supplied AC as an **essential service with a 48-hour repair window** after written notice, so property managers press hard. Water is **~16 grains per gallon (very hard)**, which drives water heater, softener and fixture work. Southern Nevada rooftop solar keeps **monthly netting with export credit at about 75% of retail**, but a **daily demand charge** for residential customers began April 2026 and the PUCN rulings are being challenged in court.

### Cited Findings
- VERIFIED (news / tenant guides): Under NRS 118A.380, after written notice a landlord has 48 hours to restore an essential service, including AC where provided. Most Southern Nevada judges treat AC as essential. — [KTNV 13 Investigates](https://www.ktnv.com/news/investigations/broken-ac-nevada-landlords-must-make-repairs-within-48-hours); [tenant-rights.com](https://tenant-rights.com/nevada/nevada-landlord-repair-timeframes-tenant-rights-explained); [Las Vegas Weekly, Jul 2026](https://lasvegasweekly.com/news/2026/jul/23/what-are-your-rights-air-conditioning-goes-out/). The statute text itself was not read.
- VERIFIED (older RJ article): North Las Vegas is the only Clark County jurisdiction that requires AC for habitability. Others require heating but not AC. — [Review-Journal](https://www.reviewjournal.com/?p=1113447) (date unclear; may be older)
- VERIFIED (official utility): LVVWD water hardness is **280 ppm, about 16 grains per gallon, "very hard"**. — [Las Vegas Valley Water District](https://www.lvvwd.com/water-quality/facts)
- VERIFIED (weak): a local guide suggests flushing water heaters every 6 months. Softener sellers' figures on efficiency loss are inconsistent and unreliable. — [Desert Plumbing 101 (unverified)](https://desertplumbing-101.vercel.app); [SoftPro (seller)](https://softprowatersystems.com/pages/best-water-softener-las-vegas-nv)
- VERIFIED: On 17 Sept 2025 the PUCN approved 15-minute netting and new demand charges. Reporting says the **15-minute netting applies only to Northern Nevada** (Sierra Pacific) for systems installed after 1 Oct 2025. Southern Nevada (Nevada Power) keeps monthly netting. **Southern Nevada residential and small business customers face a daily demand charge based on peak 15-minute draw starting April 2026.** — [Solar Power World, Sep 2025](https://www.solarpowerworldonline.com/2025/09/nevada-puc-approves-shift-to-15-minute-netting-new-demand-charges-for-all-customers/); [Utility Dive](https://utilitydive.com/news/regulators-approve-demand-charge-net-metering-changes-for-nv-energy/760485)
- VERIFIED: Vote Solar petitioned district court on 26 Nov 2025. The Nevada AG's Bureau of Consumer Protection is also challenging the demand charge and 15-minute netting. — [Vote Solar](https://votesolar.org/?p=10879); [California Globe](https://californiaglobe.com/fr/solar-showdown-nevadas-consumer-protection-bureau-files-lawsuit-against-public-utilities-commissions-approval-of-solar-price-hikes/). The 2026 outcome is unknown.
- VERIFIED: New NV Energy net-metering customers get about 75% of retail for exports. Sources conflict on whether the net-metering cap has been reached. — [SolarReviews](https://www.solarreviews.com/going-solar-with-nvenergy); [EnergySage](https://www.energysage.com/net-metering/nv-energy/) (says no cap; possibly dated)
- VERIFIED: The federal 25D residential solar tax credit ended at the close of 2025, per one source. — [cleanenergycalc](https://cleanenergycalc.com/states/nevada). INFERRED: this pushes residential solar toward lease/PPA (third-party-owned, where 48E still applies) and toward battery-plus-solar pitches against demand charges. Not verified.
- ASSUMED: Las Vegas HVAC triage is: no-cool with elderly, infants or medical needs first, then members, then everyone else. Summer daily call volumes can be several times spring, so dispatch boards need capacity limits per day and "overflow" waitlists. Rooftop condensers and attic air handlers mean heat-safety rules for techs (work early, limit attic time).

### Inferences
- A Las Vegas HVAC template should carry a **"no-cool emergency" priority flag** with vulnerable-occupant questions at intake, a **landlord/tenant field** (who authorizes, who pays, notice date and 48-hour clock) for property-manager accounts, and summer capacity planning.
- Plumbing/water heater templates should default to **hardness-driven recommendations**: anode check, flush interval, softener or conditioner offer, and expansion tank and PRV checks.
- Solar templates should track **PowerClerk statuses** (application submitted → approved → install → "Inspection Pending" → PTO) alongside the AHJ permit and inspection.

### Gaps
- The NV Energy April 2026 stakeholder deck PDF could not be text-extracted. Exact PowerClerk status names beyond "Inspection Pending", fees and current review timelines are unverified.
- The current status of the PUCN court challenges as of Nov 2026 was not found.

---

## Q7. Software and practices leaders use, bottlenecks, and the "software needs" list per trade

### Takeaway
ServiceTitan dominates larger residential HVAC, plumbing and electrical shops (pricebook, proposals on tablets, memberships, call booking, reporting). Housecall Pro and Jobber serve small shops (simple scheduling, on-my-way texts, online booking, reviews, payments). FieldEdge and Successware serve mid-size HVAC/plumbing shops with service-agreement depth. The automation that saves the most admin time is the same everywhere: booking → confirmation → on-my-way text → estimate and signature on site → invoice and payment on site → review request → maintenance reminder.

### Cited Findings
- VERIFIED: ServiceTitan field-app features: good-better-best presentation mode, member pricing, email estimates with view and sign notices, membership sale from the estimate or invoice with recurring billing, "Memberships Sold By" reporting, and an AI tech assistant ("Atlas"). — [ServiceTitan help](https://help.servicetitan.com/docs/build-estimates-close-sales)
- VERIFIED: Housecall Pro is simpler and suits small businesses. FieldEdge is deeper and more customizable but reportedly has no customer portal or online booking and a less polished mobile app. — [SoftwareAdvice 2026](https://www.softwareadvice.com/field-service/fieldedge-profile/vs/housecall); [ranksvs (low reliability)](https://ranksvs.pages.dev/compare/fieldedge-vs-housecall-pro)
- VERIFIED: Jobber has built-in routing. Housecall Pro relies on integrations for route optimization (Jobber's own claim). Jobber suits solo and tight-budget operators. — [Jobber comparison](https://www.getjobber.com/comparison/jobber-vs-housecall-pro/); [SelectHub](https://www.selecthub.com/field-service-software/jobber-vs-housecall-pro/)
- VERIFIED (low reliability): Successware is about $190/mo vs Housecall Pro from $79/mo, with a dated interface and no free trial. — [ranksvs](https://ranksvs.pages.dev/compare/housecall-pro-vs-successware)
- VERIFIED: G2 scores Housecall Pro 9.1 for confirmations and reminders and 8.1 for review management. — [G2](https://www.g2.com/compare/jobber-vs-clockwork-ip-successware-vs-housecall-pro)
- VERIFIED (vendor): First-time fix improves with parts-on-truck visibility and pre-visit warranty checks. Ordering from the truck costs about 20 minutes per call. — [Bruviti](https://bruviti.com/s/appliance_manuf/field_service/operator-workflow.html)
- ASSUMED, common bottlenecks:
  1. Missed calls and after-hours booking (lost jobs). Fixes: online booking, an AI answering service or call-booking, a text-back for missed calls.
  2. Dispatch juggling on the whiteboard or phone. Fixes: a drag-and-drop board, skills/zone matching, ETA texts.
  3. Paper tickets and re-keying into QuickBooks. Fixes: mobile invoices, QuickBooks sync, payment on site.
  4. Parts runs and second visits. Fixes: a parts-on-order status with ETA, auto-scheduling the return visit when the part arrives, truck inventory.
  5. Estimates never followed up. Fixes: automatic follow-ups on unsold options at 2, 7 and 30 days.
  6. Membership visits not booked and renewals lapsing. Fixes: auto-generated visits, reminder sequences, autopay.
  7. Permits, inspections and warranty registrations forgotten. Fixes: tasks with due dates triggered by the install stage.
  8. Collecting reviews. Fixes: an automatic review-request text after a paid job, routed to Google.
- ASSUMED: Financing (GreenSky, Synchrony, Service Finance, Wells Fargo, and in solar Mosaic, GoodLeap) is offered as a monthly payment on Better/Best options. The software shows "as low as $X/mo" and launches a soft-pull application link.

### Inferences: software needs per trade

**Common core (every trade)**: customer + service location + **customer equipment records**; job with stages *New → Scheduled → Dispatched → En route → On site → Estimate presented → Approved → (Parts on order → Return scheduled) → Completed → Invoiced → Paid → Review requested*; trip/diagnostic fee (credited if approved); pricebook with member pricing; good-better-best estimate with e-signature; photos (before/after); parts used; payment on site (card/tap/financing link); on-my-way text with tech photo and ETA; review request; maintenance plans with auto visits, reminders and renewals; QuickBooks sync. Biggest admin savers: booking-to-confirmation texts, auto-invoice on completion, parts-arrived → schedule return visit, unsold-estimate follow-ups, membership reminders, and review requests.

1. **HVAC**: Record: equipment (condenser/furnace/coil model, serial, tonnage, SEER2, refrigerant type, install date, warranty end), readings (pressures, superheat/subcool, delta-T, static, amps, combustion/CO), refrigerant added/recovered with cylinder IDs. Stages add *Comfort advisor visit → Sold → Permit pulled → Install → Inspection → Warranty registered*. Recurring: 2 (LV often 4) tune-ups/yr in spring and fall windows, filter reminders. Documents: EPA 608 card per tech, refrigerant log (3-yr retention; leak-rate tracking for ≥15 lb HFC systems), mechanical permit per appliance (Clark County), inspection result, warranty registration proof, Manual J if replacing. Automations: no-cool priority triage and summer capacity limits, auto permit/inspection/warranty tasks on sold change-outs, a "unit is 12+ years old" replacement flag, and membership visits.
2. **Plumbing / water heaters**: Record: fixture/water heater (make, model, serial, age, gallons, fuel), water PSI, PRV/expansion tank, hardness, camera video and defect location. Stages: emergency triage (active leak → shutoff guidance text), *Drain → Camera → Estimate*; replacements add a permit and inspection. Recurring: annual flush (6-month suggested in LV), softener service, annual backflow tests with report filing. Documents: C-1d/C-1h license, plumbing permit, inspection, backflow test reports, warranty registration. Automations: flush/anode reminders tied to the water heater's install date, backflow due-date reminders, a video link sent to the customer.
3. **Electrical**: Record: panel (make, amps, spaces), circuits added, readings, EV charger or solar/battery ties. Stages add *Permit → Utility disconnect/reconnect date (NV Energy) → Inspection*. Recurring: safety inspections (low). Documents: C-2 license, electrical permit, inspection card, utility work order. Automations: utility-coordination tasks and a permit-to-inspection tracker.
4. **Generators**: Record: generator model/serial, kW, fuel, transfer switch, hours, battery date, firmware, activation ID. Stages: *Site survey → Proposal/financing → Permits (electrical + gas) → Gas meter/utility → Install → Inspection → Activation/warranty registration*. Recurring: 1–2 services/yr with a load test. Documents: permits, gas utility approval, manufacturer registration. Automations: service reminders by hours or date, plus registration deadline tasks.
5. **Appliance repair**: Record: brand, model, serial (photo at booking), error codes, warranty source (OEM / home warranty / extended) with authorization # and deductible. Stages center on *Diagnosed → Parts ordered (supplier, PO, ETA) → Parts received → Return visit → Complete → Claim submitted → Claim paid*. Recurring: little (dryer-vent cleaning, fridge coil cleaning). Documents: OEM/warranty claims with repair codes. Automations: parts ETA tracking that auto-texts the customer to book the return visit, claim submission and reconciliation, and a model/serial-driven parts lookup.
6. **Garage doors**: Record: door size, weight, spring spec (wire/ID/length, cycles), opener model, sensor status. Stages are mostly single-visit. Door replacement adds *Measure → Order → Delivered → Install*. Recurring: annual tune-up/safety check. Documents: C-3d license, safety-reverse test result. Automations: spring-cycle-based tune-up reminders and order tracking for doors.
7. **Locksmith**: Record: ID/authorization proof (stored privately and sealed), service type (auto/residential/commercial), key codes or master-key system charts (sealed), vehicle VIN. Stages: quick *Quote → Dispatch → Verify ID → Work → Paid*. Recurring: commercial rekey/access-control service, key-system records. Documents: Clark County privileged business license, LVMPD work card per tech (with expiry), vehicle markings. Automations: upfront-quote text before dispatch (consumer trust), work-card expiry reminders, and sealed storage of key codes (a fit with Kloomie's sealed-field pattern).
8. **Wells and septic**: Record: well (depth, pump model, pressure tank, water test results), septic (tank size, location, last pumped, drain field condition). Recurring: septic pumping every 3–5 years, annual well-water tests. Documents: C-23/C-27 licenses, well logs (NDWR), septic permits/inspections (Southern Nevada Health District, unverified), real-estate inspection reports. Automations: multi-year pump-out reminders and test-result reports to the customer.
9. **Solar / battery**: Record: system (module and inverter models/serials, kW DC/AC, battery), utility account, permit #, PowerClerk application #, PTO date, monitoring ID, financing type. Stages: *Lead → Site survey → Design/proposal → Contract → HOA → Permit → Interconnection submitted → Approved → Install → AHJ inspection → "Inspection Pending" (NV Energy) → PTO → Monitoring*. Recurring: annual inspection/cleaning and production monitoring alerts. Documents: C-2g/C-37 license, single-line diagram, site plan, spec sheets, interconnection agreement, permit, inspection, PTO letter, warranty registrations. Automations: a stage tracker with outside-party waiting times, customer status texts at each milestone ("your utility approval came in"), a document checklist per stage, and production-drop alerts.

### Gaps
- No primary 2026 feature pages were fetched for Housecall Pro, Jobber, FieldEdge or Successware. Feature claims rely on comparison and review sites. Whether each sends "on my way" texts is industry common knowledge (ASSUMED) but not verified here.
- No operator interviews or podcasts were reviewed. Bottleneck rankings are inferred.
