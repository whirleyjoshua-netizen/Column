// The website's landing pages: one for each feature (with its video), each kind of business, and each comparison.
// Pages are data here, drawn by one template in the website's look; every claim is something Kloomie does today
// (checked against the code and Help, docs/research for the trades). /features lists them all.
// Each page: its own title, description, canonical address, breadcrumbs, VideoObject (when it has a video) and
// FAQPage (when it has questions). Text is plain words here and escaped when drawn; **bold** marks emphasis.

const PRICE = '$15 a person a month, with a 14-day free trial and no card to start';

export const PAGES = {
  // ---------- features ----------
  'features/file-sharing': {
    kind: 'feature', name: 'File sharing', title: 'Team file sharing across phones and computers',
    desc: 'Drop in files, photos and links and they’re on every phone and computer on your team. Request links, public links and Dropbox, Google Drive and OneDrive.',
    kicker: 'File sharing', h1: 'Files on every phone and computer on your team, the moment you drop them in',
    lead: 'Stacks is where your team’s files, notes and links live. A photo taken on site is on the office computer a second later, and anything on the desktop drags straight out again.',
    video: { src: '/videos/stacks.mp4', poster: '/videos/stacks.jpg', name: 'Stacks: file sharing' },
    points: [
      ['A stack for each kind of thing', 'Make stacks like Design, Receipts or Clients. Narrow a busy one to photos or documents, or search it.'],
      ['Collect files from anyone', 'A request link lets a customer or supplier send files straight into a stack, without an account.'],
      ['Share outside the team', 'Give any file a public link, download it, share it to chat, or pin it so it’s never cleared.'],
      ['Bring in what you already have', 'Add files from Dropbox, Google Drive or OneDrive. Kloomie only reads them; it never changes anything there.'],
      ['Codes kept sealed', 'A sealed note is encrypted on your device and opens only with a one-time code you give out.'],
      ['On every device', 'In the browser, on Mac and Windows, and on iPhone and Android from the home screen.'],
    ],
    faq: [
      ['Do the people I send files to need an account?', 'No. A request link lets anyone send you files, and a public link lets anyone open the one file you share.'],
      ['Does Kloomie change my Dropbox or Google Drive?', 'No. Files you pick are copied into Kloomie; it never changes anything in Dropbox, Google Drive or OneDrive.'],
    ],
    related: ['features/daily-planner', 'features/e-signatures', 'for/contractors'],
  },
  'features/daily-planner': {
    kind: 'feature', name: 'Daily planner', title: 'Team daily planner with Google and Outlook calendar sync',
    desc: 'Plan your day with tasks and time blocks beside your Google, Outlook or Apple calendar, typed the way you’d say it. Repeats, bills and job visits included.',
    kicker: 'Daily planner', h1: 'Your day and your to-do list, next to your calendar',
    lead: 'Day is your own schedule and to-do list. Type it the way you’d say it, see your calendar beside it, and send time blocks back to your calendar.',
    video: { src: '/videos/day.mp4', poster: '/videos/day.jpg', name: 'Day and tasks' },
    points: [
      ['Your calendar, in your day', 'Connect Google Calendar, Outlook or Apple Calendar. Pick which calendars show, and which one your time blocks go onto.'],
      ['Your day in any calendar app', 'Make a calendar link and add it to Apple, Google or Outlook: your blocks and job visits show up there and keep updating.'],
      ['Things that repeat', 'Daily, on weekdays, weekly or monthly, ticked off day by day.'],
      ['Bills and visits too', 'Bills due show up on the day they’re due, and job visits sit on the day of everyone going.'],
      ['Home, made for you', 'Home shows what needs you, what’s on today, and what came in. With an AI key, Brief me sums it up in a few lines.'],
      ['Only you see your calendar', 'Your calendar’s events are yours. Kloomie never shows them to the rest of the team.'],
    ],
    related: ['features/file-sharing', 'features/ai-agents', 'for/cleaning-businesses'],
  },
  'features/call-lists-and-campaigns': {
    kind: 'feature', name: 'Call lists and campaigns', title: 'Call list tracker and team campaigns',
    desc: 'Turn a spreadsheet into a call list, log every call and email, and run campaigns with steps, roles and sign-offs that tell people when they’re up.',
    kicker: 'Call lists and campaigns', h1: 'Turn a spreadsheet into a call list, and a goal into a plan the whole team can follow',
    lead: 'A campaign is a project with a finish line: an outreach push, a launch, a seasonal promotion. It’s made of goals and steps, and a step can be a call list to work through.',
    video: { src: '/walkthrough.mp4', poster: '/walkthrough-poster.jpg', name: 'Campaigns walkthrough' },
    points: [
      ['Call lists from a spreadsheet', 'Drop a spreadsheet onto a campaign and it becomes a call list. Log each call or email and its outcome, and see who’s next.'],
      ['Steps that wait their turn', '“Print flyers” can wait on “approve the design”. When the last thing a step waits on is done, the person doing it hears “You’re up”.'],
      ['Roles, so work follows people', 'Give a campaign roles like Caller or Approver. Steps go to the role, and a step can need an approver’s sign-off.'],
      ['Steps that use a tool', 'A step can be an email to send, a document to sign, files to collect, calls to make or a meeting, and finishing in the tool finishes the step.'],
      ['See how it’s going', 'Every campaign shows on track, at risk or off track, with check-ins. Count goals count the calls logged, by outcome.'],
      ['Plan it with AI', 'With your own AI key, Sidekick suggests goals, steps, who does what and the order. Save a campaign to run again on a schedule.'],
    ],
    related: ['features/email-campaigns', 'features/canvassing-and-mileage', 'for/field-sales'],
  },
  'features/email-campaigns': {
    kind: 'feature', name: 'Email campaigns', title: 'Send email campaigns from your own Gmail or Outlook',
    desc: 'Send email to your contacts from your own Gmail or Outlook address, so replies come to your inbox. Every message carries an unsubscribe link.',
    kicker: 'Email campaigns', h1: 'Email your customers from your own Gmail or Outlook',
    lead: 'Connect Gmail or Outlook and the email you write in Kloomie goes from your own address. Replies come back to your inbox, and it shows in your Sent folder.',
    points: [
      ['From your own address', 'No new sending domain to set up: people get email from you, and reply to you.'],
      ['Unsubscribe built in', 'Email sent to contacts from a campaign includes an unsubscribe link, and Kloomie won’t email anyone who used it.'],
      ['Do not contact, everywhere', 'Someone marked do not contact isn’t emailed or texted from anywhere in Kloomie.'],
      ['Kloomie can’t read your inbox', 'It only sends what you write. Your signature goes in once, in Settings.'],
      ['Part of the plan', 'An email can be a step in a campaign, logged with the rest of the campaign’s calls and emails.'],
      ['Drafts that sound like you', 'With your own AI key, your Marketing agent drafts campaigns from your business profile, and nothing goes out until you say yes.'],
    ],
    faq: [
      ['Do I need a separate email marketing tool?', 'Not for emailing your own contacts. Kloomie sends from your Gmail or Outlook account, within the limits Google and Microsoft set for your account.'],
    ],
    related: ['features/call-lists-and-campaigns', 'features/ai-agents', 'for/real-estate-teams'],
  },
  'features/e-signatures': {
    kind: 'feature', name: 'E-signatures', title: 'E-signatures for small business: send documents to sign',
    desc: 'Write quotes and documents, fill in PDFs, and send them to be signed electronically. The signed copy comes back with a signing record, next to the original.',
    kicker: 'Documents and e-signatures', h1: 'Send a document to be signed, and get the signed copy back',
    lead: 'Write quotes, proposals and pages in Docs, or fill in a PDF, and send it for an electronic signature. The signed copy comes back with a record of the signing, right next to the original.',
    video: { src: '/videos/signatures.mp4', poster: '/videos/signatures.jpg', name: 'Signatures' },
    points: [
      ['Quotes customers accept online', 'Send a quote from a job: the customer opens a page, reads it, and accepts it by typing their name, or declines.'],
      ['Sign-offs on the job', 'A customer signs a form filled in from the job, on your phone or from a link, and the job can move on by itself once it’s signed.'],
      ['Docs that write themselves', 'Start from a template like a proposal, or have AI draft it on your own key. Type / for live blocks that keep themselves up to date.'],
      ['A record of each signing', 'Signers agree to sign electronically first, and the signed copy keeps the signing record with it.'],
      ['In the flow of work', 'A document to sign can be a step in a campaign: when it’s signed, the step is done.'],
      ['Included in the price', `No per-envelope fees. Kloomie is ${PRICE}.`],
    ],
    related: ['features/file-sharing', 'features/jobs-for-trades', 'for/agencies'],
  },
  'features/canvassing-and-mileage': {
    kind: 'feature', name: 'Canvassing and mileage', title: 'Door-to-door canvassing app with routes and mileage',
    desc: 'Canvass a neighborhood with flyer, come-back and lead pins, plan job routes on real roads, and log every business mile with GPS or a road calculation.',
    kicker: 'Map, canvassing and mileage', h1: 'Canvass a neighborhood, plan the day’s route, and log every business mile',
    lead: 'The Map keeps your team’s ground covered: where flyers went, the doors to come back to, and the leads. It plans job routes on real roads and keeps the mileage log your accountant wants.',
    video: { src: '/videos/map.mp4', poster: '/videos/map.jpg', name: 'Map and mileage' },
    points: [
      ['Pins where you are', 'Drop a pin for a flyer left, a door to come back to (a date makes it a task) or a lead, where you stand or anywhere you tap.'],
      ['Nothing lost in a dead zone', 'Runs and pins are saved on the phone first and sent when there’s signal again.'],
      ['Routes on real roads', 'See a person’s visits for the day in order, with the drive before each. Kloomie keeps the times you promised and fits the rest around them.'],
      ['Turn-by-turn', 'Start route in Google Maps hands every stop to Google Maps.'],
      ['Mileage four ways', 'Track a drive by GPS, log a day’s job route in one go, work out the miles between two addresses, or type it in.'],
      ['Ready for tax time', 'Miles this month at the team’s rate, everyone’s trips for owners, and a CSV for your accountant. Trips can count as expenses in Finance.'],
    ],
    faq: [
      ['Does it track my team all day?', 'No. A run or a drive is recorded only while someone starts it with Kloomie open; there’s no background tracking.'],
    ],
    related: ['features/call-lists-and-campaigns', 'for/field-sales', 'for/nonprofits'],
  },
  'features/finance': {
    kind: 'feature', name: 'Finance', title: 'Bills, budgets and bank statements for small teams',
    desc: 'Log money in and out, import your bank’s CSV statement and have it sorted, set monthly budgets, and see bills on the day they’re due.',
    kicker: 'Finance', h1: 'Money in and out, bills and budgets, without a separate app',
    lead: 'Log money in and out, or import the CSV statement your bank lets you download: Kloomie sorts each line into a category and remembers how you sorted the same place before.',
    video: { src: '/videos/finance.mp4', poster: '/videos/finance.jpg', name: 'Finance' },
    points: [
      ['Bank statements, sorted', 'Import a CSV and each line goes into a category, the way you sorted that place last time.'],
      ['Budgets', 'Set monthly budgets and see where you stand.'],
      ['Bills on your Day', 'Add bills so they show on your Day and on Home when they’re due.'],
      ['Business and personal apart', 'Business money is shared with the owners; personal money is only yours.'],
      ['Campaign costs', 'Tag money to a campaign to count it as that campaign’s cost.'],
      ['QuickBooks and invoices', 'Invoices paid by card through your own Stripe account, and quotes and invoices sent to QuickBooks Online when you connect it.'],
    ],
    related: ['features/jobs-for-trades', 'features/canvassing-and-mileage', 'for/contractors'],
  },
  'features/ai-agents': {
    kind: 'feature', name: 'AI agents', title: 'AI agents for small business teams',
    desc: 'Four AI specialists work as you, on your own AI key: they plan your day, answer leads, set up jobs and draft campaigns, and wait for your yes.',
    kicker: 'Your team of agents', h1: 'Four AI specialists who do the work, and wait for your yes',
    lead: 'Hand work to a Chief of Staff, a Client & Sales Manager, an Operations Manager and a Marketing Manager. They work on your own AI key, as you, and see only what you can see.',
    video: { src: '/videos/agents.mp4', poster: '/videos/agents.jpg', name: 'Your team (agents)' },
    points: [
      ['Chief of Staff', 'A morning briefing, Plan my day, a weekly reset, and emails you paste turned into tasks.'],
      ['Client & Sales Manager', 'Handles a new lead, follows up deals that went quiet, preps meetings and drafts proposals.'],
      ['Operations Manager', 'Kicks off projects, prepares jobs, plans routes, writes work orders and closes jobs out.'],
      ['Marketing Manager', 'A monthly plan, campaigns, posts and emails from your business profile and real results. It never makes up reviews, prices or offers.'],
      ['Every step shown', 'Each assignment shows what it looked at, what it changed and why, with Open and Undo.'],
      ['Your key, your bill', 'Agents run on your own Claude, OpenAI or Gemini key, so you pay the provider directly for what you use.'],
    ],
    related: ['features/daily-planner', 'features/email-campaigns', 'for/agencies'],
  },
  'features/jobs-for-trades': {
    kind: 'feature', name: 'Jobs for trades', title: 'Job management software for trades',
    desc: 'Jobs for 40 kinds of trade work: stages, checklists, visits and routes, quotes customers sign online, invoices paid by card, and on-my-way texts.',
    kicker: 'Jobs for trades', h1: 'Jobs from the first call to paid, for 40 kinds of trade work',
    lead: 'Pick the kinds of work you do, from HVAC and plumbing to blinds, roofing, pools and towing. Each gets its own job details, checklist and stages, on one shared customer list.',
    video: { src: '/videos/trades.mp4', poster: '/videos/trades.jpg', name: 'Jobs for trades' },
    points: [
      ['Built for each trade', 'An installer’s job runs Lead to Measured, Ordered, Installed and Paid; a service call runs New to Done. Measurements, equipment, materials and readings are there for the trades that need them.'],
      ['Visits and the team schedule', 'Book a visit and it’s on the Day and calendar of everyone going. Drag waiting jobs onto the team schedule.'],
      ['Routes that keep your promises', 'The day’s visits in the order that drives least, around the times you promised customers.'],
      ['Quotes, sign-offs and invoices', 'Quotes customers accept online, sign-offs on site, and invoices paid by card through your own Stripe account.'],
      ['Customers kept in the loop', 'On-my-way texts, visit reminders and review requests, from your own business number.'],
      ['Plans, equipment and licenses', 'Service plans, each customer’s equipment with its age, licenses and insurance with days left, and gate codes kept locked.'],
    ],
    related: ['for/contractors', 'for/cleaning-businesses', 'features/canvassing-and-mileage'],
  },

  // ---------- kinds of business ----------
  'for/contractors': {
    kind: 'industry', name: 'Contractors and home services', title: 'App for contractors and home service businesses',
    desc: 'One app for contractors and home services: jobs by trade, visits and routes, quotes accepted online, card payments, and licenses with expiry reminders.',
    kicker: 'For contractors and home services', h1: 'Run your jobs, crew and paperwork from one app',
    lead: 'From the first call to paid: the customer, the job, the visit, the route, the quote, the sign-off and the invoice, on every phone in the truck and the computer in the office.',
    video: { src: '/videos/trades.mp4', poster: '/videos/trades.jpg', name: 'Jobs for trades' },
    points: [
      ['Jobs that fit your trade', 'HVAC, plumbing, electrical, roofing, remodeling, painting and more, each with its own stages, details and on-site checklist.'],
      ['The day planned for you', 'Visits on the team schedule, routes on real roads that keep the times you promised, and Start route in Google Maps.'],
      ['Paper gone', 'Quotes customers accept online, sign-offs on site, photos before and after, and permits with their status.'],
      ['Paid faster', 'Invoices with a card payment link through your own Stripe account, and QuickBooks Online when you connect it.'],
      ['Licenses and insurance on time', 'A list of your contractor license, business licenses, insurance and bonds with days left, and an automation to warn you 30 days ahead.'],
      ['Codes kept locked', 'Gate and lockbox codes are sealed, shown only when someone taps Show, and every look is on the job’s timeline.'],
    ],
    faq: [
      ['Which trades does it cover?', 'About 40, in six families: repair and service, installers, remodel and building, recurring outdoor services, cleaning and restoration, and mobile services like towing and courier work. You can also describe how you work and have a project made for it.'],
      ['How much does it cost?', `Kloomie is ${PRICE}. Everyone on the team gets every tool.`],
    ],
    related: ['features/jobs-for-trades', 'features/canvassing-and-mileage', 'features/finance'],
  },
  'for/cleaning-businesses': {
    kind: 'industry', name: 'Cleaning businesses', title: 'App for cleaning business teams',
    desc: 'Run a cleaning business from one app: jobs with room checklists, locked entry codes, before and after photos, routes, service plans and invoices.',
    kicker: 'For cleaning businesses', h1: 'Every clean on schedule, every code kept safe',
    lead: 'House cleaning, janitorial, carpet and restoration crews: the day’s cleans, the checklist for each, the codes to get in, and the photos and sign-off when you’re done.',
    points: [
      ['A checklist for every clean', 'Kitchen, bathrooms, bedrooms, floors, trash out, lock up: ticked off on the phone, room by room.'],
      ['Entry codes kept locked', 'Gate, lockbox and alarm codes are sealed, shown only when someone taps Show, with every look on the job’s timeline.'],
      ['Photos and sign-off', 'Photos before and after, and the customer’s sign-off, here or from a link.'],
      ['The day’s route', 'Each person’s cleans in the order that drives least, around the times you promised.'],
      ['Regular customers', 'Service plans keep each customer’s plan, how often, price and when it renews. Visits go on the team schedule.'],
      ['Reminders and reviews', 'Visit reminders, on-my-way texts and review requests from your own business number.'],
    ],
    related: ['features/jobs-for-trades', 'features/daily-planner', 'for/contractors'],
  },
  'for/field-sales': {
    kind: 'industry', name: 'Field sales teams', title: 'Canvassing and call list app for field sales teams',
    desc: 'Door-to-door and field sales in one app: map pins for every door, call lists from spreadsheets, campaigns with goals, leads from your website, and mileage.',
    kicker: 'For field sales teams', h1: 'Knock, call, follow up, and know where every lead stands',
    lead: 'The map shows where your team has been and the doors to come back to. Call lists and campaigns keep the follow-ups moving, and every lead lands in one shared list.',
    video: { src: '/videos/map.mp4', poster: '/videos/map.jpg', name: 'Map and mileage' },
    points: [
      ['Every door on the map', 'Flyer left, come back (with a date that makes it a task), or a lead: pinned where you stand.'],
      ['Works with weak signal', 'Pins and runs are saved on the phone first and sent when there’s signal.'],
      ['Call lists from a spreadsheet', 'Drop a spreadsheet onto a campaign, log each call and its outcome, and count goals by outcome.'],
      ['Leads from your website', 'Form fills from WordPress, Wix, Squarespace, GoHighLevel, Facebook lead ads and more land in Contacts, without doubles.'],
      ['Mileage for every rep', 'GPS tracking while driving, a road-mile calculator, and a CSV for paying people back.'],
      ['The owner’s view', 'Campaigns on track or at risk, check-ins, and everyone’s trips and miles.'],
    ],
    related: ['features/canvassing-and-mileage', 'features/call-lists-and-campaigns', 'for/nonprofits'],
  },
  'for/real-estate-teams': {
    kind: 'industry', name: 'Real estate teams', title: 'App for real estate teams: contacts and e-signatures',
    desc: 'A shared contact list with stages, call lists for follow-ups, email from your own Gmail or Outlook, documents to sign, and files on every phone.',
    kicker: 'For real estate teams', h1: 'Your team’s contacts, follow-ups and paperwork in one place',
    lead: 'Keep every buyer, seller and lead in one shared list, work the follow-ups as a team, and get documents signed without another subscription.',
    points: [
      ['One list of people', 'Leads, clients and partners with stages and tags, imported from a spreadsheet or Google Contacts, with duplicates merged.'],
      ['Follow-ups that happen', 'Call lists, logged calls and emails, and automations like “when a lead comes in, make a task”.'],
      ['Email from your address', 'Email campaigns from your own Gmail or Outlook, with an unsubscribe link on every message.'],
      ['Documents signed', 'Send documents to be signed and get the signed copy back with its signing record.'],
      ['Files with the team', 'Photos, PDFs and links on every phone, and request links so clients can send you their files.'],
      ['Your card, shared in a tap', 'A business card page for each agent, shared by link, QR code or NFC, that adds the people who share their details to Contacts.'],
    ],
    related: ['features/email-campaigns', 'features/e-signatures', 'features/file-sharing'],
  },
  'for/nonprofits': {
    kind: 'industry', name: 'Nonprofits and community groups', title: 'Volunteer canvassing and outreach app for nonprofits',
    desc: 'Plan outreach with campaigns, roles and steps, canvass with map pins that work offline, run call lists, and email supporters from your own Gmail or Outlook.',
    kicker: 'For nonprofits and community groups', h1: 'Organize your volunteers, canvass, and follow up, together',
    lead: 'Give every volunteer their part, see which streets are covered, and keep the calls and emails going, without a pile of separate tools.',
    points: [
      ['Campaigns with roles', 'Roles like Canvasser, Caller and Approver. Steps go to the role, so when volunteers change, the work follows.'],
      ['Canvassing on the map', 'Pins for flyers, doors to come back to and interested people, saved on the phone first so dead zones lose nothing.'],
      ['Call lists', 'A spreadsheet becomes a call list; every call and its outcome is logged.'],
      ['Email supporters', 'From your own Gmail or Outlook, with an unsubscribe link, never to anyone marked do not contact.'],
      ['Files for everyone', 'Flyers, scripts and photos on every volunteer’s phone, and request links to collect files.'],
      ['Steps that wait their turn', 'Approvals and hand-offs: when what a step waits on is done, the next person hears “You’re up”.'],
    ],
    related: ['features/canvassing-and-mileage', 'features/call-lists-and-campaigns', 'for/field-sales'],
  },
  'for/agencies': {
    kind: 'industry', name: 'Agencies and studios', title: 'App for agencies: client work, approvals, proposals',
    desc: 'Run client work in one app: projects and deliverables with client sign-off, proposals clients accept online, UGC workflows, docs, e-signatures and chat.',
    kicker: 'For agencies and studios', h1: 'Client work, approvals and proposals, without five tools',
    lead: 'Projects and deliverables for each client, sign-offs when work is approved, proposals clients accept online, and the files and chat that go with them.',
    points: [
      ['Projects and deliverables', 'A Creative & Agencies project with projects, deliverables and proposals. Clients come from your shared Contacts.'],
      ['Client sign-off', 'A deliverable can need the client’s sign-off, here or from a link, and move on by itself once it’s signed.'],
      ['Proposals accepted online', 'Proposals with line items that clients open and accept by typing their name, or decline.'],
      ['UGC too', 'A UGC template: creators, the brand campaigns they make content for, each piece from brief to posted, and payouts.'],
      ['Docs and e-signatures', 'Briefs, proposals and handbooks in Docs, drafted by AI on your own key, and documents sent to be signed.'],
      ['Your AI team', 'Agents that draft proposals, prep meetings and plan marketing, and wait for your yes.'],
    ],
    related: ['features/e-signatures', 'features/ai-agents', 'features/file-sharing'],
  },

  // ---------- comparisons: their prices from their own pricing page, dated and linked; fair about where they win ----------
  'compare/kloomie-vs-jobber': {
    kind: 'compare', name: 'Kloomie vs Jobber', title: 'Jobber alternative for small teams: Kloomie vs Jobber',
    desc: 'Kloomie vs Jobber: jobs, visits, routes, quotes and invoices, plus file sharing, campaigns, e-signatures and AI agents, at $15 a person a month.',
    kicker: 'Compare', h1: 'Kloomie vs Jobber: jobs for trades, plus the rest of your team’s work',
    lead: 'Jobber is field service software and goes deep on it. Kloomie runs jobs for 40 kinds of trade work too, and adds the files, campaigns, email, documents and planning the rest of the business needs, priced per person.',
    compareTitle: 'Side by side', compare: {
      head: ['', 'Kloomie', 'Jobber'],
      rows: [
        ['Price for a team of 5', '**$75 a month** (5 × $15), billed monthly, no commitment', 'Connect plan for 5 users: $199 a month with no commitment, $149 a month billed annually; Grow for 5 users: $299 / $229'],
        ['Adding a person', '$15 a month', '$29 a month each'],
        ['Jobs, visits, routes', 'Yes: stages per trade, team schedule, routes that keep promised times', 'Yes: scheduling, dispatch and route optimization'],
        ['Quotes and invoices', 'Quotes customers accept online, invoices paid by card through your own Stripe account', 'Yes, with signature approvals on quotes and online payments'],
        ['File sharing for the whole team', 'Yes: every phone and computer, request links, Dropbox, Google Drive and OneDrive', 'Not its focus'],
        ['Call lists, campaigns, email from your own Gmail or Outlook', 'Yes', 'Not its focus'],
        ['E-signatures on any document', 'Yes, with no per-envelope fees', 'Signature approvals on quotes'],
        ['Map canvassing and mileage log', 'Yes', 'Not its focus'],
      ],
      note: 'Jobber prices from getjobber.com/pricing on November 13, 2026 (USD). Prices change, so check their page. Jobber is a trademark of its owner; Kloomie isn’t affiliated with it.',
      sources: [['Jobber pricing', 'https://www.getjobber.com/pricing/']],
    },
    pointsTitle: 'Which one fits',
    points: [
      ['Choose Jobber if', 'field service is all your team does and you want a long-established tool built only for that.'],
      ['Choose Kloomie if', 'you want jobs and the rest of the business in one app: files, campaigns, email, signatures, planning and AI agents, at $15 a person.'],
      ['Trades it covers', 'About 40 kinds of work, from HVAC, plumbing and electrical to blinds, roofing, pools, cleaning and towing, each with its own stages and checklist.'],
      ['Moving over', 'Import your customers from a spreadsheet or Google Contacts, and start with a 14-day free trial, no card needed.'],
    ],
    related: ['features/jobs-for-trades', 'for/contractors', 'features/canvassing-and-mileage'],
  },
  'compare/kloomie-vs-connecteam': {
    kind: 'compare', name: 'Kloomie vs Connecteam', title: 'Connecteam alternative: Kloomie vs Connecteam',
    desc: 'Kloomie vs Connecteam: Connecteam is built for time clocks and shift scheduling; Kloomie for customers, jobs, files, campaigns and e-signatures.',
    kicker: 'Compare', h1: 'Kloomie vs Connecteam: which one your team needs',
    lead: 'Connecteam is built for managing deskless staff: time clocks, shifts, forms and HR. Kloomie is built for the work with customers: jobs, files, contacts, campaigns, email and documents to sign.',
    compareTitle: 'Side by side', compare: {
      head: ['', 'Kloomie', 'Connecteam'],
      rows: [
        ['How it’s priced', '$15 a person a month, every tool included', 'Per hub (Operations, Comms, HR & Skills). Operations: Basic $29, Advanced $49, Expert $99 a month billed yearly ($35 / $59 / $119 monthly) for the first 30 users, then a fee per extra user; free for up to 10 users'],
        ['Time clock, timesheets and shift scheduling', 'No', 'Yes, its core'],
        ['Forms and checklists', 'Checklists on jobs, sign-off forms', 'Yes'],
        ['Customers and leads', 'Yes: shared contacts, leads from your website, call lists', 'Not its focus'],
        ['Jobs, quotes and invoices', 'Yes', 'Not its focus'],
        ['File sharing, email campaigns, e-signatures', 'Yes', 'Not its focus'],
        ['Map canvassing, routes and mileage', 'Yes', 'GPS on the time clock and geofences'],
      ],
      note: 'Connecteam prices from connecteam.com/pricing on November 13, 2026 (USD). Prices change, so check their page. Connecteam is a trademark of its owner; Kloomie isn’t affiliated with it.',
      sources: [['Connecteam pricing', 'https://connecteam.com/pricing/']],
    },
    pointsTitle: 'Which one fits',
    points: [
      ['Choose Connecteam if', 'what you need most is clocking hours, shift schedules and HR for a large crew. It’s free for up to 10 users, and Kloomie has no time clock.'],
      ['Choose Kloomie if', 'what you need most is winning and running the work: leads, jobs, quotes, files, campaigns and signatures in one app.'],
      ['Use both', 'Some teams clock hours in one app and run customers and jobs in another. Kloomie doesn’t try to be a payroll or time clock tool.'],
      ['Try it', '14 days free, no card needed. Everyone on the team gets every tool.'],
    ],
    related: ['for/field-sales', 'features/jobs-for-trades', 'features/file-sharing'],
  },
  'compare/kloomie-vs-bitrix24': {
    kind: 'compare', name: 'Kloomie vs Bitrix24', title: 'Simpler Bitrix24 alternative: Kloomie vs Bitrix24',
    desc: 'Kloomie vs Bitrix24: a simpler all-in-one app for small teams in the field, with jobs, canvassing, mileage, files, campaigns and e-signatures.',
    kicker: 'Compare', h1: 'Kloomie vs Bitrix24: a simpler all-in-one for small teams',
    lead: 'Bitrix24 is a very broad suite for whole companies. Kloomie is smaller on purpose: the tools a small team on the move uses every day, and work for trades and the field built in.',
    compareTitle: 'Side by side', compare: {
      head: ['', 'Kloomie', 'Bitrix24'],
      rows: [
        ['How it’s priced', '$15 a person a month', 'A flat price per organization: Basic $69 a month for 5 users ($49 billed annually), Standard $144 for 50 users ($99 annually), Professional $289 for 100 users ($199 annually); free for 1–2 users'],
        ['Team of 5', '$75 a month', 'Basic: $69 a month, or $49 billed annually'],
        ['E-signatures', 'Included', 'From the Standard plan'],
        ['Jobs for trades, visits and routes', 'Yes: about 40 trades, routes that keep promised times', 'Not built for trades'],
        ['Map canvassing and a mileage log', 'Yes', 'Not built in'],
        ['Breadth', 'Focused: files, planner, contacts, campaigns, email, docs, signatures, jobs, finance, agents', 'Very broad: CRM, projects, telephony, sites, HR and more'],
      ],
      note: 'Bitrix24 prices from bitrix24.com/prices on November 13, 2026 (USD). Prices change, so check their page. Bitrix24 is a trademark of its owner; Kloomie isn’t affiliated with it.',
      sources: [['Bitrix24 pricing', 'https://www.bitrix24.com/prices/']],
    },
    pointsTitle: 'Which one fits',
    points: [
      ['Choose Bitrix24 if', 'you have a large team and want one suite for nearly everything. Its flat price is cheaper per person for big teams.'],
      ['Choose Kloomie if', 'you’re a small team that wants to be set up in minutes, work from phones in the field, and run jobs, canvassing and mileage without add-ons.'],
      ['Setup in minutes', 'Pick your kind of business and Kloomie switches on the right tools and starts your first project.'],
      ['Try it', '14 days free, no card needed.'],
    ],
    related: ['features/jobs-for-trades', 'features/canvassing-and-mileage', 'features/file-sharing'],
  },
  'compare/kloomie-vs-docusign': {
    kind: 'compare', name: 'Kloomie vs DocuSign', title: 'DocuSign alternative for small business: Kloomie vs DocuSign',
    desc: 'Kloomie vs DocuSign for small businesses: send documents and quotes to be signed without envelope limits, inside the app your team already works in.',
    kicker: 'Compare', h1: 'Kloomie vs DocuSign: e-signatures without counting envelopes',
    lead: 'DocuSign is the specialist for electronic signatures. Kloomie includes e-signatures for the documents a small team sends every day, next to the files, quotes and jobs they belong to.',
    compareTitle: 'Side by side', compare: {
      head: ['', 'Kloomie', 'DocuSign eSignature'],
      rows: [
        ['Price', '$15 a person a month, with everything else in Kloomie', 'Personal $11 a month (5 envelopes a month); Standard $30 and Business Pro $45 a user a month, each on an annual commitment billed monthly'],
        ['How many you can send', 'No envelope count', 'Standard and Business Pro: 100 envelopes per user per year on annual plans; extra ones are billed pay-as-you-go'],
        ['Quotes customers accept online', 'Yes, from a job', 'Through templates and forms'],
        ['Sign-offs on site', 'Yes, on your phone or from a link', 'Yes'],
        ['ID verification, bulk send, advanced compliance', 'No', 'Yes (some on higher plans or as add-ons)'],
        ['Everything around it', 'Files, contacts, jobs, campaigns, email and planning', 'Signatures and agreements'],
      ],
      note: 'DocuSign prices from DocuSign’s eSignature plans page on November 13, 2026 (USD). Prices change, so check their page. DocuSign is a trademark of its owner; Kloomie isn’t affiliated with it.',
      sources: [['DocuSign eSignature plans', 'https://ecom.docusign.com/plans-and-pricing/esignature']],
    },
    pointsTitle: 'Which one fits',
    points: [
      ['Choose DocuSign if', 'you need ID verification, bulk sending, many integrations, or a signing tool your legal team already requires.'],
      ['Choose Kloomie if', 'you send quotes, sign-offs and agreements every week and want them next to the job, the customer and the files, without counting envelopes.'],
      ['A record of each signing', 'Signers agree to sign electronically first, and the signed copy keeps its signing record.'],
      ['Try it', '14 days free, no card needed.'],
    ],
    related: ['features/e-signatures', 'for/agencies', 'for/real-estate-teams'],
  },
  'compare/kloomie-vs-mailchimp': {
    kind: 'compare', name: 'Kloomie vs Mailchimp', title: 'Mailchimp alternative: email customers from your own Gmail',
    desc: 'Kloomie vs Mailchimp: email your customers from your own Gmail or Outlook address, with unsubscribe links, call lists and campaigns in the same app.',
    kicker: 'Compare', h1: 'Kloomie vs Mailchimp: email from your own address, not a newsletter tool',
    lead: 'Mailchimp is a full email marketing platform. Kloomie sends the email you write from your own Gmail or Outlook, so it reads like a note from you, with the calls and follow-ups in the same place.',
    compareTitle: 'Side by side', compare: {
      head: ['', 'Kloomie', 'Mailchimp'],
      rows: [
        ['Price', '$15 a person a month, with everything else in Kloomie', 'Free for up to 250 contacts; paid plans shown from $13 a month (Essentials) and $20 a month (Standard), rising with your contacts'],
        ['Sent from', 'Your own Gmail or Outlook address; replies come to your inbox', 'Mailchimp’s sending service'],
        ['How many you can send', 'Within the limits Google and Microsoft set for your account', 'Monthly sends based on your plan and contacts'],
        ['Unsubscribe and do not contact', 'Yes, on every campaign email, honored everywhere in Kloomie', 'Yes'],
        ['Designed newsletters, deep email analytics, large lists', 'No', 'Yes, its core'],
        ['Calls, follow-ups, jobs and signatures', 'Yes, in the same app', 'Not its focus'],
      ],
      note: 'Mailchimp prices from mailchimp.com/pricing/marketing on November 13, 2026 (USD). Prices change and depend on your number of contacts, so check their page. Mailchimp is a trademark of its owner; Kloomie isn’t affiliated with it.',
      sources: [['Mailchimp pricing', 'https://mailchimp.com/pricing/marketing/']],
    },
    pointsTitle: 'Which one fits',
    points: [
      ['Choose Mailchimp if', 'you send designed newsletters to thousands of subscribers and want detailed email analytics.'],
      ['Choose Kloomie if', 'you email your own customers and leads as yourself, and want the calls, follow-ups, quotes and jobs in the same app.'],
      ['Drafts that sound like you', 'With your own AI key, your Marketing agent drafts campaigns from your business profile and waits for your yes.'],
      ['Try it', '14 days free, no card needed.'],
    ],
    related: ['features/email-campaigns', 'features/call-lists-and-campaigns', 'for/real-estate-teams'],
  },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const json = (x) => JSON.stringify(x).replace(/</g, '\\u003c');

const CSS = `
    :root { --bg: #fff; --soft: #f7f6fb; --line: #eae7f2; --line2: #dcd7ea; --text: #14121f; --muted: #5d5a70; --accent: #6b4cf0; --accent-ink: #5537d6; --tint: rgba(107, 76, 240, .08); color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
    a { color: var(--accent-ink); }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 40px); }
    header { position: sticky; top: 0; z-index: 10; background: rgba(255,255,255,.9); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
    nav { display: flex; align-items: center; gap: 20px; height: 68px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--text); text-decoration: none; font-weight: 800; font-size: 24px; letter-spacing: -.02em; white-space: nowrap; }
    .brand img { width: 36px; height: 36px; }
    nav .links { display: flex; gap: 20px; margin-left: auto; align-items: center; font-size: 15px; }
    nav .links a:not(.btn) { color: var(--muted); text-decoration: none; white-space: nowrap; }
    @media (max-width: 700px) { nav .links .hide-s { display: none; } nav .links { gap: 12px; font-size: 14px; } .brand { font-size: 21px; } }
    .btn { display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; border-radius: 10px; padding: 12px 20px; white-space: nowrap; }
    .btn:hover { background: var(--accent-ink); }
    .btn.small { padding: 8px 14px; font-size: 14px; }
    .btn.ghost { background: #fff; color: var(--text); box-shadow: 0 0 0 1px var(--line2) inset; }
    .crumbs { font-size: 14px; color: var(--muted); margin: 28px 0 0; } .crumbs a { color: var(--muted); }
    .hero { padding: 18px 0 40px; border-bottom: 1px solid var(--line); background: radial-gradient(50% 70% at 85% 30%, #f1ecff, transparent 70%); }
    .kicker { display: inline-block; font-size: 14px; font-weight: 600; color: var(--accent-ink); background: var(--tint); border-radius: 99px; padding: 5px 12px; margin: 14px 0 16px; }
    h1 { font-size: clamp(32px, 5vw, 52px); line-height: 1.07; letter-spacing: -.03em; margin: 0 0 16px; max-width: 20ch; }
    .lead { font-size: clamp(17px, 2vw, 20px); color: var(--muted); max-width: 62ch; margin: 0 0 24px; }
    .ctas { display: flex; gap: 12px; flex-wrap: wrap; }
    .trust { font-size: 14px; color: var(--muted); margin: 14px 0 0; }
    video { display: block; width: 100%; height: auto; border-radius: 16px; border: 1px solid var(--line); background: #0d0c14; margin: 40px 0 0; box-shadow: 0 20px 50px -20px rgba(40, 20, 120, .25); }
    section { padding: 56px 0; } section.alt { background: var(--soft); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    h2 { font-size: clamp(24px, 3.4vw, 34px); letter-spacing: -.02em; line-height: 1.15; margin: 0 0 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 20px; }
    .card h3 { font-size: 17px; margin: 0 0 6px; } .card p { margin: 0; color: var(--muted); font-size: 15px; }
    .links-grid a.card { text-decoration: none; color: var(--text); } .links-grid a.card:hover { border-color: var(--accent); }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; font-size: 15px; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--line); vertical-align: top; } th { background: var(--soft); font-weight: 700; }
    .table-wrap { overflow-x: auto; }
    .note { font-size: 13px; color: var(--muted); margin: 10px 0 0; }
    details { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; margin: 0 0 10px; } summary { font-weight: 700; cursor: pointer; } details p { color: var(--muted); margin: 10px 0 0; }
    .end { text-align: center; } .end p { color: var(--muted); margin: 0 0 20px; } .end .ctas { justify-content: center; }
    footer { border-top: 1px solid var(--line); padding: 28px 0; font-size: 14px; color: var(--muted); } footer .wrap { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; } footer a { color: var(--muted); } footer .co { margin-right: auto; }
`;

const shell = ({ siteUrl, appUrl, title, desc, path, ld, body }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(siteUrl + path)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(siteUrl + path)}">
  <meta property="og:image" content="${esc(siteUrl)}/og.jpg">
  <link rel="icon" href="/favicon.png">
  ${ld.map((x) => `<script type="application/ld+json">${json(x)}</script>`).join('\n  ')}
  <style>${CSS}</style>
</head>
<body>
  <header>
    <nav class="wrap" aria-label="Main">
      <a class="brand" href="/"><img src="/icon-128.png" width="36" height="36" alt="">Kloomie</a>
      <div class="links">
        <a class="hide-s" href="/features">Features</a>
        <a class="hide-s" href="/#pricing">Pricing</a>
        <a class="hide-s" href="/help">Help</a>
        <a href="${esc(appUrl)}/">Sign in</a>
        <a class="btn small" href="${esc(appUrl)}/?start=1">Try free</a>
      </div>
    </nav>
  </header>
  <main>
${body}
    <section class="alt end">
      <div class="wrap">
        <h2>Try it with your team this week</h2>
        <p>${esc(PRICE.charAt(0).toUpperCase() + PRICE.slice(1))}. Setup takes a couple of minutes.</p>
        <div class="ctas"><a class="btn" href="${esc(appUrl)}/?start=1">Start your free trial</a><a class="btn ghost" href="/download">Get the app</a></div>
      </div>
    </section>
  </main>
  <footer>
    <div class="wrap">
      <span class="co">© 2026 Cultural Architects Collective LLC</span>
      <a href="/features">Features</a>
      <a href="/help">Help</a>
      <a href="/download">Download</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </div>
  </footer>
</body>
</html>
`;

const crumbsLd = (siteUrl, list) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: siteUrl + path })) });

export function sitePages({ videoDate }) {
  // One page: { html } or null.
  function page(key, siteUrl, appUrl) {
    if (key === 'features') return { html: hub(siteUrl, appUrl) };
    const p = PAGES[key];
    if (!p) return null;
    const path = '/' + key;
    const section = p.kind === 'feature' ? ['Features', '/features'] : p.kind === 'industry' ? ['Who it’s for', '/features#for'] : ['Compare', '/features#compare'];
    const ld = [crumbsLd(siteUrl, [['Kloomie', '/'], section, [p.name, path]])];
    const when = p.video && videoDate(p.video.src);
    if (p.video && when) ld.push({ '@context': 'https://schema.org', '@type': 'VideoObject', name: `${p.video.name} · Kloomie`, description: p.desc, thumbnailUrl: siteUrl + p.video.poster, contentUrl: siteUrl + p.video.src, uploadDate: when, embedUrl: siteUrl + path });
    if (p.faq?.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
    const related = (p.related || []).map((k) => PAGES[k] && `<a class="card" href="/${k}"><h3>${esc(PAGES[k].name)}</h3><p>${esc(PAGES[k].desc)}</p></a>`).filter(Boolean);
    const body = `    <div class="hero">
      <div class="wrap">
        <p class="crumbs"><a href="/">Kloomie</a> · <a href="${section[1]}">${esc(section[0])}</a> · ${esc(p.name)}</p>
        <p class="kicker">${esc(p.kicker)}</p>
        <h1>${esc(p.h1)}</h1>
        <p class="lead">${rich(p.lead)}</p>
        <div class="ctas"><a class="btn" href="${esc(appUrl)}/?start=1">Start your free trial</a><a class="btn ghost" href="/#pricing">See pricing</a></div>
        <p class="trust">14 days free · No card needed · $15 per person after</p>
        ${p.video ? `<video controls preload="none" playsinline width="1280" height="800" poster="${esc(p.video.poster)}" aria-label="Video: ${esc(p.video.name)}"><source src="${esc(p.video.src)}" type="video/mp4"></video>` : ''}
      </div>
    </div>
    ${p.compare ? compareTable(p) : ''}
    <section>
      <div class="wrap">
        <h2>${esc(p.pointsTitle || (p.kind === 'industry' ? `What ${p.name.toLowerCase()} get` : `What you can do with ${p.name.toLowerCase()}`))}</h2>
        <div class="grid">
${p.points.map(([h, t]) => `          <div class="card"><h3>${esc(h)}</h3><p>${rich(t)}</p></div>`).join('\n')}
        </div>
      </div>
    </section>
    ${p.faq?.length ? `<section class="alt"><div class="wrap"><h2>Questions</h2>${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>` : ''}
    ${related.length ? `<section><div class="wrap"><h2>Related</h2><div class="grid links-grid">${related.join('')}</div></div></section>` : ''}`;
    return { html: shell({ siteUrl, appUrl, title: `${p.title} | Kloomie`, desc: p.desc, path, ld, body }) };
  }
  function compareTable(p) {
    return `<section><div class="wrap"><h2>${esc(p.compareTitle)}</h2><div class="table-wrap"><table><thead><tr>${p.compare.head.map((x) => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>
${p.compare.rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${rich(x)}</td>` : `<th scope="row">${esc(x)}</th>`)).join('')}</tr>`).join('\n')}
</tbody></table></div>${p.compare.note ? `<p class="note">${esc(p.compare.note)}${(p.compare.sources || []).map(([l, u]) => ` <a href="${esc(u)}" rel="nofollow noopener" target="_blank">${esc(l)}</a>.`).join('')}</p>` : ''}</div></section>`;
  }
  function hub(siteUrl, appUrl) {
    const group = (kind) => Object.entries(PAGES).filter(([, p]) => p.kind === kind).map(([k, p]) => `<a class="card" href="/${k}"><h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p></a>`).join('\n');
    const compares = group('compare');
    const body = `    <div class="hero">
      <div class="wrap">
        <p class="crumbs"><a href="/">Kloomie</a> · Features</p>
        <p class="kicker">Features</p>
        <h1>Everything a small business team needs, in one app</h1>
        <p class="lead">File sharing, a daily planner, call lists and campaigns, email from Gmail or Outlook, e-signatures, canvassing and mileage, jobs for trades, finance and AI agents. ${esc(PRICE.charAt(0).toUpperCase() + PRICE.slice(1))}.</p>
        <div class="ctas"><a class="btn" href="${esc(appUrl)}/?start=1">Start your free trial</a></div>
      </div>
    </div>
    <section><div class="wrap"><h2>Features</h2><div class="grid links-grid">${group('feature')}</div></div></section>
    <section class="alt" id="for"><div class="wrap"><h2>Who it’s for</h2><div class="grid links-grid">${group('industry')}</div></div></section>
    ${compares ? `<section id="compare"><div class="wrap"><h2>Compare</h2><div class="grid links-grid">${compares}</div></div></section>` : ''}`;
    const ld = [crumbsLd(siteUrl, [['Kloomie', '/'], ['Features', '/features']])];
    return shell({ siteUrl, appUrl, title: 'Features: file sharing, call lists, e-signatures, jobs and more | Kloomie', desc: 'Every Kloomie feature and who it’s for: file sharing, a daily planner, call lists, email campaigns, e-signatures, canvassing, jobs for trades, finance and AI agents.', path: '/features', ld, body });
  }
  const paths = () => ['/features', ...Object.keys(PAGES).map((k) => '/' + k)];
  return { page, paths };
}
