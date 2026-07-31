# SAM — Short Pitch Deck (10 slides · ~20 minutes)
## Prospect: Peshawar Services Club · Proof: EME Officers Mess

**Timing:** 8 min slides (1–4) → 6 min live demo → 4 min slides (6–10) → Q&A
**Full 23-slide version:** [PSC_PITCH_DECK.md](PSC_PITCH_DECK.md) — Q&A ammunition and
leave-behind only. Do not present it.

---

## ⚠️ THE CENTRAL ASSUMPTION OF THIS DECK

**PSC is already computerised. Do not imply otherwise.** From their own website:

- A **member login portal** — booking is done through it, or by phone (0341-9777711)
- **Credit cards accepted in four separate departments** — Accounts, Restaurant, Guest
  Rooms, and Sports Facilities/Booking Office
- An on-site ATM, and a digital library

Walking in and pitching against "paper registers" would be the fastest way to lose this
room. A 163-year-old institution under Army administration has systems.

**The wedge is not paper vs. digital. It is fragmentation.** Four departments taking
payment, a member portal, a phone booking line, a kitchen, a store and an accounts
office — the question is whether a transaction in one of them lands correctly in all the
others without a human re-typing it. That gap exists in most computerised clubs, and it
produces exactly the same losses as paper.

**And we genuinely do not know what they run.** So slide 2 asks instead of asserts.

---

## SLIDE 1 — Title

**On-slide**
> # SAM
> ### Club & Hospitality Operations — one system, one record
> Running today at the EME Officers Mess.
>
> [Company] · [Presenter] · [Date]

**You say** *(15 seconds — do not linger)*
> "I want to be clear at the start about what this is not. This is not a pitch that assumes
> PSC is behind, or running on paper. You're a 163-year-old institution with a member
> portal and card facilities across four departments — you have systems. What I want to ask
> about today is whether those systems talk to each other."

---

## SLIDE 2 — Six questions *(the most important slide in the deck)*

**On-slide**
> ### We don't know what PSC runs today. So let us ask instead.
>
> **1.** When the restaurant serves a member's guest, does that charge reach the member's monthly bill — **without anyone re-typing it?**
>
> **2.** When the kitchen cooks sixty covers, does your stock figure drop **by itself?**
>
> **3.** At the moment you accept a delivery, can the storekeeper see **what that vendor charged for the same item last month?**
>
> **4.** If a function serves thirty covers beyond the quote, does the **invoice know?**
>
> **5.** Can the Secretary pull occupancy, food cost and outstanding dues **without asking three departments?**
>
> **6.** If a figure was changed last March — can you see **who changed it, when, and what it was before?**

**You say**
> "I'd genuinely like you to answer these, either now or after the meeting. Because if the
> answer to all six is yes, then you don't need us, and I'll be the first to say so and
> stop wasting your time.
>
> But in my experience these six are where computerised organisations still lose money —
> not because the software is bad, but because each department has its own good software
> and none of it is joined up. At the EME Mess, the answer to all six was no."

*(Speaker note: pause after reading these. Let someone in the room answer. If a department
head says "no, we re-type that" — stop and follow it. That is your entire pitch, told to
you by them. It's worth more than the next eight slides.)*

---

## SLIDE 3 — Why this costs money even when you're computerised

**On-slide**
> ### The losses aren't caused by paper. They're caused by gaps between systems.
>
> ## ~5%
> ### of annual revenue lost to fraud and leakage
> *— ACFE. These are computerised organisations.*
>
> **~Half** of cases trace to weak internal **controls** — not to a lack of computers.
> Food waste alone erodes food-service margins by **up to 4%**.
>
> **Software digitises a register. It doesn't automatically make one register check another.**

**You say**
> "This is the point I most want to land. These figures come from organisations that
> already have software. Computerisation on its own doesn't close the gap — what closes it
> is one department's record being automatically checked against another's. That's a
> different thing, and it's the thing we built."

*(If you can get PSC's F&B turnover, put 4% of it on this slide as a rupee figure.)*

---

## SLIDE 4 — What we built

**On-slide**
> ### One database. Every department. Every action permanently recorded.
>
> Rooms · Kitchen · Stores · Procurement · Members · Billing · Events · Security
>
> **30 modules · 49 data models · ~35,000 lines of code**
> **On your server, inside your building. No cloud. No internet dependency.**

**You say**
> "The scale tells you this is finished, not something we can be talked into promising by
> next month. And there's no cloud component — member and guest data never leaves your
> premises. For an institution under services administration that's usually the first
> question, so I'll answer it before it's asked."

---

## SLIDE 5 — Let me just show you

**On-slide**
> # Live demonstration

**Six minutes. Narrate consequences, not features.** Each step below answers one of the six
questions on slide 2 — say so out loud as you go. *"That was question two."*

1. **Log in as Clerk** → "This is everything a front desk clerk can see. Nothing else exists for him."
2. **Try to check a guest into a room that isn't ready** → **let it fail on screen. Then stay silent for two seconds.** Most persuasive moment in the pitch.
3. **Book a room** → rate fills itself from rank and category → "The clerk did not choose that number. He can't."
4. **Kitchen → cook a recipe** → open **Inventory** → stock has already dropped → **"That was question two. Nobody told the store. Recording the cook *is* the deduction."**
5. **Procurement → raise a PO** → last vendor price auto-fills → push it up → alert fires → **"Question three."**
6. **Check a guest out** → invoice generates itself on actual nights → "No one typed this total. No one can."
7. **Log out → log in as Manager → Audit Log** → every action you just performed, with before/after values, timestamps and names → **"Question six. And nothing here can be edited — not by staff, not by me."**
8. **Leave the Audit Log on screen.** Don't click away while you talk.

---

## SLIDE 6 — Why this fits PSC

**On-slide**
> ### Peshawar Services Club
> Founded **1863** · under **Pakistan Army management since 1993** · led by serving officers
> 10.4 acres · guest rooms · restaurant & dining hall · six function venues · members and family cards
> **Card facilities across four departments** · member portal · sports booking office
>
> ### EME Officers Mess
> **The same environment.** Same governance, same rank and category structures,
> same audit expectations, same rule that data does not leave the Cantt.

**You say**
> "We did our homework before walking in. The reason this slide exists is the second line —
> PSC has been under services administration since 1993. The accountability culture, the
> rank structures and the data-sensitivity rules are the same environment we've spent the
> last [X] months building for. We're not learning your world on your budget.
>
> And note the third line — four departments taking payment. Four is the number that
> interests me."

---

## SLIDE 7 — Already built vs. what we'd build for PSC

**On-slide**

| **Built and proven today** | **We'd build for PSC** |
|---|---|
| Guest rooms & bookings | Sports & facility slot booking (squash, tennis, snooker, pool) |
| Restaurant, dining hall, coffee bar | Gym / pool subscription dues |
| **Six function venues** — banquet, ball room, Engle Bright, Irvine, Veteran's Lounge, conference | Family card management & entitlements |
| Members, ledgers, monthly billing | Salon & ancillary charges |
| Kitchen, stores, procurement | Library issue & return |
| Guest entry control & security | |
| Audit log, roles, committee reporting | |
| **~80% of your transaction volume** | Plugs into the ledger and booking engine that already exist |

**You say**
> "I'm not going to claim a mess system is already a club system. The left column is done —
> roughly eighty percent of your operation by transaction volume. The right column is the
> recreational side, and it's genuinely small work because the ledger and booking engine it
> plugs into already exist."

---

## SLIDE 8 — What PSC gains

**On-slide**
> **1. Revenue you've already earned and never billed**
> Guest meals not charged to the sponsoring member · facility use recorded in one system and
> never reaching the ledger · function overruns billed at the original quote
>
> **2. Leakage you stop**
> Stock consumed with no matching entry · vendor price creep · unbilled nights · waste
>
> **3. Re-keying disappears**
> Every figure entered once, by the person closest to it
>
> **4. Members stop arguing about bills** — full charge history on screen at the counter
>
> **5. Your committee reviews a record nobody can edit**

**You say**
> "Point one and point two get confused, so let me separate them. Point two is money you're
> losing. Point one is money you've already earned and simply failed to invoice — and at
> the mess, point one turned out to be the bigger number and the easier fix."

---

## SLIDE 9 — Why us

**On-slide**
> ### We're not asking you to throw away what works.
> If your member portal serves your members well, keep it. We're interested in the
> **joins between departments** — the part nobody sells you.
>
> | Your alternatives | The catch |
> |---|---|
> | Change nothing | The gaps between your systems stay invisible and compound |
> | Add another point solution | A fifth system that also doesn't talk to the other four |
> | Cloud / SaaS club platform | Monthly fees forever — and **member data on someone else's server** |
> | Build it in-house | 12–18 months and a team you'd have to hire and keep |
> | **SAM** | **Built. Proven in a services institution. On-premise. White-labelled as PSC's own. One-time deployment, local support.** |
>
> **You are our second client, not our first.** The expensive lessons were paid for by someone else.

**You say**
> "I want to be careful here, because the worst thing we could do is walk in and tell a
> 163-year-old institution to rip everything out. We wouldn't propose that. We'd start with
> one department, run it alongside what you have, and let it prove itself."

---

## SLIDE 10 — The ask, and close

**On-slide**
> ### We're not asking for a decision today.
>
> **1.** **Tell us what you already run** — we'd rather build around it than replace it blindly
> **2.** A **walkthrough of how PSC actually works today**, so we can quote honestly
> **3.** **One pilot department**, running alongside your existing system — proven on real PSC data before you commit to anything
>
> ---
> **Your systems record what happened.**
> **SAM makes them check each other — in a record no one can change.**
>
> [Contact details]

**You say**
> "The single most useful thing that could come out of today is you telling us what you
> already have. We'd rather fit into it than pretend it isn't there. Then one department,
> running in parallel, and you judge it on your own numbers."

---
---

# If you get cut to 5 minutes

**Slide 2** (the six questions — read them, then stop and let someone answer) →
**demo steps 4, 5 and 7** (self-deducting stock, vendor price alert, audit log) →
**Slide 10** (the ask).

Two slides, three clicks, one request.

---

# Presenter notes

- **Never say "manual", "paper", or "registers" about PSC.** You do not know that, and the
  evidence says otherwise. If you need the contrast, talk about *the EME Mess before us* —
  your own client, your own story to tell.
- **Slide 2 is the pitch.** Everything after it is evidence. If a department head answers
  one of the six questions out loud with a "no, we re-type that" — stop, follow it, and
  build the rest of the meeting around their answer. Their example beats your demo.
- **If they answer "yes" to a question, concede it immediately and move on.** "Good — then
  that one's already solved, and we wouldn't touch it." Conceding cheaply buys you enormous
  credibility on the ones they can't answer.
- **The demo is the proof, slides 1–4 only earn the right to open the laptop.**
- **Have the app running before you walk in.** Never set up in front of a Brigadier. Keep a
  screen recording on the same laptop as a fallback.
- **Say "club and hospitality operations", never "hotel management system".** They're a
  members' institution, not a hotel.
- **Slide 7 is where trust is won.** Admitting the sports-facility gap out loud is what
  makes the left column believable.
- **Don't fill the silence after the failed check-in.** Let them process it.
- Keep [PSC_PITCH_DECK.md](PSC_PITCH_DECK.md) on a second device — Appendix B has prepared
  answers on cost, ROI, staff literacy, data safety, power failure and "what if you disappear".

**Sources for the PSC facts used above:**
[peshawarservicesclub.com](https://peshawarservicesclub.com/) ·
[credit card / departments](https://peshawarservicesclub.com/credit_card) ·
[Wikipedia — Peshawar Club](https://en.wikipedia.org/wiki/Peshawar_Club)
