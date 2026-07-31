# SAM — Pitch Deck Content
## Prospect: Peshawar Services Club (PSC), 40-The Mall, Peshawar Cantt.
## Proof of delivery: EME Officers Mess

> **How to use this document:** Each numbered section = one slide. The **On-slide** block is
> what goes on the slide (keep it short — headline + 3–5 bullets). The **You say** block is
> the speaker script. Do not put the speaker script on the slide.

---

## SLIDE 1 — Title

**On-slide**
- **SAM** — Integrated Mess, Club & Hospitality Management System
- Built for the EME Officers Mess. Ready for Peshawar Services Club.
- *Runs fully offline, on your own network, on your own hardware.*
- [Your company name] · [Presenter] · [Date]

**You say**
> "What you're about to see isn't a concept or a mock-up. It's a system that is already
> built, already running, and already managing a live officers' mess end to end. Today I
> want to show you what it does, what it fixed, and why we think it maps almost
> one-to-one onto how PSC operates."

---

## SLIDE 2 — The one-sentence version

**On-slide**
> **One database. Every department. Every transaction permanently recorded.**
>
> Rooms · Kitchen · Stores · Procurement · Members · Billing · Events · Security — all on
> a single system, with role-based access and an audit trail that cannot be edited.

**You say**
> "If you remember one thing from this presentation: today your departments each keep
> their own register. SAM puts them all on one shared record, so nothing can be entered in
> one place and quietly disappear from another."

---

## SLIDE 3 — The problem we set out to solve

> ⚠️ **Do not assume PSC runs on paper.** Their own website shows a member login portal,
> card facilities across four departments (Accounts, Restaurant, Guest Rooms, Sports
> Booking Office) and an on-site ATM. Frame the problem as **fragmentation between
> systems**, never as a lack of systems. If you need the paper contrast, tell it as *the
> EME Mess's* story — your own client — not as an assumption about theirs.

**On-slide**
- Every department keeps its **own** record — bookings, kitchen, stores, billing, security
- Each may be perfectly well run. **None of them can check another**
- The same fact is entered 3–4 times, by 3–4 people, in 3–4 places
- No automatic cross-check between what was **ordered**, **received**, **consumed** and **billed**
- Discrepancies surface at the **annual audit** — months after the money is gone
- Institutional memory walks out the door when a clerk or NCO is posted out

**You say**
> "This is not a criticism of any staff, and it isn't about whether an organisation is
> computerised. It's structural. When bookings, kitchen and billing are three separate
> records — on paper or in three different systems — no individual is dishonest, but
> nothing can catch an error. And an error you can't catch is indistinguishable from a
> loss."

---

## SLIDE 4 — What that costs (the case for spending money on this)

**On-slide**
- Organisations lose an estimated **~5% of annual revenue** to fraud and leakage (ACFE)
- **~Half** of fraud cases trace to *weak internal controls*, not bad actors
- **Asset misappropriation** — including inventory misuse — is the most common category
- Food service globally accounts for **~26% of all food waste**; waste alone erodes food-service margins by **up to 4%**
- **These figures come from computerised organisations.** Software digitises a record — it doesn't automatically make one record check another

**You say**
> "Take PSC's annual food and beverage turnover. Now take four percent of it. That's the
> number to keep in your head for the rest of this presentation — because that's roughly
> what a portion-and-stock tracking system pays back before you count anything else."

*(Speaker note: before the meeting, if you can get any public/estimated figure for PSC's
scale — number of guest rooms, covers per day, member count — put the actual rupee number
on this slide. A concrete figure lands ten times harder than a percentage.)*

---

## SLIDE 5 — What we built: SAM

**On-slide**
- A complete, production-grade operations platform — **not** a booking app, **not** a POS
- **30 API modules · 49 data models · ~35,000 lines of code**
- FastAPI + SQLite backend · React 19 + TypeScript frontend
- Installs as a **single Windows application** — one installer, one server, one port
- **Zero internet dependency.** Runs on a LAN with the cable to the outside world unplugged.

**You say**
> "The scale matters here because it tells you this is not something we can be talked into
> claiming we'll finish next month. It's finished. It's been running against real
> operational load."

---

## SLIDE 6 — Feature: Rooms & Bookings

**On-slide**
- Live room grid — occupied / vacant / under maintenance / not-ready, at a glance
- **Week / Month / Year calendar view** — see the whole season, not just today
- **Check-in is hard-blocked until the room is marked ready** — no override, no exceptions
- Guest identity captured on **CNIC + phone** — the same guest is recognised on every future stay
- Automatic rate application by **rank, category, and nature of duty** — the clerk cannot mis-price a room
- Advance payments, online-booking intake, occupant cards, room maintenance log

**You say**
> "Notice the third bullet. In the old system, a room could be allotted while it was still
> being cleaned, because the register has no opinion. Here the system physically refuses.
> That single rule ended a recurring complaint at the mess."

---

## SLIDE 7 — Feature: Kitchen, Recipes & Stock

**On-slide**
- **Recipes are linked to actual stock items.** Cook 40 portions → ingredients deduct themselves
- Closes the loop between **planned → served → wasted** (three separate registers today)
- Stock split by zone: **warehouse vs. kitchen** — you know where every item physically is
- **FIFO batch and expiry handling** — oldest stock issues first, spoilage flagged before it happens
- Waste logs and cycle counts built in
- **Meal Service hub**: serve / no-show sweep per meal, per member — attendance becomes billable data automatically

**You say**
> "Today the kitchen tells the store what it used. In SAM, the kitchen doesn't have to
> tell anyone — recording the cook *is* the stock deduction. There is no gap between the
> two entries for anything to fall through."

---

## SLIDE 8 — Feature: Procurement & the Three-Way Match

**On-slide**
- Vendor register, purchase orders, deliveries — in one chain
- **Three-way match:** Purchase Order ↔ Delivery Note ↔ Goods Physically Received
- Stock cannot be created until the three agree
- **Price Memory** — the system remembers what each vendor charged last time and auto-fills; a sudden price jump is visible on the spot
- **Smart Intake (OCR):** photograph the vendor's receipt — the system reads it and drafts the entry
- Costing alerts fire when a recipe's real cost drifts above its menu price

**You say**
> "This is the slide I'd put the most weight on. Vendor invoice inflation is the hardest
> loss to detect manually, because each individual invoice looks reasonable. The system
> compares it to the last eleven invoices from the same vendor in under a second."

---

## SLIDE 9 — Feature: Members, Attendance & Billing

**On-slide**
- Member register with categories, ranks, and per-member ledger
- Meal attendance recorded **per meal, per member**; leave tracked
- Mess bills generated from **actual attendance**, not flat estimates
- **Member Ledger Portal** — a member's full charge history on one screen, ready for any query at the desk
- Month-end run: bills generated, split, and dispatched in one pass
- Guest meal charges attach to the sponsoring member automatically

**You say**
> "The most common front-desk argument in any mess or club is 'I wasn't here that week.'
> This screen ends that conversation in about fifteen seconds, with a record neither side
> can dispute."

---

## SLIDE 10 — Feature: Events & Functions

**On-slide**
- Book a hall/function for a group with a **priced, free-text menu** (no rigid catalogue to fight)
- Full **kitchen prep lifecycle** — the kitchen sees the function coming, with quantities
- Billing-type flag: bill the host, bill a member's account, or bill the unit
- On completion, generates a **real invoice** linked to the guest/member — not a side note in a diary

**You say**
> "PSC runs a Banquet Hall, a Ball Room, Engle Bright Hall, Irvine Hall, the Veteran's
> Lounge and a Conference Room. This module was built for exactly that class of work."

---

## SLIDE 11 — Feature: Billing & Checkout

**On-slide**
- **Checkout always bills.** There is no path out of the system that skips an invoice
- Charged on **actual nights stayed**, computed by the system
- Room charges, mess charges, à-la-carte kitchen orders and event charges converge into one bill
- **No manual invoices** — the number on the bill is derived, not typed
- Clerk Desk: a purpose-built fast lane for the front desk (live guests, mess-only, instant checkout)

**You say**
> "'No manual invoices' is a deliberate design decision, and it's the single most
> important control in the billing module. If a human can type the total, the total is not
> evidence. If only the system can compute it, it is."

---

## SLIDE 12 — Feature: Governance, Audit & Access Control

**On-slide**
- **Immutable audit log** — every create, edit, delete and approval stored with a full before/after snapshot
- Nothing in the system can be silently changed. Ever.
- **Role-Based Access Control:** Manager · Deputy · Clerk · Kitchen · Booking · Security — each sees only their own module and actions
- **Rules-based alert engine** — billing mismatches, low stock, cost anomalies, unauthorised access attempts, surfaced in real time
- **Directives** module — standing instructions issued and tracked down the chain
- Automatic scheduled **backups** with a retention policy

**You say**
> "For a services institution, this is the slide that matters to the Managing Committee.
> When the audit comes, you are not producing a register and a verbal explanation. You are
> producing a complete, time-stamped, un-editable record of every rupee that moved and who
> moved it."

---

## SLIDE 13 — Feature: Security & Movement

**On-slide**
- Guest movement (in/out) logged and **visible to the security post in real time**
- Security logs and incident reports on the same platform
- Every login attempt recorded; **lockout policy** on repeated failures
- Guest entry is tied to a **sponsoring member** — the record of who admitted whom already exists

**You say**
> "Security and the front desk currently talk to each other by phone or by walking. Here
> they're reading the same screen."

---

## SLIDE 14 — How it's deployed (the objection-killer slide)

**On-slide**
- **Fully on-premise.** Your server, your building, your data. Nothing leaves the Cantt.
- **No internet required** — works with the WAN link down
- **No monthly cloud fee, no per-user licence, no vendor lock-in**
- One Windows installer → runs on a single machine → staff access it from any PC on the LAN through a browser
- Nothing to install on the clients. No app store. No phones required.
- Automatic local backups; the entire database is a **single file** you can copy to a drive

**You say**
> "I want to be very direct about this, because for an institution under services
> administration it's usually the first question: there is no cloud. There is no external
> server. Your member data, your billing data and your guest data never leave your
> premises. That was a requirement from day one, and the whole architecture was built
> around it."

---

## SLIDE 15 — What we know about Peshawar Services Club

**On-slide**
- Founded **1863** as the Games Club — one of the oldest clubs in Pakistan; registered as Peshawar Club in **1899**
- Became **Peshawar Services Club Ltd.** after 1947; **Pakistan Army assumed management in 1993**; renamed Peshawar Garrison Services Club in 1997, and **Peshawar Services Club in 2011**
- Led by serving officers (President is a serving Brigadier)
- **10.4 acres** — ~60% constructed, remainder lawns, outdoor sports and parking
- Members-only, with family card holders; guest access controlled under current SOP

**You say**
> "We did our homework before coming here. And the reason this slide is in the deck is the
> third bullet — PSC has been under services administration since 1993. That means the
> governance culture, the accountability expectations, the rank-and-category structures and
> the data-sensitivity requirements are the *same environment* we've spent the last
> [X months] building for. We are not learning your world on your budget."

**Sources:** [Wikipedia — Peshawar Club](https://en.wikipedia.org/wiki/Peshawar_Club),
[peshawarservicesclub.com](https://peshawarservicesclub.com/)

---

## SLIDE 16 — PSC's operation, mapped to modules we already have

**On-slide** *(present as a two-column table — this is the money slide)*

| What PSC runs | The SAM module that already handles it |
|---|---|
| **Guest rooms** | Bookings — live room grid, calendar, rate engine, check-in guards |
| **Restaurant, Dining Hall, Coffee Bar** | Kitchen + Menu Prices — à-la-carte orders, recipe costing, stock deduction |
| **Banquet Hall, Ball Room, Engle Bright Hall, Irvine Hall, Veteran's Lounge, Conference Room** | **Events** — function booking, priced menus, kitchen prep, auto-invoicing |
| **Members & family card holders** | Members + Member Ledger — categories, per-member charge history |
| **Monthly member bills / card charges** | Mess Billing — month-end run, split, dispatch |
| **Central kitchen & stores** | Inventory + Procurement — zones, FIFO batches, three-way match, OCR intake |
| **Controlled guest entry under SOP** | Security + guest movement log, tied to sponsoring member |
| **Committee oversight & annual audit** | Audit Log + RBAC + Alerts — immutable record, role-scoped access |

**You say**
> "Read down the right-hand column. Not one of these is a promise. Every one of them is a
> screen I can open on this laptop in the next two minutes."

---

## SLIDE 17 — What we'd build specifically for PSC

**On-slide**
*(Be honest here — it builds far more credibility than pretending the fit is perfect.)*

**Phase 1 — configure what exists (weeks, not months)**
- PSC membership categories, family card structure, rank/category rate card
- PSC's halls, guest rooms, restaurant menu and kitchen recipes loaded
- PSC branding throughout (the system is already white-label)

**Phase 2 — new modules for club-specific operations**
- **Sports & facility booking** — squash, tennis, badminton, snooker, card room, pool slots; court reservation, no-show handling, usage charges straight to the member ledger
- **Gym / pool / sauna membership & subscription dues** — recurring billing on the same ledger
- **Family card management** — dependants, entitlements, spend limits per card
- **Salon & ancillary services** — chargeable to the member account
- **Library issue/return** — physical and digital

**You say**
> "I'm not going to stand here and claim a mess system is already a club system. The
> hospitality, kitchen, stores, events, billing and governance layers — roughly 80% of your
> operation by transaction volume — are done and proven. The recreational side is the piece
> we'd build for you, and it's a genuinely small piece of work because the member ledger,
> the billing engine and the booking engine it plugs into already exist."

---

## SLIDE 18 — What changes for PSC, department by department

**On-slide** *(present as a three-column table: Who · Today · With SAM)*

| Who | Today | With SAM |
|---|---|---|
| **The member** | Queries their bill at the desk; the clerk checks a register and calls back tomorrow | Full charge history on screen in seconds; disputes settled at the counter |
| **Front desk clerk** | Writes the same booking into three books; prices from memory | One entry, rate applied automatically, cannot allot a room that isn't ready |
| **Kitchen NCO** | Cooks, then reports consumption to the store separately | Records the cook — stock deducts itself. No second entry, no reconciliation |
| **Store keeper** | Accepts delivery, trusts the invoice | PO ↔ delivery ↔ goods must agree before stock exists; last vendor price on screen |
| **Events / banquet staff** | Function details in a diary; kitchen told verbally | Hall booked with a priced menu; kitchen sees quantities in advance; invoice auto-generated |
| **The Secretary** | Chases departments for figures ahead of a meeting | Opens a dashboard. Occupancy, food cost, outstanding dues, month to date |
| **Managing Committee** | Reviews figures compiled by the people being reviewed | Reviews a system-generated record no one can edit |
| **Auditor** | Cross-checks registers by hand over days | Queries an immutable log with before/after values in minutes |

**You say**
> "I've deliberately put the member at the top of that table. Everything below it is
> internal control — but a club lives or dies on member experience, and the fastest
> visible win here is that billing arguments stop happening."

---

## SLIDE 19 — Where the money comes back

**On-slide**

**1. Leakage you stop**
- Stock consumed without a recipe entry, vendor price creep, unbilled nights, food waste
- Even a **1–2% recovery** on F&B and stores is typically the whole cost of the system in year one

**2. Revenue you're currently not capturing**
- Guest meals never charged to the sponsoring member
- Facility and event usage recorded in a diary and forgotten at month-end
- Function overruns — extra covers served, original quote billed
- **Every one of these is revenue PSC has already earned and simply failed to invoice**

**3. Cash flow**
- Month-end billing that took a week now runs in a single pass
- Bills go out earlier → dues come in earlier → recoveries improve

**4. Capacity you can see**
- Week/Month/Year occupancy view exposes the quiet periods worth promoting and the halls that are under-booked
- Recipe costing shows which menu items actually make money and which are sold at a loss

**5. Time**
- Staff hours currently spent copying between registers and reconciling them, returned to actually running the club

**You say**
> "I want to separate two things, because they get confused. Point one is money you're
> losing. Point two is money you've already earned and never billed for — and in my
> experience with the mess, point two was the bigger number and the easier fix."

*(Speaker note: if you can get even rough figures from PSC in the discovery walk, come
back with these as rupee amounts. This slide is dramatically stronger with their own
numbers on it.)*

---

## SLIDE 20 — Why us, against your real alternatives

**On-slide** *(present as a comparison table)*

| Option | What it costs you |
|---|---|
| **Change nothing** | Zero to implement. The gaps between your existing systems stay invisible, and the leakage on slide 4 compounds every year |
| **Add another point solution** | A fifth system that also doesn't talk to the other four |
| **Off-the-shelf hotel software** | Built for commercial hotels — no member ledger, no mess billing, no rank/category rate card, no family cards. You'd bend PSC's operation to fit the software |
| **Cloud / SaaS platform** | Monthly per-user fees forever, and **member and guest data sitting on someone else's server outside your control.** Stops working when the link does |
| **Build it in-house** | 12–18 months and a development team you'd have to hire, manage, and keep. Then maintain it |
| **SAM** | **Already built. Already proven in a services mess. On-premise. White-labelled as PSC's own. One-time deployment, no per-user licence, local support.** |

**And specifically us:**
- We have already solved *your* problem class once — rank structures, entitlements, approval chains, audit exposure, offline operation
- **You are our second client, not our first.** The expensive lessons were paid for by someone else
- Local team — support is a phone call and a short drive, not an overseas ticket queue
- The system carries **PSC's branding**, not ours. It becomes your institution's system

**You say**
> "The honest competition here isn't another software company. It's the decision to do
> nothing for another year. So the question I'd ask the committee is simply: what did the
> registers cost you last year, and are you willing to pay it again?"

---

## SLIDE 21 — Proposed rollout

**On-slide**
1. **Discovery (1 week)** — walk PSC's departments, capture actual workflows, SOPs and rate structures
2. **Configuration & data load (2–3 weeks)** — members, rooms, halls, menus, vendors, stock, rate card
3. **Pilot on one department (2 weeks)** — recommend **Rooms + Front Desk**, or **Kitchen + Stores**, run parallel with the existing register
4. **Phase-2 club modules (in parallel)** — sports/facility booking, family cards, subscriptions
5. **Full rollout + staff training** — role-by-role, with printed SOP cards
6. **Handover & support** — backups, escalation, and an agreed support window

*Adjust the durations to what you can genuinely commit to. Never quote a timeline in a
first meeting that you can't hit.*

---

## SLIDE 22 — The ask

**On-slide**
- A **live demonstration** to the Secretary and the relevant department heads — 45 minutes
- Permission for a short **walkthrough of PSC's current workflows** so we can quote accurately
- Agreement on a **pilot department** to prove it on real PSC data before full commitment

**You say**
> "We're not asking for a decision today. We're asking for forty-five minutes with your
> department heads and a look at how you currently work. If after that it isn't a fit,
> we'll say so ourselves."

---

## SLIDE 23 — Close

**On-slide**
> **Every register you keep is a record of what happened.**
> **SAM is a record of what happened — that no one can change.**
>
> [Contact details]

---

# APPENDIX A — 5-minute live demo script

Run it in this exact order. It tells a complete story: money coming in, stock going out,
and the audit that catches both.

1. **Log in as Clerk** → show the Clerk Desk → "This is what the front desk sees. Nothing else."
2. **Bookings → Room Grid** → try to check a guest into a room that isn't ready → **let it fail on screen.** Say nothing for two seconds. This is the most persuasive moment in the demo.
3. **Book a room** → show the rate auto-filling from rank/category → "The clerk didn't choose that number."
4. **Kitchen → cook a recipe** → switch to **Inventory** → show the stock has already dropped.
5. **Procurement → raise a PO** → show **Price Memory** auto-filling last vendor price → change it upward → show the alert.
6. **Checkout a guest** → invoice generates itself, nights computed → "No one typed this total."
7. **Log out. Log in as Manager → Audit Log** → show every single thing you just did, with before/after values and a timestamp.
8. Close on the Audit Log on screen. Don't click away from it while you talk.

---

# APPENDIX B — Anticipated questions & answers

**"Our staff aren't computer literate."**
> Fair, and we designed around it. Each role only ever sees its own screens — a kitchen NCO
> sees a kitchen screen, not a system. Training is role-by-role, typically half a day per
> role, and we leave printed SOP cards at each desk. The mess staff were in the same
> position and are running it daily.

**"What happens if the power or the network goes down?"**
> The database is a single file on your own machine — nothing is lost. When the machine
> comes back, the system comes back. Because there's no internet dependency, a WAN outage
> has no effect at all. Backups run automatically on a retention schedule.

**"Is our member and guest data safe?"**
> It never leaves your building. There is no cloud component. Access is role-restricted,
> every login is logged, repeated failed logins lock the account, and every data change is
> permanently recorded with who did it and when.

**"We already have a computer system / someone made us software."**
> Good — and we'd assume you do; we're not here to tell you otherwise. The real question
> isn't whether you have systems, it's whether they check each other. Can your system tell
> you right now what the kitchen consumed against what procurement bought, put a guest meal
> onto the sponsoring member's bill without anyone re-typing it, and produce an un-editable
> record of who approved what? Most systems in this space are a booking screen and a billing
> screen. The joins between departments are the hard part, and that's the part we built.
> And if some of your systems already do this well, we'd rather work around them than
> replace them.

**"Are you telling us we're behind?"**
> No — and if the deck came across that way, that's my failure. You have a member portal,
> card facilities across four departments and 163 years of running this place. What I'm
> asking about is narrower than that: whether a transaction in one of those four departments
> lands correctly in the other three on its own. That's a gap in almost every institution
> I've seen, computerised or not.

**"What does it cost?"**
> One-time deployment and configuration, plus an agreed annual support arrangement. No
> per-user licensing and no monthly cloud fees, because there's no cloud to pay for.
> I'd rather quote you a real number after we've seen your workflows than an invented one
> today. *(Have your actual number ready in your pocket for when they insist.)*

**"How long until we're live?"**
> Configuration on existing modules is weeks, not months, because nothing is being written
> from scratch. We'd run a pilot department in parallel with your existing registers so
> there's no leap of faith.

**"What if you disappear?"**
> The database is a standard, open SQLite file — your data is yours and readable without us.
> We'll hand over the source and deployment documentation as part of the agreement.
> *(Confirm with your boss before committing to source handover.)*

**"Can it handle our sports facilities?"**
> Not today — that's the honest answer, and it's on slide 17. It's Phase 2, and it's
> straightforward because the member ledger and booking engine it plugs into already exist.

**"What's the return? How do we justify this to the committee?"**
> Three ways, and I'd argue them in this order. First, revenue you've already earned and
> never billed — guest meals, facility use, function overruns. That's not a saving, that's
> collection. Second, leakage between stores, kitchen and billing that no manual system can
> detect. Third, staff hours spent copying and reconciling registers. If we do the
> discovery walk, I'll come back with those three as rupee figures from your own operation
> rather than my percentages.

**"Why not just buy standard hotel software?"**
> Because PSC isn't a hotel. Commercial hotel software has no member ledger, no family
> cards, no rank-and-category rate card, no mess billing cycle and no concept of a
> sponsoring member. You'd end up reshaping the club's operation to suit the software.
> Ours was built for a members' institution under services administration from the start.

**"Won't this make things slower for our staff?"**
> The opposite, and it's deliberate. Routine low-value actions are designed to move fast —
> the whole reason we split roles is so a kitchen NCO isn't waiting on an approval chain to
> record a cook. The checks sit on high-value and cross-department actions, where they
> belong. Net, staff stop making the same entry three times.

---

# APPENDIX C — Notes for the presenter

- **Never say "manual", "paper" or "registers" about PSC.** They have a member portal and
  card facilities in four departments. Assuming otherwise is the fastest way to lose the
  room. When you need the paper contrast, tell it as the EME Mess's story, not theirs.
- **Lead with the failure, not the feature.** Every module slide should start with the
  problem it kills, not the screen it shows.
- **The four strongest slides are 8 (three-way match), 12 (audit log), 16 (the mapping
  table) and 19 (where the money comes back).** If you get cut to ten minutes, present
  3, 8, 12, 16, 19, 20, 22.
- **Slides 18–20 are the "why you, why us" block.** Slide 18 is what improves for their
  people, 19 is what improves for their finances, 20 is why us over the alternatives. If
  the room is commercial rather than operational, spend your time here and skim the
  feature slides.
- **Slide 15 earns the room.** Showing you researched PSC's history and governance before
  walking in signals you'll research their workflows too.
- **Be honest on slide 17.** In this environment, admitting a gap makes everything else you
  claimed more believable. Overclaiming is how these deals die in the second meeting.
- **Don't say "hotel management system"** to a club. Say *club and hospitality operations*.
  They are a members' institution, not a hotel, and the distinction matters to them.
- **Have the demo running before you walk in.** Never set up in front of a Brigadier.
