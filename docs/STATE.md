AdventureOrNo — what this is, and what is left to build

**This is the only planning document.** If a plan is not written here, it is not the plan.

Every competing one was deleted from git on 2026-08-11 — and on **2026-08-28 every single
one was found still sitting on the disk**, because OneDrive restores what git removes.
`README.md` had needed deleting twice for exactly that reason. So for seventeen days this
file was one of thirteen documents in a folder, and any session that opened the folder
instead of this file got a different plan. They are gone from disk now, and
`scripts/check-one-document.mjs` **fails the build** if any of them comes back. Do not
recreate them: plans go HERE. If a decision needs looking up, git history has them —
§7's register names the commit for each.

Last updated: 2026-08-28.

**HOW TO READ A ✅ IN THIS FILE (new 2026-08-16).** A tick used to mean "somebody
finished it", and that turned out to cover five different states — which is how this
document came to say Phase 4 was DONE while the live site still drew a Mapbox map.
Every claim of doneness now names which of these it means, and they are not
interchangeable:

| Status                  | Means                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| **Built**         | the code exists on a branch                                       |
| **Merged**        | it is in`origin/main`                                           |
| **DB-applied**    | its migration is applied to production AND recorded in the ledger |
| **Deployed**      | it is in the bundle`/version.json` reports                      |
| **Live-verified** | Erica opened it in the real app and it was right                  |

Only **Live-verified** is what §5 means by "it works when Erica drives it". Merged is
not deployed; deployed is not verified.

## APPROVED COMMERCIAL PRODUCT + UI DIRECTIVE — PEOPLE, EVENTS AND MESSAGING

**Approved by Erica, 2026-08-20. This section supersedes every older statement that makes
Erica/Josh, Partner, `Together`, `Just me`, `Just Josh`, `Both`, `All`, `Anyone`, an
ALL/ANY operator, null-person scope, or household membership the permanent product model.**
**The scope vocabulary that replaces all of them is §0.2 (2026-08-30).** Those descriptions remain useful as history of
the private prototype, but they are not the commercial design and must not drive new schema,
statistics, routes or UI.

The product is a commercial travel-memory and activity app for any user. A user can tag any
number of people on memories, retrieve everything associated with one person or a selected
group, create and discover events, invite named users or publish an open invitation, and
message other users safely. Map, Places, Timeline, photos, activities and every statistic
must use the same selected-people scope.

### The people contract

- There is **one people system**, not a privileged Partner system plus secondary friends.
- A person may be a registered user or a private contact without an account.
- A partner may be favourited as a shortcut, but `partner` is not a counting rule, scope
  type, storage type or permanent navigation mode.
- `Together` is a query result: memories matching the selected people. It is never a null,
  magic value, hard-coded couple state or separate store of history.
- Selecting several people has an explicit operator:
  - **All selected people** — every selected person is associated with the memory.
  - **Any selected person** — at least one selected person is associated with the memory.
- The default meaning of “what I did with Josh + Maya” is the current user plus **all** of
  Josh and Maya. The UI must say which operator is active.
- Tagging is separate from account access. Inviting somebody to administer a whole space is
  not the same action as tagging them in one memory or inviting them to one event.
- A tag is immediately searchable in the tagger's private history. For a registered user,
  verification controls whether it becomes that user's accepted history and sharing
  controls what recording they can see. Declining cannot erase the tagger's private
  recollection. A private contact tag grants no access.
- A photo tag says who is in that photo. It does not silently assert that the person
  participated in the entire visit or outing.
- A place result for a person is derived from dated tagged visits, outings or photos. A
  permanent place tag must not invent a visit or affect travel statistics.

### The events contract

- A user can create an event at a place, with title, description, date/time, time zone,
  category, capacity, visibility and host controls.
- An event audience is explicit:
  - **Specific people** — invitations to selected registered users; optional secure invite
    links for private contacts/non-users.
  - **Friends/circle** — visible to an explicitly selected relationship group.
  - **Open invitation** — discoverable to all eligible users in nearby event search and on
    the map. The host may require approval, set capacity/waitlist and close the invitation.
- Nearby event search uses the map and PostGIS distance with date, distance and category
  filters. Public discovery never depends on a third-party event feed.
- Responses are `invited | requested | going | maybe | declined | waitlisted | removed`.
  Host removal, blocking and capacity rules are enforced below the UI.
- Exact location visibility is host-controlled. An open event may show an approximate
  discovery point and reveal exact meeting details only after approval/RSVP.
- An event is a plan, not a historical visit. It never contributes to Places, Visits,
  Trips, Miles or activity totals. After it occurs, attendees may deliberately create or
  attach an accepted visit/outing; the event itself never auto-writes history.
- External events (NPS, Recreation.gov, calendars, races) are optional discovery sources,
  always labelled by source and never the foundation of the user-created event model.

### Messaging and invitations contract

- Every event has a conversation for the host and eligible invited/approved attendees.
  Event updates, RSVP changes and conversation messages are distinct notification types.
- Users can message another registered user. Existing friends/accepted event participants
  can converse directly; other first contacts arrive as **message requests**, not an
  unrestricted inbox entry.
- Blocking is bidirectional and enforced in RLS for discovery, invitations, conversations,
  messages and notifications. Blocked users cannot invite, message or discover each other's
  restricted events.
- Messages support text first, ordered delivery, read state, soft deletion, reporting and
  rate limits. Attachments are deferred until moderation, storage and retention rules are
  explicit.
- Open invitations are invitations to discover/request attendance, not permission for every
  user to message every attendee. Guest-list visibility and attendee-to-attendee messaging
  are host/user privacy choices.

### The storage contract to build before the new UI

Commercial tenancy, people attribution, events and messaging are separate concerns:

```text
profiles / spaces / space_memberships
    who can sign in to, administer or collaborate in a space

people
    owner_profile_id, display_name, linked_profile_id nullable, favourite, timestamps

memory_subjects
    id, kind (photo | outing | visit | place), owner_profile_id, source_record_id

memory_people
    subject_id, person_id, tagged_by, participation_status,
    verification_status, sharing_status, timestamps

events
    host_profile_id, place/location, starts_at, ends_at, time_zone, visibility,
    exact_location_policy, approval_mode, capacity, status, timestamps

event_invites / event_attendees
    event_id, invited_profile/contact, invited_by, response/status, decided_at

conversations / conversation_members / messages
    direct and event conversation kinds, membership/requests, sender, body,
    delivery/read/deletion/reporting state, timestamps
```

Use an enforceable subject registry rather than an unchecked polymorphic foreign key. The
existing `tag_claims`, `activity_profiles`, `visit_profiles`, tagging rules and legacy
Erica/Josh rows are migration inputs, not the final commercial API. Do not add independent
photo/place participant mirrors. Design RLS first, then migrate existing assertion and
decision provenance intact.

Statistics use one contract, everywhere:

```text
canonical outings / accepted visits
  -> authorization
  -> scope: MY STATS | OUR STATS | a person's own stats
  -> time range
  -> category/activity filters
  -> counts and the exact drill-down rows
```

Filter canonical outings before aggregating. Multiple Garmin, Strava, file or person-owned
recordings still count once. Events stay outside historical totals until an accepted visit
or outing is explicitly created. **The scope vocabulary is defined once, in §0.2 — there is
no ALL/ANY operator and no `Together`, `Just me`, `Just Josh`, `Both`, `All` or `Anyone`.**

### Approved navigation and information architecture

The persistent primary navigation is exactly:

```text
Map | Add | Insights | Settings
```

- **Map is the homepage.** Search covers places, activities, people and events. Map layers
  include memories and nearby/open events without adding another primary destination. A
  lightweight `People: Anyone` control opens a multi-select drawer.
- **People, Events and Messages are capabilities, not extra primary tabs.** People selection
  is reached from Map/Insights; nearby events are reached from Map search/layers; Messages
  and Invitations are persistent utility routes reached from a text control in the app
  header and relevant person/event screens.
- **Add introduces information only:** place/visit, activity/file, photos, manual memory or
  event. It may point to repairs but never hosts the repair queue.
- **Insights has visible tabs:** `Overview | Places | Timeline`, sharing one people/time/
  category scope. Events do not appear in historical Insights until they become history.
- **Settings has exactly three destinations:**

  ```text
  Account | Integrations | Data & Privacy
  ```

  `Data & Privacy` is **one destination and one continuous page**, not Location/Data pills
  or separate Data/Privacy destinations. Sections: `Location`, `Sharing`, `People and tag approvals`, `Messaging and event privacy`, `Needs attention`, `Your data`. Map Appearance
  lives under Account. Connections/import history live under Integrations. Data Management,
  Export & backup and Trash live under Data & Privacy.
- **Needs Attention is the only repair inbox.** Duplicate activities/places, unresolved
  tags, unplaced photos and other correctable records render there. Data Health diagnoses
  system condition but does not duplicate repair actions.

Target routes (old routes redirect until links and saved URLs have migrated):

```text
/                              Map
/add                           Add/import/create event
/people/:personId              one person's memories
/events/nearby                 nearby/open event results
/events/:eventId               event detail, RSVP and invitation management
/events/:eventId/conversation  event conversation
/invitations                   event and tag invitations/requests
/messages                      conversations and message requests
/messages/:conversationId      direct conversation
/insights                      Overview
/insights/places               Places
/insights/timeline             Timeline
/settings/account              Account
/settings/integrations         Integrations
/settings/data                 Data & Privacy (one destination)
/settings/data/attention       Needs Attention
/settings/data/manage          Data Management
/settings/data/export          Export & backup
/settings/data/trash           Trash
```

### Approved visual direction

Erica approved the combined direction on 2026-08-20: People-first Atlas architecture, the
Map sliding people drawer, and Memory Lens's open photo-led Timeline/tagging treatment.
Preserve the current dark navy, blue/cyan accents, pale blue-grey text, photographic map
markers and text controls. Use full-bleed map/photos, open canvas, strong typography,
full-width rows, thin dividers and edge drawers. Avoid bento grids, stacked rounded cards,
giant containers, decorative pills and icon-heavy navigation. The no-icons rule remains.

Events use the same visual language: event map markers, an open event detail sheet and a
chronological conversation—not a new boxy dashboard. Messaging is a quiet full-width thread
with thin dividers and clear sender/time/read state.

**Approval status:** the product model, people model, events/invitation requirements,
messaging capability, combined visual direction, navigation labels and Settings destinations
above are approved. Event and messaging screen previews are still required before their UI
is implemented. Database/RLS contracts come first; then generated types/RPCs; then approved
UI; then production verification.

## 0.2 THE STATS MODEL — APPROVED 2026-08-30

Erica: *"This is not a household app. This is a social application."* Everything below
replaces the household vocabulary. **There are exactly three scopes and no operator.**

| Scope | Means | Measured 30 Aug 2026 |
| ----- | ----- | -------------------- |
| **My Stats** | Every card I am tagged on — solo or not. **The map opens here.** | 132 places · 2135.6 mi |
| **Our Stats** | Only the cards *all* the selected people **and I** are tagged on. The overlap, never the union. Tagging someone means we did it together. | 55 places · 481.6 mi |
| A person's own stats | **All** of theirs, including the cards we share. Seen by opening their profile — **never a pill on my map.** | Josh: 61 places · 1053.7 mi |

**Three people means three.** Add Josh and Maya and Our Stats is the cards all three of us
are tagged on. Strict intersection; it gets small quickly and that is correct.

**Only accepted tags count in Our Stats.** A proposed tag is a claim, not shared history.

**Removing a tag does not rewrite my history.** If Josh untags himself the card leaves Our
Stats and stays in My Stats, because I was still there. The two numbers then disagree on
purpose.

### RETIRED WORDS — do not reintroduce any of these

```
Just me      Just Josh     Just Erica     Together     Both     All     Anyone
ALL / ANY operator         "Both want to go"           null-person scope
```

`Just me` → **My Stats**. `Together` / `Both` / `All` → **Our Stats**, which also names who.
`Anyone` is gone outright: it only ever meant *everyone in this household*, and there is no
household. If a control, a function name, a label or a comment says one of these, it is a
defect — the guard in `participants.test.ts` names all seven surfaces and fails on it.

**The word for connecting to someone is `add`.** Not *friend*. Erica, 2026-08-30:
*"I don't know that I want to use the term friend, just add."* You add someone, you can
remove them, and you can block them.

### This is not only the map

The same three scopes and the same words apply to the **map pill**, **Settings ▸ Stats**
and **Insights**. A number must not mean one thing on one screen and something else on
another — which it does today: Settings says **17 Trips** and Insights says **56** for the
same account, because Settings still calls the older reader where `null` means *"only what
we did together"* while Insights calls the newer one where empty means *"anyone"*. One
vocabulary fixes the words; retiring the older readers fixes the numbers.

### ONE OUTING COUNTS ONCE — reviewed 2026-08-30, and it already works

Erica: *"we ran 15 miles together, but for each of us and for Our Stats that should only
increase our mileage by 15 miles not 30."*

**Both directions are already deduplicated**, and this was measured rather than assumed:

- **My own duplicate uploads** (the same run from Strava *and* Garmin) — `dedupe_shared_outings`.
- **Two people recording the same outing** — `dedupe_joint_outings`, matched on time
  proximity and distance similarity, which is why its audit line reads *"Same outing as X —
  N min apart, N% difference in distance"*.

`dedupe-joint-outings` runs nightly at 04:20 and succeeded on 2026-08-30. Live grouping:
**95 activities collapsed into 61 outings** out of 572 — **43 groups (56 activities) are one
person's duplicates and 18 groups (39 activities) are two different people.**

Proof on real rows, showing what a naive sum would have said:

| outing | recordings / people | counted once | naive sum |
| ------ | ------------------- | ------------ | --------- |
| Training Run 22 miles | 2 / 2 | **22.10 mi** | 44.11 mi |
| Purcellville Running | 4 / 2 | **45.12 mi** | 179.26 mi |
| National Mall | 2 / 2 | **20.18 mi** | 40.35 mi |

**The mechanism was never the problem — the readers were.** `0278` fixed six that filtered
on the canonical key and then aggregated raw rows. Any NEW stat reader must collapse to
`coalesce(shared_group_id, id)` before aggregating; `activity_lines` is the one deliberate
exception, because it draws every recorded route.

### CONNECTING TO SOMEONE — approved 2026-08-30

Two different relationships, and they are not the same button:

| | Direction | They see | You see |
| --- | --- | --- | --- |
| **Add** | **Mutual** — both sides agree | What they share with people they have added | Their shared cards can enter **Our Stats** |
| **Follow** | **One-way** — no approval | Nothing extra | **Only what they have chosen to make public** |

You can **add**, **remove** and **block**. Blocking is bidirectional and enforced in **RLS**,
never only in the UI — a blocked user must not be able to reach the data by calling the API
directly.

**Privacy is the user's own choice, not the app's.** Erica, 2026-08-30: *"it's fine for
users to share their home address and whatever else they want to share."* So there is no
category the app hides on their behalf. What a person marks public is public; the default is
private, and the decision is theirs.

### AN ACCEPTED TAG IS MINE — and today it is not

Erica, 2026-08-30: *"we need to figure out a way to keep the stats if I approve a tag someone
else has made and then they defriend me or untag me."*

**Measured 2026-08-30, and the answer is that nothing survives.** Accepting a tag only flips
`participation_status` on a row that lives inside the OTHER person's subject:

- `respond_to_memory_tag` updates `memory_people` and creates nothing of my own;
- `set_visit_participants` and `set_activity_solo` **DELETE** the row outright when someone
  is removed — they do not mark it retracted;
- `memory_people.subject_id` is **ON DELETE CASCADE**, so deleting the card deletes every
  participation on it, mine included.

Photos already behave correctly — `tag_person_on_photo` and `untag_person_on_photo` mark
**retracted** rather than deleting. Visits and outings do not. That inconsistency is the bug.

The file already states the principle in the other direction (§the people contract):
*"Declining cannot erase the tagger's private recollection."* **The mirror was never built:
the tagger's removal currently DOES erase the accepter's recollection.**

#### The approved shape of the fix

**Acceptance materialises my own record.** When I accept a tag on someone's outing, the app
writes an activity row owned by ME into the same `shared_group_id`. From that moment:

- it is **my** row, so their untag, their block and their deletion cannot reach it;
- the existing deduper already collapses a `shared_group_id` to one canonical outing, so the
  15-mile run still counts **once** for me, once for them, and once in Our Stats — no new
  counting rule is needed, which is the point of doing it this way;
- **My Stats keeps it. Our Stats loses it**, correctly — they are no longer tagged, so it is
  no longer a card we are both on;
- I keep the **facts** — date, distance, place — not their content. Their photos and their
  route stay theirs.

And separately: `set_visit_participants` and `set_activity_solo` must **retract, not delete**,
so that removal is a decision with a record rather than an erasure. Photos are already the
model to copy.

### THE THREE SECURITY DEFINER VIEWS — decided 2026-08-30

`activity_profiles`, `activity_provenance`, `visit_profiles` answer *"who was on this?"*.
They are SECURITY DEFINER, so they run as their owner and ignore the permissions of whoever
asks — which is why every member sees all 627 / 571 / 664 rows. §6c has the measured proof.

**The measurement that framed the decision:** a third account can read **557 visits** but
would see **0 participants** on any of them, because the RLS on `memory_people` and `people`
hides everyone else's participation. So flipping to `security_invoker` does not merely
"return fewer rows" — it makes the app say *you may see the visit, but not who was there*.
Erica loses 305 participant rows on visits she can still see.

| Question | Erica's answer, 2026-08-30 |
| -------- | -------------------------- |
| **Does seeing a memory mean seeing who was on it?** | **YES.** Within a space you already share, a card that hides who was there lies by omission. So the views are **not** flipped to invoker. The bypass is closed by writing the intended visibility explicitly into each view's own `WHERE`, so the rule is readable and reviewable instead of being a side effect of the definer property. Behaviour on screen does not change; the leak does. |
| **Should the owner see more than an editor?** | **NO.** Roles (`owner \| editor \| viewer`) govern **writes only**. Visibility belongs to the **space boundary**, never to the role. Two parallel visibility systems is how this class of bug gets rebuilt. |
| **Now, or with the partition?** | **With the partition.** The explicit rule only becomes meaningful once `is_member()` becomes `is_member(space_id)`. Deciding the rule now and landing it with item 9 gives one coherent change to visibility instead of two. **The one thing that must not happen is another person getting an account before it is closed.** |

So this is no longer a standalone fix. It is a **precondition folded into item 9**, and the
SQL is written and reviewed before the partition rather than invented during it.

### What still has to be built for this to mean anything

Ordered, because each depends on the one above it.

1. **Partition the data.** Every read policy ends in `is_member()`, so *add a user* and
   *give them my entire history* are the same button today. One indivisible migration:
   **57 tables, 81 policies, 201 SECURITY DEFINER functions.**
2. **Add / remove / block, and follow.** A directory, public profiles with a handle, a
   **mutual** add and a **one-way** follow that exposes only what the person made public,
   and removal and blocking — blocking bidirectional and enforced in RLS, not in the UI.
   `profiles` has six columns today and none of them is a handle, an avatar or a visibility
   setting.
2b. **An accepted tag becomes the accepter's own record**, per the section above, and
   removal retracts rather than deletes. Without this, everything a person accepts stays
   hostage to whoever tagged them.
3. **Cross-account tagging with acceptance.** The acceptance machinery works, but it is
   keyed to people *inside* one account and the write path takes a single profile id, so
   *"I was out with Maya"* cannot be recorded at all.
4. **The three scopes**, on the map pill, Settings ▸ Stats and Insights together.

The pills are last because they are the only easy part.

---

## APPROVED 2026-08-30 — THE ORDER OF WORK, AND WHAT THE FOUR-WAY AUDIT FOUND

Erica approved this on 2026-08-30 after a four-way audit run in parallel against **this
file, the live database, the live site and the infrastructure** — with the standing
instruction *"do not make any assumptions. Even if something is checked off, make sure it
was actually built and is functioning."*

**It supersedes the 2026-08-28 ordering below. It supersedes nothing else.**

### THE DISCIPLINE FOR THIS RUN, in her words

> *"Make sure the plan is updated in STATE.md before you start, and that you update it
> after each build by checking to make sure it is live and working."*

So: plan first, then build, then **verify against production**, then write the result here.
A tick in this section means *Live-verified* — the §"How to read a tick" scale at the top of
this file, not "the code is written". This is the same discipline the 08-28 audit had to
invent after finding ✅s on components that had never been written.

### A RULING THAT WAS OUTSTANDING

Two approved instructions contradicted each other and neither had been retired:

- **2026-08-11** (verified live at the time): *"Settings is the gear wheel, not a nav pill.
  One continuous page … **No section labels** — not 'Account', not 'People'."*
- **2026-08-20** (the commercial directive): Settings has **exactly three destinations** —
  `Account | Integrations | Data & Privacy`.

**Erica's ruling, 2026-08-30: use the 08-20 three-destination plan.** The 08-11 "no section
labels" instruction is hereby retired and must not be cited again.

### CHECK-IN: ASKED FOR, THEN REPLACED BY SOMETHING SIMPLER

A `checkins` table was proposed and **rejected**. Her actual requirement:

> *"my vision is more that I can click on my location on the map and the place I am at will
> be suggested in the add card we already built. ie, if I am at a restaurant the name of the
> restaurant will already be in the card after I hit add, then I can change it as needed."*

This needs **no new table and no schema change** — which is the whole reason the check-in
table was proposed, since `visits.start_date` is a `date` with no time-of-day. It becomes a
prefill on the existing Add card, and it simultaneously answers her other complaint
(*"I don't understand why official details look up name and website is on the card"*): the
manual **Official details → Look up name & website** button is deleted and becomes the
automatic prefill.

**The trap, found by testing it live rather than reading the code:** `fetchPoiDetails`
(`app/src/lib/data.ts:910-943`) is Nominatim **reverse** geocoding at zoom 18, and reverse
geocoding returns the *enclosing area*. A pin dropped on a Kansas highway offered
`Use name: Coffey County · Type: boundary/administrative`. For "I am at a restaurant" it
must prefer a genuinely named POI and **leave the field blank when it has nothing
confident** — a wrong prefill the user has to notice and delete is worse than an empty one.

### WHAT THE AUDIT FOUND THAT NOBODY HAD REPORTED

Every line below was measured, not inferred. None of it was in any prior list.

| # | Finding | Evidence |
| - | ------- | -------- |
| 1 | **The Add card's name field and star rating render OFF-SCREEN and cannot be reached.** You cannot see or type a place name when adding a place | `.panel-hero.panel-hero-empty` → `height: 0px; overflow: hidden`; `.hero-title` → `position: absolute; top: -61px`; `.hero-name-input` rect `top -40, bottom -9`, `elementFromPoint` hit-test **FALSE**. Identical on iPhone 430×932, iPhone 390×844 **and desktop 1440×900**. `panel.scrollTop` is already 0 and cannot go negative. Saved cards are fine — their hero is 190px |
| 2 | **56 outings are double-counted in stats today** | `activities_of_type[_for_people]`, `race_stats[_for_people]`, `races_list[_for_people]` filter on `coalesce(shared_group_id, id)` but then aggregate raw rows. Run 279/247 (+32), Hike 152/137 (+15), Walk 130/121 (+9). `mileage_by_person_for_people` and `wander_stats_for_people` do it correctly with `distinct on` — three readers were missed when `0260` claimed all nine shared one rule |
| 3 | **The app's own numbers disagree with each other** | Settings ▸ Stats says **17 Trips**; `/insights` says **56 Trips** for the same account. Place counts: home **136**, Insights **136**, `/health` **151**, `/places/edit` **168** |
| 4 | **Four of the six Needs Attention tiles are the same link.** "Name them", "Tag them", "Add dates" and "Review" all point at `/places/edit` unfiltered — a 168-row table with no filter, sort or highlight | Hrefs captured live. The queue cards themselves ARE wired (`reject_suggestion`, `approve_card`), but **when an RPC fails the UI shows nothing at all** — no toast, no error, card unmoved. That silence is what "does not function at all" looks like from the outside |
| 5 | **"Who was there" is four pickers with three vocabularies** | "Together" on cards · "All" in the `/places/edit` filter · "Both" in Settings and `/bucket`. **"Just me" is missing from the two visit editors** (add-a-visit form, per-visit list) where it matters most. There is **no "Anyone" option anywhere** in the UI |
| 6 | **The memory on the home screen is pure text — zero `<img>`** | `.memory-banner` renders *"6 years ago today you were in Appalachian Trail, Virginia · +1 more memory"*. The place it links to has **28 photos**, none surfaced. "+1 more memory" is plain text with no next control, so the second memory is unreachable. Meanwhile `OnThisDay` — the **photo-based** memory — is mounted at `MapView.tsx:1571` and works |
| 7 | **Photo tagging is fully built and has never once run** | `tag_person_on_photo`, `photo_people`, `respond_to_memory_tag` all exist; `memory_subjects` has 572 `outing` + 557 `visit` subjects and **0 `photo`** against 180 photos |
| 8 | **An accountless person cannot appear in any stat** | `people_memory_keys` resolves them only for `kind='photo'`; the `outing` and `visit` branches both require `linked_profile is not null`. The contract promises `visit_people` "for children, pets and companions without accounts" — that table has **0 rows** and nothing reads it |
| 9 | **The household is hardcoded in the WRITE path by a name regex** | `set_visit_solo` resolves "Together" as `select id from profiles where role in ('owner','editor') and coalesce(display_name,'') !~* '(test\|bot)'`. The READ path is already general (`p_people uuid[]` + ALL/ANY) |
| 10 | **Read side keys on PEOPLE, write side keys on PROFILES** | `people_memory_keys(p_people uuid[])` vs `create_visit(..., p_profiles uuid[])`. You can filter for someone without an account but cannot record them as present |
| 11 | **`auth_leaked_password_protection` is not "a simple toggle"** | `PATCH /config/auth {"password_hibp_enabled":true}` → **HTTP 402 Payment Required**. It is gated behind a paid Supabase plan. A billing decision, not a setting |
| 12 | STATE.md's own scale claim for the spaces migration is wrong | Claimed *"58 tables, 97 policies and 230 functions"*. Measured: **57** tables, **81** policies, **201** SECURITY DEFINER functions. Smaller than advertised; still one indivisible migration |
| 14 | **The category pills touched each other on a phone** — `.cat-pills` had **no CSS rule at all**, so twelve pills fell into normal flow with 0px between them. `.cat-pill`'s `flex: none` had been inert since it was written, because nothing ever made the parent a flex container | Measured 0px between "Jeeping" and "Camping" at 390px. Fixed in PR #174. The other tight rows were checked and left alone — `star-rating`/`primary-nav` at 1px and `ps-who-toggle`/`layers-control` at 2px are segmented controls, tight on purpose |
| 15 | **Unanswered participation claims were counting in shared stats** — 15 rows sat in `proposed` with `tagged_by`, `rule_id` and real evidence all NULL. They were not person-to-person tags at all but the app's own guess that both members were on a visit, parked where the asking screen could never surface them, because it only shows claims a PERSON raised. Six of the 164 shared keys were among them | Erica, 2026-08-30: *"I do not want you to go back and ask permission for the 55 he is already included on — just mark it that he accepted the tag."* Done in `0279`: **15 → 0 proposed**, 1234 → 1249 accepted. Only `participation_status` changed — `decided_by` stays NULL and `evidence` stays `unknown`, so the record still admits these were never personally confirmed rather than forging a decision. A claim a real person raises is untouched and still has to be answered |
| 13 | Genuinely healthy | **Zero console errors, zero failed requests, zero horizontal overflow across 15 routes.** R2 and the database agree exactly: 366 objects, 366 referenced keys, 0 orphans, 0 missing |

### THE APPROVED ORDER

Erica: *"that order is fine."* Items 1–3 are in flight as of 2026-08-30.

| # | Work | Status |
| - | ---- | ------ |
| 1 | **The Add card** | ✅ **LIVE-VERIFIED 2026-08-30** — PR #172, §6k. Re-measured on **production**, signed in, at all three viewports the audit used: `hero=190px · inputTop=150 · hit-test true · typing lands`, against `hero=0 · inputTop=-40 · hit-test false` before. Date prefills to `2026-08-30` (today). Cause was not the markup: `.panel-hero` is `overflow:hidden`, which gives a flex item an automatic `min-height:0`, so a card taller than its `92vh` cap squashed the hero to nothing and carried its absolutely-positioned title to `top:-61px`. One line — `flex: none`. **Still imperfect, and known:** the prefilled name came back `"US Route 75"` on a highway pin — the new OSM POI path correctly rejected it, but the **pre-existing MapTiler reverse geocode** still supplies a fallback area/road name. At a restaurant you get the restaurant; on a road you get the road. Left as-is deliberately — a road is at least where you are, unlike "Coffey County". |
| 2 | **Dedupe the stat readers** (finding 2) | ✅ **LIVE-VERIFIED 2026-08-30** — `0278`, PR #170. It was **six** readers, not three: reading every body from production first found `activities_of_type`, `race_stats` and `races_list` (the non-people variants) had the same defect. Verified independently of the agent that made it, three ways: every function's returned count now equals `count(distinct coalesce(shared_group_id, id))` for both real accounts (6/6 match); `anon` cannot execute any of them; and through the app's own PostgREST path the test bot returns Run 165 / Hike 41 / Walk 74, matching the post-fix numbers. Erica 216→200 Run, 139→134 Hike, 115→106 Walk; Josh 248→216, 71→56, 105→98. `activity_lines` stays non-deduping **on purpose** and the migration asserts it, so a later pass has to argue with a `raise` rather than quietly "fix" it. |
| 3 | **Settings stats dropdowns + inline place editing** | ✅ **LIVE-VERIFIED 2026-08-30** — PR #173. **The suspected cause was wrong and saying so is the point.** `overflow:hidden` on the summary does NOT break `<details>`; native toggling was never broken, proven in Chromium and WebKit. The real defect: the rule removed `list-style` *and* the webkit marker and supplied no replacement, so `::before`/`::after` were `none` in **both** states — the summary rendered identically open and shut. Nothing said it was a control, or that an open panel could be closed. Verified on production at 390×844: all 22 summaries show a marker when closed; opening a second panel **closes the first**; re-clicking an open one **closes it**. `PlaceQuickEdit` reused unmodified behind a "Fix this place" disclosure, so the default stays "just the visit" (2026-07-26) with correction one click away. |
| 4 | **Unify "who was there"** (finding 5) | ✅ **LIVE-VERIFIED 2026-08-30** on production at 390×844: `/places/edit` reads *Anyone · Together · Just me · Just Erica · Just Josh* (**"All" gone**), `/bucket` reads *Anyone · Together* (**"Both want to go" gone**), Settings reads *Together · Just me · Just Erica · Just Josh* (**"Both" gone**), and **"Just me" now actually renders** where it had been in the code but invisible. **Note what this now is:** §0.2 retires the very words it just made consistent. That is not waste — it collapsed seven scattered surfaces onto one helper, which is what makes the My Stats / Our Stats change a single edit instead of a seven-file hunt. A stepping stone, not the destination. — PR #176. All seven surfaces now read one list. The three that did not — the card's per-visit row, the card's add-a-visit form and `/visit/:id` — each re-implemented `whoChoices()` by hand, and their "Just me" branch (`p.id === profile?.id`) only fired when the signed-in profile was itself a row in `map_people`, which is why the audit read the list back as "Together · Just Erica · Just Josh". It is always the second choice now. **"Anyone" is added and is deliberately NOT merged into "Together"**: a filter's *do not narrow this* and an attribution's *all of us* are different answers, and merging them would hide rows — `/places/edit` lists a place nobody has recorded a visit to under `all` and never under `both`. `whoFilterChoices()` = `ANYONE_KEY` + exactly `whoChoices()`, so the distinction is explicit rather than accidental; the word is the one §8b-i approved and the Map has used since 0260. `/places/edit`'s filter had been re-adding its everyone pill with "Together" typed in by hand, so it read "All · Just me · Just Josh · Together" and went on saying "Together" for three people; `/bucket` said the retired word **"Both"** twice, in the filter and on every row, long after 2026-08-15 retired it. **The comment at `PlacePanel.tsx:1683` was two instructions out of date and is recorded rather than obeyed**: it asks for "Both", but 2026-08-15 (*"the view is Together so investigate why you are saying Both"*) changed that very line to `everyoneLabel()` the same day and left the comment behind, and 2026-08-17 settled the wider ban — *"Fine on a control."* Obeying it would have put "Both" back on the live site. Dead `components/PersonFilter.tsx` deleted (32 lines, zero importers). The source guard that only ever read Settings.tsx now names **all seven** surfaces, which is how `/bucket` kept the retired word for a year. Presentation only — `set_visit_solo` still takes one profile id, so **no surface here can say "two of us three"**; that stays item 7. |
| 5 | **Reconcile the disagreeing numbers** (finding 3) | queued |
| 6 | **Needs Attention** (finding 4) — filtered destinations per tile, and real error feedback when an RPC fails | queued |
| 7 | **Add / remove / block another user** — a directory, a public profile with a handle, and a connection that can be added, **removed** and **blocked**. Blocking is bidirectional and enforced in RLS, never only in the UI. The word is **add**, not friend (§0.2) | queued — needs item 9 underneath it |
| 7b | **Cross-account tagging with acceptance** (findings 8, 9, 10) — a real user lookup, not pills; the tagged person must accept. Requires reconciling the people/profile seam: the read side keys on **people**, the write side on **profiles**, and `set_visit_solo` takes a single profile id | queued |
| 8 | **The three SECURITY DEFINER views** | **DECIDED 2026-08-30, FOLDED INTO ITEM 9.** Not flipped to `security_invoker` — that would make the app show a visit without showing who was on it (a third account can read 557 visits and would see 0 participants). The bypass is closed instead by writing each view's intended visibility explicitly, against the space boundary, and it **lands with the partition**. See the decision table above. **Still an absolute precondition for anyone else holding an account.** |
| 9 | **Spaces, friends, public profiles** (Phase 3b) — the gate on everything social. One indivisible migration | queued |
| 10 | **Settings' three destinations** — `Account \| Integrations \| Data & Privacy`, per the 08-20 ruling above | queued |

---

## APPROVED 2026-08-28 — FINISH THE CARD, IN THIS ORDER

Erica approved this on 2026-08-28 after an audit of both prior sessions against the live
site. **It supersedes nothing below; it says which of it happens first.**

### What the audit found

Forty-one concrete requests from the 11–15 and 16–22 August sessions were checked against
the deployed bundle, the production database and the four service APIs. **Thirty are live
and correct.** Eleven are not, and **eight of them are the card**. Nothing had regressed:
local `main`, `origin/main` and the live site were all `dee153d`, all 270 migrations were
recorded, and the destination card still passed 35 of its 36 source guards. The card was
never finished — and §"Still to build on the card" claimed twice that it was.

### The stages

1. **Make the site provable again.** Connect Chrome so the card can be seen signed-in; put
   `TEST_BOT_EMAIL`/`TEST_BOT_PASSWORD` in `.env.local` so `verify:live` stops SKIPPING
   every authed card check; retire the five stale CI expectations left by `/add`→`/attention`
   and by Settings joining the nav, so `main` is green and the nightly can warn again;
   clear the deleted-but-still-on-disk source files that break the local typecheck.
2. **Build the card, fully** — to the approved v5 preview, which is not being redesigned:
   the cover (letter of the activity, and a real slot where there is no photo), the VISIT
   card as the card scoped to one visit, the BLANK card as the card with empty fields,
   activities on the blank card, the scope text on every section heading, and the trail
   change below. **A guard per item**, so none of it can quietly come undone again.
3. **The two gates on anyone else using this.** Move the 31 SECURITY DEFINER readers of
   `activities` onto `can_see_activity()` (§7d); fix the four SECURITY DEFINER views from
   `0266` (§6c); give `cron.job_run_details` a reader.
4. **People.** Phase 3 step 1 — separate signing in to a space from being tagged in a
   memory — then friends/family as tags on every card, then a tagged person's rating row.
5. **The rest, as already sequenced.** Settings' three destinations; the remaining repair
   cards into Needs Attention; geocoding we own; events then messaging (**previews first**);
   fitness ingest, which is blocked behind stage 3; native apps, deferred until the LLC.

### THE TRAIL CHANGE — approved 2026-08-28

> Erica: *"I DO want the trail toggle to label a trail, and the is this part of a trail
> question deleted."*

This **amends the locked card**, on her express instruction, and it is the only change to
that template approved since 2026-08-11:

- **KEEP** the "Is this a trail with sections?" Yes/No toggle. It is the control that
  labels a place a trail; it keeps writing `is_trail`, and it stays the only place the
  question is asked. This replaces the preview's line that the Trail tag is "gone from
  every card" — the toggle IS the label now.
- **DELETE** the "Part of a trail?" parent picker from the blank card, and the `part_of`
  it wrote.
- **Consequence, stated to her before doing it:** a new place can no longer be attached to
  a trail at the moment it is created. That still works from the trail's own card ("Add
  places you've already saved to this one"), and it matches the model in which a segment
  name rides on the visit rather than on a parent link.

### ONE DOCUMENT, NOW ENFORCED

> Erica: *"fix EVERY fucking markdown file so you stop doing shit I dont want."*

Thirty-one superseded markdown files were removed on 2026-08-28 (§7 register). They had
been deleted from git on 2026-08-11 and were **all still on disk**, because OneDrive
restores what git removes. `scripts/check-one-document.mjs` now fails the build if any
markdown appears outside `CLAUDE.md`, `docs/STATE.md` and a snapshot `MANIFEST.md`. A rule
in prose could not fail a build; this one can.

---

## NOW — the order of work (locked 2026-08-14)

The deployed product must remain a reliable private web app for **Erica and Josh** while
the shared core becomes safe for the commercial product. The commercial Apple and Android
product **has no decided name** (2026-08-15 — "Flok" was a working title and is NOT
decided; do not write it into the product, the docs or the repo). Commercial tenancy,
people, events and messaging now belong in the shared core before their approved UI; they
must be introduced without destabilizing the private deployment.

The sequence is:

1. **Stabilize the private core.** Place, visit, trip, trail, card, saves, imports,
   photos/videos, statistics, authentication, backup, CI and production deployment must
   agree and work for both accounts.
2. **Self-host the map.** Finish the MapLibre + PMTiles path in Phase 4, approve the
   visual palette, cut production over with rollback, then remove paid basemap dependence.
3. **Build the complete web feature set.** The approved Map/Add/Insights/Settings structure,
   universal people tagging/filtering, events, invitations, messaging, collaborative trip
   planning and remaining importers are queued here. They are not cancelled or abandoned.
4. **Build the native Apple and Android apps, then launch commercially.** Reuse the proven
   commercial-safe domain model and versioned APIs; complete billing, legal/provider
   compliance, support and native-only integrations after the private core is dependable.

**“Later” means sequenced, not postponed indefinitely.** Do not delete desired features
to make the schedule look shorter. Finish one vertical slice, deploy it, verify it in the
real app, and then take the next slice.

### Current stabilization gate

Do not begin a new feature lane until all items below are true for the same commit:

- [X] Production migration `0177_the_card_answers_in_one_call` is applied and recorded.
  Verified 2026-08-14: all 177 migrations are in the ledger, `videos.visit_id` exists,
  and production `card_view` was version 2. **It is version 3 as of 0188** — the card
  reads participants from rows rather than a nullable `solo_profile`.
- [X] A current recoverable backup exists. Re-verified 2026-08-16 after it had gone
  **stale at 42h against a 36h limit** — the nightly Backup workflow could not run while
  GitHub Actions was blocked on billing, so the freshness gate and the thing it guards
  failed together. Fresh encrypted backup taken 2026-08-16, seven generations, 362 media
  objects. **The restore is now fully proven** (2026-08-16 21:11): after the
  identity-column fix, all 45 tables restore with row counts matching the manifest
  exactly — 21,143 rows, zero load errors. It had failed earlier the same day with
  `service_health` at 0 of 415; no table holding real data was ever affected.
- [ ] Erica can sign in, open a place card, edit and save a visit, reload, and see the
  saved result.
- [ ] Josh can sign in and perform every action allowed to the editor role without seeing
  an unexplained permission or save failure.
- [ ] Map, place card, visit page, Add/import, photos, stats and logout pass a short manual
  smoke test on the production commit recorded in `/version.json`.
- [ ] Required CI is green on Node 22; production deploys only the exact gated SHA.
- [ ] Backup freshness and migration-ledger checks are hard production-deploy gates.
- [ ] GitHub CLI authentication is healthy for the repository owner, so commits, checks,
  PRs and deploy evidence can be inspected instead of guessed.

### How to move faster without repeating work

- Keep **one active implementation PR**. Finish, deploy and verify it before starting the
  next feature PR. Separate worktrees are allowed for independent documentation or audit
  work, but two agents must not edit the same files at the same time.
- Database contract first: migration → generated types → backend/RPC → frontend → tests →
  production verification. Never deploy a frontend that requires an unapplied migration.
- Use a small required gate for every PR: format/lint, unit tests, database migration tests,
  build, and one deterministic smoke test. Run broader browser/accessibility/security suites
  nightly or when their files change; do not remove the tests that protect data and deploys.
- Batch Erica's visual decisions into one preview gate per feature. Code after approval,
  then verify the finished production screen once.
- Record every accepted decision and its proof here. Do not create another backlog,
  decisions log or competing agent instruction file.

### THE PLAN — revised 2026-08-17

**The 08-16 plan is finished and has been moved to §7e.** It ran Steps 0–3: production
caught up to `main`, Phase 4 went Live-verified, the restore was proved, and the three
monitoring traps were closed. Keeping a completed plan at the top of the file is how this
document turned into a history of itself last time, so what remains is below and the
narrative is in §7e where the other days live.

**The order is unchanged from 08-14** — stabilize the private core, then the web feature
set, then native. What changed is that the top of the list is no longer maintenance.

#### 1. ✅ `verify:live` IS TRUE AGAIN — and as of 2026-08-17 the last red check is green

**§5's lanes are no longer gated.** This section's last open item was a question for Erica;
she answered it, and the check now passes against her own data. Nothing in the plan is
waiting on §1 any more.

`e2e/erica-asked-for.spec.ts` decides whether Erica got what she asked for: a request is
done when its check is green **on the live site**, and a changed instruction gets its check
**rewritten, with the old one noted** — never deleted. That rewriting had never happened,
so the list was failing against an app that was correctly obeying her newer decisions.

**Five red became one, 2026-08-17. Four of the five were the list's fault, not the app's:**

| Check                                       | What was actually wrong                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| *"stats moved to the top of places"*      | Asserted a stats bar**on** Places — the exact thing she told us on 08-15 to remove, and #94 did. Two instructions in direct opposition                                                                                                                | **Rewritten to the newer instruction** per rule 4, with the old wording recorded in the test. Now asserts no stats bar and no gear on Places, and that Stats is on Settings where she moved it |
| *"clicking Trips pulls up a list"*        | **Not a missing feature.** `openStats()` clicked the FIRST of /settings' four `stats-dropdown` summaries, and only if none was open — so whenever another was open it clicked nothing, Stats stayed shut, and the Trips button read "not visible" | Helper now finds the**Stats** card by its summary text                                                                                                                                         |
| *sections are Visits, Photos, Routes, …* | Demanded a Routes heading unconditionally;`PlacePanel` renders it only when the place has activities                                                                                                                                                       | Asserts the ORDER of the sections that exist; Routes is checked where it belongs                                                                                                                     |
| *Routes holds the map AND the list*       | Same, on one hard-coded card                                                                                                                                                                                                                                 | Walks Places until it finds a place that HAS routes, then asserts map + list                                                                                                                         |

**A correction to what this section said an hour ago**: it claimed the Trips check was red
from "the same removal" as the stats bar. That was wrong — it never touched Places. The
cause was the helper above, and the difference matters because one reading says a feature
is missing and the other says a test is.

**✅ THE LAST ONE IS ANSWERED AND GREEN — 2026-08-17.** The visit section reads
`Together / Just me / Just Josh`. §0.1 had relaxed the blanket ban on "Trip" *inside an edit
control* — "the visit editor may say **Count this as a trip**" — while keeping passive
badges banned, and the participant picker is a control of exactly that kind. That made the
check red against an app obeying her newer rule. **Probably is not good enough for a rule
she wrote**, so she was asked:

> *Does "no together in the visit section" still stand, now that the words sit on a control
> you press rather than a badge that just asserts something?*

**"Fine on a control."** So the rule is now about **assertion, not vocabulary**: the words
may live on something you press, and must not appear as text that simply announces a fact.
The check strips every `select / option / button / input / label` from the section and
asserts on what is left — the part of the page that *states* something at her. Her original
wording is preserved in the test, per rule 4.

**Verified where it actually matters.** This check could only ever be red against HER data:
the browser matrix runs on a seeded disposable database where those cards have no visits, so
the assertion had nothing to read and passed regardless. Re-run signed in as her against the
live site, on the Appalachian Trail card (35 visits) and San Diego (1): **no passive
"Together", no `· Trip`, no "tap a date" — and the picker still offers Together.**

Two of the fixes above were bugs in the replacement code, found by running it against
production rather than assuming: counting place links before the list had loaded (0 links
on an account with 151), and matching `.our-stats` where /settings has six of them. Both
are the same mistake this file keeps naming — reading the DOM before the thing exists.

#### 2. THE STRAVA LEAK, THEN THE IMPORT SYSTEM — Erica's order, 2026-08-17

She set the sequence: *close the cross-visibility first*, then build the import workflow
with a provenance ledger, then cross-source de-duplication, then backfill Josh's Strava.
The whole design is **Phase 7a**, written against the live database rather than the repo.

**The one number that says why it is first:** acting as Josh, the real reader
`mileage_by_person(josh)` returns 124 activities and 992.5 miles — of which **46
activities and 356.1 miles are Erica's Strava runs**. His stats screen is showing him her
mileage today.

The cause is not the guard — #100 works, 15 readers go through `visible_activities` — and
not the Strava trigger, which credits only the athlete whose token fetched the activity. It
is `0039`, which asserted **by date** that everything Erica recorded after 2025-12-21 was
also Josh's. 44 of the 46 still carry that migration's fingerprint.

**That backfill was deliberate and stays** (Erica, 2026-08-17: it *"was just meant for the
specific timeline when I initially added activities"*). What goes is the rule's future
tense, which survives in `import_file_activity` **and in `rebuild_place_visits`** — the
second being a machine job that re-asserts it on every rebuild. The visibility fix is what
makes keeping the history safe: a true "we were both there" tag stops being a key to
Strava's copy of the data.

#### 3. ✅ THE THREE UNTAPPABLE /settings LINKS ARE GONE — and no decision was needed

`Celebrate Virginia`, `Mill Mountain Trail`, `Red Spring Gap` were untappable because a
long category list overflowed its collapsed container and painted **under the floating
nav**. This section asked her to choose between giving that list its own scroll, a max
height, or unnesting it.

**None of those. The nav is no longer on /settings** — her instruction of 2026-08-17,
*"map places add timeline should not appear on the settings page"* — so the thing doing the
covering is not there to cover anything. Re-measured on the **live site, signed in as her,
on a 390×844 phone, with every collapsible section opened**:

    interactive elements on screen                    262
    covered by something that is not themselves         0
    Celebrate Virginia / Mill Mountain Trail /
    Red Spring Gap                                    all TAPPABLE
    nav.primary-nav on /settings                      absent

And the routes that still HAVE the nav were checked the way the guard defines the property —
scrolled fully to the end, since a floating nav covering something mid-scroll is not a bug:
`/`, `/places`, `/timeline`, `/bucket`, `/albums`, `/trash`, `/health` — **nothing trapped
under the nav on any of them.**

**A fix in one place broke a guard in another, and this is how it was found.**
`nav-obstruction.spec.ts` listed `/settings` and asserted `nav.primary-nav` is *visible*
there; `erica-asked-for.spec.ts` waited for the nav as its boot signal on **every** route
including `/settings`. Both went stale the moment the nav was removed, and both live in the
**full browser matrix, which was `skipping` on every PR this week** — so a latent red sat
there unseen. This is §1's lesson exactly: *a request is done when its check is green, and a
changed instruction gets its check rewritten with the old one noted, never deleted.* Both
now carry the instruction that superseded them, and `app.spec.ts` pins the removal from the
other side (`toHaveCount(0)` on /settings, visible on /places).

**The remaining question is worth asking anyway, and it is not urgent**: a category list
inside a stats dropdown still overflows by thousands of pixels. Nothing covers it now, so
nothing is unreachable — but "scrolls forever inside a dropdown" is a design she may not
want. Not a bug; a preference, for whenever she looks at that screen.

#### 3b–3l. THE 08-18/20 RUN IS FINISHED — the narrative moved to §7f

Ten sections of completed work were sitting here, which is precisely what the top of this
plan warns against: *"Keeping a completed plan at the top of the file is how this document
turned into a history of itself last time."* Written on 08-17, broken by me on 08-18 through
08-20. The account of those three days is now **§7f**, where §7e's days already live.

**What it covered, in one line each** — Steps 1–5 of §3e, all shipped and deployed:

| | |
| --- | --- |
| Garmin export reviewed | 8,938 files → 391 activities → **7 genuinely new**; the rest already here |
| The review queue | 36 nonsense cards → 18 answerable; duplicates show both routes |
| Step 1 — grouping | two paths stopped merging without asking; **six deleted days restored** |
| Step 2 — naming | 58 renamed from source/place, **no cards raised** |
| Step 3 — provenance | every upload hashed, stored, recorded; failures in the ledger |
| Step 4 — authorization | three holes; one decided **whose account** data landed in |
| Step 5 — one verb per screen | `/add` creates, `/attention` repairs, `/inbox` redirects |
| Sharing | tagging IS sharing, owner-controlled, off by default; **a total is not a recording** |
| CI | out of minutes → docs runs 6→2 billed minutes, matrix weekly, auto-deploy verified |
| Data | "Florida" 486 mph run removed; Christmas typo fixed at its source |

**WHAT IS LEFT of §3e, and it is the whole of what is next:**

- **Step 6 — ✅ the picker stopped overwriting people (0236).** `set_activity_solo` deleted
  every participant row and rebuilt them bare: it erased the record that Josh had ACCEPTED a
  tag, added him with no say, and — once 0228 existed — silently SHARED a Strava recording.
  Now your own participation you may state, adding anyone else PROPOSES, removing them
  RETRACTS, and a row evidencing somebody's own recording is never the tagger's to delete.
  0228's `claim_status <> 'declined'` guard was fictional too — the CHECK says `rejected` —
  and now names the value the column uses. Narrative in §7f.
  **And the rest of Step 6 (0240–0245)**: `set_visit_participants` had the identical defect —
  655 rows of who-said-what, deleted and rebuilt bare on every press. Visits differ in one
  way that matters: **nothing filters `visit_profiles` by claim_status** (of 24 functions that
  read it, only `respond_to_tag` looks), so a pending row would already be on somebody's
  statistics — the 0039 harm. For a visit the CLAIM is the pending state and there is no row
  until it is accepted. A PLACE is one question rather than one per visit (43 at Lake of the
  Red Rocks), which withdraws the questions about its own days. Naming somebody again after
  taking it back REOPENS the question; after they declined it does not. And all four pickers
  now **return `{stated, asked, removed}`** — they returned `void`, so six screens reported a
  question as a fact. Narrative in §7f.
  **Still open**: `my_tags_to_confirm` surfaced ACTIVITY claims only until 0240 — visit claims
  had been storable and answerable since 0201 with nobody ever asked. Photo tagging (8b-i) is
  still not built.
- **Step 7 — ✅ one Export & Backup screen (0237, 0238, 0239, `/export`).** Data health said
  *"Download everything you can take with you"* over three buttons that exported 162 places
  — no outings, no visits, no photos, no journal. Now `export_manifest` / `export_header` /
  `export_section` back one screen with three separate things and a real table of contents;
  0238 opened `import_artifacts`, which had RLS on and **no SELECT policy at all**, to the
  people whose uploads it records. Narrative in §7f.
- **✅ The two smaller ones, same shape as Step 5.** Data health's "Needs a look" block
  carried *"Activities not attached to a place"* — a Needs attention row with a button that
  does something about it — so the same work sat on two screens and only one could act. It
  now lists only what is BROKEN (a reference to a row that is gone, a thumbnail never made,
  an import with no owner, a token that stopped refreshing), each saying where the fix is,
  under a line stating that the screen changes nothing. And **duplicate-place repair is in
  the repair queue**: `/duplicates` was reachable only from Settings, so the only way to
  learn whether anything needed merging was to go and look. The pairing rule moved to
  `lib/duplicatePlaces.ts` and both screens call it, so the count on Needs attention cannot
  disagree with the rows on `/duplicates` — the recurring one-fact-two-mechanisms defect,
  caught before it existed rather than after.


#### 3m. PHASE 3 HAS STARTED — a person no longer needs an account *(0247–0258)*

§5's next concrete step was *"database/RLS contracts for tenancy, universal people, events and
messaging first"*. **Only the people half is built.** Events and messaging previews are still
pending your approval, and a storage contract for a screen nobody has agreed to is how a
schema acquires tables nothing ever uses.

**THE THING THAT WAS IMPOSSIBLE.** §8b-i: *"A user can tag any person."* They could not.
`activity_profiles` and `visit_profiles` both point at `profiles`, so the only people who could
ever appear in this app were the two who can sign in to it — a friend, a parent, a child on a
hike could not be recorded at all. And 178 photos had no participants of any kind, because
photos were never given a participant table.

| | |
| --- | --- |
| `people` | a person, owned by whoever recorded them. `linked_profile` is **nullable** — having an account is a property some people have, not the price of being remembered |
| `memory_subjects` | the registry §8b-i asked for: four real foreign keys and a CHECK tying the kind to the one that is filled in, rather than an unchecked polymorphic pair. A subject cannot point at something that is not there and cascades away with it |
| `memory_people` | who was in it, and — kept apart on purpose — whether **they** confirmed it, and whether they can **see** it |

**PHOTO TAGGING IS THE FIRST CONSUMER, and deliberately the only one.** `activity_profiles`
and `visit_profiles` are untouched and no outing, visit or place subject is registered: §8b-i
calls those "migration inputs, not the final commercial API", and moving 1,278 rows and
twenty-four readers in the same change that introduces the model is how one fact ends up
stored twice. A photo is the one kind with **nothing to mirror**, so this adds a capability
rather than a second copy of one — and the outing/visit migration will happen against a model
that has already run against real data.

**THE THREE ANSWERS, each a rule already settled rather than a new invention**: yourself goes
on (0236); somebody with an account is **asked** (0240), and the chip says *"asked"* until they
answer (0243); somebody **without** one goes on as your statement, with verification
`unverified` **forever** — there is nobody to ask, and saying so is the only honest option.
Removing retracts. §8b-i's own warning is asserted by the tests: **being in a photograph is
not being on a run**, and nothing derives one from the other.

**AND THE OTHER HALF OF §8b-i** *(0253)*. §8b-i asks for two things and the model delivered
one: *"tag any person, FIND ANYONE TAGGED in their photos/memories, retrieve everything they
did with one or several people"*. Tagging without retrieval is half a feature. `/people/:personId`
— already a target route in the approved navigation — is built, and reads **one** function.
That is the point of writing it now rather than after the big migration: a person's memories
live in three places today (`memory_people` for photos, `activity_profiles` for outings,
`visit_profiles` for visits), and when the last two fold into the registry, ONE function
changes and every screen that asked follows. Measured against production: Josh's page shows
**127 outings from 129 participant rows** — two duplicate recordings collapsed, because "an
outing counts once however many recordings exist" is the statistics contract and counting rows
would tell somebody they did the same run twice. A photograph is never summed with an outing,
a pending tag is labelled and not counted, and a page about a person shows only what the asker
may see — his unshared Strava recording is not on it. Reachable for now from Settings ▸ People
▸ *Your people*, which says out loud that it is a temporary home: the approved permanent one is
the Map's `People: Anyone` control, which is not built.

**ONE OR SEVERAL PEOPLE, ALL OR ANY** *(0255)*. §8b-i: *"Remove `Together / Just me / Just
Josh` as the permanent model; **Together is a people query with ALL selected**."* So the
general question is the primitive and one person is the degenerate case — `person_memories` is
now a wrapper over `memories_with_people`, one implementation of authorization, canonical
outings and the photo/outing separation. **Canonical first, then count**: collapse an outing's
recordings BEFORE counting who was on it, or an outing they were both on looks like two
half-matches and an ALL query drops exactly the outings they did together. Measured on
production, and it adds up: **hers 375 · his 127 · together 55 · either 447** — 375 + 127 − 55
= 447 exactly. Reachable as *"Also with"* on a person's page.

**AND FOUR DEFECTS FOUND BY WRITING THAT ONE TEST** *(0256–0259)*:
- `default_participants` credited **`auth.uid()`** and never looked at `owner_profile`, which
  `set_activity_owner` has already decided in the BEFORE trigger. Inserting an activity on
  somebody else's behalf put YOU on their run — the 0039 shape. **Measured before claiming
  harm: zero rows on production came from it** — every current path inserts as the owner, and
  the Strava backfill has no `auth.uid()` at all. The twelve non-owner rows that exist were
  written by a backfill on 08-14, are a different question, and are untouched.
- Fixing that made the owner's row say **`unknown`** instead of `own_recording`, because
  `ingest_activity`'s explicit insert now lost the conflict — and `own_recording` is exactly
  what 0236 keys "not yours to delete" on. Every newly imported activity would have had an
  owner row that "Just me" could delete (0257).
- `0173_who_did_the_activity` then caught the other side: with the row correctly saying
  `own_recording`, a blanket protection meant **she could not take herself off a run she had
  recorded**. 0236's own words settle it — *"not THE TAGGER'S to delete"* — the protection is
  from other people, not from yourself (0258).
- And 0258 wrote that rule **backwards on the two visit pickers**: `profile_id <> v_me`
  exempts the caller from being REMOVED rather than from the protection, so "Just Josh" on a
  visit left her on it, on every visit in the app (0259).
- `0141_one_outing_counts_once` then showed its control had been **right for the wrong
  reason** — it only reached 135 miles because the old trigger put her on the third person's
  recording by accident. The fixture now says they ran it together, which is what it meant.

**THE MAP ASKS THE SAME QUESTION NOW** *(0260, 0261)*. §8b-i: *"A lightweight `People:
Anyone` control opens a multi-select drawer"*, and *"Together is a people query with ALL
selected."* Nine functions carried the two-person model — three behind the markers, the visit
badges and the route lines, six behind the stats bar — each written as `case when p_profile is
null then is_shared_X(…) else exists(…participant row…) end`. All nine now consume one rule,
**`people_memory_keys`**, lifted out of `memories_with_people` so the map and a person's page
cannot disagree about who was where.

**Half of it would have been worse than none**: with *Anyone* selected the map would have shown
135 places while the miles beside them counted the 54 they had both been to — each correct
alone, the pair of them a lie. That is why the six stats functions are in the same change.

**The old answers still mean what they meant**, and `0260_the_map_asks_the_same_question` pins
it: `place_ids_for_view(null)` ≡ `place_ids_for_people([both],'all')`, the per-profile form ≡
ANY over one, and the same for the badges and the miles. Measured on production before the
swap — 54 places and 60 counted identical, 437 miles identical, 1,941 for her identical. Two
things change on purpose: the map **opens on Anyone** (135 places, 2,513 miles) where the old
default was SHARED, and the route lines now draw **every** recording of a matching outing
rather than one, because the canonical one may be the copy without a polyline and a missing
line is a worse error than two on top of each other.

**And pressing "Me" gave you Josh.** Found by pressing it on the deployed map. The first
version of the control was a plain multi-select toggle, so from *Together* — where everybody
is selected — pressing a name REMOVED that person and left the other one. The old control was
three radio buttons and "Me" has always meant just me. Pressing a name that is part of a wider
selection now narrows to that person; pressing the only one selected lets go of it.

**AND A STALE COPY OF THIS FILE APPEARED ON DISK** *(2026-08-21, 11:14 ET)*. Mid-session,
`docs/STATE.md` in the working tree was replaced by a much older version — 3,760 lines
different from `HEAD` — with the characters `ok` prepended to its first line. **The committed
file was never affected**: every note from 0247 onward is in `HEAD` and always was, which is
also why four anchors "vanished" at once and one that had supposedly failed to apply days ago
turned out to be sitting there perfectly.
**WHY, as far as it can be established.** The whole repository — **including `.git`, 32 MB of
it** — lives under `~/Library/CloudStorage/OneDrive-Personal/`. A cloud-sync agent therefore
has write authority over every file in the working tree, and over the object store. OneDrive
has resurrected stale copies in this project before (§8). The `ok` on line 1 says a keystroke
also reached the file, which is what an editor holding an old buffer would do. Which of the
two wrote last cannot be established after the fact: the artefact is gone and there are no
logs to read. What IS established is the standing hazard, and it is bigger than one document —
**a sync agent that can rewrite `.git` can corrupt the repository, not just a file in it.**
Moving the repo out of the synced tree is the actual fix and is Erica's call.
**What matters is what nearly happened**: the next edit would have been written onto the stale
copy and committed, silently reverting the record of the last five days under a commit message
about something else. It did not, because every edit to this file asserts its anchor first and
four failed at once — a pattern that is itself a signal. `git diff docs/STATE.md` before
editing it is now the rule, and the pre-commit hook refuses a commit that deletes most of it.

**AND TWICE, A SENTENCE THAT READ AS ONE FACT AND WAS ANOTHER.** The first live version of the
person page said **"Miles together — 1,009"**, when the page answers *"everything that person
did which you can see"*, including things they did alone. Then, filtered to *Also with: Me /
All of them*, the paragraph beneath still said *"including things they did on their own"* — the
opposite of what was on screen. The second is worse, because its fix **had been written and
silently did not apply**: a string replacement whose target the formatter had re-wrapped, made
without checking that it matched.

**AND THE SAME MISTAKE, IN THIS FILE, FIVE TIMES.** Everything in the two blocks above was
written into STATE.md as it happened — and none of it arrived. Each edit anchored on a
paragraph inserted by the edit before, the first one failed to match, and every one after it
failed silently on the missing anchor. So the plan was recording *nothing* about 0255–0259
while the commits said it was. §6 rule 1 is *measure the thing, and check what you pointed at*;
an unverified string replacement is the same class of error as an unverified query, and this
is the second time today. Every edit to this file now asserts its anchor before writing.

**Two mistakes the tests caught within the hour**, both mine and both in 0247:
- `0154_authz_matrix`: `people_read` consulted `memory_people`, whose policy consulted
  `people`. Postgres stops at **42P17**, so *every direct read of `people` by a signed-in
  browser was an error* — invisible only because everything ships through SECURITY DEFINER
  functions, which evaluate no policies at all. The model worked and the table under it did
  not. Both clauses are right and both stayed; two definer helpers break the loop (0250).
- **ON CONFLICT cannot infer a partial index** — the 0209 trap, again. The predicate bought
  nothing, since a unique index treats NULLs as distinct (0249).
- `0111_create_experience`: **a viewer could create people.** The old write policy was
  `is_editor_or_owner()`; 0247 replaced it with `owner_profile = auth.uid()` to make a contact
  private, and in doing so dropped the requirement to be allowed to write at all. Ownership
  decides which rows are yours; the role decides whether you may make any. Swapping the second
  for the first reads like a tightening and is a widening (0251).
- And the same test, one rule further: **a person attached to a visit is not a private
  contact** (0252). Its assertion that "a viewer CAN read people" was the old household-wide
  rule and is superseded — but the narrower half survives and matters: somebody who can see a
  visit and cannot read the name on it is told a child was there without being told which
  child. The old instruction is noted in the test rather than deleted.

#### 3o. THE REGISTRY MIGRATION HAS STARTED — step one of two *(0262)*

§8b-i calls `activity_profiles` and `visit_profiles` *"migration inputs, not the final
commercial API"*. 0262 registers a subject for every activity and visit and copies all **1,278
participations** into `memory_people` with their provenance intact. Verified on production by
the migration itself, which raises rather than continues: **623 outing and 655 visit rows
across, none missing, none invented, none changing its answer on the way.**

**What a profile maps to**: a person with an account is one person however many contact lists
they appear in, so participation is recorded against their **own self-contact** — the `people`
row whose owner and linked profile are the same. That keeps exactly one row per (memory,
account) and makes the compatibility views in step two exact rather than DISTINCT-ed. Having
an account now *creates* that row, by trigger, rather than by a migration that ran once.

**Step two, measured before it was attempted** *(0264, 0265)*. Two things had to be true
before a view could replace those tables, and one of them was not:

- **The view is byte-identical to the table** — 623 outing and 655 visit rows, none missing
  either way, **zero differing columns**. It took 0264 to get there: 0262 had folded
  `accepted_legacy` into `accepted` under "one word for one idea", which is right for
  *rejected*/*declined* and wrong here. `accepted_legacy` does not mean accepted; it means
  **accepted by a rule rather than by the person** — the 44 tags applied to Josh before anyone
  thought to ask him, and the reason `respond_to_tag` still treats them as answerable.
- **"The writers stay untouched" was never available.** All fourteen writers use `ON CONFLICT`
  — 32 clauses between them — and a view cannot take one. So the move is 33 write statements
  translated from `(activity_id, profile_id)` to `(subject_id, person_id)`, not a swap. 0265
  adds the three get-or-create helpers that make that a substitution rather than fourteen
  chances to be clever.

**✅ STEP TWO IS DONE** *(0266, 0267)*. `activity_profiles` and `visit_profiles` are **views
over `memory_people`** now, with the same columns in the same order, and the migration proved
them row-for-row identical to the tables inside its own transaction before committing to it.
The old tables were renamed `*_retired` and frozen, then **dropped in 0270** once three things
were true and checked rather than assumed: an off-site backup existed that contains the new
store (triggered one — `memory_people: 1278`, `memory_subjects: 1119`, 29,227 rows across 54
tables, encrypted and uploaded); `pg_depend` showed nothing stored still pointing at them; and
the views and the frozen tables still held identical rows, which is the last moment that
comparison can be made at all. **Participation now lives in exactly one place.** Measured after the swap, on
live data: **zero rows differ in either direction.**

**Thirty-three write statements moved.** All fourteen writers used `ON CONFLICT` — 32 clauses
between them — so a view could not take their writes, INSTEAD OF trigger or not. Each was
matched against the live definition exactly once before replacement and each function asserted
afterwards to contain no reference to the old tables, because a generated migration that
rewrites thirteen functions and silently not the fourteenth compiles perfectly and means
something else. The end-to-end check on production: an activity insert credits its owner
`own_recording`; the picker gives 2 for everyone and 1 for just her; `create_visit` with both
gives 2 and narrowing gives 1; and `memory_people` and the view agree throughout.

**And forty test fixtures moved with them**, because a fixture that writes a table cannot write
a view. That is 17 files, rewritten mechanically and then by hand where the shapes differed —
the derived-table form keeps the original VALUES untouched and wraps only the two keys.

**Two guards caught what the swap left behind**: new views inherit Supabase's blanket grant, so
`0176` found INSERT/UPDATE/DELETE back on relations that had spent their whole lives read-only
(nothing could be written through them — a view over a join is not auto-updatable — but *"it
fails for a second reason"* is not the rule), and `the_readers_stay_enforced` found
`subject_for_activity` reading `activities`, which belongs on the allowlist: it reads one
column of one row and returns an id.

**AND A VIEW REMEMBERS THE TABLE, NOT THE NAME** *(0268, 0269)*. CI failed on exactly one test
out of seventy-one — `0200_a_tag_is_not_a_key` — and it was right. Reproduced on production in
four lines: an outing she has tagged him on, sharing on.

```
activity_profiles rows for it   2
his row present                 1
can_see_activity                TRUE
visible_activities rows         0      ← the same rule, the opposite answer
```

Renaming `activity_profiles` moved every **stored expression** that named it. A FUNCTION
resolves names when it runs, so `can_see_activity` picked up the new view at once. A VIEW does
not — Postgres records its dependencies by OID — so `visible_activities` followed the rename
and quietly kept reading the frozen table, and everything written after the swap was invisible
to it. Then the same thing again for the row POLICY: `activities_select` is a stored expression
too. **Renaming a table silently moves views, policies and generated columns, and leaves
functions alone.** Both were found by asking `pg_depend`, not by grepping the name — grepping
would have found the same two and given no reason to believe there were only two.

After the rebinds, on live data: her visible activities **477**, Anyone **135 places / 2,513
miles**, Josh's outings **127** — every number identical to before the swap.

**Eight of seventy-one SQL tests still fail against PRODUCTION and this is expected.** Each is a
whole-database assertion meeting live data — four coordinate-free activities that do carry a
route, a place whose stored count disagrees, seven awaiting a geocoder that is off — or the
household-size family (`is_shared_*` requires the fixture's own pair to be the only real
members, and production has two more). The clean database in CI is the arbiter for those, and
the proof that none of them is a swap regression is that the view and the frozen table return
**identical rows**: no reader can see anything different.
 Nothing reads the new
rows yet; the two old tables remain authoritative. The next migration re-runs this backfill —
so anything written in between is carried over — and then turns those tables into views over
the new store so the twenty-four readers keep working. **If step two does not happen, 0262 is
a mirror and should be reverted, not left.**

#### 3n. AN OUTSIDE AUDIT, 2026-08-21 — what it found, and what it had already been fixed

Codex audited the repository against production. Its snapshot was two merges old (735c3c8), so
some of it was already answered; the rest was right and is listed here with what happened.

| Finding | Verdict |
| --- | --- |
| **Overlay labels ask for a font nobody serves** | **CONFIRMED, and it was live.** Measured: `/basemap/fonts/Open Sans Bold,Noto Sans Bold/…` → **404** (the Worker only passes `/^Noto Sans[ A-Za-z0-9]*$/` — it is not an open proxy), `Noto Sans Bold` → **502** (not published upstream), `Noto Sans Medium` → **200**. Four MapView layers asked for the first, on every tile, forever. `style.test.ts` has stated the rule since the basemap was built — it guarded the STYLE and never the app's own layers, which is exactly how a written-down rule gets broken. Fixed, and the guard now covers both. |
| **Two controls share a row on a phone** | **CONFIRMED.** `.memory-banner` and `.layers-control` were both at `calc(84px + env(safe-area-inset-top))`, placed by rules 1,500 lines apart — one dodging the crowded bottom, one dodging the stats bar. Neither knew about the other, and the wide one covered Fog and Heat. The two rows are named variables now, and `nav-obstruction.spec.ts` measures what is actually on top of every button in that control at 390×844. A CSS-text guard was written first and **thrown away**: it can only see the literal `84px`, and the next collision will be two different numbers. |
| **STATE.md on disk is a rollback** | **CONFIRMED, and never committed.** See below. |
| **Two live tests are stale** | **CONFIRMED.** The Routes test held a live Playwright locator across a navigation, so `.nth(i)` re-resolved against the place page and timed out; it snapshots the hrefs now. The Settings test demanded an "Import an activity file" button removed on 08-20 for pointing at a route that does not exist; it asserts the working GPX/TCX/FIT importer instead, with the old instruction noted rather than deleted. |
| **Nav is still the superseded private model** | **TRUE and known.** `Map / Places / Add / Timeline` against an approved `Map / Add / Insights / Settings`. Tracked in §5; the live test correctly describes today rather than promising tomorrow. |
| **The people filter is still `Together / Just Erica / Just Josh`** | **STALE.** Replaced on 08-21 by `Anyone / Together / Me / Josh` with explicit ALL/ANY (0260, 0261) — two merges after the snapshot. |
| **0260 has no regression tests** | **STALE.** `0260_the_map_asks_the_same_question.test.sql` shipped with it, pinning ALL/ANY, empty selection, and that Together and Just-me mean exactly what they meant. Unauthorised person ids are pinned by 0253's test. |
| **30 `<Link><button>` nested interactive elements** | **CONFIRMED** (15 by a narrower count, same defect). Competing link/button semantics. **NOT fixed here** — it is a mechanical sweep across many files plus an eslint rule, and it is worth doing on its own rather than inside a fix for something else. |

#### 3p. THE HEADLINE MILES DO NOT CHANGE. THE INSTRUMENT DID *(retracted, 2026-08-22)*

**What was written here yesterday was wrong, and this is the correction.** The claim was that
the map's miles pill shows a different number on every reload — 562.6, 544.4, 976.8, 476.8 —
and that the defect lay between the query and the pill.

It does not. Measured properly, by reading the DOM once a second for twenty seconds instead of
screenshotting it four times:

```
visibilityState   "hidden"
rafFired          false
pill              0.0 miles   … for twenty seconds
```

`useCountUp` drives the pill entirely with `requestAnimationFrame`, and **a browser pauses
those in a background tab**. Every screenshot was taken during the instant the tab came
forward, so the four numbers are four points on the same curve toward the same total. For
somebody actually looking at the page the count-up finishes in 700 ms and the number is right
and stable — which is exactly what the four server-side readings said all along, and I wrote
the note anyway.

**The rule I broke is the one in §6 that I keep quoting**: *measure the thing, not a proxy for
it, and check what you pointed at.* Four screenshots are a proxy. The instrument was never
checked, and the retraction is more expensive than the check would have been.

**There IS a real bug in there, and it is a small one**: with no animation frames the value sat
at **0.0** rather than at the total, so a tab loaded in the background showed nothing until it
was looked at. Fixed by settling on the value immediately when the page is hidden — the number
is the point, the count-up is decoration, and decoration nobody can see is not worth a 0.0.
It also makes the pill readable by anything automated, which is what let this be settled at
all.

#### 3q. THE APPROVED NAVIGATION — `Map | Add | Insights | Settings` *(2026-08-22)*

The persistent primary navigation is the four the contract names. **Places and Timeline stop
being destinations** and become tabs inside **Insights**, alongside a new **Overview** — which
is the entire reason to put them together: *"sharing one people/time/category scope."* The
people control at the top of Insights is the same one the Map uses and reads the same
`people_memory_keys` rule, so a number there can never disagree with a marker here.

**Overview** is the headline four — places, miles, trips, races — through the `_for_people`
functions, plus the race buckets. Events are deliberately absent: *"Events do not appear in
historical Insights until they become history."*

**`/places` and `/timeline` redirect** to their tab, per *"old routes redirect until links and
saved URLs have migrated"*, and both are asserted by a live test.

**AND SETTINGS COMES BACK INTO THE NAV, which reverses an instruction rather than ignoring
one.** Erica, 2026-08-17: *"map places add timeline should not appear on the settings page"* —
and she was right, because none of those four WAS Settings, so the bar offered only ways to
leave a screen she was still reading. Now Settings is one of the four, so the bar says where
she is instead. The approved contract calls this navigation persistent; the older instruction
was about a bar that did not include the page it sat on. **If that reading is wrong, this is
the line to say so on.**

Both live nav checks changed with the old expectation written down beside them rather than
deleted — including `app.spec.ts`, which asserted Settings was NOT in the nav and now asserts
Places and Timeline are not, so the count still cannot drift.

**AND A TAB BODY IS A TAB, NOT A PAGE INSIDE A PAGE.** The first deploy shipped both
screens still wearing the chrome they had as routes: the Places tab rendered *"Map ▸
Places"* and the Timeline tab rendered *"Settings ▸ Timeline"* — a back-bar offering a way
out of the page you are already on, above a heading repeating the tab you just pressed.
(Timeline's pointed at Settings, which was wrong before Insights existed.) Both are gone
with the route they belonged to; if either becomes a destination again its chrome comes
back with it. **This was found by looking at the live page, not by a test** — so it is now
a live check, and that check was proved to FAIL against the deployed site before the fix.

#### 3r. A COUNT OF ZERO PROVES NOTHING UNTIL THE SCREEN HAS RENDERED *(2026-08-22)*

The check written for the tab-chrome defect **passed against a site that still had it.**
`ready()` waits for the NAV — it proves the app booted — and the screen under test arrives
after that, so `toHaveCount(0)` was asked before there was anything to count and answered
"zero, correct". That is the same shape as every stale-assertion failure this file has had:
a check that cannot fail is not a check.

So, in `erica-asked-for.spec.ts`: **every negative assertion now follows a positive one that
only the real screen satisfies** — Places has rows, Timeline has years, the map has its stats
bar, /add has its button. The rule is written at the top of the file. The strengthened check
was proved both ways: it FAILS against a locally-served build with the back-bar put back, and
passes against the deployed one.

Three more things fell out of looking:

* **`app/e2e/` was typechecked by NOTHING.** `tsconfig.app.json` includes only `src`. The
  live spec had shipped `ReferenceError: total is not defined` inside a failure message, so
  the one check that was reporting a real problem *crashed instead of reporting it*. There
  is now a `tsconfig.e2e.json` in the build, and `tsc -b` — which the pre-commit hook and CI
  both run — covers the tests. It immediately found two more real type errors in `fixtures.ts`.
* **"Import & sort photos" was asserted as `role=button`.** It has always been an `<a>`
  styled `as-button`, so that check demanded something that was never there and went red
  against a Settings page that has had the control all along.
* **The Routes check sampled twelve places from whatever had rendered at that instant**, so
  which twelve changed run to run; on the run where none had activities it reported "the
  section stopped rendering" about an app that was rendering it. It waits for the list now.

All 25 live checks are green.

**What is still not built from the contract**: Settings' three destinations
(`Account | Integrations | Data & Privacy`, the last being one continuous page), and everything
events/messaging, which waits on previews.

#### 3s. OTHER USERS — what exists, and the plan she asked for *(2026-08-22)*

Erica, 2026-08-22: *"I want to be able to share this application with other people... I can
add people as an editor, but I also want to add other users so they have all the same
functions and can add other users as friends."*

**WHAT EXISTS TODAY IS ONE HOUSEHOLD, NOT MANY USERS.** Every read policy in the database
ends in `is_member()` — *are you signed in to this household* — so `places_select`,
`photos_select` and the rest hand a new account **Erica and Josh's entire history**. Roles
are `owner | editor | viewer`; they say what you may WRITE, never whose data you see. Sign-up
is `claim_invite()`: no pending invite, no account, and accepting one puts you in **this**
household. So today "add a user" and "give somebody all of my data" are the same button.
Adding a friend that way would be a privacy incident, not a feature.

`people` (0247) is already the right half of the answer: a person is owner-scoped, needs no
account, and `linked_profile` points at one when they have it. Tagging, ALL/ANY retrieval
and approvals already work off it. **What is missing is tenancy and friendship.**

**THE PLAN, in the order it has to happen.** Each step is a migration series and a UI slice.

1. **Spaces.** `spaces` + `space_memberships`, per the storage contract above. Every
   household-owned row gains `space_id`; `is_member()` becomes `is_member(space_id)`.
   Backfill is one space with Erica as owner and Josh as editor, so nothing she has changes.
   **This is the big one**: 58 tables, 97 policies and 230 functions currently assume one
   tenant, and until it lands every other step below would leak. It is also the only step
   that must be done in one go — a half-partitioned database is worse than an unpartitioned
   one, because it looks safe.
2. **Sign-up.** Self-registration creating your own space, with the invite path kept for
   joining an existing one. Open registration vs invite-code-first is **her call** (§4).
3. **Friends.** A `friendships` edge between PROFILES (requester, addressee, status
   `pending | accepted | blocked`), mutual, bidirectional block enforced in RLS — not a
   `people` row, because a contact is private to its owner and a friendship is agreed by two
   accounts. `people.linked_profile` is how a friend appears in your own contact list.
   **Default: a friend sees nothing.** Friendship is permission to tag, invite and message,
   not access to a history.
4. **Cross-space tagging.** Tagging a friend writes a claim in THEIR space with
   `participation_status = 'proposed'` — the machinery `memory_people` already has. Their
   acceptance puts it in their history; declining leaves the tagger's own record untouched,
   which is the contract. Sharing what you can SEE of a memory is a separate, explicit act.
5. **Events and messaging**, which the contract already specifies and which need friends and
   blocking underneath them.

**What this is not**: it is not "more roles". Roles stay what they are — how much you may
change inside a space you are already in.

**Before strangers hold accounts**: a privacy policy and terms, a deletion/export path that
a stranger can run without asking (the export page exists; account deletion does not), abuse
reporting, and a decision on photo storage cost per user. None of them are code problems and
all of them precede a public sign-up form.

#### 4. WAITING ON ERICA — none of it blocks the rest

- ✅ **`GITHUB_TOKEN` for the watchtower** *(2026-08-21)*. She added it to `.env.local`; it
  had to be a **Cloudflare Worker secret on `adventureorno-watchtower`** — a different place
  with the same name, and the Cloudflare API showed that worker holding only
  `SUPABASE_SERVICE_ROLE_KEY`. Verified against the GitHub API first (it reads `main`), then
  put on the worker.
- **The iOS Shortcut** — send `Authorization: Bearer`, and the `?token=` fallback can go.
  Note §C5: the device path has not run since 07-29, so "where we are" is a browser tab for
  both of them right now.
- **The 122 photos** — one visit, one day, one place, no ambiguity, and `0157` makes the
  attachment permanent. The 32 with fabricated `12:00:00` stamps must be proposed instead.
- **Her manual smoke pass** — the last unticked box in the stabilization gate. The
  automated acceptance flows cover the same ground but do not replace her driving it once.
- **THREE DECISIONS ABOUT OTHER USERS** (§3s), asked 2026-08-22. Step 1 (spaces) does not
  need any of them — it is the same migration whatever she answers — so nothing waits.
  Steps 2–3 do:
  1. **Open registration, or an invite code first?** Recommended: invite code. It lets
     friends in without opening the door to the internet before moderation exists.
  2. **What a friend sees by default.** Assumed: *nothing* until you tag or share with them.
     Friendship is permission to tag, invite and message — not access to a history.
  3. **Do she and Josh stay ONE shared space?** Recommended yes, because that is what they
     actually use; the alternative splits her history from his. Friends are separate
     accounts either way.

#### 5. THEN THE QUEUED LANES, in the order locked on 08-14

§1 went green on 2026-08-17, so these are startable.

| Lane                                     | State                                                    | Next concrete step                                                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 3 — approved app structure        | **people model, photo tagging, a person's memories, the ALL/ANY query, the Map's people filter and the approved navigation built (0247–0270, §3q)**; events/messages preview pending | ✅ universal people + subject registry + RLS, photo tagging as its first consumer. ✅ the Map, its badges, its lines and all six stats read one people rule (0260/0261). ✅ the registry migration finished and the profile-only participant tables are gone (0262–0270). ✅ `Map \| Add \| Insights \| Settings`, with Places and Timeline as tabs inside Insights. NEXT: Settings' three destinations — `Account \| Integrations \| Data & Privacy`, the last being one continuous page. Add creates; Needs Attention repairs. |
| **Phase 3b — OTHER USERS (§3s)**        | **nothing built — and it is the gate on everything social** | Step 1 is `spaces` + `space_memberships`, and it lands in ONE migration series: 58 tables, 97 policies and 230 functions currently end in `is_member()`, which asks *are you signed in to this household*, not *is this yours*. Then self sign-up, then `friendships` between profiles with bidirectional blocking, then cross-space tagging on the `memory_people` machinery that already exists. |
| Phase 4d — geocoding we own             | nothing built                                            | Overture → PMTiles; Mapbox stays the fallback                                                                                                                                                                                        |
| Phase 6 — what we own                   | nothing built                                            | §6a-ii first: Copernicus terrain kills the last Mapbox call AND its attribution question                                                                                                                                             |
| Phase 7 — fitness ingest                | nothing built                                            | intervals.icu first; email-in is the best effort-to-coverage item                                                                                                                                                                     |
| Phase 8 — events, social, privacy floor | nothing built | **Now explicitly downstream of Phase 3b**: an event audience of "friends", and a message request from somebody you do not know, both need friendship and blocking underneath them. Much of the rest is gated on the LLC and the native shell. Before strangers hold accounts: privacy policy, terms, self-serve account deletion (export exists, deletion does not), abuse reporting, per-user photo storage cost. |

**✅ The nested controls are gone** *(2026-08-22)*. Fifteen `<Link><button>…</button></Link>`
pairs across six files put a button inside a link. **The LINK survived** — they are all
navigation, and a link is what they are: cmd-click, open in a new tab, a real href. Turning
them into buttons with an `onClick` would have thrown all of that away to answer a semantic
complaint. `a.as-button` carries the styling, and the six base button rules name it alongside
`button`.

Not eslint-plugin-jsx-a11y, which cannot see this: `Link` is a component, and a linter has no
way to know it renders an anchor. A source guard does, and it also asserts the replacement is
still *in use* — a guard that only forbids the old shape passes just as happily on a codebase
where somebody deleted all fifteen links.

**And a note on how it was done.** The first attempt widened every selector mentioning
`button` with a regex, which rewrote the word inside a *comment* and broke the stylesheet.
Reverted; six base rules widened by hand instead. That is the second time this week a clever
substitution cost more than the careful one would have.

**Three dead components are named and unremoved**: `BucketMiniMap`, `TrailSectionsMap` and
now `PersonFilter`, superseded by `PeopleFilter` on 08-21. None has a consumer. `AddSheet` was the same and she said delete it, so these are probably
the same answer — but removals get asked about first.

#### 6. THE STANDING RULES THIS WEEK EARNED

Not process for its own sake — each one is a specific thing that went wrong:

1. **Measure the thing, not a proxy for it, and check what you pointed at.** Three
   findings this week came from measuring and one from inferring; the inferred one was
   wrong, and the retraction of it was *also* wrong because it measured a login page by
   mistake.
2. **A guard that cannot see the failure is not a guard.** The a11y check aimed at a
   dialog that no longer existed. The obstruction check never looked at /settings. The
   nightly suite could not run at all.
3. **Apply the migration BEFORE merging.** It is why #103 deployed and #100 did not, and
   regenerate the types in the same commit.
4. **A null is not a fact.** `solo_profile IS NULL`, a quiet cron row, an empty
   `last_query_auth_at` — absence of evidence keeps getting read as evidence of absence.

---

## 0. AUTHORITATIVE BUILD DIRECTIVE — PLACE, VISIT, TRIP, TRAIL AND THE CARD

**Approved direction, 2026-08-12. Read this section before every older discussion of
places, visits, trips, trails, cards, containment or statistics. When an older passage
conflicts with this section, this section wins. Do not create another planning document.**

This is an implementation brief, not permission to improvise another model. The work is
complete only when the database, RPCs, frontend, generated types, tests, live data audit,
and this document all describe the same rules.

### 0.1 Non-negotiable outcome

There is one model:

```text
PLACE = where something happened
VISIT = one occurrence at one place
TRIP = a qualifying visit, never a separate place or table
CHILD VISIT = a visit explicitly grouped under a parent trip visit
ACTIVITY = something done during a visit; its recorded route is evidence
TRAIL = a non-counting place rollup whose sections are counting places
```

Do not restore `trips`, `trip_stops`, a `trip` place category, or trip-places. Do not infer
trip contents from overlapping dates alone. Do not create a second visit at a trail when a
section visit already represents the outing. A machine may propose; only an accepted write
changes history.

The new decision supersedes these older rules where they conflict:

- date-only global trip containment;
- `solo_profile IS NULL` as the permanent participant model;
- `places.part_of` as a writable/canonical relationship;
- direct frontend insert/update/delete operations on `visits`;
- cached place dates/counts as an independent source of truth;
- a drawn trail definition stored as an `activity`;
- the blanket ban on the word “Trip” inside an edit control. Passive badges remain banned,
  but the visit editor may say **“Count this as a trip”** so a person can make or undo that
  decision intentionally.

### 0.2 Before writing code

Claude must do all of the following and record the results in this section:

1. Read this entire file, the final definitions of migrations `0133` through `0162`, the
   current `PlacePanel`, visit-detail route, stats RPCs, `detect-trips`, and trail rollup code.
2. Open the authenticated card preview supplied by Erica:
   `https://claude.ai/code/artifact/7d3ec882-b79c-4c7c-a889-69bcfaa618ed?via=auto_preview`.
   Capture desktop and mobile screenshots for comparison. If it cannot be opened, stop the
   visual portion and ask Erica for screenshots; do not claim it was reviewed.
3. Compare that preview with the locked card rules in §2. Preserve its visual language:
   cover, type, colors, spacing, ratings, blue section rules, section order and footer.
   The redesign is a data/interaction correction, not a new visual concept.
4. Run a read-only production preflight. Report row counts and exceptions; never print keys,
   tokens, exact private coordinates, or private notes. At minimum measure:
   planned/taken visits, exact duplicate visits, overlapping visits, deleted/draft places
   still contributing to stats, legacy `trip` tags, orphan `trip_people`/`trip_notes`,
   `part_of`/`place_membership` disagreement, and trail/member same-outing duplicates.
5. Take and verify a recoverable database backup before any production migration.
6. Create new sequential migrations. Never edit an already-applied migration.

### 0.2a PREFLIGHT RESULTS — recorded 2026-08-12, production READ-ONLY

Nothing in production was changed to produce this. No keys, tokens, coordinates or notes
are reproduced here.

**Backup taken and PROVEN restorable first (§0.2.5).** `db/2026-08-12/s0-preflight-…age`,
2.44 MB, encrypted. Restored into a disposable Postgres 17 from the migration chain:
**all 38 tables matched the manifest exactly, 18,834 rows, zero errors.**

| #  | Measure                                          | Result                                                                                                     |
| -- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1  | Visits by status                                 | **489 taken, 0 planned.** 52 multi-day, 9 carry `is_trip`                                          |
| 2  | Exact duplicate visits                           | **0**                                                                                                |
| 3  | Overlapping visits at one place                  | **0**                                                                                                |
| 4  | Deleted/draft/suggested places with taken visits | **7 places, 8 visits** — none deleted or suggested; all are `saved = false`                       |
| 5  | Legacy`trip` place tags                        | **0**                                                                                                |
| 6  | Orphan`trip_people` / `trip_notes`           | **0 rows each** (the tables still exist)                                                             |
| 7  | `part_of` vs `place_membership`              | **In perfect sync** — 0 either way, 19 rows each. Only `relationship_type` in use is `contains` |
| 8  | Trail/member same-outing duplicates              | **78 pairs** — 77 trail visits, 78 section visits, across 7 trails                                  |
| 9  | Attribution                                      | 388 visits name a profile;**101 use null-means-both**                                                |
| 10 | `activities.visit_id`                          | **Does not exist.** 445 activities, and **0 rows with `source='drawn'`**                     |
| 11 | Trails                                           | 6 trails, 19 membership rows, 143`counts_as_place`                                                       |
| 12 | §0.3's new visit fields                         | **None exist yet** — clean slate                                                                    |
| 13 | Headline numbers today                           | 132 places, 489 taken visits, 16 trips (Both)                                                              |
| 14 | Authorization surface §0.4 must audit           | **127 SECURITY DEFINER functions**, 43 public tables                                                 |

**What this changes about the plan:**

- **Item 8 is the only large data problem.** 78 pairs is the same duplication found on
  2026-08-11 and deliberately left alone. §0.5.6 says resolve it through an audit table and
  explicit review, never a mass delete — and the numbers confirm that is the right call:
  77 of the trail-level visits are involved, so a blind delete would touch most of the
  Appalachian Trail's history.
- **Item 7 removes a whole risk.** `part_of` and `place_membership` already agree exactly,
  so the §0.3 migration off `part_of` is a rename of the source of truth, not a
  reconciliation. `trail_section` still has to be added to `relationship_type`.
- **Item 10 removes another.** There are **no** `source='drawn'` activities, so the
  `trail_routes` migration has no ambiguous legacy rows to classify — §0.5's "migrate
  current drawn rows carefully" is a no-op on this dataset.
- **Item 1 means the planned-visit rules are untested by real data.** 0 planned visits
  exist, so §0.9's planned/cancelled tests must be built on fixtures.
- **Item 4 is smaller than it looks.** None are deleted or suggested; all 7 are
  `saved = false` auto-created admin areas. They need a decision, not a cleanup script.
- **Item 6:** the tables are empty but still present, so §0.7's removal is safe whenever
  the parity phase completes.

**§0.7's first requirement is already satisfied:** `detect-trips-nightly` was already
unscheduled (production has three cron jobs — `dedupe-joint-outings`, `purge-trash`,
`rebuild-revealed-area`), and the Edge Function deployment was deleted 2026-08-12. It
cannot run during the migration because it no longer exists.

**VISUAL REFERENCE — RESOLVED BY ERICA, 2026-08-12: "it is acceptable."** The published
artifact source (held locally, and the same content the artifact serves) is the approved
visual reference for §0.6. Screenshots of the authenticated page were never obtainable
here; that is recorded below rather than papered over, and her decision closes it.

**⚠️ Why it was blocked, for the record — not done by Claude, not claimed.** The authenticated artifact
`7d3ec882…?via=auto_preview` returns *"Page not found – Claude / Sign in"* to this
browser, and the content frame (`…frame.claudeusercontent.com`) 404s unauthenticated. The
HTML Erica pasted is the claude.ai shell, not the card — the card renders inside a
sandboxed iframe. Claude published that artifact and still holds its exact source, and
rendering that source locally confirms the STRUCTURE matches §2: section order Visits →
Photos and videos → Routes → Notes and reviews, rating under the name, cover with close
control, address line, category pills, Save/Cancel footer, the trail question asked once,
and none of the banned words. **But screenshots cannot be captured in this environment**
(the tool times out), so desktop and mobile rendering have NOT been visually compared.
Per §0.2.2 this is reported, not glossed: **Erica needs to supply screenshots**, or
confirm that the published source is an acceptable reference.

**⚠️ CONFLICT TO NAME — §0.2.6 vs work already merged today.** §0.2.6 says *never edit an
already-applied migration*. Earlier on 2026-08-12, in merged PR #30, migrations `0001` and
`0044` **were edited** — guarded, so a fresh database could apply the chain at all (it was
previously appliable only through `scripts/db-bootstrap.sh`). No object definition changed
and the end state is identical, but the rule was broken before it existed. Recorded here
rather than left for someone to discover. From now on: new sequential migrations only.

### 0.4a PARITY PROVED — on a production-shaped snapshot, 2026-08-12

§0.8 phase 4. Today's encrypted backup was restored into a disposable **Postgres 17**,
the idempotent backfills were run against that real data, and the old counting was
compared with the canonical `accepted_visits` + `visit_profiles` model.

| Scope           | Places old → new   | Visits old → new   | Trips old → new  |
| --------------- | ------------------- | ------------------- | ----------------- |
| **Both**  | 52 →**52**   | 101 →**101** | 16 →**16** |
| **Erica** | 128 →**128** | 442 →**442** | 42 →**42** |
| **Josh**  | 57 →**57**   | 148 →**148** | 29 →**29** |

**Every number matches. There is no intentional difference to explain yet** — which is
the point of doing this before switching any reader: the new model reproduces today's
answers exactly, so a later change in a number will mean a real decision rather than an
accident.

Backfill results on that snapshot:

- **participants:** 590 rows across all 489 visits, 2 real members, **0 sent for review**
- **activities → visits:** **445 linked, 0 ambiguous, 0 with no covering visit**

The zero-ambiguity result is worth stating plainly, because the 78 known trail/member
same-day pairs were expected to produce two candidate visits. They did not: each
activity sits at ONE place, and the duplicate pairs are a trail visit and a *section*
visit — different places — so the "same place, covering day, exactly one candidate" rule
never had to choose. The duplication is still there and still needs §0.5.6's review; it
simply does not corrupt the activity links.

**A disaster-recovery bug was found and fixed doing this.** `jsonb_populate_record`
leaves a column that is absent from an older dump as NULL — it does **not** apply the
column default — so the moment `0163` added NOT NULL columns, restoring **any earlier
backup** died with *"null value in column trip_marked violates not-null constraint"*.
The backup you need is always older than the schema you restore onto, so this would have
bitten precisely when it mattered. `scripts/verify-restore.sh` now inserts only the
columns the dump actually contains and lets the schema default the rest, and reports
which columns were newer than the backup.

### 0.5a READERS SWITCHED — parity held, 2026-08-12

§0.8 phase 5. `wander_stats` and `trips_list` now read the canonical model, and the
numbers did not move — measured again through the live functions against a restored
production snapshot:

| Scope | Places        | Miles  | Trips        |
| ----- | ------------- | ------ | ------------ |
| Both  | **52**  | 436.5  | **16** |
| Erica | **128** | 1956.8 | **42** |
| Josh  | **57**  | 992.6  | **29** |

`trips_list(null)` returns exactly 16 rows — the list and the count now come from the
same definition and cannot disagree.

**A hardcoded household size was caught by the test suite.** The obvious translation of
`solo_profile IS NULL` was "exactly two participant rows" — which bakes in that this
household has two people. `0137` failed immediately: *"marking a visit as a trip must add
one trip (0 -> 0)"*, because a test database does not happen to contain two members.
The honest rule is about membership, not arithmetic: **a visit is shared when every real
member was on it** (`public.is_shared_visit`). Two members gives exactly the 101 that
`solo_profile IS NULL` gave; one gives that person's visits; three gives what all three
shared. Nothing hardcodes 2 — which matters, because adding a third person is the entire
point of the shared-group work.

The same mistake was in the WRITER trigger and was fixed there too: `NULL` means "not
solo", so it now populates every real member when the household is small enough for that
to be unambiguous (one or two), and sends the row to review at three or more rather than
guessing which two were meant.

### 0.7a APPLIED TO PRODUCTION — 2026-08-13

§0.8 phase 7. Migrations `0163`–`0169` are live. **Parity held exactly.**

| Scope | Places              | Visits              | Trips             |
| ----- | ------------------- | ------------------- | ----------------- |
| Both  | 52 →**52**   | 101 →**101** | 16 →**16** |
| Erica | 128 →**128** | 442 →**442** | 42 →**42** |
| Josh  | 57 →**57**   | 148 →**148** | 29 →**29** |

Measured on production before the migration with the OLD rules, and after it through the
CANONICAL model. Not one number moved, which is the whole point of phases 3–6.

**Migration ledger versions recorded** (the Management API runs SQL and records nothing —
the 2026-08-11 audit found eight applied-but-unrecorded migrations, and a restore rebuilds
from this ledger):

    20260813170000  0163_visits_gain_a_spine
    20260813170001  0164_add_an_activity
    20260813170002  0165_who_was_there
    20260813170003  0166_evidence_and_trail_routes
    20260813170004  0167_link_activities_to_their_visit
    20260813170005  0168_the_numbers_read_the_canonical_model
    20260813170006  0169_one_way_to_change_a_visit

**Backfill results in production:**

|                              |                                                             |
| ---------------------------- | ----------------------------------------------------------- |
| participant rows             | **590** across all 489 visits, **0 for review** |
| activities linked to a visit | **445 of 445**, **0 ambiguous**, 0 orphaned     |
| evidence rows                | **620**                                               |
| accepted visits              | **489** — all of Erica's history                     |
| dropdown options seeded      | **8**                                                 |

**Frontend state:** `15458752` — unchanged, and deliberately so. The app still writes visits
directly; both spellings of every field stay in step during the compatibility period, so
this migration is invisible to anyone using the site. `verify:live` confirms it: the same
**18 checks pass and the same 4 fail** as before, and the 4 are the UI work that has not
been built yet, not regressions.

Types regenerated from the deployed schema; `tsc` clean; 112 unit tests pass.

**Pre-migration backup**, taken and PROVEN restorable first:
`db/2026-08-13/pre-phase7-aon-db-2026-08-13.tar.gz.age` — 18,838 rows, all 38 tables
matching on restore into a disposable Postgres 17.

### 0.3 Target database model

#### Places

`places` remains the identity table for every real location. A city, restaurant, beach,
trail, trail section and destination are places. Keep stable IDs and existing media links.

- A normal place or trail section counts once after it has an accepted, taken visit.
- A trail rollup does not count as another Place; its visited sections already count.
- A deleted, suggested, rejected or otherwise unaccepted place never contributes to
  historical statistics.
- `counts_as_place` may remain a generated compatibility field, but statistics must use the
  canonical accepted-place view rather than trusting miscellaneous cached flags.

#### Visits

Add the following fields additively to `visits` (use exact types and constraints appropriate
for Postgres; names below are the contract):

```text
parent_visit_id  uuid null references visits(id) on delete set null
trip_marked      boolean not null default false
source           text not null  -- manual | evidence | import | approved_suggestion
accepted_at      timestamptz null
accepted_by      uuid null references profiles(id)
updated_at       timestamptz not null
```

Migrate the meaning of the existing `is_trip` human decision into `trip_marked`. During the
compatibility period, keep one synchronized interface or compatibility view; do not leave two
writable trip flags. Remove the old column only after all code and production data are proven.

Constraints and guarded RPC logic must enforce:

- `end_date >= start_date`;
- a visit cannot parent itself;
- parent chains cannot cycle;
- a child visit must fall inside its parent visit's date range;
- a parent must be accepted and `status='taken'` before taken children can be attached;
- participant compatibility must be checked when a child is attached;
- automation cannot write `parent_visit_id`, `trip_marked`, participants, accepted fields, or
  other human decisions directly. It creates a suggestion.

One canonical SQL function/view defines trip qualification:

```text
counts_as_trip =
  status = 'taken'
  AND accepted_at IS NOT NULL
  AND (end_date > start_date OR trip_marked)
```

Every trip number, list, card drill-down and containment reader must use that definition.
No UI component may reimplement it.

#### Participants

Replace null-as-data attribution with explicit rows:

```text
visit_profiles(visit_id, profile_id, created_at, primary key(visit_id, profile_id))
visit_people(visit_id, person_id, created_at, primary key(visit_id, person_id))
```

`visit_profiles` is for account holders such as Erica and Josh. `visit_people` remains for
children, pets and companions without accounts. Backfill `visit_profiles` from
`solo_profile`: a non-null value becomes that profile; null becomes the two currently active
member profiles only when the legacy row truly meant Both. Put ambiguous rows into a review
table; never guess additional participants.

Keep `solo_profile` read-only during compatibility, compare old/new counts, then remove it and
all null-special-case filters in a later migration.

#### Visit evidence

Create an auditable evidence relationship:

```text
visit_evidence(
  visit_id,
  evidence_type,   -- photo | activity | location_ping | entry
  evidence_id,
  evidence_date,
  source_key,
  created_at,
  primary key (visit_id, evidence_type, evidence_id)
)
```

Use database validation or typed link tables if needed to preserve referential integrity.
Every derived visit must be explainable from its evidence. Moving or deleting evidence queues
a reconciliation proposal; it must not silently rewrite an accepted visit. Imported evidence
needs a stable, unique `source_key` so retries are idempotent.

Add `activities.visit_id` and link an activity to the accepted visit it occurred during.
Photos already have a visit link. Routes, photos, entries and notes displayed on a visit card
must be selected by visit identity, not merely by an overlapping date.

#### Canonical relationship and mutation APIs

- `place_membership` is the only canonical place hierarchy. Extend its
  `relationship_type` to include `trail_section` as well as general containment, and add an
  optional per-parent display label/order only if the preview requires it.
- Move every reader and writer from `places.part_of` to `place_membership`, verify parity,
  then remove `part_of` and its mirroring triggers in a later migration.
- Revoke direct authenticated writes to canonical visits and relationship tables after the
  frontend has moved to atomic RPCs.
- Provide atomic, authorized RPCs for creating a place with its first visit, creating a visit,
  editing a visit, deleting/restoring a visit, moving a visit, setting participants, attaching
  or detaching a child visit, and attaching evidence.
- Every RPC must be idempotent, permission-checked, transaction-safe, and return the refreshed
  card/read model. A dropped connection must not create a duplicate visit.

### 0.4 Canonical counting rules

Create one accepted/taken visit view and make all stats, badges, lists, cards, Smart Albums and
exports read it.

| Number           | Exact rule                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| Places           | Distinct accepted, nondeleted, non-trail places with at least one accepted taken visit |
| Place visits     | Accepted taken visits whose`place_id` is that place, including child visits          |
| Headline Visits  | Accepted taken visits with`parent_visit_id IS NULL`                                  |
| Trips            | Top-level accepted taken visits satisfying canonical`counts_as_trip`                 |
| Planned          | Accepted`status='planned'`, shown separately and never in historical totals          |
| First/last visit | `min(start_date)` / `max(end_date)` over accepted taken visits                     |
| Miles            | Sum accepted activity distance once per stable/shared source identity                  |
| Trails taken     | Distinct trail rollups with an accepted taken visit on the trail or a member section   |

A Cape Cod Aug 2–7 parent visit containing Linnell Landing, a restaurant and a museum is one
headline Visit, one Trip, and four distinct Places. Each child place still shows its own visit.

Stop using `places.visit_count`, `first_visit` and `last_visit` as independent facts. Prefer
the canonical view at the current dataset size. If performance later requires caches, they
must be maintained for insert/update/delete/restore/move and proven against the view in tests.

All `SECURITY DEFINER` stats functions must explicitly filter authorization, acceptance,
`status`, `deleted_at`, draft/suggestion state and participants. Never assume RLS filters rows
inside a definer function.

### 0.5 Working trail model

A trail is a place rollup, not an outing and not an activity.

```text
Trail place (does not increment Places)
└── place_membership relationship_type='trail_section'
    ├── Section place (counts as a Place when visited)
    └── Trailhead/section place (counts as a Place when visited)
```

Rules:

1. A real outing has one canonical visit row. If the section is known, `visits.place_id` is the
   section. Do not also create a visit on the parent trail. If the section is unknown, the
   visit may temporarily belong directly to the trail and be moved later through an RPC.
2. A trail card rolls up visits, activities, photos and miles from the trail and its member
   sections. Deduplicate by stable visit/evidence/activity identity, never merely by calendar
   day: two genuine outings on one day are still two visits.
3. The visit row on a trail card displays the section name from canonical membership. There is
   no separate Sections list on the card.
4. `trails_taken` counts a trail once if any qualifying direct or member visit exists. A trail
   itself does not increment Places; visited section places do.
5. Expand `place_membership` queries recursively only where nested trail structures are
   intentionally supported, with cycle prevention and bounded depth.
6. Resolve the known trail/member duplicate data through an audit table and explicit review.
   Do not mass-delete manual visits. Future ingest must attach duplicate evidence to the same
   visit instead of creating trail-level and section-level twins.

A drawn trail definition is not a completed activity. Create a separate table for reference
geometry:

```text
trail_routes(
  id,
  trail_place_id,
  section_place_id null,
  name,
  geometry/polyline,
  distance_m,
  source,            -- drawn | osm | import
  created_by,
  created_at,
  updated_at
)
```

Actual hikes, walks, runs and rides remain `activities`, link to `visit_id`, and contribute
miles. A reference `trail_route` draws the trail but never creates a visit or adds mileage.
Migrate current `source='drawn'` rows carefully: classify them from usage and put ambiguous
ones in review rather than assuming they are reference paths or completed outings.

Expose one `trail_card(place_id, viewer_profile_id)` RPC/read model returning the trail header,
canonical visit rows with section names, participant-scoped counts, actual activities, reference
geometry, media and totals. The frontend must not reconstruct trail rollups independently.

### 0.6 Card implementation — keep the style, fix the contract

The authenticated artifact above is the visual reference. Preserve the locked structure:

1. cover with close control;
2. name over the cover;
3. ratings immediately beneath the name, two columns when two raters exist;
4. address and a human sentence such as “Visited twice · 12 photos” or visit dates;
5. category pills, excluding city/region pills;
6. sections in this order: **VISITS**, **PHOTOS AND VIDEOS**, **ROUTES**, applicable place
   categories such as **RESTAURANTS**, then **NOTES AND REVIEWS**;
7. footer actions. Destination/trail: “Add another visit” and “Delete”. Blank card: Save and
   Cancel. Visit editor: Save and Cancel, with destructive actions visually separated.

Build one shared card shell with typed modes (`place`, `visit`, `activity`, `trail`, `new`).
Do not keep one enormous component full of mode-specific queries. Separate presentation from
backend adapters, and pass a stable card view model into the shared shell.

Backend/card contract:

- Add a versioned `experience_card`/`visit_card` read RPC or equivalent typed query returning
  the complete mode-specific view model. Avoid dozens of browser requests and frontend joins.
- Header totals and list rows come from the same returned dataset so labels cannot disagree.
- Every row has stable IDs and explicit `can_edit`; do not infer permissions in JSX.
- Loading, empty, saving, saved, error and stale-suggestion states must be visible and usable.
- Preserve unsaved input after an RPC error. Never silently catch a failed write and render an
  empty list as the current helpers do.

#### Destination card

- Visits are grouped by year, newest first; only years with visits appear.
- Each visit row shows formatted dates, participant names and a quiet evidence summary.
- A qualifying parent visit may show “3 places” and expand its explicit child visits.
- Do not show passive “Trip” badges. Qualification changes presentation only through the
  explicit nested contents and trip statistics.
- “Add another visit” opens the inline visit form and saves through one atomic RPC.

#### Visit card/editor

- Scope every section to `visit_id`: media, routes/activities, notes, reviews and child places.
- Use an explicit Save action for the complete edit. Do not autosave start and end dates as
  separate writes; an intermediate invalid range must never reach the database.
- Fields: date range, `planned/taken/cancelled` status if cancelled is added, participant
  multi-select, note, “Count this as a trip” switch, optional parent trip selector, and child
  visit management when this visit qualifies as a trip.
- The switch writes `trip_marked`; a multi-day visit qualifies without setting it. Explain
  this in helper text: “Multi-day visits already count. Turn this on only for a single-day
  trip.”
- Attaching a child opens a search of existing visits first. Creating a new child visit is a
  secondary action. Never create a duplicate place merely to add it to a trip.
- Show evidence read-only with its source and date. Corrections use explicit move/detach
  actions that create auditable writes.

#### Trail card

- Use the exact shared visual shell and section order.
- The sub-line reads naturally: “Visited 35 times · 44.8 miles · 27 photos”.
- VISITS contains direct and member-section visits once each; the section name sits on its
  visit row. No Sections list.
- PHOTOS AND VIDEOS rolls up media linked to those canonical visits.
- ROUTES shows a map and list of actual activity routes; reference trail geometry may appear
  as map context but must not be counted as an outing or miles.
- Do not show Restaurants on a trail card unless Erica later explicitly approves it.
- “Add another visit” asks for date(s), participants and an optional section. “Add/edit trail
  route” is a distinct edit action because drawing the trail is not logging an outing.

#### Blank/new card

- Same shell with empty fields, not a separate form design.
- Ask “Is this a trail with sections?” once. If yes, create the trail place and optional
  reference route; create a first visit only when the user supplies an outing date.
- For a normal place, saving with a supplied date creates the place and first visit atomically.
- Address is prefilled from the tapped map location and remains editable.

Accessibility and responsive acceptance:

- mobile width 320–430 px and desktop;
- keyboard-accessible disclosures and controls;
- visible focus, proper labels, `aria-expanded` and `aria-pressed` where appropriate;
- 44 px touch targets for primary actions;
- no color-only status; no modal hidden behind the map/search stacking context;
- existing typography, colors and spacing tokens are reused instead of introducing a second
  design system.

### 0.7 Automation and legacy cleanup

The first production migration must unschedule `detect-trips-nightly`. The current Edge
Function writes retired trip-places and visits directly; it must not run during this migration.
Its replacement may create `suggestions` with evidence and confidence, but may not mutate
places, visits, membership, participants or statistics.

After parity and production verification, remove:

- orphan `trip_people` and `trip_notes` plus their grants, policies, helpers and generated
  types;
- dead `trip_timeline`/trip-note frontend helpers;
- legacy trip-category code and scheduled detector;
- direct visit mutation helpers;
- `places.part_of` and sync triggers after every reader uses `place_membership`;
- `solo_profile` after participant parity;
- misleading comments and tests describing superseded rules.

Search the entire repository, including Edge Functions, cron migrations, generated types,
tests and `docs/STATE.md`; cleanup is not complete while an executable retired mechanism or
contradictory current instruction remains. Historical passages may remain only when clearly
marked superseded.

### 0.8 Required migration sequence

Do not ship this as one destructive migration.

1. **Freeze and measure:** unschedule the detector; backup; production read-only audit.
2. **Add:** new columns, participant/evidence/trail-route tables, constraints, indexes, RLS and
   RPCs. No old column/table removal.
3. **Backfill:** idempotently populate participants, accepted state, evidence and memberships;
   quarantine ambiguity.
4. **Prove parity:** old/new counts by Both/Erica/Josh, cards for representative destination,
   multi-day visit, single-day marked visit, trail, planned visit, deleted place and draft.
5. **Switch readers:** canonical views/RPCs, then frontend card and all stats/badges/exports.
6. **Switch writers:** atomic RPCs only; revoke direct authenticated writes.
7. **Observe:** deploy preview, complete authenticated mobile/desktop verification, then
   production. Re-run counts and inspect logs.
8. **Remove:** only after explicit production sign-off, remove legacy schema and frontend code
   in a later migration.

Every phase is its own commit with a plain-language message. Do not mix backup/Cloudflare/GitHub
workflow repairs into the schema commits. Do not deploy production while required CI is red.

### 0.9 Tests that make the decision permanent

Database tests must prove at least:

- planned/cancelled visits do not affect historical counts;
- deleted, suggested and unaccepted places do not count;
- a multi-day visit appears in both trip count and trip list and can own explicit children;
- a marked single-day visit counts as a trip;
- unmarking it reverses only that human decision;
- child visits count on their place cards but not as extra headline Visits;
- a Josh-only parent cannot swallow an Erica-only child;
- parent cycles and out-of-range children are rejected;
- two real same-day outings remain two visits;
- an idempotent retry remains one visit;
- moving/deleting/restoring a visit updates every relevant read model;
- first/last dates can move inward and clear;
- evidence deletion cannot erase an accepted decision;
- one trail-section outing is one visit, one trail outing and one activity distance, never a
  parent/section twin;
- reference trail geometry adds zero visits and zero miles;
- `place_membership` cannot dangle or cycle;
- anon cannot execute mutation or private read RPCs; viewer/editor/owner rules remain intact.

Frontend tests must prove the shared card order and banned content, plus:

- destination, visit, trail and blank modes render the same shell;
- counts and rows use the same backend payload;
- visit Save is atomic and errors preserve input;
- participant multi-select round-trips explicit rows;
- trip children are explicit, editable and never date-inferred;
- trail visits show section names without a Sections list;
- planned visits are visibly planned and absent from historical totals;
- the card passes the existing accessibility suite at mobile and desktop sizes.

Run the full local migration chain from an empty database, all SQL regression tests, generated
type checks, unit/component tests, production build and the deliberately small browser smoke
suite. Do not delete meaningful tests to make CI faster; move volatile pixel/copy assertions
out of required CI while retaining data-contract, accessibility and core-flow coverage.

### 0.10 Definition of done

Claude must not say this is complete until all of these are true:

- one current model in this file and no executable contradictory mechanism;
- clean migration from empty database and from a production-shaped snapshot;
- old/new parity report reviewed, with every intentional count difference explained;
- detector disabled or proposal-only;
- no direct frontend writes to canonical visit/membership state;
- generated Supabase types match the deployed schema;
- destination, visit, trail and blank card verified against the authenticated artifact on
  mobile and desktop;
- GitHub required checks green;
- Cloudflare preview shows the same tested commit;
- production migration and deploy IDs recorded here;
- post-deploy read-only counts and representative cards verified;
- backup restoration instructions still match the final schema and no longer list retired
  `trips`/`trip_stops` tables.

If any of those is missing, report **in progress** or **blocked**, name the exact gap, and do
not start another redesign.

---

## 1. What the app is

The current deployment is Erica and Josh's private proof of the commercial product: a map
of where a user has been, built automatically from photos, location and connected activity
sources — so that **going somewhere is enough to have it recorded**. No data entry as the
price of admission.

The product answers: *where have I been, when, who was with me, what did we do, what did it
look like, and what can we do next?* Users can create and discover nearby events, invite
specific people or publish an open invitation, and communicate safely around those plans.

The deployed prototype remains invite-only with no public pages. The product being designed
is commercial and multi-tenant; new work must obey the approved people/events/privacy
directive at the top rather than extending household assumptions.

---

## 2. THE SYSTEM — LOCKED, 2026-08-11

> Erica: *"Make sure you understand it and everything in STATE.md, memory, and history
> understands the system — by system, I mean the way that visits and places are recorded and
> statistics are gathered. I DO NOT WANT TO KEEP REBUILDING THIS."*
>
> **This is the definition. Everything — schema, RPCs, stats, cards, memory — answers to it.**
> If code disagrees with this section, the code is wrong.

### The three nouns

**PLACE** — somewhere she has been. **Counts ONCE in Places**, however many times she goes.
Adding a place is already its first visit.

**VISIT** — **one date, or one set of dates.** Never a scattered collection. **Counts every
time.** A second visit to the same place makes it *a place visited twice*; it does not make a
second place.

**ACTIVITY** — a hike, ride, walk or run. **An activity IS a route.** It lives in the Routes
section, labelled by what it was. It is not a pill, not a tag, and not its own section.

### TRIP — counted, never labelled

**A visit of more than one day counts as a Trip in the stats bar. Nothing is labelled a trip,
anywhere.**

⚠️ **This looks like a rule that was deliberately removed, and the difference matters.**
Migration `0047` made `visits.is_trip` a GENERATED column (`end_date > start_date`), which
promoted every multi-day visit to a trip *by arithmetic* — **50 of 485 visits were flagged
trips Erica never marked**, and the flag then drove labels and fusing behaviour. That is why
§10 says never to reintroduce a derived `is_trip`.

What is being asked for now is **not that**:

| Removed in 0133                               | What Erica asked for, 2026-08-11                                     |
| --------------------------------------------- | -------------------------------------------------------------------- |
| A**stored flag** on the visit row       | **No stored flag**                                             |
| Drove UI labels ("· Trip")                   | **Nothing in the UI says Trip** — already removed from Visits |
| Changed rebuild fusing behaviour              | **Changes nothing but a number**                               |
| Could be wrong about a specific visit forever | A count, recomputed from the dates every time                        |

So: **the stats bar counts visits whose end date is after their start date. No column, no
label, no behaviour.** That satisfies both her instruction and the reason 0047 was reverted.
**✅ DONE AND VERIFIED LIVE, 2026-08-11** (`a4f10ed1`, migrations `0159` + `0160`). The bar
now reads **16 trips** in the shared view, and tapping it opens all 16 in her format:
"Cape Cod · 8/2 - 8/7 · 5 nights".

The jump, measured after the fact rather than estimated: **Erica's view 9 → 42**, **Both
8 → 16**, **Josh 8 → 29**. (The earlier note here said 9 → 52; that counted every visit
row, including ones the stats bar excludes — it only counts `status='taken'` and the
current person scope. 52 is the *places* number.) Most multi-day stays were never marked;
the jump is the intended effect and is recorded here so nobody later "fixes" it back.

**TWO RULES COLLIDED, and both are honoured.** Deriving Trips purely from the dates would
have silently uncounted **three visits marked as trips BY HAND on a single day** — an
automation erasing a human decision, which is what `0157` exists to prevent. So the rule
is: **more than one day, OR marked by hand.** Nothing is erased and nothing needs a label.
Erica: if you want those three to stop counting, unmark them and the number follows.

`is_trip` stays as a thing a person may set — it just stopped being *required* for the count.

### How statistics are gathered

| Stat             | Counts                                                                           |
| ---------------- | -------------------------------------------------------------------------------- |
| **Places** | Distinct places visited —**each place once**                              |
| **Visits** | Every visit, every time                                                          |
| **Trips**  | Visits spanning**more than one day** — derived at read time, never stored |
| **Miles**  | Sum of activity distance                                                         |
| **Routes** | Activities with a track                                                          |

### What every card shows

- **A cover photo on every card.** An activity with no photo shows **the letter of the
  activity** instead — H for hike, R for run, B for biking, W for walking. A letter, because
  there are no icons.
- **The rating under the name**, in **two columns — one line across when there are two
  raters**. Anyone added to the card can rate it.
- Everything on a **visit** card is scoped to that visit. The **destination** rolls up every
  visit.

### THE CARD — LOCKED, approved 2026-08-11

> Erica: **"never redesign the card or add or delete anything from its template without
> my EXPRESS permission and approval of a preview."**

Approved preview (v5): https://claude.ai/code/artifact/8dafa822-fca5-460b-a58f-c914e89cdb97

**This section is the record of what she approved.** It was missing from STATE.md until
2026-08-11 — the one thing she locked was not written down anywhere, which is exactly how
a card gets rebuilt wrong. It is transcribed from the approved preview, not reinvented.

**ONE card. Five things use it and nothing about the template changes between them:**
a destination, a visit, an activity, a trail, and a blank new one.

**Top to bottom, always in this order:**

1. **Cover photo**, with × to close. No photo and it is an activity → **the letter of the
   activity** (H hike, R run, B biking, W walking). Never an icon.
2. **The name**, over the cover.
3. **Ratings, directly under the name** — one row per rater, `Name ★★★★★`, laid out in
   **two columns so two raters read as one line across**. A third wraps to the next line.
   Dim stars mean not rated yet. Anyone added to the card gets their own row.
   *(Her last note on the preview: reduce the space between the name and the stars.)*
4. **The address**, then a **sub-line** saying what this is in plain words:
   "Visited twice · 12 photos" · "Visited 62 times · 44.8 miles · 27 photos". On a VISIT
   card the sub-line is that visit's dates. Never a raw flag or a count with no noun.
5. **Category tags** as pills — Dining, Beach, Winery. **Never city or region pills.**
6. **The sections**, each headed by a **blue rule with an UPPERCASE WHITE heading**, and a
   quiet count or scope on the right ("12 · every visit"):| Section                     | Holds                                                                                                                                                              | On a VISIT card          |
   | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
   | **Visits**            | Years as**dropdowns** (Show / Hide), newest first, only years that have visits. Inside, one line per visit: the date, and the segment name if it is a trail. | the one visit            |
   | **Photos and videos** | ONE carousel, in date order, each with its date and the ♥ / 🔥 marks                                                                                              | scoped to the visit      |
   | **Routes**            | A map showing**every route from every visit**, then the list: name · type · miles · date. **Hikes, biking, walking and running all live here.**     | only that visit's routes |
   | **Restaurants**       | name + stars. Not on a trail card.                                                                                                                                 | scoped to the visit      |
   | **Notes and reviews** | note + date, and "Write a note or review" at the bottom                                                                                                            | scoped to the visit      |
7. **The footer**: "Add another visit" · "Delete". On the blank card: **Save · Cancel**.

**The blank (new) card** is the same card with the fields empty: "Add a cover photo",
"Name this place", the address **prefilled from where you tapped and editable**, and one
extra question asked **once, here only** — *"Is this a trail with sections?"* Its Visits
section says **"this is visit one"**, because **saving a new place IS its first visit**.
Routes and Restaurants say "Added once this first visit is saved".

**Gone from every card, and it stays gone:**

- the **Activities** section — hikes, rides, walks and runs are **routes**, and live in Routes
- **activity pills**
- the words **"Tap a date"**, **"Trip"** and **"Together"**, out of the Visits section entirely
- the **Sections** list on a trail — a segment name rides on the visit, so a trail's Visits
  section reads exactly like every other card's
- **"This is a Trail"** on a destination/visit card
- **city and region pills**, **"N places inside"**, **"+ Put a place inside this one"**,
  the blue **"+ Write a note"** link, and the **PLACES HERE** section

**Dates, everywhere on the card** (implemented once in `app/src/lib/visitDates.ts`, tested):
a single date is **"May 2"**, a range is **"5/4 - 5/7"**, and dates are **grouped by year**.

#### Building it — status 2026-08-11 (destination card)

Verified live on adventureorno.com, San Diego, deploy `cef831d0`:

| Locked                                                                                   | Live                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Section order: Visits · Photos and videos · Routes · Restaurants · Notes and reviews | ✅ (was Visits · Photos · Notes · "Routes here")                                        |
| Routes holds the map**and** the list (name · type · miles · date)               | ✅ 6 routes listed under the map                                                           |
| Restaurants is its own section, plural                                                   | ✅ "Restaurants (2)", "Beaches (1)" — they were folds inside Notes                        |
| No "Places" section                                                                      | ✅ removed;**3 places app-wide have no category and need one** (Fort Rosencrans + 2) |
| The name, then the rating under it                                                       | ✅ (the stars were above it)                                                               |
| Sub-line says what this is                                                               | ✅ "Visited once · 12 photos" (was "· 1 visit")                                          |
| A single date "May 2", a range "5/4 - 5/7"                                               | ✅ everywhere on the card, via`lib/visitDates.ts` (tested)                               |
| No "Trip", no "Together" in the Visits section                                           | ✅ both gone; the who-was-here control says "Both"                                         |
| Photos: one carousel, the marks on it                                                    | ✅ (`0913f05d`)                                                                          |

**Still to build on the card — CHECKED AGAINST THE CODE 2026-08-15.** This list was
written 2026-08-11 and had gone stale: six of its seven items are built. Leaving it
standing is how work gets done twice, which §0.7 exists to prevent.

| Was on the list                                                       | Now                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Years as dropdowns** inside Visits                            | ✅`.visit-year` details, newest open, asserted in `lockedCard.test.ts`     |
| **Ratings in two columns**, anyone on the card rates it         | ✅`.dual-rating`, one line across, mapped over every member                  |
| **Category pills** show the whole palette when you can edit     | ✅ the full`CATEGORIES` palette when `canEdit`, this place's tags when not |
| The**VISIT card** carries every section, narrowed to that visit | ✅**BUILT 2026-08-28** (`d3121d8`). `VisitPage` is `.panel.visit-card` — the same `CardCover`, the same `details.visits-details`/`visit-year`/`visit-row` markup as the destination card, the same carousel, Routes instead of "What we did", and the trip's places grouped into the same category sections. The sub-line is that visit's dates, in the locked format. Six guards, proved red-then-green. **Not yet Live-verified.** |
| The**TRAIL card**: no Sections list, segment on the visit       | ✅ asserted in`lockedCard.test.ts`                                           |
| The**BLANK card** — Add opens it                               | ✅**BUILT 2026-08-28** (`6cec2c1`). `NewPlaceDraft` is `.panel.npd-card` — the cover with its slot, the name typed onto it, the rating under the name, the address with an edit, category PILLS, the trail question, then Visits ("this is visit one") · Photos and Videos · Routes · Restaurants ("Added once this first visit is saved") · Notes and reviews, then Save · Cancel. Everything staged; nothing written until Save. Eight guards, proved red-then-green. **Not yet Live-verified.** |
| A**Save button that visibly freezes automation**                | ✅ 2026-08-14, PR#65 — and it says what it froze                              |

**THE CARD, FINISHED — 2026-08-28.** Five items were re-measured against the deployed
bundle that morning; four were built the same day, on branch
`chore/one-document-and-the-card`. Each has a source guard that was **proved to fail
before it passed**, which is the only kind of tick this file now accepts.

| Locked                                                                  | State                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every card has a cover** — a photo, or the letter of the activity | ✅**BUILT** (`4ec7141`).`components/CardCover.tsx`, three states: photo · letter · empty slot. The card used to draw a hero ONLY with a photo and fall back to `.panel-head` — which is what **121 of the 166 live places** got. H hike, R run, **B biking** (Strava says "Ride", which collides with Run), W walking; first letter otherwise. The letter is the place's DOMINANT activity, ties to the most recent. The empty slot opens the gallery's own picker rather than adding a second one. |
| **The VISIT card** is the same card, scoped to one visit          | ✅**BUILT** (`d3121d8`). See the row above.                                                                                                                                                                                                                |
| **The BLANK card** is the same card with its fields empty         | ✅**BUILT** (`6cec2c1`). See the row above.                                                                                                                                                                                                                |
| **The trail is asked ONCE**                                       | ✅**BUILT** (`4ec7141`).`"Part of a trail?"` deleted at her instruction; the toggle is what labels a trail.                                                                                                                                                |
| **Activities can be added on the blank card** (2026-08-12)        | ⚠️**OPEN, AND IT NEEDS HER**. An activity attaches to a VISIT, and a blank card has no visit until Save — which is exactly why the approved preview shows Routes reading "Added once this first visit is saved" on that card. Her 08-12 instruction and the 08-11 preview genuinely disagree. Ask before building either. |
| **Section headings carry their scope**                            | ⚠️**PARTIAL.** The preview reads "Routes · every visit" and "Photos and videos · this visit"; the destination card renders "Routes (6)". The VISIT card says "this visit" already. |

**HOW THE TWO FALSE TICKS HAPPENED, so it does not again.** A tick in this table is the
only thing that decides whether work is finished. Two of them said "built" about
components that had never been written — one naming `AddSheet`, deleted before the tick
was added — and every session after 2026-08-15 read them, believed them, and worked
elsewhere. A tick now requires the evidence beside it: a commit, a file, a passing guard
that was proved to fail first. "Somebody said so" is not one of them, and neither is a
tick without a commit hash.

### Remove anything that rewrites or confuses this

Nothing may re-derive, relabel or overwrite the above. Specifically retired and not to return:
a `trip` place category; a stored/derived `is_trip` driving labels or behaviour; activity
pills; an Activities section separate from Routes; a Sections list (segments are visits with a
segment name); "places here"; City/Region pills; "N places inside".

### The earlier wording of this model, kept for context

Every screen should express the same shape:

> **Place → Visits → The day**

- A **place** is somewhere you went. It **counts once**, however many times you go.
- A **container** is a place that holds other places: a trail, a trip, a city, a region.
  The Appalachian Trail holds Maryland Heights and Bear's Den. A container appears
  **once** and lists each **section once**.
- A **visit** is one date at a place. Visits **count every time**.
- **The day** is what actually happened: photos, the activity, the route, the note, who
  was there.

**Opening a container gives its sections. Opening a section gives its dates. Opening a
date gives the card.** That is the design — the Sections area Erica already likes — and
it applies to trails, trips, cities and regions alike, not just trails.

Attribution (just me / just Josh / both) lives on the **visit**, never on the place: the
same place can be solo one time and shared the next.

### The rule the ingest rebuild exists to enforce

> **A machine may only propose. A person's decision writes, and it is permanent.**

Two corollaries:

- **An edit in the app IS an approval.** Never ask her to confirm the same thing twice.
- **"No suggestion" means leave it alone.** Never blank a value because the machine had
  nothing to offer.

---

## 3. What you can do — ONE DOOR PER VERB

**Revised and people-preview-approved 2026-08-20.** The older “everything folds into
Edit/Add” plan mixed creation, repair, diagnosis and account management. The approved split:

| Destination                          | What belongs there                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Map**                        | Find memories, people and nearby/open events; apply people scope; open event discovery                  |
| **Add**                        | Create/import a memory or create an event                                                               |
| **Insights**                   | Overview, Places and Timeline using one people/time/category filter                                     |
| **Messages / Invitations**     | Utility routes for direct/event conversations, requests, RSVPs and tag approvals                        |
| **Settings → Account**        | Identity, preferences and Map Appearance                                                                |
| **Settings → Integrations**   | Connected sources, connection state and import history                                                  |
| **Settings → Data & Privacy** | Location, sharing, messaging/event privacy, Needs Attention, Data Management, Export & backup and Trash |

`/attention` remains the single repair workflow inside Data & Privacy. Duplicate activities
and places move into it. `/health` may diagnose but never duplicate repair controls. Add may
link to pending repairs after an import, but repair cards do not live there.

`/places/edit` may survive as a bulk spreadsheet. Inline location correction remains part
of photo sorting. Upload/resume UI is transient and disappears when complete.

### Marking something done (her rule, 2026-08-11)

> **This file is updated ONLY after the change is verified live on the app.** Not when the
> code is written, not when it is committed, not when it is deployed — when it has been
> opened on the real site and seen working.

Plans may be written here in advance. **Status** may not: ✅ means seen on the screen.

### EVERY UI CHANGE NEEDS A PREVIEW SHE APPROVES FIRST (her rule, 2026-08-11)

> "From now on, I want a preview of every change to the UI BEFORE you change it, and I
> MUST approve it."

**This is absolute and it comes before shipping speed.** No change to anything a person
can see goes to the site until Erica has seen a preview of it and said yes. Not a
"small" one, not a "fix", not "while I was in there".

What this means in practice:

- Build the preview as a standalone page and send her the link. Wait.
- Backend, migrations, tests, docs and guards do NOT need a preview — they are not UI.
- **Undoing something she explicitly asked to be removed is not a new change**; her
  instruction IS the approval. Do it, and say so.
- If a preview is impractical for something, say so and ask, rather than guessing.

Why: she has now had to give the same UI instructions repeatedly, and the reason each
time was a change that reached the site without her seeing it first. The guard test
(`app/src/lib/lockedCard.test.ts`) stops banned things coming BACK; this rule stops new
ones going in.

### How a new direction gets handled (her rule, 2026-08-11)

> **If a new direction conflicts with this file, say so before acting.** Name the change
> it would make, ask whether that is what she wants, and only then write the decision
> here. Do not silently follow the newer instruction, and do not silently follow the
> older document.

This is not a licence to stop and ask about everything: it applies when a direction
CONTRADICTS something written here. Otherwise keep working (see
[[adventureorno-autonomy]] — she leaves for hours and expects progress).

### Interface rules (hers, non-negotiable)

- **No icons.** Text controls only. Emoji reactions on photos are the one exception.
- **Every map marker is a photo.**
- Evidence on the face of a card — "underfoot at 7 of 9 route points". A suggestion you
  cannot check is just another guess.
- **Transient UI must be transient**: the upload box and "finish importing your Google
  Photos" disappear when they are done.
- One door per action. Not three ways to Add.
- Batch changes and deploy once. No rapid deploys.
- Her recorded distances are the truth. Strava and AllTrails may never overwrite them.

---

## 4. Where the build actually is

### Live and working

- Map, places, visits, photos, videos, activities, trips-as-marked-visits, bucket list,
  timeline, stats with per-person attribution, races, peaks, elevation, weather.
- Strava, file import, phone ingest, Google Photos import.
- **The ingest rebuild, all 8 steps**: the `suggestions` / `approved_fields` ledger,
  `may_autowrite`, the route scorer (OpenStreetMap, measured against 13 real routes),
  the review page, the guard on every machine writer, learned naming rules, photo
  suggestions, and OSM attribution.
- Offline mode (service worker, network-first HTML, immutable assets cached).
- The authz matrix, and anon holding no table grants.
- Accessibility: zero WCAG A/AA violations across the authed routes, nothing allowlisted.
  ⚠️ **This was FALSE from #94 (08-15) to 08-16** — the new-place card shipped an
  unlabelled date input and an unlabelled select, both critical. Found the first time the
  nightly browser suite could run again; fixed the same day. The claim is only ever as
  current as the last suite that actually ran, so read it with the nightly's status.

### Broken or wrong right now

1. ~~**The map is blank.**~~ FIXED 2026-08-10, and it was TWO faults stacked:
   - MapTiler suspended the account for exceeding quota (the idle auto-rotate had no
     stop condition; now bounded to 45s and never while hidden). The basemap is now
     **Mapbox raster tiles** — the OpenStreetMap/Mapbox look Erica asked for — with a
     30k/day tile meter, because through MapLibre Mapbox bills per TILE not per load.
   - **MapLibre 6 broke every worker-backed source.** Vector tiles, GeoJSON sources,
     clusters, routes and fog all silently rendered NOTHING — no error, no console
     message. Reproduced with a one-point GeoJSON source. Reverted to MapLibre 5,
     which CLAUDE.md pins as the stack anyway. Do not upgrade to 6 without checking a
     GeoJSON layer actually draws.
2. ~~**Containers are invisible in Places**~~ — fixed 2026-08-10. Places now lists each
   container once, holding its sections; `lib/containers.ts` decides what a container is,
   under test.
3. ~~**Sections repeat.**~~ — fixed 2026-08-10. Each section is listed once and opens to
   its dates.
4. **Data work is scattered** across six screens with different words for the same thing.
   4b. ~~**THE BIGGEST CONFLICT IN THE REPO: the machine writes visits.**~~ **FIXED
   2026-08-11, migration `0157`.** A person's decision is now permanent by
   CONSTRUCTION, not by remembering a flag: a trigger marks a visit decided whenever a
   signed-in person changes it (`auth.uid()` is null for every machine job, so the
   discriminator is free), pinning a photo marks its visit decided, the rebuild will not
   delete a visit that holds pinned photos, and a pinned photo no longer seeds a day of
   its own. Proven by replaying the destructive case in a rolled-back transaction: an
   unprotected visit holding a pinned photo survived with its photo attached. The
   original diagnosis is kept below because the SHAPE of it will recur.
   ORIGINAL: the machine writes visits.
   `rebuild_place_visits()` DERIVES visits from photo dates, ping dates, activity dates
   and entry dates, and **writes them as fact** — and deletes and recreates them on the
   next run unless `manual = true`. **476 of 488 visits are machine-derived; only 12 are
   protected.** That is the exact opposite of §2's rule, *a machine may only propose*.
   It is also the cause of the Virginia Beach complaint (2026-08-11): the race was
   **22 Mar**, but photos dated 3 Mar, 4 Mar and 20 Jul each produced their own visit, so
   the place reads as three. **34 of 176 photos carry a taken_at of exactly 12:00:00** — a
   placeholder, not real EXIF — so those dates were never trustworthy in the first place.
   §10 (the data model, below) documents the rebuild as intended behaviour, which makes this a
   conflict between the two documents, not just a bug.
5. ~~**Three doors to Add**~~ — fixed 2026-08-10: `/add` is the one door.
6. **Transient UI is not transient** (upload box, "finish importing").
   6b. **THE STRAVA RULE IS NOT ENFORCED IN THE APP** (found 2026-08-16). `0193` built
   `can_see_activity()` and a correct RLS policy, but **31 of the 32 SECURITY DEFINER
   readers of `public.activities` ignore both**, and SECURITY DEFINER bypasses RLS. Every
   count, card and statistic still shows each person the other's Strava-origin activities.
   Josh's personal approval settles it between him and Erica; it does not settle Strava's
   terms, so this is a hard precondition for Phase 7 and for charging anyone. See §7d.
   6c. **Nothing watches whether scheduled jobs SUCCEEDED** (found 2026-08-16).
   `dedupe-joint-outings` failed silently for eight consecutive nights. The watchtower
   probes URLs; `cron.job_run_details` has no reader.
7. **Sorting photos cannot edit the location** — removed 2026-07-26, see §7.

---

## 5. The plan

Each phase ends the same way: **it works when Erica drives it**, a test that fails if it
regresses, and this file records the decision and proof. Not "deployed and probably fine."

**The verification rule (see CLAUDE.md):** every change is opened in the app, on
production, after it deploys. Done means seen on the screen. When the database and the
screen disagree, the screen is right.

### Phase 0 — One source of truth ✅ (2026-08-10)

This file. Every other planning document was archived, then DELETED (2026-08-11). The "removed on
purpose" register in §7 exists so nothing is silently lost again.

### Phase 1 — Stabilize the private core  *(ACTIVE)*

- ✅ **The build FAILS when a required `VITE_*` is empty** (2026-08-11). A Vite plugin,
  `requireClientEnv` in `app/vite.config.ts`, refuses to build without the Supabase URL
  and key, or without at least one map source. Proven by blanking each and watching the
  build exit 1. `scripts/check-env-example.mjs` still only checks DOCUMENTATION — the two
  together now cover both halves.
- ✅ The only live Pages project is `adventureorno-com`; it owns `adventureorno.com` and
  `www.adventureorno.com`. Do not create another project. The earlier two-project notes
  were historical and are superseded by §12b.
- ✅ Production deployment is a GitHub Actions job behind the release gate and the
  `PRODUCTION_DEPLOY_ENABLED` switch. Cloudflare automatic production-branch deployment
  must stay disabled. The workflow builds the exact SHA and verifies it through
  `/version.json`; §6 and §12b are authoritative.
- **Remaining:** make production deployment refuse to run when the repository contains a
  migration that is absent from the production ledger; keep backup freshness visible;
  complete the Erica/Josh acceptance list at the top of this file.

### Phase 2 — Make the model show through ✅ (2026-08-10)

(see above)

### Phase 3 — The approved app structure  *(PEOPLE PREVIEW APPROVED; EVENTS/MESSAGES PREVIEW PENDING)*

Database and RLS contracts come before visible work:

The state of each is marked as of **2026-08-22**. Where a step is not ticked it is because
nobody has proved it, not because somebody decided against it.

1. **NOT BUILT — this is Phase 3b (§3s).** Separate commercial space access from people
   tags, event participation and messaging. Everything below that involves another human
   being is downstream of it: today `is_member()` asks *are you signed in to this
   household*, so there is no "another user" for a tag or an invitation to point at.
2. **Not re-verified.** Finish canonical outings and move aggregating readers onto them.
   §7a-2 defines the step and the guard it needs; `0141` and `0203` cover counting-once for
   the readers they name. Do not tick this without checking every aggregating reader.
3. ✅ **Done (0247–0270).** The universal people registry and memory relationships, with
   existing claims migrated and the profile-only participant tables retired.
4. Add events, audiences, invites/RSVPs, nearby search and exact-location privacy.
   **Downstream of 1 and of friendship.**
5. Add direct/event conversations, message requests, blocking, reporting and notifications.
   **Downstream of 1 and of friendship.**
6. ✅ **Done (0260/0261).** One authorized people/time/category query — the Map, its badges,
   its lines, Insights and all six stats read the same `people_memory_keys` rule.
7. **Half done.** `Map | Add | Insights | Settings` and the people UI are live (§3q);
   Settings' three destinations are next. The event and messaging previews are still
   pending, and those screens are not to be implemented before she approves them.
8. **Partly done.** Old routes redirect (`/places`, `/timeline` → their Insights tab, §3q)
   and every live check is green; the repair cards are not all in Needs Attention yet.

Still required: restore inline `PlaceQuickEdit` while sorting photos, and make upload/resume
UI disappear when complete.

### Phase 4 — A map we own  *(THE GOAL. Mapbox is a stopgap, not the destination)*

**Authoritative implementation plan, 2026-08-14. This block supersedes older cost,
project-status and architecture claims later in Phase 4.**

MapLibre GL JS is the renderer, not the map service. It is open source and has no usage
fee, but storage, requests, geocoding, routing, imagery and operations still have costs.
Use OpenStreetMap-derived vector data packaged as PMTiles from Protomaps. Never point a
commercial app at the community `tile.openstreetmap.org` servers.

Architecture:

```text
MapLibre in the web app
        │ HTTP range requests
        ▼
tiles.adventureorno.com — read-only tile Worker + edge cache
        │
        ▼
Cloudflare R2 — versioned PMTiles, glyphs, sprite and style artifacts

Separate admin/copy Worker — imports and verifies a new snapshot; never serves users
```

Build it in this order:

1. **Inventory before creating anything.** Confirm the one Cloudflare account, the live
   Pages project, `aon-basemap` bucket, current copy Worker/upload state, custom-domain
   ownership and secrets. Reuse or remove intentionally; never create another Pages
   project to escape an unclear configuration.
2. **Choose a right-sized first extract.** Start with the regions Erica and Josh actually
   use plus enough context for their routes. Do not copy a whole planet merely because it
   is available. Record measured file size, request volume and monthly cost; widen coverage
   when the product needs it.
3. **Finish resumable import.** Copy to a versioned key such as
   `maps/planet-YYYYMMDD.pmtiles`, retain progress outside the live object, cap concurrency
   below Worker connection limits, and make retries idempotent.
4. **Build a separate read-only tile Worker.** Support byte ranges correctly, set immutable
   cache headers for versioned assets, restrict CORS to approved origins, expose a health
   endpoint, and never put copy/admin controls on its public routes.
5. **Self-host every visual dependency.** Store glyphs and sprites with the PMTiles/style;
   inspect the browser network panel to prove the rendered basemap does not call Mapbox,
   MapTiler, Protomaps build storage or community OSM tile servers.
6. **Approve the palette before styling production.** Provide Erica with visual previews
   of the same recognizable area, zoom and overlays in at least these three directions:
   `Night Navy` (current dark card tokens), `Ink + Sand` (warmer land and restrained blue
   water), and `Slate + Moss` (charcoal base with muted natural greens). Each preview must
   show roads, water, parks/trails, labels, place markers, a selected marker, a route and
   the card beside the map on desktop and mobile. Record the chosen screenshot or artifact
   link here; hex values alone are not approval.
7. **Integrate behind a source switch.** Preserve map camera, markers, clusters, routes,
   popups and reduced-motion behavior. Keep the current basemap as an explicit rollback
   path until the self-hosted source passes production smoke tests.
8. **Cut over and prove it.** Test known locations and routes, range requests, cache hits,
   mobile use, keyboard access, failure behavior and `/version.json`. Watch errors and R2
   request volume for 24 hours before removing the temporary fallback.
9. **Refresh monthly and on demand.** Import a new versioned snapshot, validate PMTiles
   header and size, render known locations, switch one configuration pointer, retain the
   prior version for rollback, then delete older versions according to retention policy.

Commercial boundary: self-hosting OSM-derived tiles is compatible with a commercial app
when attribution and relevant data licenses are followed. It does **not** provide
geocoding, routing, satellite imagery, traffic or Strava data rights. Keep those as
separate replaceable services and review provider terms before the product charges users.

**Phase 4 is done only when** Erica approves a rendered palette, the production map and
route overlays work for both accounts, third-party basemap calls are absent, attribution
is visible, cost/usage monitoring exists, refresh and rollback are documented and tested,
and the old dependency can be disabled without blanking the app.

#### Historical map research (keep for evidence; do not execute over the plan above)

The point is **not to be limited by somebody else's charges, and not to be switchable-off
by somebody else**. MapTiler proved the second half by suspending the account and taking
every map in the app with it.

**Worth knowing: Snapchat does not do this.** Snap Map runs on **Mapbox** (partnership
since 2017 — Mapbox Outdoors vector data plus Mapbox Satellite, OpenStreetMap
underneath). The look Erica likes IS Mapbox+OSM; Snap simply pays Mapbox at enterprise
scale. Self-hosting is the opposite trade, and it is available to us because Protomaps
publishes the same OpenStreetMap planet as a single file.

**Decided 2026-08-11: the WHOLE PLANET, full detail.**

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| File     | `build.protomaps.com/<date>.pmtiles` — daily OSM planet build, zoom 0–15                  |
| Size     | **137.3 GB** (2026-08-10 build), verified by content-length                             |
| Verified | HTTP 206 range requests,`PMTiles` spec v3, `accept-ranges: bytes`, served from Cloudflare |

**Cost, in R2 — flat, and the whole reason for doing it:**

| Line                                                           | Amount                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Storage 137.3 GB × $0.015/GB-month, minus the 10 GB free tier | **≈ $1.91 / month**                                      |
| Class A (writes): ~1,400 multipart parts, one-time             | free (1M/month included)                                        |
| Class B (reads): 1 per tile served; two people browsing        | free (10M/month included)                                       |
| **Egress**                                               | **$0 — R2 never charges for it**                         |
| **Total**                                                | **≈ $2 / month, flat, no matter how much we look at it** |

Against that, Mapbox through MapLibre bills **per tile request**, which is precisely the
shape of the blowout that cost us MapTiler.

**Getting 137 GB in without touching Erica's Mac.** The planet file is served *from
Cloudflare*, and R2 is *in* Cloudflare, so the copy never leaves their network: a Worker
reads ranges from the source and writes them to R2 as a multipart upload (~1,400 × 100 MB
parts), driven until it completes. No 137 GB download, no 137 GB upload, no overnight
saturation of her connection.

**Steps**

1. ✅ **R2 access** — done 2026-08-11: Erica ran `npx wrangler login` and added
   `CLOUDFLARE_API_TOKEN_MASTER` to `.env.local`, which is verified against both R2 and
   Pages. (`CLOUDFLARE_ACCESS_TOKEN` in that file is NOT a valid API token, and the old
   `CLOUDFLARE_API_TOKEN` name is gone — the deploy docs and skill now say so.)
2. ✅ Bucket `aon-basemap` created, copier Worker deployed
   (`workers/basemap`, `adventureorno-basemap.adventureorno26.workers.dev`), **copy
   running** (started 2026-08-11 13:02 UTC). Measured on the real thing:
   - one 100 MB part takes ~37 s from the source (~2.7 MB/s), so sequential would be
     ~13.5 hours;
   - **8 parts in parallel is the ceiling** — 16 trips Cloudflare's outbound connection
     limit ("Response closed due to connection limit") — and gives ~10 MB/s, so the
     137.3 GB lands in **about 3.7 hours**, once;
   - it is resumable: the Worker keeps its state in the bucket, a failed batch records
     nothing and is simply retried, so `scripts/copy-planet.sh` can be stopped and
     restarted at any point.
3. A tiles Worker serving `/basemap/{z}/{x}/{y}` out of the pmtiles, with edge caching so
   repeat views cost nothing, plus the same budget meter.
4. Self-host the **glyphs** (fonts) and any sprite in the same bucket, or the map still
   calls a third party for its lettering.
5. **The style, authored in the app's own colours** — this is the other half of the point,
   and it is what fixes Erica's "I don't like the colour": the Mapbox basemap is neutral
   grey and does not match the cards. Built against the real tokens:
   `--bg #060a14`, `--bg-2 #0a1122`, `--panel #0e1728`, `--panel-2 #131f36`,
   `--border #1f2d4d`, `--text #eaf1ff`, `--muted #93a6cc`, `--accent #3b82f6`.
6. Cut MapLibre over; Mapbox drops to **failover only**; the meter stays.
7. Verify live, per the rule.

**Still third-party afterwards, and worth naming:** search/geocoding (Mapbox Search Box)
and weather (Open-Meteo). Self-hosting search is a separate decision — Nominatim/Photon
are the options.

### Phase 4b — The map's appearance  *(DONE 2026-08-15)*

#### Where the basemap actually is

Found 2026-08-15, and it was not what the plan assumed:

- The planet IS in R2 — `aon-basemap/planet.pmtiles`, **137.3 GB**, zoom 0–15.
- The Worker serves tiles, glyphs and a style, verified: a z6 tile over Virginia returns
  38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range 76,044 bytes, and
  MapLibre renders Loudoun County with **zero errors**.
- **The zone had zero worker routes registered**, so every `/basemap/*` URL fell through
  to Pages and answered **200 with the app's HTML**. A 200 from the wrong server is the
  worst failure available here — nothing looks broken. Check the content-type.
- The deployed Worker was the **copy-only build from 11 August**; the serving code (#73)
  had never been deployed.
- **AND THE ROUTE WAS NEVER PUBLISHABLE.** `routes = [...]` sat at the END of
  `wrangler.toml`, below `[vars]` — and in TOML a bare key after a table header belongs to
  that table. Wrangler read it as an environment VARIABLE named `routes` and published
  nothing, printing it back as `env.routes ([{"pattern":...)`. That is the whole
  explanation for the zero routes, and it survived because the symptom was a 200.

#### The styles

**Dark is decided: INK** — the card's own palette, so opening a card over the map is one
surface rather than two:

|        |                                                |
| ------ | ---------------------------------------------- |
| ground | `#0e1728` (`--panel`)                      |
| land   | `#131f36` (`--panel-2`)                    |
| water  | `#16324f`                                    |
| roads  | `#22314f` → `#33507f` → `#3f6fae`      |
| labels | `#eaf1ff` (`--text`) on a `#080e1c` halo |

**Light is decided: DAYLIGHT 2** — Google's idiom one notch richer. Ground `#f8f9fa`,
water `#8ccbf9`, parks `#b4dfb4` at 0.85, labels `#3c4043`, white roads over cased
`#dfe4e9` / `#cbd3db` / `#a6b3c0`.

It took five rounds, and each failed for a nameable reason worth keeping:

1. *Pastels* — white roads on a near-white ground with **no casing**, so the road network
   vanished. Roads on a light map need a darker casing under them; this is not optional.
2. *Saturated pastels* — better, still four greys with different tints.
3. *Different treatments* (sepia atlas, green-hero, monochrome-with-one-accent) — rejected
   outright. They changed the treatment and threw away the **contrast**, which is the part
   that was working.
4. *One structure, four rich colour families* — Azure / Emerald / Indigo / Ember. Closer,
   still not it.
5. *A real reference* — Google and Apple. That is what settled it, and it showed what
   every previous round had wrong: **neither of them uses a white ground or saturated
   water.** Google's ground is a cool off-white, its water a sky blue that RECEDES, its
   labels dark grey rather than black. I had been pushing saturation up while the
   references go the other way. Erica picked step 2 of a four-step ladder from there.

**The rules that came out of it:** roads on a light map need a CASING or the network
vanishes; the contrast is fixed and only colour is in question; and when a look is being
argued about, go and measure a real one instead of generating another guess.

#### The lettering (2026-08-15)

Our glyph server publishes **Noto Sans Regular, Medium and Italic**. Bold is NOT published
upstream — it answers 502, and asking for it puts unlabelled tiles on the map with nothing
to say why, so a test forbids it.

|                    | was                               | now                                             |
| ------------------ | --------------------------------- | ----------------------------------------------- |
| Town names         | Regular, +0.02 tracking, 10–17px | **Medium, −0.012 tracking, 11–19px**    |
| Water              | Regular, wide tracking            | **Italic** — the cartographic convention |
| Places of interest | 11px                              | 10.5px                                          |
| Halos              | 1.4–1.6px                        | **1–1.1px**                              |

It lives in the shared layer builder, not in a palette, so every theme has it and no future
one can miss it.

#### Done, in this order

1. ✅ **The light palette** — Daylight 2.
2. ✅ **Both themes from the Worker** — `/basemap/style.json?theme=dark|light`. An unknown
   theme is DARK, not an error: an unreadable map is a worse answer to a typo.
3. ✅ **Settings → Map appearance** — Dark / Light / Match my device, per browser (#88).
4. ✅ **The route** `adventureorno.com/basemap/*` is registered. **Wrangler cannot manage
   it**: `CLOUDFLARE_API_TOKEN_MASTER` is account-scoped and zone routes need
   `CLOUDFLARE_ZONE_ACCESS`, so it was created through the API and wrangler still errors
   on that one step. Do not read that error as a broken deploy.
5. ✅ **`basemap.ts` points at it** (#88), and `basemapOptions` became a FUNCTION —
   as a frozen object it handed every map whichever theme was current at module load.
6. ✅ **The switch is reversible**: `VITE_SELF_HOSTED_BASEMAP='false'` returns the app to
   Mapbox raster with no code change. Phase 4 requires the old dependency to be
   disableable without blanking the app; the reverse has to hold too, or it is a cliff.

**Phase 4 is MERGED, not Live-verified** (corrected 2026-08-16). Steps 1–6 above are all
true of `origin/main` and of the Worker, and the Worker half is genuinely live: a z6 tile
over Virginia returns 38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range
76,044 bytes, both styles serve (12 layers dark, 15 light — the 3 extra are road casings),
an unknown theme falls back to dark, and `/basemap/health` reports the 137.3 GB planet.

**But the app that consumes it never deployed.** Erica, 2026-08-16: *"the map style has
not changed when I looked at it."* She was right. The deployed bundle at `546ff11` still
contains `api.mapbox.com/styles/v1/mapbox/dark-v11` and the frozen `basemapOptions`
object, because #86, #87 and #88 merged AFTER the last successful deploy and CI was
blocked on billing from 2026-08-15 17:47 UTC.

Phase 4's own definition of done requires "the production map and route overlays work for
both accounts" and "third-party basemap calls are absent". Production makes a Mapbox call
for every tile. **It is done when the deploy lands and she says the map looks different.**

The lesson is the one this file keeps relearning in new clothes: *deployed* is a separate
fact from *merged*, and only one of them is visible from a browser.

> ### ✅ PHASE 4 IS LIVE-VERIFIED — 2026-08-16, 21:05 UTC
>
> The deploy landed (`a57a928`) and she said it: ***"the map looks different."***
> The paragraphs above are kept exactly as they were written a few hours earlier, because
> the gap between them and this line IS the record — every one of those checks was green
> while the thing itself was not true.
>
> The deployed bundle now points at `/basemap/style.json?theme=`; the frozen
> `basemapOptions` object and `api.mapbox.com/styles/v1/mapbox/dark-v11` are gone from it.
> **One third-party map call remains and it is not the basemap:**
> `api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1.json` — the elevation model, which §6a-ii
> replaces with Copernicus GLO-30. Anyone grepping the bundle for "are we off Mapbox yet"
> should get that answer, not a clean grep and a wrong conclusion.

#### The style is OURS, not `protomaps-themes-base`

The Worker served that package first, and it is good — generated from the same schema the
planet build uses, so it cannot drift from the data. It was replaced because Erica chose a
look from renders of a HAND-BUILT layer set, and 68 of somebody else's layers wearing our
colours would not have been the thing she approved. **The preview and the product have to
be the same map.** That is also how the first routed response was caught serving 68 layers
at `#34373d`: both themes returned exactly 60,172 bytes, and 12 and 15 layers cannot be
the same size.

**No icons, ever.** The style strips every `icon-*` property and keeps `text-field`; a
first attempt at that filter also dropped `places_locality` and would have removed every
city label, so the guard tests for both.

### Phase 4d — Geocoding we own  *(PLANNED 2026-08-15, nothing built)*

Erica, 2026-08-15: **"I want to use Overture and Photon."** Decided. What follows is how,
and one honest caveat about the order.

#### There are two different jobs, and only one of them is urgent

|                   | What it is                           | Where it happens today                       |
| ----------------- | ------------------------------------ | -------------------------------------------- |
| **Reverse** | a coordinate → a name and address   | the nightly geocoder, and naming a new place |
| **Forward** | typing "Blackwater Falls" → a place | the search box on the new-place card         |

Reverse is the one that runs UNATTENDED and burns quota; forward is human-paced and cheap.
That difference decides the order below.

#### THE CAVEAT: Photon does both, so Overture is not on its critical path

Photon answers reverse AND forward, worldwide, from one index. Once it is running, the
geocoding problem is solved and Overture adds nothing to it.

Overture is still worth having — its **addresses** theme covers places OSM is thin on, and
its **places** theme has better POI categories than the basemap's `pois` layer — but that
is ENRICHMENT, not geocoding. Building both at once would mean running a server and an
import pipeline to answer the same question twice. Photon first; Overture when there is a
gap Photon actually leaves.

#### Photon — the shape of it

- **Java 21+**, and it can run its index embedded: no separate OpenSearch to operate.
- **~60 GB** compressed planet index to download (`db` mode), **~95 GB** on disk, growing
  roughly **10% a year**. (An earlier note in this file guessed 80 GB / 200 GB from
  memory; these are the measured figures.)
- Download and verification take **hours**, not minutes. Plan the first run accordingly.
- Refreshing means fetching a new index; the old one keeps serving until the swap.

**This is the first always-on server in an otherwise entirely serverless stack.** Pages,
Workers, R2 and Supabase are all managed — nobody patches them, nobody watches their disk.
A Photon box changes that, and the honest cost is not the ~€40–60/month for 16 GB RAM and
300 GB of NVMe. It is that something now needs patching, monitoring and an index refresh,
and that when it falls over at 2am the map still works but naming a place does not.

#### Where it sits

    adventureorno.com/geocode/*   ->   Worker   ->   Photon on a VPS (not public)
                                          |
                                          +-------->  Mapbox, while Photon is young

The same shape as `/basemap/*`, for the same three reasons: same-origin so the service
worker can cache it, **no new CSP entry to be silently blocked** — which is exactly how
the Mapbox search died unnoticed — and an origin that can be swapped without touching the
app. Reverse lookups for a rounded coordinate repeat constantly, so the Cache API in front
absorbs most of the traffic.

**Mapbox stays as failover until Photon has proven itself**, exactly as MapTiler is
failover for Mapbox today. That preserves the property this whole phase exists for: not
switchable-off by somebody else.

#### Overture, when its turn comes

- Ships as **GeoParquet** (`geoparquet` at github.com/opengeospatial is the format spec).
- **CDLA-Permissive v2** where possible, with per-source attribution — CC BY 4.0, Apache
  2.0, OGL — listed by theme. **The attribution obligations are per source and must be
  read before the product charges anyone.**
- 474M+ address points globally, which is far too much for the Supabase instance. Import
  is therefore **by region**, driven by where places actually are, and the nearest-address
  query is a PostGIS `<->` lookup against a GiST index.

#### The order

1. **Photon on a box**, reachable only from the Worker.
2. **The `/geocode/*` Worker**, with Mapbox failover behind it and its own spend meter —
   `spendApiCall` already exists and must keep counting, because a meter that stops
   counting when the provider changes is the false confidence it was written to remove.
3. **Point `lib/maptiler.ts` and `supabase/functions/_shared/geocode.ts` at it.** Both, or
   the server keeps paying Mapbox while the client does not.
4. **Watch it for a fortnight**, then drop Mapbox from the reverse path.
5. **Overture addresses into PostGIS**, by region, only where Photon proves thin.
6. Retire `VITE_MAPBOX_TOKEN` from the client entirely.

**Nothing here is built.** No server exists, no bytes copied, no dependency added.

### Phase 4c — Standards and open data  *(PLANNED 2026-08-15, nothing built)*

Erica asked to "get the API from OGC.org" and use its assets to make the map state of the
art. **OGC does not have assets or an API to consume.** The Open Geospatial Consortium is
a standards body: it publishes specifications — OGC API – Tiles, Features, Maps, Styles,
plus the older WMS/WMTS and GeoPackage — and nothing else. There is no data or imagery at
ogc.org to fetch. Recording that plainly so nobody spends a day looking for the download.

The intent behind the ask is right, though, and splits into two halves.

#### a. The standards worth conforming to (interoperability, not pixels)

| Standard                           | What it buys                                                                                                                                                                                    | Effort                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **OGC API – Tiles**         | A discoverable tileset document, so QGIS and OpenLayers can consume our basemap directly instead of via our own`tiles.json` shape. OpenLayers supports it out of the box (`OGCVectorTile`). | Small — mostly an extra JSON document beside the tiles the Worker already serves |
| **OGC API – Features**      | Serving PLACES and VISITS as standard GeoJSON collections, so her own data opens in QGIS and any OGC client.                                                                                    | Medium; an export/interop nicety, not user-facing                                 |
| **OGC API – Maps / Styles** | Serving the dark/light styles as discoverable style documents.                                                                                                                                  | Small, and only worth it after the styles settle                                  |

None of this changes what the map LOOKS like. It changes who else can read it, which
matters for a commercial product and for getting data back out (§6b's instinct).

**github.com/opengeospatial IS worth using — for three things, none of them data.**
Checked 2026-08-15; the org publishes specifications, schemas and test suites:

1. **`ets-ogcapi-tiles10` and friends** — Java conformance test suites. If the basemap
   Worker claims OGC API – Tiles, there is an EXECUTABLE test that proves it rather than
   a comment saying so. That is the same bargain as every other guard in this repository.
2. **`geoparquet`** — the specification Overture actually ships its data in. Reading
   Overture addresses means reading GeoParquet, so this is the format spec for §4c(c),
   not an abstraction.
3. **`ogcapi-features` / `ogcapi-styles` / `ogcapi-tiles`** — the schemas to conform to,
   in the repository that defines them.

What is NOT there: map data, imagery, tiles, addresses, elevation. The pinned repos are
`geoparquet`, `ogcapi-features`, `geopackage`, `sensorthings`, `geoapi`, `ogc-geosparql`
— every one a standard, not a dataset.

#### b. The open data that would actually make the map state of the art

These are the assets the ask was really after, and none of them are OGC's:

- **Overture Maps Foundation** (Linux Foundation; AWS, Meta, Microsoft, TomTom). Open
  base data with an **addresses** theme — 474M+ address points — plus places/POIs,
  buildings and transportation. Mostly CDLA-Permissive v2, with per-source attribution
  (CC BY 4.0, Apache 2.0, OGL) listed by theme. **This is the direct answer to "click a
  place and get its address"**, which the Protomaps basemap cannot do: its buildings
  carry `addr_housenumber` and nothing joins it to a street.
- **Copernicus DEM GLO-30** (AWS Open Data, Cloud-Optimised GeoTIFF, free, no egress
  cost) for **hillshade and contours**. For an app whose subject is trails and walking,
  terrain under the map is the single biggest visual upgrade available. US-only
  alternative at higher resolution: USGS 3DEP.
- **Sentinel-2 via STAC** on AWS Open Data for a satellite layer, if ever wanted.
- **MapLibre Tile (MLT)**, announced 2026-01, claims up to 6× compression over MVT.
  WATCH, do not adopt: the planet ships as PMTiles+MVT and the format is young.

#### c. How this changes the geocoding decision

Overture addresses make a third option real, alongside Nominatim and Photon:

> **Import Overture's address points for the regions we care about into the PostGIS we
> already run, and answer "what is this address" with a nearest-neighbour query.**

That is not a geocoder — there is no fuzzy text search, no ranking, no worldwide
coverage — but it answers the reverse question exactly, from our own database, with no
server to operate and no third party to be switched off by. Forward search (typing an
address into the new-place card) still needs Mapbox or a real geocoder.

**Sequence, if this is taken up:** Copernicus hillshade first (biggest visible change,
no new dependency), then Overture addresses into PostGIS (closes the click-for-address
gap), then OGC API – Tiles conformance (cheap, and makes the basemap quotable as a
standard service). Photon stays the answer only if forward search must also be
self-hosted.

**Nothing here is built.** No dependency has been added and no bytes copied.

### Erica's screen rules, 2026-08-15  *(all four MERGED in #94 — not yet Deployed)*

**Status, corrected 2026-08-16.** All four were fixed in #94 and are in `origin/main`:
`PlacesList` no longer renders `<StatsBar>` (which takes the gear with it), and
`Timeline.tsx` gained 154 lines for the year level. **They are not on the live site** —
#94 merged after the last successful deploy, so on adventureorno.com all four are still
wrong. That is the deploy freeze, not unfinished work.

The table below records the state WHEN SHE ASKED, and is kept because the diagnosis in
the last row is the reusable part.

| Rule                                                   | State when asked                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline drills down: YEAR → months → days** | ❌ grouped by MONTH only. There is no year level at all                                                                                                                                   |
| **Add opens the blank card we designed**         | ❌`/add` opens `AddPage`, a hub with the review queue. `PrimaryNav`'s own comment already says "ADD opens a FILLABLE CARD — not a chooser", so the code and the decision disagreed |
| **No settings icon on Places**                   | ❌ appears                                                                                                                                                                                |
| **No stats bar on Places**                       | ❌ appears (`PlacesList.tsx`)                                                                                                                                                           |

**The last two are ONE bug.** The gear lives inside `StatsBar` (`.gear-btn`), so anything
rendering the stats bar gets the gear with it. `PlacesList` renders `<StatsBar>`; removing
it takes both away. Worth knowing before someone "fixes" the gear separately and wonders
why it is still there.

### THE STRAVA RULE CANNOT BE DONE WITH RLS  *(found 2026-08-15)*

Josh sees his own Strava data, Erica sees hers, neither sees the other's. Today
`activities_select` is `using (public.is_member())` — every member sees every activity —
so the rule is currently violated for all 445 of them (180 `strava`, 265 `file`).

**But changing that policy is not enough.** **32 SECURITY DEFINER functions read
`public.activities`, and SECURITY DEFINER bypasses RLS entirely:**

    activities_of_type, activity_lines, card_view, climbing_stats, inbox, mileage_by_person,
    place_days, race_stats, races_list, rebuild_place_visits, visit_detail, wander_stats,
    wrapped_year_miles … and 19 more

Every count, every card, every statistic goes through one of those. A policy on the table
would look correct in psql and change nothing in the app.

**So the exclusion has to live where the reading happens**: one helper
(`public.can_see_activity`), applied in the RLS policy AND in every reader that aggregates
activities. `original_source` must exist first — `activities.source` records HOW WE GOT IT
('strava', 'file'), not where it came from, and a file imported via intervals.icu that
began life on Strava is exactly the case the rule is about.

### Phase 6 — What we own  *(APPROVED 2026-08-15; nothing built EXCEPT §6b, which is live)*

Phase 4 made the MAP ours. This makes the things around it ours: geocoding, routing,
elevation, terrain, points of interest, and recording an activity. Approved by Erica
2026-08-15 after an investigation of what is actually deployed.

**Corrections this phase makes to earlier notes in this file:**

- **PLANET, not a regional extract.** A US-or-Europe Photon index was floated on cost
  grounds and is wrong for this app: her own places already include Roma, Lungotevere
  Vaticano and Madrid, and the bucket list is international. A geocoder that fails on the
  next trip is not a geocoder. The disk difference is a few pounds a month.
- **NO third-party terrain tiles.** Free AWS terrain was floated; we bake our own
  (§6c). The point of Phase 4 was to stop being switchable-off by somebody else.
- **hotpot / heatmaps are OUT for now** — a fourth service for a feature nobody has asked
  for yet.

#### What is actually deployed (verified 2026-08-15, not from these notes)

|                          |                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aon-basemap`          | `planet.pmtiles` **137.3 GB**, plus glyph ranges for Noto Sans Regular/Medium/Italic                                                                                                           |
| Workers                  | `adventureorno-basemap` (tiles + glyphs + both styles), `adventureorno-photo-gateway`                                                                                                              |
| Zone routes              | **exactly one** — `adventureorno.com/basemap/*`. The photo gateway is still on `workers.dev`                                                                                                |
| Data                     | 151 places · 487 visits ·**445 activities** · 17,017 location pings · 178 photos · **0 trail_routes**                                                                                 |
| Activities already carry | `summary_polyline`, `elevation_gain`, `elevation_profile`, `moving_time`                                                                                                                       |
| Still third-party        | Mapbox → MapTiler geocoding;**public Nominatim called FROM THE BROWSER** (`lib/data.ts`, 2 endpoints); **public Overpass** mirrors in `suggest`; Foursquare in `geocode-new-places` |

#### 6a. NO SERVERS. Files in our bucket, read by Workers.  *(REWRITTEN 2026-08-15)*

**This section used to specify three always-on servers — Photon, Valhalla and Open Topo
Data — on a €45–70/month box.** Erica: *"I don't think I need the box and I want to keep
this free."* She was right, and the reasoning that produced the servers was subtly wrong.

The goal in this file has never been *own everything*. It is **not switchable-off by
somebody else, and not limited by their charges**. I optimised for the first phrasing and
it pointed at servers. The second is satisfied by files in R2 — which is how the basemap
already works, and the pattern was sitting in front of me.

**THE TRICK, stated once: a lookup at a coordinate is a TILE READ.** Reverse geocoding and
elevation both ask "what is at this point?", and that is answered by fetching one tile and
looking inside it. No process, no graph, no always-on anything — the same shape as
`/basemap/tiles/{z}/{x}/{y}`.

| Need                       | Was                     | Now                                                                                       |
| -------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Reverse geocode            | Photon on a box         | **Overture → PMTiles in R2**, Worker reads the tile                                |
| Elevation / hillshade / 3D | Open Topo Data on a box | **Copernicus GLO-30 → terrain-RGB PMTiles in R2**                                  |
| Typeahead search           | Photon on a box         | **Mapbox free tier** — ~100k geocodes/month, two people use a rounding error of it |
| Routing / map-matching     | Valhalla on a box       | **PAUSED 2026-08-15** (see 6a-iii)                                                  |

**Cost: R2 storage at ~$0.015/GB/month on top of the 137 GB already there.** Dollars, not
a new class of spend, and R2 egress is free.

##### 6a-i. Overture → PMTiles, GLOBAL

**All regions, not a subset.** A Postgres import forced a choice of regions because 474M
address points do not belong in Supabase; PMTiles removes the choice. Bake Overture's
addresses and places into tiles in `aon-basemap`, and `/geocode/reverse?lat=&lng=` becomes
a Worker fetching one tile and returning the nearest point in it.

Mapbox stays as the fallback for anything the tiles cannot answer, exactly as MapTiler
backs Mapbox today, and the existing `spendApiCall` meter keeps counting across the change
— a meter that stops counting when the provider changes is the false confidence it was
written to remove.

##### 6a-ii. Copernicus GLO-30 → terrain-RGB PMTiles

ONE artifact, THREE features: elevation profiles corrected server-side at save time,
hillshade under the map, and camera-along-path 3D flyovers rendered by our own style. Free
Cloud-Optimised GeoTIFFs from AWS Open Data, baked once, served by the same Worker.

##### 6a-iii. Routing — PAUSED, and why it is the honest exception

Erica, 2026-08-15: *"lets pause on the routing for now."*

**Valhalla can do everything wanted here** — snap-to-trail, map-matching a GPS trace,
turn-by-turn. It is the one thing on this list with no tile trick available, because
routing is a SEARCH ACROSS A GRAPH, not a lookup at a coordinate. It needs a process
holding that graph.

So routing is a box, or somebody else's box. When it resumes, the free option is
**FOSSGIS's public Valhalla** (no key, fair use) — the same shape of dependency as Mapbox,
watched by the same meter, and replaceable later. **Nothing depends on routing today**, so
pausing costs nothing.

#### 6b. Watchtower  *(BUILT 2026-08-15 — migration 0194, worker deployed)*

Five probes on a 15-minute cron, writing to `service_health`: app, style, tiles.json, a
real tile and a glyph range. It checks the CONTENT TYPE, not the status code — the whole
reason it exists is that `/basemap/*` answered 200 with the app's HTML for four days.
`service_status()` also marks a service STALE after 30 minutes, because a probe that has
stopped running leaves a green row that reads exactly like a healthy one.

Its probe list already carries commented entries for anything added later; wiring one up
is deleting a comment.

#### 6c. What "the planet" means, because I blurred it

FOUR different global datasets, from four projects, and the map being global gives you
none of the others:

| Dataset                     | For                                     | State                                                |
| --------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Protomaps planet            | the map you look at                     | ✅**137.3 GB in R2, serving**                  |
| Overture places + addresses | click a place, get its name and address | ❌ nothing yet (6a-i)                                |
| Copernicus GLO-30           | elevation, hillshade, 3D                | ❌ nothing yet (6a-ii)                               |
| Photon index                | typeahead                               | ❌**not being built** — Mapbox covers it free |

#### 6d. Recording, properly — and it is JUST ANOTHER INGEST SOURCE

What exists today is not recording: `lib/tracking.ts` drips throttled `watchPosition`
pings into `location_pings`. That is passive presence. Every one of the 445 activities came
from Strava or a file.

The recorder must produce the SAME normalized activity a file import produces
(`source='recorded'`) and go in through the same pipeline, so map display, joint-outing
detection, stats and sharing need zero recorder-specific code.

Non-negotiables, in order of how much they hurt when missed:

1. **A crash-safe on-device journal.** Every accepted point is written to local storage the
   moment it arrives, never held only in memory; an unfinished journal offers to resume.
   A phone dying at mile 9 must not lose miles 1–8. Users forgive jank, never a lost hike.
2. **Filter before storing** — drop accuracy worse than ~30–50 m, drop implausible
   teleports, light smoothing. Distance from filtered points only.
3. **GPS elevation is garbage.** Correct it server-side against our own DEM (§6c/6a) at
   save time, which is what Strava does.
4. **Auto-pause** with `moving_time` and `elapsed_time` kept separately.
5. **Offline finish**: queue the upload and sync later. Trails have no signal.
6. Foreground-service / user-initiated background location only — **never ask for
   "Always" location** for a start-button recorder.

#### 6e. Overture Places → PostGIS, replacing Foursquare

**Moving off Foursquare is not a trade, it is a repair.** `geocode-new-places` calls
`places-api.foursquare.com`, and that key is DEAD (the 2026-08-07 credential audit), so
`foursquarePoi()` returns null today and that naming path is silently doing nothing.
Overture Places *includes the Foursquare OS Places donation* — the same underlying data,
permissively licensed, self-hosted, no key to expire, no rate limit.

Import by region with DuckDB spatial from the GeoParquet releases into a `pois` table
(PostGIS point, name, current category taxonomy, confidence, GERS id) with trigram/FTS
indexes. Nearest-POI naming becomes one `ST_DWithin` query. **Attribution is per SOURCE,
not one licence** — read the per-theme table before charging anyone. Build against the
CURRENT taxonomy; the legacy `categories` property is deprecated.

**The existing rule still governs all of it: "no suggestion means leave it alone."** Never
write a placeholder name.

#### 6f. THE STRAVA CONSTRAINT — it shapes the data model, not just the UI

Strava's API terms permit showing an athlete's data **only to that athlete**. No feeds, no
comparison, no social display, and the API now expects a paid subscription with a
self-serve cap of 10 athletes.

Therefore, before anything social is built:

- **Every activity records its `original_source`.** Not "how we got it" — where it came
  from originally, through however many hubs.
- **Strava-origin data is excluded from every surface visible to another person, and that
  exclusion lives in RLS and views — NOT in the UI.** A privacy rule enforced in the
  frontend is a privacy rule that leaks the first time a new screen forgets it.
- Strava becomes **per-user and private**: each person connects their own account, and
  nothing Strava-derived crosses between accounts.
- Anything that currently depends on Strava must have a non-Strava path before it can be
  part of a commercial product. Today that is 445 activities and the whole
  `strava-webhook` / `strava-backfill` ingest.

### Phase 7 — Fitness ingest we own  *(APPROVED 2026-08-15; nothing built)*

**Anything that depends on Strava must have a non-Strava path before this is commercial.**
Today that is all 445 activities.

#### The legal shape, which decides the architecture

- **Strava**: an athlete's data may be shown **only to that athlete**. No feeds, no
  comparison, no social display. The API now expects a paid subscription, self-serve cap
  ~10 athletes. So Strava is **per user and private**, and `original_source` is what every
  visibility rule is written against (0193).
- **Fitbit**: the legacy API dies ~Sept 2026 and its successor needs a $500–$4,500 CASA
  assessment. Not worth it.
- **Aggregators** (Terra, Rook, Spike, Thryve, Vital): $300–500+/month. No.

Therefore: **phone health stores + free direct APIs + ingest rails we own.**

#### 7a. Free direct connectors, in priority order

| #  | Provider                 | Why it is where it is                                                                                                                                                                                                                                    |
| -- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | **intervals.icu**  | The hub. Free API, OAuth, webhooks, original file download; it already pulls Garmin, Polar, Suunto, COROS, Wahoo, Zwift, Strava, Dropbox.**One button ingests a user's whole ecosystem.** Must filter Strava-origin rows before any shared surface |
| 2  | Polar AccessLink         | Free, self-serve, webhooks, GPX/TCX/FIT                                                                                                                                                                                                                  |
| 3  | Suunto                   | Free key, self-serve, new-workout webhook, FIT                                                                                                                                                                                                           |
| 4  | Wahoo                    | Free, request-based approval, webhooks, FIT URLs                                                                                                                                                                                                         |
| 5  | COROS                    | Free, form approval — apply once the LLC exists                                                                                                                                                                                                         |
| 6  | Garmin Connect Developer | Free, business-entity application; pushes original FIT. Highest-value hub: Peloton↔Garmin, Zwift→Garmin, TrainerRoad→Garmin, Rouvy→Garmin all terminate here                                                                                         |
| 7  | RideWithGPS              | Free API; also where Hammerhead Karoo auto-uploads land                                                                                                                                                                                                  |
| 8  | Whoop, Oura              | Free APIs + webhooks. No GPS — ingest as route-less activities/recovery                                                                                                                                                                                 |
| 9  | Withings                 | Free to 5,000 users; body/sleep/steps, no routes                                                                                                                                                                                                         |
| 10 | Concept2                 | Free OAuth + webhooks; rowing/skierg/bikeerg per-stroke                                                                                                                                                                                                  |
| 11 | Smashrun                 | Free OAuth, polyline GPS, running only                                                                                                                                                                                                                   |
| 12 | Hevy                     | Official API (user needs Hevy Pro); strength. Also parse Strong CSV export                                                                                                                                                                               |
| 13 | Runalyze / FitTrackee    | Free/self-hosted, niche, zero cost                                                                                                                                                                                                                       |

**No free public API — covered indirectly by 7b, do not chase**: Zepp/Amazfit, Xiaomi,
Samsung, Runkeeper, adidas, Nike, Peloton, Zwift, TrainerRoad, iFit, Echelon, Hydrow,
Tonal, Technogym.

#### 7b. Ingest rails we own, in build order

1. **Health-store relay** *(needs the native app — DEFERRED until the LLC)*. iOS
   HealthKit `HKObserverQuery` + background delivery + `HKWorkoutRoute`; Android Health
   Connect `ExerciseSessionRecord` + `ExerciseRoute`, with `READ_HEALTH_DATA_HISTORY`
   (without it only 30 days) and `READ_HEALTH_DATA_IN_BACKGROUND`. **This is the master
   key** — it covers Peloton, Nike Run Club, Runkeeper, Samsung, the Fitbit app, Zepp,
   iFit, Hydrow, Tonal and more with zero per-vendor work.
2. **Share-sheet / file-handler registration** *(days of work; native + PWA where
   possible)*. Register as a handler for `.gpx`/`.tcx`/`.fit` — iOS custom UTIs +
   `CFBundleDocumentTypes`, Android `ACTION_SEND`/`ACTION_VIEW`. Then "Export → our app"
   appears inside Komoot, COROS, Wahoo, OpenTracks, Files, Mail and AirDrop.
3. **Sync-hub chaining** — ship "Connect intervals.icu" and "Connect Garmin" as the two
   buttons and document the free chains that terminate there.
4. **Email-in ingestion** *(1–2 days, ENTIRELY on infrastructure we already run — the best
   effort-to-coverage item on this list)*. Cloudflare Email Routing + Email Workers (free,
   25 MiB inbound): `u-<token>@import.<domain>` via catch-all → Worker → R2 → queue →
   the existing FIT/GPX/TCX parser. Verify sender; dedupe the way `import_file_activity`
   already does.
5. **Cloud-drive watch** — Dropbox (App-folder scope) and Google Drive (`changes.watch`,
   `drive.file` scope to avoid heavy OAuth verification).
6. **A generic authenticated `POST /ingest`** — `ingest-overland` already proves the
   pattern; Overland, OwnTracks and GPSLogger all speak simple JSON/GPX POSTs.
7. **Garmin Connect IQ data field** *(later, a differentiator)* — a tiny CIQ field can
   `makeWebRequest` to us without waiting on the Developer Program.

**Back pocket only**: a browser extension fetching the user's own files from vendor sites
in their session — user-initiated, single activity, never server-side with stored
credentials. **Skip entirely**: desktop watcher apps, FHIR/openfitness.

#### 7c. The in-app recorder *(native — DEFERRED until the LLC)*

Its rules are already written in §6d and do not change: it is **just another ingest
source**, producing the same normalized activity a file import produces
(`source='recorded'`), so nothing downstream needs recorder-specific code.

Additions from 2026-08-15: iOS needs only "While Using" for a user-started recorder with
`allowsBackgroundLocationUpdates` — **do not ask for "Always"**, it hurts App Review and
trust. Android needs a foreground service with a persistent notification, not
`ACCESS_BACKGROUND_LOCATION`. `expo-location` + `expo-task-manager` for v1;
`react-native-background-geolocation` only if drift demands it. Write the finished workout
back to HealthKit / Health Connect. A 1 Hz recording costs ~5–10%/hour, comparable to
Strava. OSS to read, not import: OpenTracks, FitoTrack, OutRun.

### Phase 7a — THE IMPORT SYSTEM: one outing, many sources  *(APPROVED 2026-08-17)*

Erica, 2026-08-17: *"we need to build that system and then backfill his Strava information…
create a plan to build an import workflow that also keeps a ledger of who adds what from
what source — we also must be able to de-dupe activities uploaded from different methods
that record the same run… the activity should only be counted once."*

**This phase exists because the current importer is wrong in three separate ways, and the
audit that found them is the table below.** It is written before any code so the shape is agreed
first, and it replaces `import_file_activity` rather than patching it.

**CHECKED AGAINST PRODUCTION, NOT THE REPO** (Erica asked, 2026-08-17, and it changed two
claims in this plan). Every function below was read from `pg_proc` on the live database,
and the leak was measured by setting `request.jwt.claims` to Josh's id in a read-only
transaction and calling the real readers.

#### What is broken today, measured

|                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Co-attribution was an INSTRUCTION, implemented as a date** ⚠️ *corrected — see §7a-6* | `0039` did a blanket `UPDATE`: *"Post-Dec-21-2025 activities Erica recorded were joint → also Josh's."* 46 activities carry Josh's name, **all** dated ≥ 2025-12-21, and **19 of them are dated after his last import** — nothing of his could possibly have matched them. **This was Erica's explicit request, exception included** (§7a-6), and an owner's assertion is the best evidence there is — the fault is that it was written as a hardcoded date inside a migration, where it could not be seen, amended, revoked, or told apart from a guess |
| **That defeats the Strava rule**                                                              | `visible_activities` treats an `activity_profiles` row as "this is yours too". **Measured live, acting as Josh: he sees 46 of Erica's 180 Strava activities.** Asking the real reader — `mileage_by_person(josh)` — returns **124 activities and 992.5 miles, of which 46 activities and 356.1 miles are Erica's Strava runs.** His own stats screen is showing him her mileage                                                                                                                                                                                   |
| **The importer silently destroys the second recording**                                       | `import_file_activity` finds a match and `return v_id` **without inserting**. The file Josh uploaded is not stored, not linked, not recorded anywhere. It is simply gone                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`original_source` is a transport, not an origin**                                         | `0193` backfilled it as `coalesce(original_source, source)`, so all 265 file rows say `'file'`. §6f requires *"where it came from originally, through however many hubs"*. A Garmin FIT, an AllTrails GPX and an Apple Health export are all `'file'` today                                                                                                                                                                                                                                                                                                                |
| **No provenance at all**                                                                      | `source_id` is NULL on every one of the 265 file rows. `ingest_runs` logs only the OSM suggester. Nothing records who imported what, from which file, when                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### The one idea the whole design rests on

**An activity is an OUTING. A source is EVIDENCE of that outing.** They are different things
and the schema has been conflating them.

That single separation answers all three of Erica's requirements at once:

- *"the activity should only be counted once"* — counting reads `activities`; a run
  recorded by Strava, AllTrails and Apple Health is **one** row with **three** evidence
  rows, so it cannot be counted three times by construction rather than by a dedup job
  that has to keep winning.
- *"a ledger of who adds what from what source"* — the evidence row IS the ledger entry.
- **And the joint-outing bug disappears**, because the two cases stop looking alike:

  SAME PERSON, two apps, one run     → ONE activity, TWO sources
  TWO PEOPLE,  one run together      → TWO activities, one per person, linked

  The current importer collapses the second case into the first. That is the actual root
  of the 46, and no amount of better matching fixes it while one outing can only have one
  owner.

#### 7a-0. The Codex review, and what CHECKING it changed *(2026-08-17)*

Erica had a second model review the plan and told me to *"challenge codex assertions against
the live site, github, supabase, and cloudflare. Do not make assumptions."* Every verdict
below was measured, and the checking changed the design in five places — including two
where **Codex was right about the problem and both of us were wrong about the fix**.

| #  | Codex's claim                                                                    | Verdict, measured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | *Critical: visibility must not hang off the mutable `strava_accounts` table* | **Right about the risk, and the fix is simpler than either proposal.** `strava_accounts.profile_id` is `ON DELETE SET NULL`, so it is genuinely mutable. But `owner_profile` is **already an immutable snapshot**: `set_activity_owner` resolves it at INSERT and stores it, all 180 Strava rows match their athlete's profile, none are null, and **all three functions that touch it — `set_activity_owner`, `import_file_activity`, `match_photo` — set it only on INSERT.** So no new `source_profile_id` column, and no join at read time. Use `owner_profile`, and add a guard making it formally immutable |
| 2  | *High: "activity" means two things; readers counting rows can double-count*    | **Right, and worse than stated.** 33 functions read activities; only **9** group by `shared_group_id`; **10 aggregate with `count()`/`sum()` without it** — `card_view`, `race_stats`, `place_days`, `recompute_place_stats`, `races_list`, `data_health`, `shared_outings`, `place_days`, `rule_offer`, `learn_rule`. There are **27 activities in 16 groups**, so 11 rows are double-countable today                                                                                                                                                                                               |
| 3  | *High: the ledger only models human file actions*                              | **Right.** `imports.profile_id = auth.uid()` cannot represent a webhook, a scheduled backfill or a migration. And **`ingest_runs` already exists** — 41 rows, `source='suggester'` only, and **no database function references it**, so it is an edge-function-only log. Extending it beats adding a competing ledger                                                                                                                                                                                                                                                                                                          |
| 4  | *High: Tier 1 ids prove source-record identity, not outing identity*           | **Half right, and the live data settles it.** Fetched from Strava with Erica's own token: her watch activities carry `external_id = garmin_ping_610945955935` and `device_name = "Garmin fēnix 6S"`; her phone ones carry `external_id = <UUID>-activity`, `device_name = "Strava App"`. So `external_id` **does** name the origin provider — but `garmin_ping_…` is a Garmin *ping* id, **not** the FIT `file_id`, so it cannot be joined to a FIT file. Scoped uniqueness it is                                                                                                                                  |
| 5  | *High: Tier 2 auto-attach conflicts with the machine-proposal rule*            | **Right, and it contradicted this file's own §2 and `0195`.** Conceded without reservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6  | *High: raw-file retention needs a security policy*                             | **Right, and it is net-new.** R2 holds exactly three buckets — `adventureorno-photos`, `aon-backups`, `aon-basemap`. There is nowhere to put raw activity files today                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7  | *Medium: label the 44 historical claims honestly*                              | **Right.** "44 carry the fingerprint" says how they were written, not that each outing was shared                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8  | *Medium: backfill must record explicit `unknown`*                            | **Right**, and it matters most for the 265 file rows: `source_id` is NULL on every one, so their upstream provider is genuinely unknown and must not be guessed as Garmin                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9  | *Medium: done-definition should test more than `mileage_by_person`*          | **Right.** The RLS policy on `activities` uses the SAME tag predicate as the view, so route geometry, cards and detail readers need their own assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10 | *Doc: the plan cites a §7f that does not exist*                               | **Right.** I referenced a section I never wrote; the audit it meant is the table above. Reference corrected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 11 | *Josh's OAuth: check athlete capacity, not just the callback*                  | **Fair, unresolved.** `strava-auth` is deployed (v15, `verify_jwt=false`) and his state expired unused. Capacity is not measurable through the API, so both hypotheses stay open until the retry is instrumented                                                                                                                                                                                                                                                                                                                                                                                                                              |

**One claim I want to record as NOT a problem**, because it looks alarming: `authenticated`
holds INSERT/UPDATE/DELETE grants on `public.activities`. It cannot use them — RLS is
enabled and the only policy is `activities_select` (SELECT), so every write command is
denied for want of a permissive policy. The grants are noise, not a hole.

#### 7a-1. FIRST: close the leak *(revised after the review)*

Three changes. None of them touch Erica's historical data.

1. **Strava visibility follows `owner_profile`.** Not a tag, and not a join through
   `strava_accounts` — that table is mutable (`ON DELETE SET NULL`) and would hand
   historical access to a live credential row. `owner_profile` is already the immutable
   snapshot of whose account the data came from. Add a trigger that refuses to change it
   after insert, so it stays that way by construction.
2. **Fix the RLS policy AND the view**, which currently share the same tag predicate.
   Either one left behind is the whole leak.
3. **Remove the blanket rule's future tense** in `import_file_activity` and
   `rebuild_place_visits` (see below). The 44 historical co-attributions stay, and are
   relabelled honestly: `status='accepted_legacy'`,
   `evidence='owner_asserted_date_backfill'`, `created_by='migration'`. That records how
   they were written without claiming each outing was independently proven shared.

**Definition of done — broader than the first draft, per review point 9.** Acting as Josh:
`mileage_by_person(josh)` returns 0 activities owned by Erica with
`original_source='strava'` (today 46 / 356.1 mi); `card_view`, `visit_detail`,
`activity_lines` and `place_days` return no route geometry for them; a direct
`select from activities` under RLS returns none; and a test asserts each, so a tag can
never again unlock Strava's copy.

#### 7a-2. ONE canonical outing id, before any counting is trusted

Review point 2 is the one that changes the model. An `activities` row is not an outing —
it is **one person's record of an outing** — and 10 readers already aggregate as though it
were.

The end state is an explicit `outings` table with `outing_participants`. That is a large
migration, so it is not step one. **Step one is to stop the ambiguity spreading:**

- define `outing_id := coalesce(shared_group_id, id)` **once**, in one authoritative view,
- move every aggregating reader onto it,
- and add a test — the same shape as `the_readers_stay_enforced.test.sql`, which already
  works — that **fails when a function aggregates `activities` without going through it**.

That converts a modelling problem into a guarded invariant, which is the pattern that has
actually held in this repository.

#### 7a-3. The provenance spine *(rebuilt on the review's shape)*

Four identities, never collapsed: **data owner**, **import initiator**, **connection or
device**, **participants**. The first is `owner_profile` and already exists; the rest are new.

```text
source_connections   provider identity + owner profile. NO credentials — strava_accounts
                     keeps those, and this table is safe to read
ingest_runs          EXTEND THE EXISTING TABLE (41 rows, suggester-only, no DB function
                     reads it) rather than adding a rival: + method, actor_kind
                     ('user','device','webhook','scheduled','service','migration'),
                     initiated_by, source_connection_id, source_owner_profile,
                     app_version, idempotency_key, status
import_artifacts     one row per file: sha256, bytes, media type, private R2 key,
                     retention state. Referenced by items — never duplicated per activity
ingest_items         one row per incoming record and its disposition:
                     inserted | updated | duplicate | skipped | failed, with the reason
activity_sources     typed link from an ingest item to the activity it evidences,
                     carrying provider, origin, external_key, device_name, confidence
```

**`actor_kind` is what makes it honest**: a webhook has no `auth.uid()`, and a backfill
must not be recorded as Erica approving anything.

**Retention policy, because the bytes are sensitive** (review point 6, and there is no
bucket for them today): a NEW private R2 bucket, service-role access only, size and type
limits, SHA-256 idempotency, defined retention, deletion on account deletion or provider
deauthorisation, and orphan cleanup for the case where R2 succeeds and the transaction
does not.

#### 7a-4. De-duplication *(retiered after the review)*

**Tier 1 — scoped idempotency, not universal identity.** The unique key is
`(provider, source_connection_id, entity_kind, external_key)` — *not* a global unique on
`external_key`. A matching key proves **the same source record**, which is exactly what
stops a re-import creating a second row.

The live evidence for why that is the right scope:

    garmin_ping_610945955935     device_name "Garmin fēnix 6S"   ← a Garmin PING id…
    <UUID></uuid>-activity              device_name "Strava App"        ← …not a FIT file_id

`external_id` reliably names the **origin provider** — which is how `origin` gets populated
honestly instead of guessed, and `device_name` should be captured alongside it. It does not
give a join key to the Garmin FIT file. **Cross-provider collapse is therefore never
automatic on an id alone.**

**Tier 2 — proposal, until it has earned promotion.** The thresholds are a hypothesis, not
a rule, and §2 plus `0195` already forbid a machine writing a grouping decision. So Tier 2
writes into `suggestions`, its comparison recorded in `match_decisions`
(algorithm + version, compared ids, measured deltas, proposed outcome, accepted/rejected by
whom, previous state, and a detach record). **Measure precision against the existing corpus
first**; automatic attachment is a later decision with evidence behind it, not a launch
feature.

**Tier 3 — weaker still: propose, and say why.**

Three rules that do not move: never silently drop a file; de-duplicate **within one
person** only; every merge reversible.

#### 7a-5. Then Josh — and it was ATHLETE CAPACITY

**Settled 2026-08-17 by his retry: `403 — too many athletes`.**

Strava caps a NEW API application at **one connected athlete**. Erica is that one. Josh is
the second, so nothing about the callback, the state lifetime or the redirect URI could
ever have let him in. Lifting it means submitting the app through **Strava's Developer
Program review**, which raises the cap to 999 and takes **7–10 business days** — a form,
not a code change.

**What I got wrong, recorded because the mistake is the reusable part.** A reviewer raised
athlete capacity; I wrote it down as *"fair, unresolved — both hypotheses stay open until
the retry is instrumented"*, which was correct. Then I ruled out the redirect URI by
probing Strava, found the 10-minute state TTL, and reported THAT as the cause — dropping my
own caveat and promoting an unmeasured hypothesis to an answer. The instrumentation I said
was needed is precisely what produced `403 too many athletes` in one attempt.

`0204` still stands on its own: ten minutes is too short for someone finding a password or
clearing 2FA, and the silent-failure message is what turned this retry into a diagnosis
instead of another week of believing it had worked. Neither was the cause. `0207` records
that on the function itself.

**AND THE RULE THIS FILE HAS BEEN STATING IS WRONG.** Erica, 2026-08-17:

> *"The rule should not be everything depending on Strava needs a non-Strava path. The rule
> is EACH USER SEES THEIR OWN STRAVA INFORMATION."*

§6f and Phase 7 both read as though Strava were a liability to be escaped. It is not. It is
a good importer with one condition attached, and that condition is per-user visibility —
which `0200` now enforces at the helper, the view and the RLS policy. Building a non-Strava
escape hatch for its own sake is solving a problem she does not have.

**The correct statement of the rule, replacing the older wording wherever the two disagree:**

> Each person connects their own Strava account. Each person sees their own Strava data and
> nobody else's. Tagging someone on an outing is a fact about the outing and never a key to
> Strava's copy of it.

Other importers (Garmin files, Apple Health, AllTrails) remain worth having because people
own several apps, not because Strava needs replacing.

**HOW EACH PERSON CONNECTS — the plumbing is already there, verified 2026-08-17:**

| Piece                  | State                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `strava_accounts`    | keyed by`athlete_id`, so it holds one row PER ATHLETE                                     |
| `strava-auth`        | stores the connection against the profile from the consumed state — Josh's lands as Josh's |
| `strava_oauth_start` | requires`is_editor_or_owner`, so an editor may connect                                    |
| `strava-webhook`     | looks the account up by`event.owner_id` and attributes to THAT athlete                    |
| `strava-backfill`    | `getAllAccounts()` and loops — already every athlete, not just the owner                 |
| `set_activity_owner` | resolves`owner_profile` from `athlete_id`, so each activity lands owned by its athlete  |
| `0200`               | visibility follows`owner_profile`, so the separation holds automatically                  |

**Nothing needs building. The only blocker is Strava's athlete cap**, and the fix is smaller
than 0207 implied: a new app starts in *Single Player Mode* at **1 athlete**, and the owner
can **self-upgrade to 10 athletes from the API settings dashboard with no review**. Review
(7–10 business days) is only needed beyond 10, which raises it to 999. Two people need the
self-serve upgrade and nothing else.

#### 7a-6. TAGGING IS THE PRODUCT — and a correction to how this file described it

Erica, 2026-08-17: *"Josh and I hiked, ran, biked, and took trips and visits, etc together.
The whole point of this app is to be able to tag and share those memories. When I
originally uploaded my Strava I told you to add him on all activities since December 21,
2025 except Richmond Yuengling marathon."*

**That changes what the 44 rows are, and §7a-0 described them wrongly.** This file has been
calling the co-attribution "a date, not evidence" and filing it under the same heading as
`solo_profile IS NULL` rendering as *"both of us were there"*. It is not that.

**The owner said so.** An owner's assertion about who was with her is not the absence of
information — it is the best evidence this system will ever get, better than a GPS
coincidence and better than any matcher. What went wrong was never the claim. It was that
the claim was **implemented as a hardcoded date inside a migration**, where it could not be
seen, amended, revoked, or asked about, and where nobody could tell it apart from a guess.

**Checked, and her instruction WAS carried out** — including the exception:

|                                       |                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The excepted race                     | **Yuengling Shamrock Marathon**, 2026-03-22, 26.4 mi, `is_race=true` (it is the Shamrock, in Virginia Beach — not Richmond; recorded here because the plan should name the right activity) |
| `activity_profiles` — the record   | **Erica only.** The exception was honoured                                                                                                                                                    |
| `also_profiles` — the legacy array | **still says Josh.** A stale mirror of a corrected fact                                                                                                                                       |

That divergence is this repository's oldest recurring bug in a new place: one fact stored
twice, and the copy left behind (§"Derived vs source"). `activity_profiles` is the record
(0189/0192); `also_profiles` must be retired, not repaired.

**How much of the tagging has a second recording behind it:**

    46  Josh tagged on Erica's activities
     8  ...where Josh has his OWN recording that day   ← evidence
     7  ...of those linked by shared_group_id
    38  owner-asserted only                            ← and that is FINE

38 is not a failure. Josh had no Strava, and his file imports are sparse and stop on
2026-05-18. For most of those outings her word is the only record that exists, and the
model must treat **owner assertion as a first-class evidence type** rather than a
second-class one.

#### 7a-7. What the model has to support, taken from what she actually did

Her instruction is the specification, almost word for word:

> add him on **all activities since December 21, 2025** — *a rule, over a range*
> **except** the Yuengling marathon — *with exceptions*
> and he should be able to **see and share those memories** — *with the other person's acceptance*

So the tagging model needs four things a migration cannot give it:

```text
outing_participants
  outing_id, profile_id
  claim_status   proposed | accepted | declined | retracted
  evidence       owner_asserted | own_recording | matched | inferred
  asserted_by    who said it            ← Erica, for all 44
  decided_by     who accepted it        ← Josh, and §A requires it
  rule_id        the bulk action it came from, if any

tagging_rules            A BULK CLAIM, STORED AS DATA RATHER THAN AS A MIGRATION
  id, created_by, created_at, note
  subject_profile        who is being tagged
  from_date, to_date, activity_types, places
  status                 active | revoked
tagging_rule_exceptions
  rule_id, outing_id, reason      ← "except the Yuengling marathon", stored, not remembered
```

**Why this is the fix and not bookkeeping.** Every property that made the December
instruction go wrong disappears:

- it is **visible** — she can see the rule and everything it claimed;
- the **exception lives with the rule**, so nothing depends on whoever ran the migration
  remembering it;
- it is **revocable** — retracting the rule retracts the claims it made, except the ones
  Josh individually accepted, which are his now;
- and it is **distinguishable** from a guess, so a reader never again has to infer intent
  from a date constant.

**Acceptance is the part §A already required and nothing has ever implemented.** Josh has
never been asked about any of the 46. In a two-person household that can be one screen and
one button — *"Erica tagged you on 46 outings since 21 Dec. Accept all / review"* — but it
has to be recorded, because at commercial scale the tag is a claim about somebody else.

#### 7a-8. Why both of you must reload, in one sentence

**0200 stopped Josh seeing 46 Strava-sourced activities he is legitimately tagged on** —
correct under Strava's terms, and directly at odds with the point of the product. The way
out is not to weaken the rule; it is Erica's own instruction: *"have both of us reload our
activity information with a process that works."* When an outing is evidenced by files each
person owns, the shared memory is theirs to share, and Strava is reduced to one convenient
importer among several rather than the thing the household's history depends on.

**The canonical test case is already in the data — 2026-03-07:**

    Purcellville to Arlington - Full WOD   08:10:36  45.12mi  strava  owner Erica
    Purcellville Running                   08:10:42  44.68mi  file    owner Josh
    Purcellville Trailhead - W&OD          08:21:57  44.93mi  file    owner Erica

One run. Three records. It contains **both** problems at once: a cross-source duplicate
(Erica's Strava copy and Erica's file copy of her own run) and a genuine joint outing
(Josh's own recording). All three already share a `shared_group_id`, which is why
`mileage_by_person` reports it once — and why the **ten readers that do not group** would
report 135 miles for a 45-mile run.

Any import rebuild is finished when this day comes out as: **one outing, two participants,
Erica's activity carrying two sources, Josh's carrying one.**

#### 7a-9. The writes that reported success and did nothing *(2026-08-17, DONE — 0209)*

Erica uploaded her Garmin GPX/TCX files and got **"Done — 0 activities imported.
Re-importing the same file is safe (duplicates are ignored)"** for files she had never
uploaded. The ingest ledger showed two runs, **zero items**, finished in 120ms — nothing had
reached the database, so nothing in the database was at fault. Pulling that thread found
four faults, and **three of them were writes that returned success and wrote nothing.**

| What                     | What it did                                                                                                                                                                                                                                                         | How it hid                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordStravaSource()` | `onConflict: 'provider,connection_id,external_key'` against 0202's **expression** index `(provider, coalesce(connection_id,'000…'), external_key)`. Postgres cannot infer an expression index from a column list, so every call returned **42P10** | the result was never inspected, and 0208's hand-backfill had already filled the rows that existed — so only the**25** imported after 0208 were bare |
| `source_connections`   | only ever written by 0202's own backfill; the OAuth callback stored tokens and stopped                                                                                                                                                                              | Josh's**90** activities carried `connection_id` NULL while his tokens sat in `strava_accounts`                                                   |
| `parseActivityFile()`  | discarded origin, device and any de-dup key                                                                                                                                                                                                                         | all**265** file rows say origin `unknown`; a re-upload could only be caught by Tier 2's guess                                                      |
| `strava-backfill`      | two athletes × 100 activities × ~5 round trips per activity                                                                                                                                                                                                       | timed out at 150s, then returned`WORKER_RESOURCE_LIMIT` three times, leaving **28 of Josh's 93** missing **while reporting success**         |

**The rule this phase adds, and it is not about Strava.** *An ON CONFLICT column list cannot
match an expression index — and an unchecked write is indistinguishable from a successful
one.* Both `activity_sources` and `source_connections` are guarded by expression indexes
(`coalesce(...)`), so both are now **match-then-write with the error checked and raised**.
`check-data-integrity.mjs` gained *"an imported activity that cannot say where it came
from"*, which counts activities from a connected account with no evidence row — the number
that would have shown this on day one.

**Files now carry their own identity, so de-duplication stops being a guess:**

- **GPX** → Garmin Connect's activity id, read from the `connect.garmin.com/modern/activity/…`
  link it stamps into the export → `garmin-connect:<id>`.
- **TCX** → `UnitId` + `ProductID` + `<Id>`, emitted in **exactly the FIT key shape**
  (`fit:garmin:<product>:<serial>:<iso>`), so the watch's own `.fit` and a `.tcx` of that
  same activity are **one source record**, not two.
- **No serial, no key.** File imports have no connection to scope them, so the unique index
  is global — a key of just a start time would collide two people who set off together into
  one activity. A missed match costs a confirmation; a false one silently merges two
  people's outings. Tier 2 proposes instead.

**The GPX/TCX path had never been tested at all**, because `parseActivityFile` needs
`DOMParser` and vitest runs `environment: 'node'`, where it does not exist — so any test
would have thrown on its first line. That is why a format Erica actually exports could ship
broken while the FIT path had coverage. Added **jsdom** (that one file only), 9 tests over
real Garmin export XML, and 4 that build an actual FIT file with Garmin's own encoder and
read it back — no mocking of the decoder, because the decoder is the part that breaks.

**Verified on production, not asserted:**

    Erica   184 / 184 against Strava's own count       0 missing
    Josh     90 /  93                                  3 are 2018 gym sessions: no location,
                                                       no distance — dropped by rule
    activities from a connected account with no evidence      0
    Josh's evidence, re-fetched rather than guessed    57 strava-app, 29 garmin, 4 unknown

and a **rolled-back rehearsal against her real data** (`Seneca Regional Park`, 2026-08-09):
a GPX of an outing she already has via Strava is **created and proposed**; the same GPX
again is a **duplicate that attaches**; the TCX is proposed, not merged; **3 submissions,
3 ledger rows**. Nothing silently merged, nothing silently dropped.

**And the message that started it.** The summary dropped the `already` count entirely and
ended with *"duplicates are ignored"* whatever happened, so "I could not read your files"
and "you already had these" and "I did nothing" all rendered identically. It now names each
outcome and each unreadable file with its reason — including *"not a GPX, TCX or FIT file —
unzip Garmin's export and pick the files inside"*, because a `.zip` read as text parses to
null and used to be reported as *"no GPS track found"*, which sends a person to look at
their watch instead of at the zip.

#### 7a-10. A proposal nobody could accept *(2026-08-17, DONE — 0210)*

Erica imported one Garmin GPX. It behaved exactly as designed right up to the last step:

    Loudoun County Walking   2024-09-26 12:13:40  1225 m  file    origin garmin
    Lake of the Red Rocks    2024-09-26 12:13:22  1254 m  strava  origin garmin
    → "Looks like the same outing … 0 min apart, 2.3% difference in distance"

Created, not swallowed. Provenance real (`origin garmin`, device *Garmin Connect*) — the
0209 fix working. Card raised, and it **appeared in her Inbox**. Everything looked finished.

**Approving it would have raised `22023: the inbox does not write activity.duplicate_of`.**
`apply_inbox_field` has no branch for that field and never did. There was no way for a
person to say yes, so the two recordings stay unlinked — and until they are linked, every
reader that does not group **counts that walk twice**. A de-duplication system whose last
step cannot be completed has not de-duplicated anything; it has queued a double-count and
put a badge on it.

**The field already existed.** 0195 routes joint-outing dedupe through `shared_group_id`,
`apply_inbox_field` has written it since, and every mileage reader counts one row per
`coalesce(shared_group_id, id)` (0140). `duplicate_of` was a **new name for a question
already decided** — and inventing a field is how you end up proposing something nothing can
accept. The importer now proposes `shared_group_id`, valued at the outing the existing
recording already belongs to, and the three proposals already raised were rewritten in
place rather than withdrawn and re-raised: she has seen those cards, and a card that
vanishes and returns is indistinguishable from a bug.

**Proved by accepting one, against production, rolled back:**

    outings counted on 2024-09-26 BEFORE   2
    approve_card returned                  {"ok": true, "fields": 1, "undo_token": …}
    outings counted on 2024-09-26 AFTER    1
    both recordings kept                   2

**The test is the general rule, not the instance.** `0210_a_proposal_must_be_acceptable`
extracts every field `ingest_activity` proposes and fails unless `apply_inbox_field` can
write it — so it catches the next invented field too. Checked both ways: it finds
`shared_group_id` (not a vacuous loop), and mutating the source back to `duplicate_of`
makes it fail.

**Also fixed: `ok` counted only `inserted` and `attached`,** so the run that imported her
walk recorded `ok=0 failed=0` for one activity created and one proposal raised. The UI said
"1 imported" while the ledger said nothing happened — and the ledger is what anybody reads
later. Anything not `failed` is now an item the run handled, and existing runs were
recounted.

**The pattern across 7a-9 and 7a-10.** Writes that reported success and did nothing; a
choice that could not be made. Neither was visible on screen, and both were found only by
**counting something** — 25 rows with no evidence, one day counting as two outings. That is
the argument for `check-data-integrity.mjs` growing a row per invariant rather than for
more tests of the happy path.

#### 7a-11. One press for a library *(2026-08-17, DONE — 0211/0212)*

**The reload does not fail on correctness, it fails on effort.** 7a-8 requires both of them
to re-record their outings as files, because an outing evidenced only by Erica's Strava
copy is one Josh cannot see. Measured on 2026-08-17:

    Josh is tagged on                                          219 outings
    of those, invisible to him — evidence is Erica's Strava      46
    his tags created by a migration, never actually asked        44

But her Garmin library is the *same outings* Strava already holds, so every matching file
raises its own `shared_group_id` card (0210). Across ~184 activities that is one press per
card: a **data-entry job wearing a review's clothes**. The predictable end is that she stops
halfway and the remainder stay double-counted — the system correct about every single one
and wrong overall.

**This does not change who decides.** §2's rule stands: a machine may only propose. The
cards are still hers to read, the count is on the face of the banner, and **one Undo puts
every one of them back**. What changed is the number of times she has to say yes.

**Scoped to her OWN outings in the function, not in the caller.** Tier 2 only ever matches
same-owner recordings, so today the scope changes nothing — but a function whose job is
"accept everything pending" is precisely the one that later gets pointed at somebody else's
data, and the regression test's third case is the one that matters:

    2 linked in one press · Josh's card untouched · both recordings kept · one undo restored both

**Undo had to be fixed to survive a batch.** It restored suggestions by the undo *row's*
single `group_key` — right for one card, silently wrong for many: every activity would
revert while only one card returned to pending, leaving the rest approved-but-not-applied.
Each payload element now carries its own `group_key`, with the row's as fallback, so every
token written before today behaves exactly as it did.

**0212 corrects 0211 the same day.** `approved_fields.via` is a CHECK-constrained set —
`inbox | edit | rule | backfill` — and 0211 invented `'inbox-bulk'`, so every call raised
`23514` and the function could never approve anything. Caught by *running* it. `'inbox'` is
also the right answer rather than the merely permitted one: it **is** the Inbox, and that
one press covered many cards is recorded where it belongs, in
`approval_undo.group_key = 'bulk:import-dup'`, instead of by widening a closed vocabulary
four other things depend on. 0211 is left exactly as applied — a migration file that changes
after it ran no longer describes what any environment did.

**Still open after this, and both are Erica's call:**

- **Josh has never been asked about his 44 legacy tags.** `respond_to_tag()` exists (0201);
  nothing calls it. In a two-person household this is one screen and one button.
- **Her GPX exports carry no Garmin Connect activity link**, so they get no Tier 1 key and a
  re-upload of the same file creates a second copy plus another card rather than attaching.
  TCX carries the watch serial and does not have this problem.

#### 7a-12. Josh gets asked, and a tag follows the OUTING *(2026-08-17, DONE — 0213/0214/0215)*

7a-7 called acceptance *"the part §A already required and nothing has ever implemented."*
0201 built `tag_claims` and `respond_to_tag()`. Running them found **three faults stacked on
each other**, each only visible once the one above it was fixed:

1. **`respond_to_tag` refused any claim that was not `proposed`.** All 44 of Josh's are
   `accepted_legacy`. So the one function built to ask him **could not be called for a
   single claim that existed.** He had never been asked and, as built, never could be.
2. **On DECLINE it marked the claim and stopped.** Right for a `proposed` claim — no
   participation row was ever written. For a legacy one the row is *already there*, put
   there by 0039's date rule, so "no" left him credited with the outing he had just said he
   was not on. A **no that changes nothing** is 0210's proposal-nobody-could-accept, one
   layer up.
3. **Then the list came back empty: 0 of 44.** Every claim names Erica's *Strava recording*,
   which he correctly may not see.

**Fault 3 is the one that mattered, because 7a-8's answer does not fix it.** Her Garmin
file becomes a **second activity row**, linked by `shared_group_id`. The claim still points
at the first. After a complete reload he would still see nothing: the outing became
visible and the tag did not follow.

That is §"Derived vs source" one level up. `activity_profiles` is per-activity because a
membership is evidence about a *recording* — but **a tag is a statement about a day that
happened**. Erica did not say "you were on my Garmin file"; she said *"you were with me"*.
Binding that to whichever row imported first makes the claim as fragile as the recording.

**So a claim resolves through its outing** (`visible_recording_of`): if the claimed
recording is hidden but another recording of the same outing is visible, he is asked about
*that* one, and accepting credits him there — where it shows up for him and counts once.
Declining removes him from **every** recording of that outing, because "I was not there" is
about the day, not about which file it came out of.

**Measured immediately, and it changed the number before anyone uploaded anything:**

    asked about, before any reload      0  →  20 of 44
                                              (Josh's OWN recordings already share
                                               an outing with hers)
    after one file upload + link              21

**What is protected, and tested.** His 219 memberships split cleanly — 44 carry the rule's
`rule_id`, 175 are his own with `rule_id` null. A tag answer can only ever reach a row
carrying *that claim's rule*, so declining "you were on Erica's copy" can never quietly
remove him from his own recording of the same day. The test asserts it, and asserts that
**the person who made the claim may not answer it**.

**The Strava guard missed a function, and widening it exposed six more.** 0214's decline
uses `DELETE … USING public.activities`, which `the_readers_stay_enforced` did not detect —
its pattern only looked for `from|join`. A `DELETE…USING` and an `UPDATE` read the table
exactly as a `SELECT` does. Widening it named six writers that had been reading `activities`
unlisted since long before this week: `merge_places`, `merge_places_auto`, `merge_visits`,
`rename_activities_for_place`, `set_activity_race`, `update_activity`. **None is a leak** —
every one writes rows a person named — but *"not named because the regex could not see it"*
is not an exemption, and the next one might not be a writer.

**0215 moves the reader onto the view.** `my_tags_to_confirm` joined `activities` directly;
its ids already came from a filtered function, so it was not a leak — but *"not a leak
because of what the other function does"* is exactly the argument that guard exists to
refuse. It was true of the fifteen readers 0196 had to move, right up until one of them
wasn't.

**Still open, and it is Erica's:** the 24 remaining claims are on outings with no visible
recording at all. They become answerable as she uploads her Garmin files — which is 7a-8,
now with the mechanism that makes it actually arrive.

#### 7a-13. A file that says nothing still identifies itself *(2026-08-17, DONE — 0216/0217)*

**It happened to her while this was being written.** Erica imported one Garmin GPX at
21:50 and the same file again at 22:01. Both said `proposed`. She now has two identical
*Loudoun County Walking* rows for 2024-09-26 — and she is about to upload ~184 files.

Measured first, as the reason:

    file-sourced activities in production        267
    of those with a de-dup key                     0

Not one. Her GPX carries no `connect.garmin.com/.../activity/…` link, so 0209's Tier 1 key
could not be built and Tier 2 could only guess. Nothing in the system could recognise a
file it had already seen.

**So when the file will not say who it is, the recording does:**

    file-content:<owner></owner>:<start to the second></start>:<distance in whole metres></distance>:<type></type>

**This is not a similarity guess, and that distinction is the entire justification for
letting Tier 1 attach on it silently.** Tier 2 asks *"could these be the same outing?"* and
must only propose, because the answer is a judgement — her two recordings of one run start
11 minutes 21 seconds apart (7a-4). This key asks *"is this the same RECORDING?"* One person
cannot start two activities of the same type in the same **second** covering the same whole
number of metres. There is no pair of distinct outings it can merge, and the test proves
both halves: a different outing at the same place on the same day is still its own activity,
and **another person's identical recording stays theirs** — the owner is inside the key
because file imports have no `connection_id`, so the unique index is global and two people
setting off together would otherwise collide into one activity.

**264 of the 267 backfilled.** One has no key possible (no distance). Two collided — which
IS her duplicate pair.

**0217 corrects 0216's handling of that collision, and the mistake is worth recording.**
0216 skipped colliding rows on the ground that a real duplicate is a person's decision, not
a migration's. Right about the merge, wrong about the key: leaving *both* unkeyed means a
third upload of that file matches neither and creates a **third** row. The skip meant to
avoid deciding for her instead guaranteed the problem would repeat. Now the earliest of each
group keeps the key, later copies stay unkeyed, and nothing is merged or deleted — her
duplicate stays visible with its card, and the next upload of that file attaches to the
original.

**Her two rows are still there on purpose.** They carry a pending card that will make the
day count once; removing one is hers to decide.

#### What this phase does NOT do

It does not add new providers. `intervals.icu`, Garmin Connect, Polar and the rest stay in
Phase 7's list. **This is the rail they all arrive on**, and building it first is what stops
the next importer repeating `import_file_activity`'s mistakes at ten times the volume.

### Phase 8 — Events, social and the privacy floor  *(APPROVED 2026-08-15; nothing built)*

**User-created events are the product; third-party feeds are garnish.** Every external
feed is revocable — never architect around one.

#### 8a. Events

- **User-created, three audiences**: private invite / friends-circle / open invite
  (discoverable pins on the map). Tokenized invite links with **no-account RSVP**,
  guest-list visibility controls, a maybe list, host update blasts, and date polls.
  Patterns to mine: Gathio, Rallly, Mobilizon/Gancio. *An open-invite event pinned at a
  trailhead, visible to anyone looking — no incumbent ships that.*
- **Free, on-brand feeds**: NPS `/events` (free key, 1,000/hr), Recreation.gov RIDB, city
  Socrata/CKAN per metro, OpenAgenda where covered.
- **Races**: RunSignup — free, geo-searchable; complete their free API-caller registration
  **before 1 Jan 2027**.
- **iCal/.ics ingest is the universal adapter** — "add a calendar by URL", recurring fetch
  + rrule expansion. Where there is no feed, read embedded schema.org/Event JSON-LD
    (facts only; respect robots.txt; nothing behind a login).
- **Weather**: NWS `api.weather.gov` (free, no key, US). Open-Meteo's free tier is
  NON-COMMERCIAL — its paid tier is required once we charge.
- **Do not build**: Facebook Graph events, Meetup, Eventbrite discovery, Yelp, Bandsintown,
  PredictHQ, parkrun (link out), Ticketmaster (owner decision).

#### 8b. Social

Friend graph + per-item privacy on Postgres RLS: canonical-ordered `friendships`, security
definer helpers (`is_friend`, `is_blocked_either_way`), a visibility enum on every
shareable noun, fan-out-on-read feed with Realtime. Comments (one level, soft delete) and
constrained reactions inherit the post's RLS. Direct messages, message requests and event
conversations use explicit conversation membership; blocking applies to all of them.
Notifications: table + Expo push + Resend.

#### 8b-i. PEOPLE: one universal system *(Erica, 2026-08-20 — approved; nothing built)*

**This replaces the 2026-08-18 Partner/friends tier.** This is a commercial app, not an app
permanently organized around Erica and Josh. A user can tag any person, find anyone tagged
in their photos/memories, retrieve everything they did with one or several people, and use
that same selection for statistics.

There is no privileged Partner data type. A partner may be a favourite shortcut, but query,
participation and statistics contracts are identical for every person.

> **SUPERSEDED, 2026-08-30.** This section used to end *"Together is a people query with ALL
> selected"*, and the contract used to name an **ALL/ANY** operator. Erica removed both:
> *"All or Any makes no sense for this."* The scope model is now **§0.2** — My Stats, Our
> Stats, and a person's own stats — and `Together`, `Just me`, `Just Josh`, `Both`, `All`
> and `Anyone` are retired words that must not reappear in a control, a function name or a
> label. Everything else in this section still stands.

The authoritative implementation contract is at the top of this file: owner-scoped private
contacts and registered users; account access separate from memory/event participation; one
enforceable memory-person relationship; verification separate from sharing; photo presence
not silently promoted to outing participation; canonical-outing filters; and the §0.2 scope
contract for Map, Overview, Places, Timeline and statistics.

#### 8b-ii. EVENTS, INVITATIONS AND MESSAGING *(Erica, 2026-08-20 — approved requirements; previews pending)*

Users create events, search for nearby/open events, invite specific users, or publish an
open invitation to all eligible users. Specific invitations and open discovery are audience
modes on the same event, not different event products. Hosts control approval, capacity,
waitlist, guest-list visibility and exact-location disclosure.

Every event has RSVP state and an eligible-participant conversation. Users can also message
registered users directly; non-friend/non-event first contact is a message request. Blocking,
reporting, moderation, rate limiting and RLS apply across event discovery, invitations and
messages. Open discovery never implies an open inbox or access to the guest list.

The Map is event discovery, Add creates an event, event detail handles RSVP/invites, and
Messages/Invitations are utility routes rather than a fifth primary navigation item. An event
is planned social data and contributes nothing to historical travel statistics until an
accepted visit/outing is explicitly created after it occurs.

#### 8c. The privacy floor — NOT optional, and enforced below the UI

- **Default private.** Per-item audience chosen at post time.
- **Privacy zones**: random-offset centre, trackpoints trimmed **at the data layer before
  any shareable polyline exists**, hide first/last 200 m by default.
- Joint-outing merges and cross-account sharing are **mutual opt-in and default off**.
- No aggregate heatmaps over private data.
- A tag or event invitation never opens an account/provider library. Sharing grants access
  only to the accepted subject at the owner's chosen level through RLS/views. Never expose
  unrelated recordings from the same account.

#### 8d. The moderation floor — mandatory before App Store submission (Guideline 1.2)

OpenAI `omni-moderation-latest` (free, text+images) on posts; a report button, a `reports`
table, timely response and a published contact; bidirectional blocking enforced in RLS;
ToS agreement at signup; Cloudflare CSAM scanning on the image zone; NSFWJS on-device
pre-upload. **Do not use Perspective API — it sunsets 31 Dec 2026.**

#### 8e. Mobile shell *(DEFERRED until the LLC)*

Expo + dev client, monorepo with `packages/core` sharing the Supabase and business logic.
`@kingstinct/react-native-healthkit`, `react-native-health-connect`. The native map
consumes **our own** `/basemap/style.json`. **Google Play personal-account rule: 12 testers
× 14 consecutive days of closed testing before production — start that clock early.**
EAS free tier is 30 builds/month.

### Phase 5 — Complete web features, then the native apps  *(QUEUED; not cancelled)*

First finish the web features recorded in this file on top of the stable private core:
the approved app structure, universal people tagging/filtering, events, invitations,
messaging, collaborative planning, remaining importers and approved card/map work. Then
build native Apple and Android clients (**name undecided**) against versioned APIs rather
than forking the business rules into three implementations.

Commercial readiness includes tenant isolation, per-tenant quotas, account deletion and
export, billing/entitlements, privacy/terms/consent, abuse controls, observability, support,
app-store release automation and tested data migration from AdventureOrNo. These are real
deliverables, not reasons to rewrite the private app today.

Two provider constraints are already established and not negotiable by wishing:

- **Google Photos can no longer answer "photos from that day."** The library scopes were
  removed in March 2025; the Picker returns no GPS and cannot search by date or location.
  Date-based photo suggestion needs the phone, not Google.
- **Strava forbids showing Josh's data to Erica** in the same application. Josh has given
  personal approval, which settles it between them; it does not change Strava's terms for
  a commercial product. The route through it is bulk export as user-owned records — 265
  of 445 activities already arrived that way.

### Open, awaiting Erica's decision (found 2026-08-11)

**A. TOGETHER, DEFINED (Erica, 2026-08-11).** Together is **a tag on a person, approved by
that person**. It is not something the app works out and applies.

- You tag someone on a place, trail, activity, photo — **anything a user can edit**.
- **They are asked to verify it before it is added.** Until they accept, it is not Together.
- If two people in the same shared group were at the same place at the same time, that produces a
  **suggestion** — *"add this ___?"* — never an automatic label.
- Everyone's own imported data is **"just me"** by default.

This supersedes the earlier "automatically labelled Together" wording, and it agrees with
§2's rule: the machine proposes, the person decides. It also settles the open question
below, which was written before this instruction.

**A(i). The old problem it fixes: "Together" was claiming things you did apart.** Same disease as 4b: absence of
information rendered as a positive claim. `visits.solo_profile IS NULL` means *nobody
said*, and the UI reads it as *both of us were there*.

- **100 visits** are NULL → shown as Together. Only **5** were set by a person.
- **56 activities** are NULL → shown as Together. **46 of them already carry an
  `athlete_id`**, so we KNOW whose outing it was and simply never used it.
- Genuinely-together evidence does exist: **16 shared outings** (27 activities linked by
  `shared_group_id`, where both athletes recorded the same outing).
  ⚠️ **CONFLICT:** §10 (the data model, below) states `null = Both`. Fixing this changes that rule to
  `null = unknown`, with Together becoming something the data has to EARN.

**B. Attaching the 156 unpinned photos.** Bucketed against the visits that already exist:

| Bucket                                                                           | Count         | Safe?                                              |
| -------------------------------------------------------------------------------- | ------------- | -------------------------------------------------- |
| Exactly one visit at that place on that day                                      | **122** | yes — same place, same day, no ambiguity          |
| Fabricated`12:00:00` timestamp                                                 | **32**  | NO — the date is not real, so it must be proposed |
| No date at all                                                                   | 2             | no                                                 |
| Ambiguous (several candidate visits)                                             | 0             | —                                                 |
| Nothing is ambiguous, which is why this is worth doing: 122 can be attached with |               |                                                    |
| certainty, and 0157 now makes that attachment permanent.                         |               |                                                    |

### PLAN: keeping the map current once we own it

*(Erica, 2026-08-11: "Create a plan to keep the map updated if things are changed.")*

Owning the basemap means owning its freshness. OpenStreetMap changes daily; the copy in R2
is a snapshot of one build. Without a refresh plan, our map silently ages while the world
moves — a new trail she walks might not exist on it.

**How it works:** Protomaps publishes a dated planet build every day
(`build.protomaps.com/YYYYMMDD.pmtiles`). A refresh is the same copy job pointed at a newer
date, into a NEW key, with a swap at the end.

1. **Never overwrite the live file.** Copy to `planet-YYYYMMDD.pmtiles`, verify it, then
   point the tile Worker at the new key and delete the old one. A half-copied basemap must
   never be able to become the live basemap.
2. **Cadence: quarterly, plus on demand.** Daily is pointless for a travel map and costs a
   137 GB copy each time. Erica asks for a refresh when somewhere she has been is wrong.
3. **Cost of a refresh:** the copy itself is free (inside Cloudflare); storage doubles for
   the hour or so both files exist — pennies. Class A writes ~1,400, well inside the free
   tier.
4. **What triggers one:** a quarterly reminder, or her saying a place is missing/wrong.
5. **Verification before the swap** (never skip): file size within ~5% of the source's
   content-length, PMTiles v3 header reads, and a handful of known tiles render — the
   Appalachian Trail, Leesburg, San Diego, Barbados.
6. **Rollback is instant** because the old file is still there until the new one is proven.

**Corrections to OSM itself** (a missing trail) are a different thing: those go upstream to
OpenStreetMap and arrive in a later build. Nothing we can patch locally without forking the
data, which we will not do.

### PLAN: a user's change can never be auto-deleted

*(Erica, 2026-08-11: "Create a plan to make sure that user changes are never auto-deleted."
Said three times now — this is the one that keeps coming back.)*

Migration `0157` fixed this for VISITS. The rule has to hold for everything she can edit.

**The principle:** a machine may write only where a person has not decided. The moment a
person decides, that field is theirs, permanently, and automation routes around it.

**Why it kept breaking:** protection depended on each writer REMEMBERING to set a flag, and
three of them did not. Nothing structural stopped a new writer from forgetting. So the fix
is never "set the flag in one more place" — it is "make it impossible to forget".

**The mechanism that works** (proven in 0157): a database trigger marks the row decided
whenever a SIGNED-IN PERSON changes it. `auth.uid()` is non-null only for a real user's
request; cron jobs and edge functions run as service_role with no uid. The discriminator is
free and cannot be forgotten, because no writer has to do anything.

**Still to extend, each needing the same treatment:**

| What she edits                             | Protected? | Notes                                                           |
| ------------------------------------------ | ---------- | --------------------------------------------------------------- |
| Visit dates, note, attribution, trip flag  | ✅ 0157    | trigger + rebuild refuses to delete                             |
| A photo pinned to a visit                  | ✅ 0157    | pin marks the visit decided                                     |
| **Place NAME**                       | ❌         | `name_locked` exists but the naming rules still write; verify |
| **Place dates** (first/last visit)   | ❌         | derived from evidence                                           |
| **Trail / segment membership**       | ❌         | `part_of` is rewritten by merges and rules                    |
| **Race names and assignment**        | ❌         | `assign_activity_to_race` rebuilds                            |
| **Activity name, type, attribution** | ❌         | learned naming rules rewrite these                              |
| **Categories and tags**              | ❌         | `sync_place_category` trigger                                 |
| **Cover photo, rating, review**      | ❌         | probably safe; verify                                           |

**And the Save button she asked for:** the trigger makes every save permanent
automatically, so the button is not strictly required to make it TRUE. It is required to
make it VISIBLE — she has been told twice that her work is safe and twice it was not. A
card that says *"Saved — automation will not change this"* with the date is the honest
version of the promise, and a way to hand a field back to automation if she ever wants it.

### THE COMMERCIAL PRODUCT — what the research settled (2026-08-11, two rounds: research then refutation)

*(Renamed 2026-08-16. This section was headed "FLOK"; the name is NOT decided — see the
top of this file — and a working title left in a heading is how it becomes the name by
accident.)*

**1. STRAVA CANNOT BE PART OF A PAID SHARED GROUP.** The risk recorded as UNVERIFIED is now
VERIFIED against the live policy (https://www.strava.com/legal/api_policy, effective
1 June 2026) and survived an adversarial re-check. Four clauses each independently kill it:

| Clause | What it says                                                         | What it kills                   |
| ------ | -------------------------------------------------------------------- | ------------------------------- |
| §5.7  | may not "aggregate, cache, or store geographic location information" | the whole map                   |
| §6.2  | may not retain Strava data "longer than seven (7) days"              | every history we hold           |
| §2.3  | data "may be displayed or disclosed … only to that user"            | showing Josh's outing to Erica  |
| §5.8  | "**may not charge end users, in any manner**"                  | charging for the product at all |

Also: §5.10 forbids it *even with the user's consent*; §5.4 forbids aggregation/analytics;
§5.5 forbids persistent indexes; §5.3 forbids AI/ML. Access is 1 athlete by default, 10
self-serve, more only at Strava's discretion. Aggregators (Terra, Spike, Rook) were shut
out on 1 June 2026, so there is no back door.

**The escape hatch is the one already in use:** a user's own Strava EXPORT is not "data
accessible via the API", and 265 of 445 activities arrived that way. It conflicts with
Erica's "no importing files, that is a last resort" — and that tension IS the decision.

**2. The provider reality for a paid product**, after the refutation corrected the first
pass:

| Provider                                | Verdict                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Health API** (ex-Fitbit) | **The one clean win.** TCX with real GPS trackpoints. Needs OAuth verification + CASA review past 100 users; exercise pages cap at 25 items, so a decade of backfill is real engineering. Legacy Fitbit API dies Sept 2026 |
| **Garmin**                        | **OPEN — apply today.** ~2 business days. The first research pass said the programme was paused; that was WRONG. Business use only, and "commercial use requires a license fee payment" for some metrics                  |
| **Polar**                         | **CUT IT.** Forward-only from the moment of consent — a new user gets an empty map until their next workout. Not "90 days of history"                                                                                     |
| **Wahoo**                         | Narrow — returns only workouts recorded through Wahoo's own systems                                                                                                                                                             |
| **Suunto / Coros**                | Approval-gated / unverifiable. Small populations                                                                                                                                                                                 |
| **Google Timeline**               | No public API. Not now, not ever                                                                                                                                                                                                 |
| **Apple Health**                  | No web API. Native app or nothing                                                                                                                                                                                                |

**3. "Within 10 feet" would break the feature.** 3.05 m is below the noise floor of consumer
GPS. Measured against real accuracy distributions it discards **~80% of genuinely-together
moments in the open, ~91% under tree cover, ~99% in a city** — worst exactly where Erica
hikes. Two more floors sit under it: polyline precision-5 quantises to ~1.1 m, and
`summary_polyline` is decimated for display, deviating tens of metres.

**The fix is to stop deciding on distance and decide on DURATION of closeness:**

| Parameter    | Erica asked | Use                                                  | Why                                                                                    |
| ------------ | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Distance     | 3 m         | **60 m**                                       | recovers ~100% open-sky and canopy. Strava's own tiles are 80 m                        |
| Start window | 10 min      | **±30 min**                                   | a fine filter, a terrible decision — 12 min apart then two hours together IS together |
| Overlap      | —          | **≥10 min AND ≥25% of the shorter activity** | below that it is a flyby, not a shared outing                                          |
| Coverage     | —          | **≥60% propose, ≥80% auto**                  | a stranger would have to hold pace within 0.10 km/h for 90 minutes to fake 80%         |
| Samples      | —          | **≥40 aligned**                               | one lucky point pair is not evidence                                                   |

Strava's shipped social grouping uses 80 m tiles and a **50%** threshold; 80% is stricter
than production. And the repo has the counterexample already: the 2026-03-07
Purcellville→Arlington run, which migration `0079`'s 800 m START-proximity rule never
caught, because the two records of the same run start in different places.

**4. One STATE.md line needs amending:** "Google Photos can no longer answer photos from
that day" is half wrong. You cannot SEARCH by date, but `createTime` comes back on every
picked item. Still no GPS.

### PLAN A TRIP TOGETHER — Erica's direction, 2026-08-11 *(new, not started)*

> "I also want to create a feature that allows users to collaborate to plan a trip"

⚠️ **THIS IS THE FIRST THING IN THE APP THAT IS ABOUT THE FUTURE.** Every noun in §2
records something that ALREADY HAPPENED: a place is somewhere you have been, a visit is a
date you were there, an activity is a route you covered. A plan is none of those, and the
one way this feature can wreck the locked system is by leaking into it — a planned trip
appearing in Places, or bumping the Trips count, or drawing a marker on the map as though
you had been there.

**THE RULE, and it is not negotiable: a plan counts for NOTHING until it happens.**
Plans live in their own tables. They are never read by `rebuild_place_visits`, never
counted by the stats bar, never drawn as a visited marker. §2's sentence "a place counts
once in Places" means once you have BEEN there.

**How it turns real.** A plan does not become a visit by the date passing — that would
invent history for a trip you cancelled. When the end date is past, the plan asks once:
*"Did you go?"* Yes creates the visit (one visit, one set of dates — §2) and the plan is
kept, attached to it, as what you meant to do. No, or no answer, and it stays a plan.
This is the only door between the two halves, and a human walks through it.

**Who can edit it.** Planning is the reason the social graph exists — it is the same
tagging-and-approval model, only pointed forward:

- The planner invites people from their shared group. An invite is **accepted, declined, or
  maybe** — nobody is added to your trip without saying yes, exactly as with Together.
- Everyone accepted can add ideas, dates and notes. Only the planner can set the trip's
  final dates, and only the planner can answer "Did you go?" — one hand on the record.
- An idea is a **place you have not been** — so it must NOT create a `places` row on the
  spot. It holds a name, a coordinate and whatever the geocoder returned. If the trip
  happens, the ideas you actually did become real places at that moment, through the same
  path as any other new place.

**Voting, deliberately small.** The heart and the flame — the same two marks, the same
component, ALREADY BUILT for photos. No new vocabulary, no star ratings on things nobody
has seen. Rating is for places you have been (§2's card), and an idea is not one yet.

**The card.** A plan is shown with the LOCKED card structure — cover, name, the sections
in the same order, the blue rule and white uppercase headings. Nothing about the card
template changes; only what fills the sections. **Erica sees a preview and approves it
before any of this is built**, per her standing rule.

**Shape of the data** (written when built, not before):
`trip_plans` (owner, name, cover, target dates, status) · `trip_plan_members` (profile,
role planner/guest, invite status) · `trip_plan_ideas` (name, coords, who added it,
optional link to a real `places` row once it exists) · reactions reuse the existing
photo-reaction machinery pointed at an idea.

**Order of work:** the data model and the invite/accept flow first (they touch nothing
that exists), the card preview second, the "Did you go?" conversion last — because that
is the only part that can write history, and it should be built when everything around it
is settled.

### ⚠️ ONE OUTING, RECORDED TWICE — needs Erica's decision (found 2026-08-11)

Rolling a trail's sections into its Visits list (so the Appalachian Trail shows all 62
records rather than the 32 on the trail row) exposed a real duplication in the data:

- **27 days on the Appalachian Trail exist as TWO visits** — one on the trail, one on the
  section walked that day. Dec 25 2026 is both "Appalachian Trail" and "Maryland Heights".
- **78 such container/member same-day pairs exist app-wide.**

**The card now draws ONE row per day** — the section's, because it says everything the
trail's row said plus which section it was. So the AT reads **35 outings**, not 62 with
twins. Nothing is deleted: both records still exist and both still open. This is a
display decision, reversible in one line.

**The question for Erica:** should the trail-level visit for a day a section already
covers be REMOVED from the data, or kept as a second record?

- Keeping it means the Visits statistic counts that outing twice.
- Removing it is a mass delete of 78 rows, which is not something to do without you —
  and some of them are marked `manual` (a human set them), which the permanence rule in
  `0157` says an automation must never undo.

Nothing will be deleted until you say so.

### C — broken now, quietly (status 2026-08-11)

|    | What                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 | The photo-gateway deploy block piped EMPTY strings over two working Worker secrets (`$SUPABASE_SERVICE_ROLE_KEY` / `$SUPABASE_ANON_KEY` do not exist in `.env.local`) | ✅ fixed in §12c — right names, and it now REFUSES to write a blank                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C2 | `CLOUDFLARE_API_TOKEN` renamed to `…_MASTER`, but wrangler reads the un-suffixed name                                                                                  | ✅ fixed in §12b — mapped across, and`wrangler login` noted as the alternative                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| C4 | The tile meter counted only tiles. Mapbox**Search Box and Directions** are plain fetches billed per request and were invisible to it                                  | ✅**VERIFIED LIVE** on deploy `f38cc846`: typing in search moved `aon_api_budget` from nothing to 1. Four call sites metered (suggest, retrieve, forward, directions) with their own 2,000/day budget; refusing a search degrades honestly, unlike refusing a tile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C3 | Server-side geocoding dead since the MapTiler suspension — verified 403 on geocoding, not just tiles                                                                       | ✅**fixed, client and server.** `MAPBOX_TOKEN` is now a Supabase secret (it was absent — the app moved to Mapbox on 08-10, the functions did not). One shared `supabase/functions/_shared/geocode.ts` does Mapbox → MapTiler → nothing, and **zero `api.maptiler.com` calls remain** outside that fallback. `geocode-new-places`, `suggest`, `detect-trips`, `strava-webhook` and `strava-backfill` redeployed; all three callable ones verified BOOTING with the new module (a bad import 500s before the auth guard, and they return their own 401 instead). Client `reverseGeocode` prefers Mapbox too. **Not yet seen end-to-end**: naming a real new place needs an owner session (Erica's) or the next Strava ingest |
| C5 | The device ingest token travels as`?token=` and is therefore in Supabase's request logs in plaintext                                                                      | ❌ not started. Needs header support + a change to her iPhone Shortcut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| C6 | `the ` is set nowhere, so `ai-suggest` silently answers "not configured"                                                                                                | ❌ not started — needs a key, or the UI should say it is off rather than look unbuilt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Erica's directions, 2026-08-11 — to build

1. ✅ **VERIFIED LIVE** (`7797d885`) — **the redundant "+ Add" button at the top of the
   map is gone.** Asked for before and missed. The nav already has Add; §3 says one door
   per action. The hidden file input that sat beside it stays: it is what the photo-drop
   flow uses.
   Also live in the same deploy: **Import & sort photos** and **Import an activity file**
   now live in Settings → Manage data, and both are gone from the Add page ("Move Import
   and Sort Photos into Settings. Move import activities to settings."). Add is down to
   one action plus the review queue — the shape it needs for the approved card, where Add
   opens a fillable card.
2. ✅ **VERIFIED LIVE** — **Settings is the gear wheel, not a nav pill.** One continuous
   page (`.settings-tabs` count 0), nav exactly `[Map, Places, Add, Timeline]`.
   **Settings becomes the gear wheel, not a nav pill.** Account, Connections, Privacy,
   Data and Advanced all extracted onto ONE nicely styled page that opens from the gear
   (bottom-left). **No section labels** — not "Account", not "People" — it should read as
   one seamless page, not five tabs stacked.
   ⚠️ **CONFLICT, resolved with her:** §3 and the nav say FIVE tabs including Settings.
   This makes it four (Map / Places / Add / Timeline) with Settings behind the gear.
3. ⚠️ **BUILT, NOT YET SEEN LIVE** (`0913f05d`) — **Join Requests is now part of the
   People section**, rendered above the member list under the one People heading instead
   of as its own labelled section. Not verifiable from the test account: that whole block
   renders only for `role === 'owner'`, so **Erica has to confirm it**.
4. ✅ **VERIFIED LIVE** (`6354cfb2`) — **photos appear on the VISIT card.** Confirmed on a
   San Diego visit: 12 photos, 24 marks, under "Photos (12)".
   The mechanism was never missing — a photo belongs to a visit when its local day falls
   inside it, OR when it is pinned. What was missing was the pinning: **35 of 177 photos
   were pinned to nothing**. 33 of them had a date AND a place AND fell inside exactly
   ONE existing visit (checked for ambiguity first: zero photos matched two visits), so
   they were pinned. **175 of 177 now.** The last two have no date at all — the "Add
   date" pill on the thumbnail is how they get one, and no automation should guess it.
   *Reversible:* the id → visit_id list is saved; `set_photo_visit(id, null)` puts any
   photo back on its own date.
   Also fixed here: the visit card's photo strip was a SECOND, hand-rolled copy of the
   place card's carousel — which is exactly why the heart and flame landed on one and not
   the other. Both now render one `<ThumbMarks>` component, so the marks cannot change on
   one card and miss the other.
5. ✅ **VERIFIED LIVE** (`0913f05d`) — **the place card has ONE carousel** with the date,
   and **the heart and flame are on it**. Confirmed on San Diego: 22 photos, 1 carousel,
   44 marks, and a react round-trip that wrote and cleared again. The marks used to exist
   only inside the full-screen lightbox, which is why they read as "where did it go".
   A mark nobody has used is invisible until hover and always visible on a phone (no
   hover there); once someone reacts it stays up, because the count is the point.
   Migration **0158** adds `photo_reactions_for_many(uuid[])` — the single-photo RPC would
   have fired ~40 requests on opening San Diego. One round trip for the strip; reacting
   re-reads only the photo you touched. **Applied to production**, verified by the network
   log showing exactly one `photo_reactions_for_many` call.

### Smaller things the 2026-08-10/11 work turned up

- The people markers collide with a place cluster when someone is standing on one.
- **Josh's last-seen is 30 hours old** because a web app gets no background location on
  iOS. Giving him the same iOS Shortcut ingest Erica has would make "where we are" real.
- **MapLibre 6 is blocked** (§8) until a GeoJSON layer is proven to draw on it.

## 6. Why work kept getting erased — and what now prevents it

Five mechanisms, all evidenced:

| Mechanism                                                            | Fix                           |
| -------------------------------------------------------------------- | ----------------------------- |
| Six competing "what to do next" documents (~380 KB across ~40 files) | This file, and only this file |
| Removals not recorded as reversible                                  | The register in §7           |
| Hand-deploys bypassing CI                                            | Phase 1                       |
| Model rules leaking across layers (`holds_children` → invisible)  | Phase 2, plus a test          |
| Config vanishing silently (`VITE_GOOGLE_CLIENT_ID`)                | Phase 1 build assertion       |

---

### The repository is PRIVATE again (corrected 2026-08-16 — it says PUBLIC below, and that is wrong)

**As of 2026-08-16 the repository is PRIVATE.** `gh repo view` reports
`"visibility":"PRIVATE"`, and fetching the old snapshot anonymously from
`raw.githubusercontent.com` returns **404**, as does the repository page.

This correction matters more than a stale fact usually would, for two reasons:

1. **It explains the outage.** The passage below records that the repo was made public
   *for free Actions minutes*. A private repo meters those minutes against the free tier
   and then bills them — and on 2026-08-15 at 17:47 UTC every workflow began failing in
   5–8 seconds with *"recent account payments have failed or your spending limit needs to
   be increased."* CI is the only deploy authority, so **production froze at `546ff11`
   for 16 commits** and the nightly Backup stopped too. Resolved 2026-08-16 by upgrading
   to GitHub Pro. **GitHub Pro does not retroactively re-run anything** — the blocked
   runs stay failed and the work has to be re-triggered.
2. **The instruction below — "do not fix this" — would send the next session the wrong
   way**, because the thing it says not to fix is no longer the state.

The good news: the data listed below is **no longer publicly readable**.

The original passage is kept because the exposure history is still true, and because
anything pushed while it WAS public should be assumed to have been seen.

#### The original entry, 2026-08-11 — accurate then, not now

`github.com/adventureorno26/adventureorno.com` was public. Erica made it public for free
Actions minutes, was shown exactly what that exposes, and chose to leave it public.

What is in the history, verified by fetching it anonymously from raw.githubusercontent.com:

| File (added in commit`3d9f1bd`, untracked later in `90ee6fb`) | What                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `supabase/snapshots/2026-07-22/location_pings_slim.json`        | **16,952 location pings**                    |
| `…/activities.json`                                            | 256 activities with coordinates and route geometry |
| `…/places.json`                                                | 129 places**with street addresses**          |
| `…/photos.json`                                                | 148 photos with lat/lng                            |
| `…/visits.json`                                                | 416 visits                                         |

Untracking a file does NOT remove it from history — that is why this survived the
2026-07 privacy cleanup. `supabase/snapshots/` is gitignored today, so nothing NEW is
being added.

**Credentials are clean.** The only secret ever committed is the old `service_role` JWT
in migrations `0057`/`0071`, and it is confirmed dead — the API answers
*"Legacy API keys are disabled."* It was already rotated; **never ask her to rotate it
again.**

**What this means going forward:** the rule does not relax now that the repository is
private again. No data dumps, no `.env` anything, no tokens, no photo coordinates in
fixtures or test data — ever. Visibility is one setting away from changing back, the
history is permanent, and a commit made under the assumption of privacy is exactly what
becomes a leak the day it flips.

### HOW PRODUCTION DEPLOYS NOW (changed 2026-08-11, at Erica's instruction)

> "disable cloudflare's auto production deployment from git pushes"
> "deploy production only after gh checks succeed"

**A push to `main` no longer publishes anything.** Cloudflare Pages'
`production_deployments_enabled` is now **false** on project `adventureorno-com`, set
through the API. Preview builds are untouched — a branch still builds so it can be
looked at.

**Production is deployed by GitHub Actions, and only after every check passes.** The
chain was already built and is now the only path:

    build · security · secret-scan · osv-scan · semgrep · zizmor ·
    db-types-drift · edge-config-drift · e2e · db-tests · deploy-preview
        ↓  (all must succeed)
    release-gate      (also requires the repo variable PRODUCTION_DEPLOY_ENABLED=true)
        ↓
    deploy-production → wrangler pages deploy --project-name adventureorno-com

**The project name was wrong in the workflow and is corrected.** It said
`--project-name adventureorno`, with a comment claiming `adventureorno-com` was "an
unused orphan with no custom domain". That is exactly backwards: `adventureorno-com`
holds the domain and the GitHub connection, and the project it named no longer exists.
Both deploy steps and the preview-URL parser now say `adventureorno-com`.

**Consequence to remember:** nothing reaches adventureorno.com until CI is green. If CI
is broken, the site does not update — that is the point, but it means a red CI is now a
blocked release, not just a red badge.

**Also disabled 2026-08-11:** the global Claude hooks that auto-committed and
auto-pushed on every session start/stop (`~/.claude/hooks/auto-push.sh`,
`auto-pull.sh`), and `permissions.defaultMode: bypassPermissions`. Her settings backup
is at `~/.claude/settings.json.bak-2026-08-11`. The auto-push hook is what resurrected
`README.md` after it was deleted (§8).

### HOW CLAUDE WORKS ON THIS REPO (her rules, 2026-08-11)

> "Make Claude work only on named branches."
> "Allow commits only after tests pass; never commit automatically on session exit."

1. **Named branches only.** `fix/…`, `chore/…`, `feat/…`. Never commit on `main`.
   `.githooks/pre-commit` refuses, and GitHub refuses the push regardless:
   *"Changes must be made through a pull request. 10 of 10 required status checks
   are expected."*
2. **A commit has to earn it.** When app code is staged the hook runs `tsc` and the
   unit tests — including `lockedCard.test.ts` — and refuses on failure. Docs and
   SQL changes do not have to boot vitest. Enable per clone with
   `git config core.hooksPath .githooks`.
3. **Nothing commits itself — except GitDoc, which does (found 2026-08-14).** The
   global Claude hooks that committed and pushed on every session start and stop are
   gone (backup: `~/.claude/settings.json.bak-2026-08-11`). That Stop hook is what
   resurrected `README.md` 90 minutes after it was deleted (§8). **But this line was
   still not true.** Commits kept appearing under Erica's name with a timestamp for a
   message — `Aug 14, 2026, 10:53 PM` — three times in one evening. They are not git
   hooks (`.githooks/` holds only `pre-commit`) and not a cron job. They are the
   **GitDoc** VS Code extension, configured in her *user* settings
   (`~/Library/Application Support/Code/User/settings.json`):

   ```jsonc
   "gitdoc.enabled": true,
   "gitdoc.autoCommitDelay": 30000,   // commit 30s after a file stops changing
   "gitdoc.autoPush": "onCommit",
   "gitdoc.pullOnPush": true,
   ```

   **Why it matters, concretely.** It commits work *while it is being written*: one
   evening's export fix was split across two timestamp commits mid-edit, and a
   component change landed on the branch of an unrelated PR because that is what
   happened to be checked out. It attributes machine-written work to **Erica**. With
   `autoPush: onCommit` it will also push whatever it commits the moment a branch has
   an upstream. It respects `pre-commit` (`noVerify: false`), so it cannot commit
   failing code — but it decides *when* and *what*, which is exactly what rule 3 says
   nothing should.

   **TURNED OFF 2026-08-16**, by setting `"gitdoc.enabled": false` in
   `~/Library/Application Support/Code/User/settings.json` (backup alongside it:
   `settings.json.bak-2026-08-16-gitdoc`). Nothing commits itself in this repository any
   more, and rule 3 is finally true as written.

   **Invoking *GitDoc: Disable* was not enough, and that is worth knowing.** It was run,
   and GitDoc carried on committing — `e42b78e` and `f06808d` landed after it. The
   command did not persist to the settings file; only editing `gitdoc.enabled` did.
   **Verify it by watching for a new timestamp commit while editing a file, not by
   watching an idle window** — an idle repo looks identical to a disabled extension, and
   that false negative was briefly recorded here as success.

   **What it cost, so the trade is on the record.** It made 21 commits, all attributed
   to Erica, all with a timestamp for a message. It never LOST anything — audited
   2026-08-16 across all 13 branches holding those commits, every file they touched is
   present in `origin/main` (`absent: 0`). The damage was legibility: it committed
   mid-edit, split single changes across two timestamp commits, and put changes on
   whichever branch happened to be checked out. That is what made "is our work safe?"
   a question that took an hour to answer instead of a minute.

   **Beware of two false alarms it causes**, because both will recur while reading old
   history: squash-merging destroys BOTH commit ancestry and patch-id, so
   `git merge-base --is-ancestor` and `git cherry` each report merged work as missing.
   Neither is evidence. Compare file CONTENT against `origin/main` instead.

   To turn it back on: `gitdoc.enabled: true`. It is a per-machine editor setting, not
   a repo setting, so nothing in this repository can prevent it. A commit here with a
   timestamp for a message was written by the editor, not by a person or by Claude.
4. **`bypassPermissions` is off** in her Claude settings.

### THE ONLY ROUTE TO THE LIVE SITE (2026-08-11)

    named branch → pull request → 10 required checks → merge to main
        → release-gate → production environment approval (Erica)
        → wrangler pages deploy --project-name adventureorno-com

- **Direct pushes to `main` are rejected**, admins included (`enforce_admins: true`),
  verified by attempting one.
- **Cloudflare no longer builds production from git** —
  `production_deployments_enabled: false`. Previews still build.
- **The `production` environment requires Erica's approval** and accepts deployments
  only from protected branches.
- **Merged branches delete themselves.**
- Linear history required; force-pushes and branch deletion on `main` are refused.

### THE PINNED TOOLCHAIN (2026-08-11)

| Thing    | Pinned to                | Where                                                                                                           |
| -------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Node     | **22**             | `.nvmrc`, `engines` (`>=22 <23`), CI `setup-node`, Cloudflare `NODE_VERSION` (production AND preview) |
| Wrangler | **4.113.0, exact** | `app`, `workers/photo-gateway`, `workers/basemap`                                                         |

The Mac was on **Node 26** while CI ran 22 — the two only agreed by luck. Wrangler was
worse: `app` had `^4.113.0`, `photo-gateway` had `^3.80.0`, and `workers/basemap` never
declared it at all despite its deploy script calling it, so it silently used whichever
version happened to be hoisted (3.114.17). Three versions, one repo.

`adventureorno.code-workspace` is the VS Code entry point — format-on-save, ESLint
pointed at `app/`, the repo's own TypeScript, test tasks, and a terminal that opens in
the REPO rather than the OneDrive parent.

### THE DATABASE CHAIN IS CLEAN NOW (2026-08-11)

**162 migrations apply to a fresh database with ZERO errors, on Postgres 17, and all
31 SQL suites pass.** Four things were wrong; all four are fixed.

**1. Postgres was 15 locally and in CI, 17.6 in production.** Every SQL test proved
something about a different engine than the one serving the app. `config.toml` is now
`major_version = 17`, done the way the old comment demanded: the ~3.5 GB image was
pulled first, then the full chain and every test were run against a fresh 17 container
before the change was committed. If CI's database job ever times out pulling that
image, **cache the image — do not go back to 15.**

**2. One migration error was "tolerated" and no longer is.** `0044` backfills
`places.city` from `places.address`, a column no migration created until `0098` — it
existed in production only because it drifted in outside the migrations. The backfill
is now guarded on the column existing, so it is a no-op on a fresh database (which has
no rows to backfill) and byte-identical anywhere the column exists.
`scripts/db-bootstrap.sh` no longer has a special case: **any** error fails it now.
*Do not add another. A tolerated error is a migration that does not work on a fresh
database, which means the chain cannot rebuild anything — including a restore.*

**3. `0001` could not apply to a genuinely fresh database.** Its `SECURITY DEFINER`
helpers are defined before `public.profiles` exists and read it, and Postgres validates
a function body at creation time. It only ever worked because `db-bootstrap.sh` sets
`check_function_bodies=off` for its session — so the chain was appliable through **one
script and no other path**. `0001` now sets that itself, `set local`, for its own
transaction. The header says never edit 0001 after merge; this is the one case the rule
cannot cover, because the failure happens *while applying 0001* and no later migration
is ever reached.

**4. EIGHT migrations were applied to production but absent from its ledger.** They
were executed through the Management API's query endpoint, which runs SQL and records
nothing. The schema was right and `supabase_migrations.schema_migrations` was lying —
which matters exactly when you cannot afford it: a restore rebuilds from the ledger, so
an unrecorded migration is silently missing from the restored database, and
`supabase db push` re-runs anything unrecorded. Each of the eight was **verified present
in production** before being recorded (recording an unapplied migration makes it skip
forever, which is worse than the gap).

`npm run check:ledger` (`scripts/check-migration-ledger.mjs`) now compares the repo
against production's ledger so this is caught before a merge instead of weeks later. It
warns rather than fails, because a branch that legitimately adds a migration is "ahead"
until it deploys; `STRICT=1` makes it fail.

**Checked while there:** `anon` reaches **zero** ordinary tables and can execute **zero**
SECURITY DEFINER functions in production. (An earlier draft of this note claimed
otherwise — that check wrongly counted PostGIS's own `geometry_columns`,
`geography_columns` and `spatial_ref_sys`, which `0154` deliberately excludes.)

## 6b. BACKUP AND RECOVERY (built 2026-08-12)

### The state it replaced

**There was no backup of this database anywhere.** Supabase's backup list was empty
and PITR was off, verified through the Management API. A bad migration, a dropped
table or a lost account would have taken **149 places, 489 visits** and every note,
rating, date and photo-to-visit link with it. The scripts that existed
(`export-data.sh`, `restore-data.sh`) were never scheduled, never encrypted, never
retained and never tested.

### What runs now

`.github/workflows/backup.yml` — **separate from `ci.yml` on purpose**, so a backup
never stops because a code check went red, and a red backup is not lost among other
failing jobs.

| Job                | When                 | What                                                                                                                |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `database`       | nightly 07:17 UTC    | every table → JSONL + manifest (row counts + sha256),**age-encrypted before upload**, then R2 with retention |
| `objects`        | nightly              | mirrors`adventureorno-photos` → `aon-backups/objects/` (incremental)                                           |
| `freshness`      | nightly,`always()` | **fails if no recent artifact exists**                                                                        |
| `verify restore` | on demand            | restores the newest backup into a disposable Postgres 17 and checks every row count                                 |

**Retention (grandfather-father-son):** 14 daily · 8 weekly (Sundays) · 12 monthly
(the 1st). ~3 MB a night, inside R2's free tier. A single rolling copy is not a
backup — it overwrites itself with the corrupted version the night after something
breaks.

### The token CI needs is NOT the deploy token

`secrets.CLOUDFLARE_API_TOKEN` deploys Pages and has **no R2 permission** — the first
real backup run failed all three jobs with `403 … Authentication error`, after the dump
and encryption had already succeeded. The backup jobs use
`secrets.CLOUDFLARE_API_TOKEN_MASTER`, which is the same value as
`CLOUDFLARE_API_TOKEN_MASTER` in `.env.local`.

⚠️ **That is a broad account token.** A least-privilege token scoped to R2 read on
`adventureorno-photos` and read/write on `aon-backups` would be better, and is worth
doing when there is a reason to touch it — it just cannot be minted from the API, so it
is a dashboard job.

### Encryption

`age`. R2 only ever receives ciphertext, so a leaked R2 token exposes nothing.

- **Public key** (encrypts; safe anywhere): `age1zsd4ptmy57sl2ad9utgafylsw5yl5y87luuhn9h5afywz28sdaps20aw52` — repo variable `AGE_RECIPIENT`.
- **Private key** (decrypts): `~/.aon-backup/backup-key.txt`, mode 600, **never printed and never committed**; also GitHub secret `AGE_SECRET_KEY` so the verify job can restore.
- ⚠️ **If that private key is lost, every backup is unreadable.** Keep a copy somewhere that is not this Mac — a password manager is fine.

### Photos are backed up separately, because the dump is only a manifest

`photos` and `videos` rows carry **R2 object keys, not bytes**. Restoring the database
alone gives rows pointing at nothing — and every map marker is a photo, so that is not
a restore. `scripts/backup-r2.mjs` mirrors the objects; **362 objects, 289 MB** at first
run. The object mirror is *not* encrypted: opaque blobs under UUID keys, already
private in R2, and re-encrypting nightly would force a full re-upload on every key
rotation. The database backup — the names, notes, coordinates and dates that make the
photos mean anything — **is** encrypted.

### Proven, not assumed

Run end-to-end on 2026-08-12: pulled from R2 → decrypted → schema rebuilt from the
migration chain into a fresh Postgres 17 → every row loaded → **all 38 tables matched
the manifest exactly, 18,833 rows, zero errors.**

It failed twice first, which is the entire argument for testing restores:

1. Hand-built INSERTs died 18,024 times on `uuid[]` vs `jsonb`. Fixed with
   `jsonb_populate_record`, letting Postgres cast into its own row type.
2. Then `permission denied to COPY from a file` (Supabase's `postgres` is not a
   superuser → use `\copy`) and `cannot insert a non-DEFAULT value into column "geom"`
   (generated columns must be excluded; they recompute from lat/lng).

A backup nobody has restored is a rumour. This one has been restored.

### Recovery objectives

|                                   |                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RPO** (data you can lose) | **≤ 24 h** — nightly. An outage at 07:00 loses that day's edits.                                                                                           |
| **RTO** (time to be back)   | **≈ 30–45 min** — ~2 min to fetch and decrypt, ~4 min to rebuild the schema, ~2 min to load, the rest for Supabase project setup and re-pointing the app. |
| **Objects RPO**             | ≤ 24 h, incremental                                                                                                                                               |

### How to actually recover

1. `AGE_KEY_FILE=~/.aon-backup/backup-key.txt npm run backup:verify` — proves the
   artifact and the key still work, on a disposable database, before touching anything.
2. New Supabase project → `supabase link` → apply the migration chain
   (`scripts/db-bootstrap.sh`). The dump carries `_migrations.jsonl` so the schema can
   be rebuilt to **exactly** the chain the data came from.
3. Load the rows the way `verify-restore.sh` does (`\copy` + `jsonb_populate_record`,
   generated columns excluded).
4. Copy `aon-backups/objects/` back into the photos bucket.
5. **Credentials are NOT in the backup, deliberately** — `ingest_tokens`,
   `strava_accounts`, `google_tokens` and `oauth_states` are excluded, because
   restoring them restores someone's ability to act as her. Recreate by: signing in
   with Google again, reconnecting Strava in Settings, and minting a new device ingest
   token for the iPhone Shortcut. Everything else comes back from the dump.
6. Point the app at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
   and the Worker secrets in §12c).

### Raw dumps still never go in git

`supabase/snapshots/` is gitignored and `.backup-work/` was added to `.gitignore` with
this work. **The repository is PRIVATE** — verified against the GitHub API on 2026-08-28
(`adventureorno26/adventureorno.com`, `isPrivate: true`). This paragraph said "public"
until then, contradicting the correction already recorded above; the habit stands either
way, because private is a setting and a leak is forever.

## 6c. SUPABASE ADVISOR BASELINE (folded in from `security/advisor-baseline.md`, 2026-08-28)

That file was the last markdown outside this one. Its content lives here now and the file
is gone, per §"one document". **Re-measured on 2026-08-28, not copied forward.**

Re-check with (the browser-like User-Agent is required — the Cloudflare WAF in front of the
Management API returns 403 "error 1010" without one):

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
  "https://api.supabase.com/v1/projects/aanfyhsjbtnqzphuoiem/advisors/security"
```

**The baseline was 83 findings on 2026-08-07 and 188 on 2026-08-28. Re-measured 2026-08-29:
188 before any change, 181 after `0271`.** A finding NOT on this list is new and needs a
decision.

| Level | Name                                              | 08-07 | 08-28 | 08-29 | Status                                     |
| ----- | ------------------------------------------------- | ----- | ----- | ----- | ------------------------------------------ |
| ERROR | `security_definer_view`                           | 0     | **4** | **3** | `visible_activities` fixed in `0271`; the other three are **open by decision** — see the proof below |
| ERROR | `rls_disabled_in_public` (`spatial_ref_sys`)      | 1     | 1     | 1     | Cannot fix — PostGIS-owned                 |
| WARN  | `authenticated_security_definer_function_executable` | 72 | 167   | 167   | Intended — the RPCs are the only door      |
| WARN  | `anon_security_definer_function_executable`       | 3     | 3     | 3     | Cannot fix — PostGIS `st_estimatedextent`  |
| WARN  | `function_search_path_mutable`                    | 0     | 6     | **0** | **CLOSED** — all six pinned in `0271`. A pin is not permanent: a later `create or replace function` without `set search_path` silently drops it, which is how `is_generic_activity_name` (created `0147`, re-created `0226`) would have lost one. If this row comes back, that is why |
| WARN  | `extension_in_public`                             | 3     | 3     | 3     | Accepted                                   |
| WARN  | `auth_leaked_password_protection`                 | 1     | 1     | 1     | **Open — needs Erica.** Offered 2026-08-29 and not taken; it is a Management API `PATCH /v1/projects/<ref>/config/auth` or one dashboard toggle |
| INFO  | `rls_enabled_no_policy`                           | 3     | 3     | 3     | Intended (deny-all)                        |

**Total: 83 (08-07) → 188 (08-28) → 181 (08-29).** The seven that went are the six pinned
search paths and the one view that proved safe to flip.

### The four new ERRORs are ours, and they matter before anyone else has an account

Migration `0266` turned the profile-only participant tables into views, and all four were
created **SECURITY DEFINER**:

`public.activity_profiles` · `public.activity_provenance` · `public.visible_activities` ·
`public.visit_profiles`

A SECURITY DEFINER view runs as its OWNER, so it **bypasses the row-level security of
whoever queries it**. Today that is survivable because the only two accounts are Erica's
and Josh's inside one household. It stops being survivable the moment Phase 3b gives
anyone else an account, and it is the same shape of hole as §7d's Strava finding: a lock
built in the database and fitted nowhere. Fix them to `security_invoker = true` and prove
each one still returns the same rows for each member.

### 2026-08-29 — the proof was run, and it says three of the four are not a flip

The instruction above ends *"prove each one still returns the same rows for each member."*
That proof had never been run. It has now: all four views flipped to `security_invoker`
inside a transaction, `count(*)` taken as each of the three accounts (`set local role
authenticated` + `request.jwt.claims.sub`), then **rolled back**. Nothing was changed to
measure it.

| view                  | Erica        | Josh         | Test bot     | verdict     |
| --------------------- | ------------ | ------------ | ------------ | ----------- |
| `activity_profiles`   | 627 → 536    | 627 → 486    | 627 → 303    | **DIFFERS** |
| `activity_provenance` | 571 → 480    | 571 → 430    | 571 → 293    | **DIFFERS** |
| `visible_activities`  | 480 → 480    | 430 → 430    | 293 → 293    | same        |
| `visit_profiles`      | 664 → 359    | 664 → 305    | 664 → **0**  | **DIFFERS** |

So the assumption behind the instruction was wrong, and that is worth more than the fix
would have been. **The definer property is currently doing something**: it hands every
member all 627 participations and all 664 visit participations, straight past the RLS on
`memory_people` (`can_see_memory_subject(subject_id) or person_is_mine(person_id)`),
`memory_subjects` and `people`. Those policies exist and are not decorative — under
invoker they remove between 15% and 100% of the rows depending on who is asking.

Flipping the three is still the right end state; it is exactly the leak this section
describes. But it **changes what the app shows today** — Erica's visit participations
would go 664 → 359 — and that is a decision about the product, not one a migration takes
on its own. It stays open, with the numbers, so it is argued from evidence next time
rather than re-measured.

`visible_activities` is the exception and not by luck: its own `WHERE` is the same
expression as the `activities_select` policy, so invoker RLS re-applies a filter the view
had already applied. Identical for all three accounts. **Migration `0271` flips that one,
pins the six `function_search_path_mutable` paths (all six are SECURITY INVOKER and
reference only `public`, so pinning changes no result), and asserts all of it in the same
transaction.** Applied and recorded 2026-08-29; the advisor count moved 188 → 181.

**Erica's decision, 2026-08-29: leave the three open and documented**, and revisit before
Phase 3b gives anyone else an account — which is the moment §6c already names as the one
where it stops being survivable. When that day comes the work is not "flip them": it is to
decide, for each of the three, whether the RLS-filtered row set is what the screen should
show, and then either flip and re-verify the participant lists in the app, or keep the
views definer and write the intended visibility into their `WHERE` clauses explicitly. The
numbers above are the starting point either way, so nobody has to measure this twice.

**`spatial_ref_sys` and `st_estimatedextent` are not ours.** Both are owned by
`supabase_admin` and belong to PostGIS — verified via `pg_class.relowner` + `pg_depend`.
Migration `0093`'s lockdown tried to revoke the `st_*` grants and Postgres answered
`WARNING: no privileges could be revoked`. This is why `scripts/db-test.sh`'s lockdown
check excepts `st_*`, and why its "0 anon-executable SECDEF functions" result is accurate
for first-party code.

## 6d. 2026-08-29 — THE NIGHT'S WORK, AND WHAT IS LEFT

Five reported problems, all closed, plus four found while closing them. Production ends the
night at `ac56044` with `check-data-integrity.mjs` reading **"Production data is
consistent"**, 273 migrations recorded, and **zero** open Dependabot advisories.

### Done

| # | What was wrong | What was done |
| - | -------------- | ------------- |
| 1 | **The working copy was not a git repository.** No `.git`: no history, no hooks, nothing to push, OneDrive underneath it | Verified against a fresh clone that every tracked file was byte-identical to `origin/main` @ `9aa0b76` — **nothing was lost** — then repaired in place with `init` + `fetch` + `reset --mixed`, which never touches the working tree. `core.hooksPath` re-set. Session-start check written into the Git & GitHub section |
| 2 | **`main` had no protections and Dependabot was off** | Ruleset `21818125`: no deletion, no force-push, PR required, `Release gate` required, admin bypass kept. Alerts + automated security fixes enabled. The claim that this plan could not do branch protection was stale — it predated GitHub Pro |
| 3 | **The Overland device credential was stale** | Worse than stale: **`source='overland'` is zero rows, all time.** Timeline stopped 2026-07-19, Overland never started, so there is no live location ingest at all. Written into §12a step 7, which had read as a finished setup. Josh's ingest token revoked (business rule #7 said one token; there were three) |
| 4 | **Three data inconsistencies** | Riverpoint Drive Trailhead's count repaired in `0271`; the two evidence-less visits deleted with Erica's yes, **undo snapshots recorded verbatim in §7**. Then `0272`, then `0273` — see the `visit_count` section, this is the one that kept coming back |
| 5 | **Supabase advisor backlog, 188 findings** | **181.** All six `function_search_path_mutable` pinned and `visible_activities` flipped to `security_invoker` in `0271`. The proof §6c demanded had never been run; it has now, and it says three of the four views are **not** a drop-in flip. Erica's call: left open, documented, with the numbers |
| 6 | *Found:* **17 Dependabot advisories, 2 critical**, invisible until alerts were switched on | **Zero.** `#158`, `#159`, `#161` landed; the last six were one `wrangler` pin bump (`#163`), because `sharp` and `undici` both arrive only through `wrangler` → `miniflare` |
| 7 | *Found:* **`places.visit_count` had no maintainer at all** — it drifted three times in one evening, twice from deletes and once from a visit added through the app mid-session | `0273` gives it a trigger, and proves it with a live insert/delete round trip against production inside a rolled-back transaction |
| 8 | *Found:* **the `@rollup/rollup-linux-x64-gnu` pin was holding nothing** | `rollup` left the tree entirely when Vite 8 moved to rolldown. Pin removed, note rewritten (`#163`) |
| 9 | *Found:* **GitHub Actions was billing-blocked** — every run failed to start with *"recent account payments have failed or your spending limit needs to be increased"*, the same failure as §7d on 2026-08-16, and nothing could deploy | Cleared by Erica. `main` deployed `d347797` then `ac56044`; `/version.json` confirms |

### Left

**Nothing is blocked and nothing is half-finished.** Three items are open *by decision*, not
by omission, and each is recorded where the work would start:

1. **The three SECURITY DEFINER views** (`activity_profiles`, `activity_provenance`,
   `visit_profiles`) — §6c, with the measured row counts per member. Erica's decision was to
   leave them and revisit **before Phase 3b gives anyone else an account**, which is the
   moment §6c already names as the one where it stops being survivable.
2. **`auth_leaked_password_protection`** — one toggle, offered and not taken. §6c.
3. **Retiring `places.visit_count`** — optional now rather than needed. `0273` made the
   column correct; deleting it is a tidier end state whenever a reader-migration is worth
   doing.

And one standing operational fact, not a task: **there is no live location ingest.** Overland
has never delivered a ping and Timeline stopped on 2026-07-19. Nothing is broken in a way
that logs — it simply never ran.

### Two tripwires fired, and both were right

Neither was noise, and neither would have been caught by reading the diff.

- **`0190_the_count_was_a_leftover.test.sql`** asserted that `visit_count` *drifts*, and
  said in its own comment: *"if a later change adds a trigger and the column starts keeping
  up, THIS TEST SHOULD FAIL and be deleted along with the workaround it documents."* `0273`
  added that trigger and it failed, by design, in CI. Section 1 is now its inverse and is a
  stronger test than before: the hand-written backfill is gone, so the INSERT side is proved
  through `create_visit` instead of assumed. Sections 2–4 are untouched.
  `0126_visit_counts_are_visits_not_days.test.sql` independently confirms the design choice
  — it already asserted `visit_count = count(*) from public.visits` everywhere, which is why
  `0273` counts plain `visits` and **not** `accepted_visits`; the other choice would have
  started failing `0126`.
- **`0154_authz_matrix.test.sql`** caught `0273` handing `anon` EXECUTE on a SECURITY DEFINER
  function. Postgres default-grants EXECUTE on a new function to PUBLIC, and `0273` did not
  revoke it. **This is a repeat and the repo already warned about it** — `scripts/lockdown.sql`
  opens with *"run after EVERY migration deploy … this happened in 0101"*, and `db-test.sh`
  prints *"run scripts/lockdown.sql after the offending migration (and revoke anon in it)."*
  Fixed in `0274`. It was never actually exploitable — calling a plpgsql trigger function
  directly raises immediately, since `tg_op`/`old`/`new` do not exist outside a trigger — but
  "harmless this time" is a judgement someone has to re-make every time, and 0101 is what
  that costs. **A new SECURITY DEFINER function needs its revoke in the same migration.**
  Verified after the revoke that the trigger still fires for `authenticated` through the real
  `create_visit`/`delete_visit` path: Postgres checks EXECUTE when a trigger is CREATED, not
  when it fires.

### The two mistakes worth keeping

- **A migration is replayed from nothing, so its guard cannot assert today's production.**
  `0271` and `0272` first said *"expected exactly 1/2 places with a stale visit_count"* —
  true of production that afternoon, false of the empty schema `db-test.sh` rebuilds, where
  the count is 0. CI caught it and was right. The guards are now "at most", which still
  refuses to repair more rows than each file was written for.
- **The service_role key in `0057`/`0071` was raised as a live exposure. It is not, and this
  file already said so** — twice, at *"Credentials are clean"* and again in §8's rules.
  It is confirmed dead, it was rotated long ago, and **the answer is already written down;
  read it before raising it.** Erica has now said so a third time. Do not ask again.

---

### 6i. A PURGED PHOTO LEAVES ITS BYTES IN R2 — and the first one is due in 8 days

The sharpest thing the 2026-08-29 audit found, because it has a date on it.

Deleting a photo has two paths and only one of them honours business rule #6:

- **Through the Worker's `/delete`** — the R2 objects and the DB row both go, and the hash
  lands in `deleted_hashes`. Rule #6 exactly.
- **Through the trash** — `deleted_at` is set, the row and objects stay, and `purge_trash()`
  (nightly, 04:30) hard-deletes any `photos` row 30 days later. **Nothing deletes its R2
  objects.** SQL cannot reach R2; `purge_trash` is SQL; and the Worker's `/reconcile` is
  `dry_run: true` and says so in its own comment — it counts orphans and deletes nothing.

**It has never shown up because it has never fired.** R2 and the database agree exactly
today — 179 live rows, 358 referenced keys, **0 orphans and 0 missing**, confirmed by
listing the bucket and diffing on `r2_key`/`thumb_key`. One photo is 22 days into trash. On
day 30 it becomes the first pair of objects nothing references and nothing will remove.

(The first attempt at that diff compared R2 key UUIDs against `photos.id` and reported 186
orphans and 179 missing with zero overlap — which is the signature of comparing the wrong
identifier, not of a broken bucket. The keys are `r2_key` and `thumb_key`. A reconciliation
that finds *everything* wrong is almost always measuring the wrong thing.)

#### What `0277` does, and what it deliberately refuses to do

It does **not** delete anything from R2, and it schedules nothing that will. Automatically
and irreversibly destroying the bytes of these photos is not a change to make on an agent's
judgement: §12d calls this data *"irreplaceable and private"*, and a bug in an automatic
purger cannot be undone the way a bug in a report can.

Instead it makes the leak **recorded instead of silent**. `purge_trash()` now writes every
key it is about to orphan into `public.purged_media` before deleting the row that names it —
after the delete, nothing left in the database knows those keys existed. Deny-all RLS,
service-role only, `deleted_from_r2_at` null meaning "still in R2, still owed a deletion".

So "which objects should not be there" becomes a query instead of an archaeology exercise
against a bucket, and draining it is a decision **with a list attached**.

**Erica's call, and the only thing outstanding from this audit:** whether to drain it by
hand, or to authorise a job that deletes R2 objects for rows in `purged_media`. Until one of
those happens the objects accumulate — slowly, visibly, and without losing the ability to
tell which they are.

### 6g. `backup-freshness` was measuring age from the wrong thing

Reported *"27h old"* for a backup taken 13 hours earlier, because it read the date out of
the `db/YYYY-MM-DD/` key prefix and measured from **midnight of that day** rather than the
object's timestamp. It only ever overstated, so it never hid a gap — but a number that can
be a full day out is a number nobody trusts, and this is the check that answers "am I
covered?". It now reads R2's `last_modified`, with the folder date as fallback.

The second bug in the same three lines was the dangerous one. When a key did not match the
expected shape, `day` was `undefined`, `new Date("undefinedT00:00:00Z")` gave NaN, and
`NaN > MAX_AGE_HOURS` is **false** — so a bucket whose keys had been renamed would report
**"covered"**. That is precisely the silence the file opens by saying it exists to prevent:
*"the dangerous failure is SILENCE… nothing goes red because nothing runs."* An age that
cannot be read is now a failure, not a pass.

Backups themselves were fine throughout: daily, succeeding, 14 generations retained, 364
objects mirrored — the check was misreporting, not the backup misbehaving.

### 6e. THE PERFORMANCE ADVISORS, first read 2026-08-29

§6c has tracked the **security** advisors since 2026-08-07. The **performance** list had
never been opened. It had **181 findings**, and re-checking it is the same call with
`/advisors/performance` instead of `/advisors/security`.

| Level | Name | before | after `0275` | Status |
| ----- | ---- | ------ | ------------ | ------ |
| WARN | `auth_rls_initplan` | 6 | **0** | **CLOSED** — bare `auth.uid()` in a policy is re-evaluated per row scanned; `(select auth.uid())` hoists it to an InitPlan |
| WARN | `duplicate_index` | 1 | **0** | **CLOSED** — `location_pings` carried two identical indexes; `pings_profile_idx` dropped |
| WARN | `multiple_permissive_policies` | 114 | 114 | Mostly noise: counted once per role, and most name roles nobody authenticates as (`dashboard_user`, `authenticator`, `cli_login_postgres`) |
| INFO | `unindexed_foreign_keys` | 53 | 53 | **Noise at this size, not deferred work.** Measured before judging: the largest table is `location_pings` at 17,145 rows / 9 MB, then `service_health` 11,885, then nothing above 1,300. Postgres scans a 168-row `places` faster than it walks an index. 53 new indexes would cost write throughput and storage for no measurable read gain. Revisit if a table passes ~100k rows |
| INFO | `unused_index` | 5 | 5 | Leave. "Unused" here means "not used yet"; dropping an index on read patterns this young is guessing |
| INFO | `no_primary_key` | 2 | 2 | `trip_migration_exceptions`, `place_membership_exceptions`. Small operator-facing exception lists; adding a key to a table whose rows are matched by content is a data-model decision, not a performance fix |

**Total 181 → 174.**

`auth.uid()` is STABLE, so hoisting it cannot change a result — but "cannot change a result"
is exactly the sort of claim that is true until it isn't, so it was measured: all six
policies rewritten inside a transaction, `count(*)` on all five affected tables as each of
the three accounts, then rolled back. **Fifteen comparisons, fifteen identical.**

| table | Erica | Josh | Test bot |
| ----- | ----- | ---- | -------- |
| `activities` | 480 | 431 | 293 |
| `activity_reactions` | 0 | 0 | 0 |
| `memory_people` | 1000 | 797 | 303 |
| `memory_subjects` | 836 | 632 | 293 |
| `people` | 4 | 4 | 3 |

The migration asserts the rewrite stuck, that no bare `auth.uid()` survives, **and that every
`ALL` policy kept its `with check` half** — dropping that half does not fail a read test, it
quietly widens writes, which is the way this change could have gone wrong unnoticed.

### 6h. `prune_service_health()` had never run once

`0194` created the watchtower's health ledger, wrote the pruner, wrote the reason above it
— *"Keep the ledger from growing without bound; a fortnight is plenty to see a pattern"* —
and revoked its grants correctly. **It never scheduled it.** Every other maintenance
function in this database got its `cron.schedule` in the migration that created it
(`rebuild-revealed-area` 0045, `dedupe-joint-outings` 0079, `purge-trash` 0088,
`cluster-nightly` 0003). This one was missed, and nothing else called it — not
`purge_trash`, not the watchtower Worker.

Same shape as §7d's Strava finding and §6c's definer views: **a lock built and fitted
nowhere.** And found the same way — by asking production how big its tables were, not by
reading the code. `service_health` was 11,885 rows over 15 days (~792/day), with the oldest
row already past the 14-day retention the function existed to enforce.

`0276` schedules it at 04:40 UTC, beside the other nightly maintenance and clear of 07:10's
rebuild, and runs it once to clear the backlog. Not urgent — a slow leak on a database whose
largest table is 17k rows — but an unbounded log is only cheap until it isn't, and the fix
is the one line that was missing.

**The general lesson, since this is the third of its kind:** a function written and not
wired up leaves no trace in any test, any advisor or any lint. The only thing that finds it
is comparing what production *does* against what the repo *says*. That is what an audit is
for, and it is why "the code is correct" and "the system does it" are different claims.

**And the watchtower could not have caught this, by construction.** `0197` watches the jobs
in `cron.job` and reports `has never run` when a job has no run history — good, and it does
work: the moment `0276` scheduled the pruner, the next health sweep reported
`cron:prune-service-health · ok=false · "has never run"`, exactly as designed. But before
`0276` the job **did not exist in `cron.job` at all**, so there was nothing to watch and
the ledger was silently green. `service_health` shows it: one check for that service in 24
hours, the one after it was scheduled.

So the monitor covers *scheduled jobs that stop running*. It cannot cover *a job that was
never scheduled* — that is the blind spot, and it is not fixable by adding a check to the
same list, because the list is built from `cron.job`. What would catch it is asserting that
every maintenance function has a caller. Worth doing if a fourth one of these turns up;
recording the shape here so the next session does not have to rediscover it.

It self-resolves once the job fires: `ok` requires a successful run inside the freshness
window (25h by default until three runs give it a median), so after 04:40 UTC the entry
goes green and stays green. Read from `0197`'s SQL rather than assumed.

### 6f. THE DEPLOYED APP, hit-tested 2026-08-29

`scripts/audit-live.mjs` drives the real production build, signed in, across 13 routes × 3
viewports. It needs no password: `app/e2e/fixtures.ts` mints a test-bot session from the
service key via `generate_link` + `verify`, and the same few lines work standalone.

**112 findings, and none of them in a category that means something is broken.** No console
errors, no failed requests, no blank pages, no horizontal overflow, no broken images —
anywhere. What it found was `tiny-target` (81) and `obscured-control` (31), which are the two
categories the script's own header lists as known and deliberately left for a human:
map attribution, the `/places/edit` bulk table on a phone, and touch-target sizing which is
Phase 4 work.

Two clusters in there are **not** on that known list and are worth a human eye before anyone
calls them defects — `visit-row` on `/settings` reported as covered on all three viewports,
and the memory card on `/` covered by a nav tab on desktop. Several read like the hit-test
finding an element "covered" by its own ancestor (`covered by settings-page`), which is
normal and not a fault. Repositioning chrome is a locked design decision per the same header,
so nothing was changed.

### 6k. 2026-08-30 — THE BLANK CARD FILLS ITSELF IN (and the name field comes back on screen)

Four sentences of Erica's, and what each one changed on the new-place card
(`app/src/components/NewPlaceDraft.tsx`).

1. **"The date should always be pre-filled to the date I am adding the card, or the date the
   picture being added was taken... and I should be able to edit the dates."** The date field
   opened EMPTY. It now opens on today — built from LOCAL date parts, never
   `toISOString().slice(0, 10)`, which is tomorrow's date after 8pm on the east coast (§8) —
   and moves to the first photo's EXIF capture day the moment photos are added, unless she has
   already set a date herself. Still a plain date input: type over it, or clear it, and with no
   date no visit is logged, exactly as before. The label dropped "(optional)", which described
   the empty field. Logic in `app/src/lib/draftPrefill.ts`, tested in `draftPrefill.test.ts`.
   **Google Photos is covered only via EXIF**: `lib/googlePhotos.ts` downloads the original
   bytes (`=d`) so the capture time is still in them, but Google's own
   `mediaFileMetadata.creationTime` is not requested and the `File` it builds carries no
   timestamp — a photo whose EXIF was stripped before Google got it keeps today's date.
2. **"I don't understand why official details look up name and website is on the card."** The
   "Official details" heading and its "Look up name & website" button are gone.
3. **"if I am at a restaurant the name of the restaurant will already be in the card after I
   hit add, then I can change it as needed."** The card now asks OpenStreetMap ONCE, on open,
   and fills the name and website in by itself. **`layer=poi` is what makes this honest**:
   plain reverse geocoding answers with the area you are inside — a pin on a Kansas highway
   returned "Coffey County" on the live site, which is not a place anyone wants named on their
   card. Measured 2026-08-30 through the real component in a headless browser: Katz's
   Delicatessen → "Katz's Delicatessen" + its website; Buckingham Palace → "Buckingham
   Palace"; the Kansas highway and a Colorado forest track → nothing at all. `draftPrefill`
   discards anything whose OSM class is a boundary, road, suburb, rail line or landuse, and a
   suggestion NEVER lands on top of something she has typed. (The MapTiler reverse geocode
   that has always supplied a fallback name is untouched — the POI answer overrides it when
   there is one.)
4. **"I wanted the memory function to be photos, not a random description."** Two memory
   surfaces were mounted on the map at once. The text one is deleted; see the register below.

**And the bug none of that would have survived.** A live audit found the new-place card's NAME
INPUT AND STAR RATING RENDERING ABOVE THE TOP OF THE SCREEN, unreachable, on 430×932, 390×844
and 1440×900 alike: `.panel.npd-card` is a scrolling flex COLUMN, its content is taller than
its 92vh cap, and `.panel-hero` is `overflow: hidden` — so its automatic minimum height was 0
and it was squashed from 190px to nothing, taking its absolutely-positioned title with it to
`top: -61px`. `scrollTop` cannot go negative, so it could not be scrolled back. One line
(`flex: none`) fixes it. Reproduced and then re-measured in headless Chromium at all three
viewports: hero 190px, input top 150, `elementFromPoint` hit-test true, typing works.
### 6j. SIX READERS COUNTED THE SAME OUTING TWICE — `0278`, 2026-08-30

The canonical key of an outing is **`coalesce(shared_group_id, id)`**, not `id`. Two people
recording the same run make two `activities` rows tied by `shared_group_id` (0140/0141), and
a reader that does not collapse to that key reports the number of *recordings* while the
screen says *outings*.

`mileage_by_person_for_people` has collapsed since it was written. **Six readers did not**,
and `0261` carried five of them across to the people-aware variants verbatim — its own note
says *"the bodies are otherwise untouched"*, which was true and is exactly how the defect
propagated:

    activities_of_type_for_people · race_stats_for_people · races_list_for_people
    activities_of_type            · race_stats            · races_list

**Exposure, measured 2026-08-30:** 572 activities, 91 in a `shared_group_id`, 31 groups with
more than one member — so **57 rows are second recordings** of an outing already in the set.
By type: Run 279 rows / 247 canonical (+32), Hike 152 / 137 (+15), Walk 130 / 121 (+9). Ride,
Swim and Workout have none.

Row counts in `activities` are not the same claim as rows a person sees — `visible_activities`
is per-viewer — so each reader was called as each of the three accounts inside a rolled-back
transaction, before and after:

| reader | | Erica | Josh | Test bot |
| ------ | - | ----- | ---- | -------- |
| `activities_of_type_for_people('Run', '{}', 'all')` | | 216 → **200** | 248 → **216** | 168 → **165** |
| …`'Hike'` | | 139 → **134** | 71 → **56** | 41 → 41 |
| …`'Walk'` | | 115 → **106** | 105 → **98** | 79 → **74** |
| `activities_of_type('Run', <account>)` | | 143 → **128** | 163 → **145** | 0 → 0 |
| …`'Hike'` | | 139 → **134** | 30 → **20** | 0 → 0 |
| …`'Walk'` | | 115 → **106** | 26 → 26 | 0 → 0 |
| `activities_of_type('Run', null)` | | 27 → **26** | 27 → **26** | 10 → 10 |
| …`'Hike'` / `'Walk'` | | 17 / 11 unchanged | 17 / 11 unchanged | 0 / 0 |

Every one fell or held; **none rose**. No other reader moved: `mileage_by_person_for_people`
still counts 450 / 376 / 285 outings and `activity_lines*` still draws 480 / 431 / 293 lines,
identical to the digit.

**The race readers are fixed with zero effect today, and that is worth saying plainly rather
than dressing up as a win.** Four activities qualify as races and none is in a multi-member
group, so `race_stats*` and `races_list*` return exactly what they returned before — 4 / 2 / 1
races and 66.650 / 30.037 / 10.105 miles. The defect was in the code and not yet in the data.
Fixing it now is what stops the first jointly-recorded race counting as two, which nobody
would notice because a race count of 2 looks like a race count of 2.

**`activity_lines` and `activity_lines_for_people` are deliberately left non-deduping.** Their
own body says why: the representative of a group may be the copy *without* a route, and a
missing line on the map is a worse error than two drawn on top of each other. `0278` asserts
they still do **not** contain a `distinct on`, so a later pass that "finishes the job" has to
argue with a raise rather than slip through.

Each of the six keeps its `RETURNS TABLE` signature, `SECURITY DEFINER` and pinned
`search_path`; all eight functions are asserted non-executable by `anon` (0274's lesson: a
definer function's grant is asserted, never assumed). The migration's behaviour block calls
the readers for real and compares against a canonical count taken from the same tables, and
**returns with a notice when `profiles` is empty** — so it replays against a fresh schema in
`scripts/db-test.sh` instead of failing on an "expected exactly N" that CI can never satisfy.
That mistake has been made twice in this repo; this is the form that does not make it.


## 7. Removed on purpose — the register

Anything deliberately removed goes here, with the commit, so it is never mistaken for
lost work and can be restored in minutes.

| What                                                                                                     | When       | Why                                                                                                                                                                                                             | Restore from                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address/place editing in the photo sorter (`PlaceQuickEdit`)                                           | 2026-07-26 | She asked for "JUST THE VISIT INFORMATION" — place-level fields were confusing inside a visit-sorting flow                                                                                                     | commit`5bb5b6e`; the component still exists, unused. **She now wants it back (Phase 3).**                                                                         |
| The`trips` and `trip_stops` tables                                                                   | 2026-08-08 | A trip is a visit you marked, not a separate object                                                                                                                                                             | commit`aa6e553`                                                                                                                                                         |
| The 5-step Add wizard                                                                                    | 2026-08-08 | Replaced by one add sheet                                                                                                                                                                                       | commit`fd3004d`                                                                                                                                                         |
| Service-worker registration                                                                              | earlier    | A cached shell served stale code                                                                                                                                                                                | restored 2026-08-10 with HTML network-first                                                                                                                               |
| `apply_naming_rule(uuid)` (geofence-only)                                                              | 2026-08-10 | It could rename 76 activities on start-point alone                                                                                                                                                              | migration`0152`                                                                                                                                                         |
| "downtown Leesburg, VA" as an Appalachian Trail section                                                  | 2026-08-10 | Not on the AT.**The place itself was kept** — it holds 3 photos and 2 visits                                                                                                                             | migration`0155` (the earlier membership-row delete did not take: `part_of` is the record and its trigger rebuilds membership)                                         |
| The**`detect-trips` nightly auto-detection** (deployment deleted)                                      | 2026-08-12 | Erica: "disable the nightly auto-detect feature". Its cron was already unscheduled; the deployment was what remained. It also contradicts §2 — it creates places tagged`trip`, and a trip is never labelled | source kept at`supabase/functions/detect-trips/`; `supabase functions deploy detect-trips` restores it, and the config entry is commented in `supabase/config.toml` |
| The**Sections list** on a trail card, its walked-sections map, and the per-section date disclosure | 2026-08-11 | The approved preview replaced it: the segment name rides on the visit, so a trail card reads like every other card                                                                                              | commit`438677e0`; the deleted JSX is also saved verbatim in the session scratchpad                                                                                      |
| The generic**"Places"** section on a card (uncategorised members)                                        | 2026-08-11 | It IS the PLACES HERE section she asked to be rid of. The locked card has category sections and nothing else                                                                                                    | commit`a8e60124` + follow-up. **Three places app-wide are affected — Fort Rosencrans (San Diego) and two others. They need a category, not a bucket.**           |
| **Thirty-one superseded markdown files** — `README.md`, `docs/COMPLETION-PLAN.md`, `docs/decisions.md`, `docs/SCHEMA.md`, `docs/RECONCILIATION.md`, `docs/MANUAL-SETUP.md`, the three `deploy-*.md`, `backup-restore.md`, the three `ios-shortcut-*.md`, and the folders `docs/adr/` (2), `docs/archive/` (8), `docs/phases/` (6) | 2026-08-28 | Erica: *"fix EVERY fucking markdown file so you stop doing shit I dont want."* Every one had been DELETED FROM GIT on 2026-08-11 and was **still on disk** — OneDrive restores what git removes, which is why `README.md` needed deleting twice (commit`e9e0e7a`, "Delete README.md again"). Any session reading the folder found a dozen plans contradicting this one. | All recoverable from git history: `4fa9fc2`, `6d27635`, `d0bfea7`, `e9e0e7a`. **`scripts/check-one-document.mjs` now fails the build if any of them returns.** |
| `CLAUDE-CODE-INSTRUCTIONS-2-70.md` and `workbench-entries.md` (parent folder)                            | 2026-08-28 | 60 KB of instructions predating this file, plus a scratch list. Same reason as the row above — but these two were **never tracked by git**, so they were copied out first rather than deleted outright          | `../.superseded-docs-2026-08-28/` — the only copy. Not in any commit                                                                                                       |
| `security/advisor-baseline.md`                                                                           | 2026-08-28 | The last markdown outside this file. Its content is **re-measured and folded into §6c**, not merely moved — the baseline had drifted from 83 findings to 188                                                    | §6c above; the file itself was untracked                                                                                                                                  |
| **Two visits claiming evidence that was not there** — Leesburg `2024-10-22` and Great Falls `2026-07-19`                                                                                                     | 2026-08-29 | Both machine-created on 2026-07-22, `source='evidence'`, no note, no `created_by`, and **nothing at their place inside their dates**. `delete_visit` returned `"evidence": []` for both — the same answer the two `2026-12-25` visits gave in §7c. Erica's explicit yes. What was on those days sat elsewhere: Leesburg's only record is one activity at *North Street Northeast*; Great Falls' day is at Claytor Lake, the Washington Monument and Leesburg VA, plus 438 unplaced pings | **The two undo snapshots below** — `delete_visit`'s own return value, which is everything needed to put each row back |
| `ingest_tokens` row **"Josh iPhone — photos"** (revoked, not deleted)                                     | 2026-08-29 | Business rule #7: *"no ingest token is ever issued to him."* It had been live since 2026-07-25 and used once, the day it was made. Revoking is reversible and keeps the row and its history                     | `update public.ingest_tokens set revoked_at = null where id = '91ed38b3-6e6c-48a9-917a-35a5ac94a104'`                                                                       |
| **The TEXT memory banner** — `app/src/components/MemoryBanner.tsx`, `app/src/lib/memories.ts`, its mount on the map and its CSS | 2026-08-30 | Erica: *"I wanted the memory function to be photos, not a random description."* Two memory surfaces were mounted on the map at once: `OnThisDay` (photographs, `rpc('on_this_day')`) and this one, a sentence — *"2 years ago today you were in Lisbon"* — with no image in it. It also read EVERY visit row with no date filter and no limit, and filtered month/day in JavaScript. `OnThisDay` is untouched. | git history for this commit; `.memory-banner` / `.memory-main` / `.memory-spark` / `.memory-x` CSS went with it, and phone row 2 (`--map-phone-row-2`) is free again |
| **"Official details" on the blank card** — the heading and its "Look up name & website" button | 2026-08-30 | Erica: *"I don't understand why official details look up name and website is on the card."* It asked her to press a button to be told the name of the place she was standing in. The card does it by itself now — see §6g | git history for this commit; `fetchPoiDetails` is still there and is what the automatic prefill calls |

#### The two undo snapshots, 2026-08-29

`delete_visit` returns everything required to restore what it removed. Both are recorded
verbatim so "we deleted two visits" is a reversible sentence rather than a regrettable one.

```json
// Leesburg 2024-10-22 — visit 88f89b11-7dc3-4da1-a0d6-60eda68bdf14
{ "visit": { "id": "88f89b11-7dc3-4da1-a0d6-60eda68bdf14", "place_id": "0fabb00c-92d4-4c06-b928-ec857aa12187",
             "start_date": "2024-10-22", "end_date": "2024-10-22", "source": "evidence", "status": "taken",
             "note": null, "manual": false, "trip_marked": false, "solo_override": false,
             "created_at": "2026-07-22T23:17:49.502968+00:00", "created_by": null,
             "accepted_at": "2026-07-22T23:17:49.502968+00:00", "accepted_by": null,
             "decided_at": null, "updated_at": "2026-08-17T21:07:09.215393+00:00",
             "parent_visit_id": null, "client_key": null },
  "profiles": [ { "profile_id": "ca941ae8-099d-4217-afa7-67a6cadb50f4", "claim_status": "accepted",
                  "evidence": "unknown", "created_by": "unknown",
                  "created_at": "2026-08-17T21:07:09.215393+00:00",
                  "asserted_by": null, "decided_by": null, "decided_at": null, "rule_id": null } ],
  "people": [], "children": [], "evidence": [] }

// Great Falls 2026-07-19 — visit 42e11a96-ce19-40db-aea2-3da29eece7b5
{ "visit": { "id": "42e11a96-ce19-40db-aea2-3da29eece7b5", "place_id": "1fccdc7a-7106-4ca8-82d4-3771f2c2c46a",
             "start_date": "2026-07-19", "end_date": "2026-07-19", "source": "evidence", "status": "taken",
             "note": null, "manual": false, "trip_marked": false, "solo_override": false,
             "created_at": "2026-07-22T21:54:52.946504+00:00", "created_by": null,
             "accepted_at": "2026-07-22T21:54:52.946504+00:00", "accepted_by": null,
             "decided_at": null, "updated_at": "2026-08-13T17:17:17.388994+00:00",
             "parent_visit_id": null, "client_key": null },
  "profiles": [ { "profile_id": "12ef0b67-4ae8-4d2c-8a60-26316f7fd040", "claim_status": "accepted",
                  "evidence": "unknown", "created_by": "unknown",
                  "created_at": "2026-08-13T17:17:22.179469+00:00",
                  "asserted_by": null, "decided_by": null, "decided_at": null, "rule_id": null },
                { "profile_id": "ca941ae8-099d-4217-afa7-67a6cadb50f4", "claim_status": "accepted",
                  "evidence": "unknown", "created_by": "unknown",
                  "created_at": "2026-08-13T17:17:22.179469+00:00",
                  "asserted_by": null, "decided_by": null, "decided_at": null, "rule_id": null } ],
  "people": [], "children": [], "evidence": [] }
```

Restoring either is an `insert` of `visit` back into `public.visits` followed by its
`profiles` rows into `memory_people` through the participant path (`visit_profiles` is a
view over `memory_people` + `memory_subjects` since `0266` — it cannot be inserted into
directly), then a recount of that place's `visit_count`.

---

## 7c. 2026-08-15 — what changed, and what was found while changing it

Fourteen pull requests (#69–#83). The parts worth remembering are not the features.

### Applied to production

| what                                                                      | evidence                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **0190** `place_visit_totals()` + backfill                        | Appalachian Trail`visit_count` 39 → 31, W&OD 46 → 44                                    |
| **Washington, DC** `first_visit` `0202-06-19` → `2017-03-29` | its own earliest visit; earliest photo 2017-03-30 00:03 UTC is the same evening locally     |
| **Two visits dated 2026-12-25 deleted**                             | Appalachian Trail and Maryland Heights, via`delete_visit`; both returned `evidence: []` |

The two Christmas visits claimed `source='evidence'` and **nothing in the database carried
that date** — no photo, no ping, no activity. Undo snapshots were captured from
`delete_visit` before they went.

### A COUNT THAT DECIDES SOMETHING MUST BE COUNTED

`places.visit_count` is a mirror, and **nothing refreshes it when a VISIT changes**:
`create_visit`, `delete_visit`, `restore_visit`, `merge_visits` and `update_visit_dates`
all leave it behind. `recompute_place_stats` counts correctly but only runs on the PHOTO
and ACTIVITY paths. So merging two visits into one — the thing 0185 was built for — takes
the real count down and leaves the column where it was.

That was not cosmetic: **Duplicates picks which place SURVIVES A MERGE by that number**,
and a merge is not undone by pressing it again. 0190 adds the reader; #82 moved Duplicates
and Smart Albums onto it. No trigger was added on purpose — a maintained mirror is what §8
is removing.

### The preconditions for removing `part_of` and `is_trip` were misread

Both were described as unblocked because their frontend PRs had deployed. They are not.

- **`part_of`** — four functions still WRITE it (`add_place_to_visit`, `add_to_container`,
  `remove_from_container`, `merge_places_auto`) and `places_sync_membership` copies it into
  `place_membership`. It is still the record, exactly as §8 says. #71 moved readers only.
- **`is_trip`** — `visits_sync_trip_flags` keeps it identical to `trip_marked`, but that
  trigger ALSO stamps `updated_at` and the decision fields, so it must be rewritten rather
  than dropped. `set_visit_is_trip`, `apply_inbox_field` and `rebuild_place_visits` all
  still use the column.

Each is a 0188-sized migration. #83 does the safe half of the second one: the card and
`VISIT_COLS` stop reading `is_trip`, readers first, which is the order that made
`solo_profile` boring to remove.

### THE MAP WAS NOT SERVING, AND IT LOOKED LIKE IT WAS

Every `/basemap/*` URL returned **200 with the app's HTML**, because:

1. the zone had **zero worker routes registered** — the route in `wrangler.toml` had never
   been published, so Pages answered the path with its SPA fallback; and
2. the deployed worker was still the **copy-only version from 11 August**. The tile, glyph
   and style code (#73) had never been deployed at all.

A 200 from the wrong server is the worst possible failure here: nothing looks broken.
**Check the content-type, not the status.**

The worker is now deployed WITHOUT its route, so nothing user-facing changed, and verified
at its `workers.dev` address: `tiles.json` reports zoom 0–15, a z6 tile over Virginia
returns 38,148 bytes of `application/vnd.mapbox-vector-tile`, a glyph range 76,044 bytes,
and MapLibre renders Loudoun County with **zero errors**. Preview sent 2026-08-15.

~~Still to do, and both are Erica's call: register `adventureorno.com/basemap/*`, then
point `basemap.ts` at `/basemap/style.json`.~~ **Both were done later the same day** —
the route through the API (wrangler cannot manage it, see Phase 4b step 4) and
`basemap.ts` in #88. Superseded; Phase 4b is authoritative. What was NOT done is
deploying the bundle that contains #88, which is why the map still looked unchanged on
2026-08-16.

### Two mistakes of the same shape, worth naming

- Resolving a conflict, `package-lock.json` was taken from main and "verified" by checking
  that it still resolved **pmtiles** — the dependency in mind at the time. It was missing
  `protomaps-themes-base` and `vitest`, and `npm ci` failed on CI. **Run the check that
  fails, not the check you were thinking about.**
- An empty `import.meta.glob` result was read as a hole in the banned-words guard. The glob
  was fine; the lookup used `lib/data.ts` where the key is `./data.ts`. A change was made to
  a guard on that false premise and then reverted.

Both look identical from the outside: a narrow check that passes reads exactly like a broad
one that passes.

### Also

- **`CLOUDFLARE_API_TOKEN` does not exist in `.env.local`** — it is `CLOUDFLARE_API_TOKEN_MASTER`
  (account-scoped) and `CLOUDFLARE_ZONE_ACCESS` (zone-scoped). Do not verify an account token
  with `/user/tokens/verify`; it returns 401 for account tokens even when they are valid. Use
  a real account endpoint.
- **The deploy already refuses to ship ahead of the schema** (`check:ledger`, `STRICT=1`), so
  an unapplied migration blocks the whole pipeline, not just its own change. #81 adds
  `supabase db push --include-all` in front of it — it needs a `SUPABASE_DB_PASSWORD` secret
  and does nothing until that exists.
- **`scripts/check-data-integrity.mjs`** (#79) reads production's DATA, not its shape:
  impossible dates, visits in the future, visits derived from evidence that is not there, and
  count drift. A warning, not a failure, because a live database can go dirty with nobody
  touching the code.
- **87 visits have no evidence, and 84 of those are fine** — a trail's evidence lives on its
  sections. Only non-containers count. That distinction is the difference between a real
  finding and a scary number.
- **2026-08-29: the check reads clean — "Production data is consistent."** It had been
  reporting three rows. Two were the bare visits deleted below with Erica's yes; the third
  was Riverpoint Drive Trailhead's `visit_count` saying 13 against 12, repaired in `0271`.

#### `places.visit_count` has no maintainer, and deleting a visit proves it

Repairing Riverpoint was not the end of it. The moment the two bare visits were deleted,
the same check went from one stale mirror to **two** — Great Falls 3 vs 2, Leesburg 5 vs 4
— because **`delete_visit` removes the row and never touches `places.visit_count`**. There
is no trigger on `visits`; the only things that have ever written that column are backfills
in old migrations (`0003`, `0009`, `0010`, `0015`, `0097`, `0117`, `0190`, `0240`, `0260`).
It is a cache that is correct exactly until somebody changes a visit, which is why this
check keeps finding it.

`0272` repaired the two and deliberately did **not** add a trigger, because `visit_count`
decides which place survives a merge and giving it a maintainer is a decision about the data
model rather than a repair. The two options were: maintain it with a trigger, or retire the
column and read `place_visit_totals()` instead.

**RESOLVED — `0273` takes option one, and the column now has a maintainer.** After the third
drift in one evening (below), repairing the number a fourth time was not a plan.
`visits_sync_place_visit_count` is an `after insert or update of place_id or delete` row
trigger that recounts the affected place — **both** places on an update, since a visit can
move between them — and writes only when the answer actually changes, so an ordinary visit
write no longer dirties a `places` row for nothing. It counts `count(*) from public.visits`,
which is deliberately what `check-data-integrity.mjs` compares against and deliberately not
`accepted_visits`: two different answers to "how many visits" is how this column became
untrustworthy in the first place.

Retiring the column is still the tidier end state and this does not block it — a column that
is always correct is strictly easier to delete than one that is not.

**How it was proved**, because "the trigger exists" is not the same claim as "the trigger
works": the migration asserts zero drift and asserts the trigger is attached for insert,
delete *and* update (`tgtype` bits 2, 3 and 4 — leave one out and the column drifts through
whichever one was missed). The live round trip was run **separately**, against production
inside a rolled-back transaction: insert a visit → mirror goes up by one; delete it → mirror
goes back. It is not done inside the migration on purpose: `visits` carries four other
triggers, and a probe row in a migration that COMMITS can leave participant rows behind that
the delete does not reach.

**It came back forty minutes later, and not from a deletion.** The final check of the
2026-08-29 session found `Red Iguana stored=1 actual=2`. Nothing in that session touched
Red Iguana: Erica added a manual visit through the app at `22:14:56Z`, while the session
was still running, and `places.visit_count` did not move. So the mirror is not merely
un-refreshed on **delete** — **nothing maintains it in either direction**, and a normal
afternoon of using the app drifts it. That is as close to a live reproduction as this
question is going to get, and it argues for option 1.

It was left unrepaired at first, on purpose — repairing it would have been one `update`
that hid the evidence a day later. The evidence is recorded here permanently now, and
`0273` both backfilled it and stopped it happening again, so the number is correct **and**
the reason it kept going wrong is fixed.

## 7d. 2026-08-16 — the day nothing was broken and nothing was live

Erica: *"the map style has not changed when I looked at it."* She was right, and every
finding below came out of asking why one true-looking tick was false.

### THE DEPLOY HAD BEEN FROZEN FOR A DAY, AND EVERY TICK STILL READ GREEN

Production sat at `546ff11`, **16 commits behind `main`**, since 2026-08-15 16:21 UTC.
Not a bug: **GitHub Actions was blocked on billing** from 17:47 UTC that day — every run
failed in 5–8 seconds with *"recent account payments have failed or your spending limit
needs to be increased."* CI is the only deploy authority, so merging kept working and
shipping silently stopped. 36 PRs merged on 08-15 and 21 on 08-14; none of the last 16
reached the browser.

**The tell was available and nobody looked at it:** `/version.json` reports the deployed
SHA. Comparing it to `origin/main` is one command and would have caught this in a day.

Fixed by upgrading to GitHub Pro. **Pro does not retroactively re-run anything.**

### `supabase db push --include-all` WOULD HAVE RE-RUN 42 MIGRATIONS

Added in #81, never once executed (it needs a database password that was never set), and
auditing it before arming it is the only reason this was found.

**The ledger is keyed two ways**: 152 rows use this repo's `0NNN` prefix, 75 use a
14-digit timestamp. `check:ledger` matches on NAME and reports 2 gaps.
`supabase db push` matches on VERSION KEY and sees **42** — everything from 0153 to 0194,
all long since applied.

`--include-all` would have re-run all 42 against live data. It would have died partway:
`0191` ends with an unguarded `alter table public.visits drop column is_trip` and that
column is already gone. But 0153–0190 run first, each in its own transaction, and several
backfill — `0190` recomputes place counts, `0188` rewrites `visit_profiles` and
`activity_profiles`. **A backfill re-deriving what a person has since fixed by hand is
this repository's most repeated failure.**

Erica, 2026-08-16: *"I want to delete the risk rather than manage it."* The step is gone.
`scripts/apply-migration.mjs` replaces it: one named file, applied and RECORDED in the
same transaction, so the ledger cannot drift again. No database password exists.

**Two tools disagreeing about the same question is worse than either being wrong**, and
the safe-looking one was the one that was never going to run.

### THE STRAVA RULE IS STILL NOT ENFORCED — 0193 BUILT THE LOCK AND FITTED IT NOWHERE

`0193` added `can_see_activity()`, the `visible_activities` view and a correct
`activities_select` policy. Of the **32 SECURITY DEFINER functions that read
`public.activities`, exactly one uses the guard — `can_see_activity` itself.**

`mileage_by_person` is `SECURITY DEFINER`, calls `assert_member()`, then selects straight
`from public.activities` with no filter. Any signed-in member can ask for the other's
mileage. Same for `card_view`, `wrapped_year_miles`, `race_stats`, `climbing_stats`,
`wander_stats`, `place_days`, `visit_detail`, `activities_of_type`, `activity_lines`,
`shared_outings` — every count, card and statistic in the app.

**This file predicted it exactly**, in "THE STRAVA RULE CANNOT BE DONE WITH RLS":
*"A policy on the table would look correct in psql and change nothing in the app."*
The warning was written, and then the migration walked into it anyway. **Writing a trap
down does not disarm it.** Phase 7's legal precondition is NOT met. Still to do.

### A NIGHTLY JOB HAD BEEN FAILING FOR EIGHT NIGHTS, IN SILENCE

`dedupe-joint-outings` succeeded every night to 2026-08-08 and failed every night from
2026-08-09 with `not authorized`. The break is exactly when the "a machine may only
propose" guard work landed: `group_duplicate_activities` opens with
`is_editor_or_owner()`, and pg_cron has no `auth.uid()`.

**It is the discriminator from 0157 working correctly and catching the wrong job.** The
rule is good; applying an editor check to a function a machine is *supposed* to call is
not. Nobody noticed because a failed cron row looks like nothing at all.

Fixed in `0195`, and the job now PROPOSES into the suggestions ledger rather than writing
`shared_group_id` itself — which is what §2 required of it all along. Erica, 2026-08-16:
*"propose, not apply."*

**Nothing checks that scheduled jobs succeeded.** The watchtower probes URLs; `cron.job_run_details` has nobody reading it. Worth a probe. — **BUILT 2026-08-16 as `0197` + the watchtower's cron sweep; see Step 3 under NOW.**

### THE BACKUP WAS STALE, AND THE RESTORE WAS PART RUMOUR

Freshness had drifted to **42h against a 36h limit**, because the Backup workflow is a
GitHub Action and was blocked by the same billing failure. The gate and the thing it
guards fail together — worth knowing when designing any other gate.

Running the restore verification (`-f verify=true`, which nothing does automatically
except the weekly run) then found a real bug: **`service_health` restored 0 of 415 rows.**
`id` is `bigint generated always as identity`, and the loader excluded GENERATED columns
by testing `is_generated`, which describes `GENERATED ALWAYS AS (expr) STORED` — an
IDENTITY column reads `is_generated='NEVER'`. It sailed through and the insert died.

It was the first identity column in 194 migrations, so it had never been exercised. Fixed
generally via `is_identity` + `OVERRIDING SYSTEM VALUE`, not special-cased. **No table
holding real data was affected** — 35 of 36 restored with matching counts.

*"A backup nobody has restored is a rumour"* — and the weekly restore is the only thing
that could have caught this. Do not let it become monthly.

### THE TRAIL CARD DISAGREED WITH ITSELF

A trail's visit list came from an effect keyed on `place.id`; its mileage came from one
keyed on `allPlaces`. The section list is derived from `allPlaces`, which starts empty and
arrives async. So the miles recomputed across the sections and **the visit list beside
them did not** — the same card, two different answers about which sections it covers.

This is a regression of the exact complaint 0136 was written for: *"the card showed the 32
logged on the trail row and hid the 30 logged on its six sections."* A `react-hooks/exhaustive-deps`
warning had been pointing at it the whole time. **The one lint warning in the codebase was
a real bug**, which is the argument for not carrying warnings.

Both effects now key on the section list itself — correct, consistent, and it stops
refetching every trail whenever any unrelated place is edited.

---

## 7e. 2026-08-16/17 — the plan that ran, and what measuring badly cost

Everything below happened under the 08-16 plan, which is finished. It is here rather than
at the top of the file because a completed plan left in the NOW section is how this
document became a history of itself the first time.

**What closed:** production caught up to `main` (three times), Phase 4 went
**Live-verified** on Erica's own words, the restore was proved after the identity-column
fix, the Strava rule reached the readers and got a guard, the cron jobs got a watcher, the
deploy freeze got a detector, and two stabilization-gate items were closed by asking the
screen instead of the database.

**What it cost to find out** is the more useful record, and it is all here: the stale red
tick, the a11y violations shipped on a brand-new card, the guard aimed at a dialog that no
longer existed, the test that was wrong for a day without going red, the cleanup that
deleted other tests' fixtures, and the confident retraction that measured a login page.

---

### The 08-16 plan, as it ran

Measured against production, not against this file. Every claim below was checked live
before it was written down; where the check disagreed with §7d, the check wins and the
correction is stated.

**Where production actually is, 20:55 UTC 2026-08-16:**

| Fact                        | Measured                                                                          |
| --------------------------- | --------------------------------------------------------------------------------- |
| `/version.json`           | `920e52f` (#99)                                                                 |
| `origin/main`             | `a57a928` (#100) — **one commit ahead**                                  |
| Why                         | CI's`Deploy production` job FAILED on the migration-ledger gate                 |
| Migration ledger            | **all 196 recorded** — `check:ledger` passes now                         |
| `0196` genuinely applied? | **yes** — `visible_activities` exists and `mileage_by_person` reads it |

**CORRECTION to §7d.** It says the billing freeze is the reason nothing is live. That was
true this morning and is not the reason now. #99 deployed at 20:42. The *current* freeze is
one commit deep and has a different cause: the deploy gate refused `a57a928` at 20:46
because `0196` was not yet in the ledger, `0196` was applied by hand shortly after, and
**nobody re-ran the job**. The gate worked exactly as designed. It is a stale red tick, not
a broken pipeline.

#### Step 0 — Re-run the deploy. ✅ **Deployed 2026-08-16 21:05 UTC**

Re-ran `Deploy production` on `a57a928`; it passed in 40s with nothing changed but the
ledger condition being true. `/version.json` now reports `a57a928` — **production and
`origin/main` are the same commit for the first time since 2026-08-15 16:21 UTC.**

**The self-hosted map is Live-verified as SERVING** (Erica's own look is still what makes
Phase 4 done, per Step 1):

| Check                      | Result                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Deployed`basemap` chunk  | points at`/basemap/style.json?theme=` — the frozen Mapbox style object is GONE from the bundle |
| `style.json?theme=dark`  | `application/json`, **12 layers**                                                         |
| `style.json?theme=light` | **15 layers** (the 3 extra are road casings)                                                |
| A z6 tile over Virginia    | `application/vnd.mapbox-vector-tile`, **38,148 bytes**                                    |
| `/basemap/health`        | `ok:true`, planet 137,281,886,877 bytes                                                         |

Content-type was checked on every one, because §4b's worst failure was a 200 of the app's
own HTML from the wrong server.

**ONE THIRD-PARTY MAP CALL SURVIVES, and it is not the basemap.** The deployed chunk still
requests `api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1.json` — **terrain**, not tiles.
Phase 4's "third-party basemap calls are absent" is now true of the basemap and false of
the elevation model. That is not a regression and not a surprise: replacing it is exactly
§6a-ii (Copernicus GLO-30 → terrain-RGB PMTiles). Recorded so the next person measuring
"are we off Mapbox yet" gets the honest answer instead of a clean grep and a wrong
conclusion.

#### Step 1 — ✅ **PHASE 4 IS LIVE-VERIFIED, 2026-08-16**

Erica, after the deploy: ***"the map looks different."*** That is the sentence Phase 4's
definition of done was waiting for, and **Live-verified** is the highest status in the
table at the top of this file. The basemap is ours, rendered from our own PMTiles in our
own colours. The terrain DEM above is the one third-party map call left, and it is
§6a-ii's job, not Phase 4's.

She said one more thing in the same breath: ***"It should just say Add not Add 1 on the
pill."***

**Fixed.** The count is off the pill. It rode there because retiring the Inbox tab left the
number homeless — but a destination is a place you are going, and a queue length is not
part of its name; it also made the pill's width jump as the number changed. **Nothing is
lost**: `/add` still heads its queue **"To review · N"**, which is the screen that can
actually do something about it. It also drops a `fetchInboxCounts()` that ran on EVERY
navigation to render one digit.

**And it uncovered a test that had been wrong for a day without going red.**
`app/e2e/app.spec.ts` asserted the Add tab links to `/add` and lands on the Add page. #94
changed that on 08-15 — the tab is `to: '/?add=1'` and opens the blank card over the map.
The assertions were stale from that moment, and nothing caught it because **this file only
runs in the nightly `Full browser matrix`, and the nightly was failing in 7 seconds on
GitHub billing.** The suite itself is sound: it sets `REQUIRE_AUTH_E2E=true`, so it cannot
silently skip its own authenticated tests. It simply never got to run. Tonight's would
have caught it.

Two lessons, both already in this file wearing other clothes: **a test that only runs
nightly is only as good as the nightly**, and the pill assertion is now exact — `/^Add$/`,
not `/^Add( \d+)?$/` — because a prefix match would let the count creep back without
failing anything.

#### WHAT RUNNING THE NIGHTLY SUITE FOUND — 2026-08-16, and it was not the pill

Rather than assume the pill change was safe, the `Full browser matrix` was dispatched by
hand — the first time it has completed since the billing freeze. **211 passed, 24 failed.**
The 24 are 6 tests across 4 browsers, and **not one of them was caused by the pill.** They
were all already broken, waiting for a suite that could run.

**Two REAL critical accessibility violations, on the card Erica asked for.** On `/?add=1`:

    critical label       — Form elements must have labels — input[type="date"]
    critical select-name — Select element must have an accessible name — select

§4 of this file says *"zero WCAG A/AA violations across the authed routes, nothing
allowlisted."* That has been **false since #94**, on the newest and most prominent screen
in the app. The cause is a pattern worth recognising: rows are written
`<div class="npd-row"><span>Visit date</span><input/></div>` — the words are on the screen,
next to the control, attached to nothing. The **Name** row three fields above was already
`<label className="npd-row">` and was always fine, so the correct shape was in the same
file the whole time. Fixed by making the rows `<label>`; the CSS is class-based, so it is
byte-identical on screen. The tag picker cannot be a wrapping label — its row holds chips
*and* a select — so it takes an explicit `aria-label`.

The trail select had the same defect and axe never saw it: the run had no trails, so the
row did not render. **One condition away from being invisible** is not the same as fixed.

**The guard that should have caught it was aimed at the wrong element.** The a11y test for
this screen opens `getByRole('dialog', { name: 'Add' })` — but #94 replaced the chooser
with the card, whose accessible name is **"New place"**. The locator failed before axe ever
ran, so the test reported a locator error rather than two violations. *A guard pointed at
something that no longer exists says nothing about what replaced it.*

**`AddSheet` is GONE.** Nothing imported it, and `lockedCard.test.ts` already asserted
MapView does not render it — #94 removed the chooser and left the component behind. Three
e2e tests were still describing its "What are you adding?" screen and its three choices;
they now describe the card. **Erica, 2026-08-16, asked: delete it.** So the component and
its 866 characters of orphaned CSS (`.add-sheet`, `.add-choices`, `.add-note` — used by
nothing else) are removed together. Dead CSS outlives dead components because nobody
greps stylesheets.

The through-line for all six: **a test that only runs nightly is only as good as the
nightly.** #94 merged on 08-15, the nightly died on billing that afternoon, and every one
of these has been sitting in `main` — and since 21:05 today, in production — unseen.

**Proved, not assumed** — the matrix was re-run on the fix branch:

| Run                                | Result                                    |
| ---------------------------------- | ----------------------------------------- |
| `main`, 21:23                    | 211 passed,**24 failed**, 1 skipped |
| `fix/the-card-has-labels`, 21:47 | **235 passed, 0 failed**, 1 skipped |

211 + 24 = 235, so every failure is accounted for and none was traded for a new one.

#### Step 1 (cont.) — the rest of what landed, still to look at

These are all **Merged, not Deployed** today, and Step 0 makes them all visible at once:

| From        | What she should see                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| #86 #87 #88 | The map is OURS — Ink (dark) / Daylight 2 (light), Settings → Map appearance,**no Mapbox call in the network panel** |
| #94         | Timeline drills YEAR → months → days;`/add` opens the blank card; no gear and no stats bar on Places                     |
| #96         | Mileage is her own; "just me" is the default                                                                                 |
| #97         | The watchtower checks WHAT came back, not just that something did                                                            |
| #100        | Each person's Strava-origin activities are their own, in every count and card                                                |

Phase 4 becomes **Live-verified** on her sentence, not on a screenshot of a Worker.

#### Step 2 — Close the six open boxes in the stabilization gate

1. ✅ **The restore is proved — 2026-08-16 21:11 UTC.** The identity-column fix landed in
   #99 at 20:38, **after** the 18:08 verify run that failed with *"cannot insert a
   non-DEFAULT value into column id"*, so it had never once been watched working. Ran it:

   |               | 18:08 (before)                             | 21:11 (after)                                      |
   | ------------- | ------------------------------------------ | -------------------------------------------------- |
   | Tables loaded | 35,**errors: 1**                     | 35,**errors: 0**                             |
   | Row counts    | `ROWS LOST`, `service_health` 0 of 415 | **all 45 tables match exactly, 21,143 rows** |

   The gate in the stabilization list at the top of this file can now be ticked without the
   "only partly proven" caveat it has carried since this morning.
2. Erica: sign in → open a place card → edit and save a visit → reload → it is still there.
3. Josh: every editor action, with no unexplained permission or save failure.
4. Manual smoke on the deployed SHA: map, place card, visit page, Add/import, photos,
   stats, logout.
5. Confirm both hard gates on a real run — ledger (already proven; it is what blocked
   `a57a928`) and backup freshness.
6. ✅ GitHub CLI is healthy — `adventureorno26` is the active account.

#### Step 3 — Close the three traps 08-16 opened and did not finish

- ✅ **`cron.job_run_details` has a reader — `0197` + the watchtower.** It had none:
  verified as zero references anywhere in the repository. `dedupe-joint-outings` failed
  eight consecutive nights in silence, and the reason nobody noticed is that **a failed
  cron row breaks no page, 500s no request and produces no complaint — it looks like
  nothing at all.** The watchtower was probing five URLs every fifteen minutes throughout
  and had no idea the database was running anything.

  `cron_health()` answers for the jobs and the existing Worker records the answers into
  `service_health`, so both halves show on one screen. It is the same lesson as 0194 one
  layer down: *0194 — a 200 from the wrong server looks like success, so ask what came
  back; 0197 — a scheduled job looks like a working job, so ask whether its last run
  succeeded.*

  **Staleness is measured, not parsed.** A job can fail by not running at all, and pg_cron
  has no `next_run`; parsing five-field cron expressions in SQL to compute one is a bug
  generator. The job's OWN history sets the expectation — the median gap between its
  recent runs, doubled — so a daily job tolerates ~48h and a quarter-hourly one ~30m with
  nothing needing to know which is which. Proved against production read-only before it
  was written down: it returns `ok=false … not authorized` for `dedupe-joint-outings` and
  `ok=true` for the other two, and with the tolerance forced to one second all three
  correctly read *"overdue for a job that normally runs every 24h"*.

  **A job whose last run SUCCEEDED can still be broken** — that is the case the ok flag
  exists for, and the one a status-only check would call healthy.

  ⚠️ **`0197` IS NOT APPLIED YET.** Applying it was declined by this session's permission
  gate, so it is merged-but-unapplied and **the production deploy gate will refuse the
  next deploy until it is applied** — correctly, and exactly as it refused `a57a928`
  earlier today. Apply with `npm run db:apply 0197_the_jobs_are_watched`, then deploy the
  Worker with `cd workers/watchtower && npx wrangler deploy`. The Worker is harmless until
  then: an unreachable `cron_health()` records one honest `cron` failure row rather than
  blaming a job.
- **A test that keeps the Strava rule enforced.** 17 functions still read
  `public.activities` directly. Checked one by one, that is *correct* — they are writers
  and machine jobs, which #100 deliberately kept on the table because the view filters on
  `auth.uid()` and pg_cron has none. `shared_outings` reads raw and is still right: it
  returns only the caller's own miles plus an honest `restricted_rows` count. But nothing
  stops the **next** display reader from selecting straight from the table. Add the test
  that fails when one does — the lock is fitted now, and this is what keeps it fitted.
- **A deploy-freeze detector.** §7d already named the tell and it went unused twice in two
  days: compare `/version.json` to `origin/main`. One command. It should be a check, not a
  thing somebody remembers.

#### Step 4 — Then the queued lanes, in the order locked on 08-14

Nothing here starts until Steps 0–3 are true for the same commit.

| Lane                                     | State                                                    | Note                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 remainder                        | nearly closed                                            | Steps 2–3 above ARE the remainder                                                                                                                                                           |
| Phase 3 — approved app structure        | people preview approved; events/messages preview pending | This historical 08-16/17 plan is superseded by the top directive: commercial-safe people/events/messages contracts, then Map/Add/Insights/Settings; Add creates and Needs Attention repairs. |
| Phase 4d — geocoding we own             | nothing built                                            | Overture → PMTiles; Mapbox stays the fallback                                                                                                                                               |
| Phase 6 — what we own                   | nothing built                                            | The tile trick: reverse geocode and elevation are tile reads. Routing stays PAUSED                                                                                                           |
| Phase 7 — fitness ingest                | nothing built                                            | intervals.icu first; email-in is the best effort-to-coverage item                                                                                                                            |
| Phase 8 — events, social, privacy floor | nothing built                                            | Much of it is gated on the LLC and the native shell                                                                                                                                          |

**Two things are waiting on Erica and block nothing else** (§"Open, awaiting Erica's
decision"): whether to attach the **122 photos** that match exactly one visit on one day
at one place — unambiguous, and 0157 now makes the attachment permanent — and the 32 with
fabricated `12:00:00` timestamps, which must be proposed rather than written.

---


## 7f. 2026-08-18/20 — the ingest system, and five steps of §3e

#### 3b. ✅ CHRISTMAS WAS LAST YEAR — and the typo was not where it was showing *(0218)*

Two visits dated **2026-12-25**, four months in the future, counting in every total as
though they had happened. `check-data-integrity.mjs` had flagged them since 08-14 and
refused to guess. Asked directly, Erica said 2026 was a typo for 2025.

**The first attempt corrected the visits and did not work.** The dates moved,
`rebuild_place_visits` ran, and both came straight back — caught only because the migration
re-checked the world instead of trusting its own UPDATE:

    0218: a visit in the future survived the correction

§"Derived vs source", for the fourth time in this repository. **`visits` is DERIVED.** The
rebuild builds islands from photos, activities, pings and — the source nobody had checked —
`public.entries`. The real typo was a journal entry, *"The Rabbit Hole"* at Maryland
Heights, dated 2026-12-25. Correcting the copy achieved nothing, because the copy is
rebuilt from the original.

**And one bad entry made two bad visits.** Maryland Heights is `part_of` the Appalachian
Trail, and the rebuild deliberately folds a section's evidence into its parent — *"a
trail's evidence legitimately lives on its sections"*, as the integrity check itself says.
So one mistyped year produced a future visit on the section AND on the trail, and anyone
fixing "the two visits" would have been fixing two symptoms of one cause.

Fixed at the entry; both visits followed. **Future-dated visits: 0. Future-dated entries: 0.**

**Still open in that check, and still hers to decide**: two visits claiming `source=evidence`
with nothing in the database on their dates — Leesburg 2024-10-22 and Great Falls 2026-07-19.

#### 3c. THE GARMIN ACCOUNT EXPORT, REVIEWED *(2026-08-18 — 7 outings added, the rest deliberately not)*

Erica downloaded her full Garmin Connect data export (45 MB, `a1646035-…_1 (1)`) and asked
which of it belongs in the app. **Most of it does not, and the part that looked like the
prize turned out to be almost entirely redundant.**

**What is in it**

| Path                                                                                                                        | What it is                                                                                                                  | Verdict                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip`                                                         | **8,938 FIT files**                                                                                                   | the only source of routes — see below                              |
| `DI_CONNECT/DI-Connect-Fitness/…_0_summarizedActivities.json`                                                            | 391 activities with name, type, distance, device                                                                            | **useful**, and it agreed with the FITs exactly               |
| `DI_CONNECT/DI-Connect-Routing/…_courses_*.json`                                                                         | **4 saved courses** with geometry — Shenandoah NP Loop, Taskers Gap, Peter's Mill Run OHV, Cold Spring Bald Mountain | **plans, not visits** — bucket-list material, not activities |
| `DI_CONNECT/DI-Connect-Wellness`, `DI-Connect-Metrics`, `DI-Connect-Aggregator`                                       | sleep, VO2max, hydration, daily rollups                                                                                     | out of scope: no place, no outing                                   |
| `INREACH/mapdata-*.gpx/.kmz`                                                                                              | inReach waypoints/routes/tracks                                                                                             | **empty** — 315–493 byte XML shells with nothing in them    |
| `IT_GLOBAL_EVENT`, `IT_CONSENT_HISTORY`, `IT_DEVICE_AND_CONTENT`, `customer_data`, `DI_FACEIT_CLOUD`, `DI-GOLF` | events, consents, device list, account, profile images                                                                      | not relevant                                                        |
| 27 further domain folders (`ALPHA_API`, `AVIATIONCLOUD`, `NAVIONICS`, …)                                             | **empty**                                                                                                             | —                                                                  |

**The 8,938 FIT files are mostly not activities.** Classified by their `file_id` message
rather than guessed at from size:

    ~5,543  monitoringB   daily steps / heart rate / sleep
    ~2,915  type 44       metrics
       391  activity      ← of which 333 carry a GPS track
        ~36  type 41

**And 326 of those 333 were already in the app.** The export adds **7 outings, 38 miles**:
one 2018 run, five 2020 walks, one 2023 hike. All seven imported, each landing on a place
that already existed — **no new places invented** — and one was correctly PROPOSED as a
possible duplicate rather than assumed new.

**Why the whole 333 were NOT imported, tested rather than assumed.** A FIT for an activity
already present arrives with a `fit:…` key that matches nothing, so 0216's content key never
applies and Tier 2 creates the row and raises a card. Verified against production and rolled
back: `disposition = proposed, activities created = 1, cards raised = 1`. Importing all of
them would mean ~326 new rows and ~326 cards — recoverable in one press (0211), and *not
wrong* under the model, since a second recording is evidence and the outing still counts
once. But it doubles her activity rows to gain provenance she can already see, and that is
her call rather than a default.

**The export stays OUT of the repository.** It is 45 MB of personal health data — sleep,
heart rate, VO2max — and it lives in the project folder beside the repo, not inside it.
Nothing about it is committed.

#### 3d. THE REVIEW QUEUE, AND CODEX'S INGEST REVIEW — CHECKED AGAINST LIVE *(2026-08-18)*

Erica: *"This is all fucked up and nonsensical, and the options are redundant and make no
sense… it should populate the Name of the activity from the source or the location of the
source, then ask me to approve it only if there is some doubt."*

**She was describing something worse than a naming problem, and the naming was not the
problem at all.** Measured through her own session before anything was written:

    every pending card                       36, all shared_group_id proposals
    naming cards pending                      0
    cards her queue returned                 33
      with a visible subject                 18
      WITH NO VISIBLE ACTIVITY AT ALL        15

Two faults, stacked:

1. **A duplicate proposal was rendered through the UI built for NAMING.** On screen: a
   heading reading `shared_group_id`, one radio option whose text is a raw uuid, an evidence
   line reading *"OpenStreetMap · 0 of 9 route points"*, a **Never** button, and a free-text
   box offering *"Your own words"*. **The "random letters" are the uuid.** There is no answer
   a person could give to that.
2. **Fifteen of her cards were about Josh's Strava recordings** — correctly hidden from her
   by 0200 — so the card had nothing to render and fell back to "Something to name" plus a
   uuid. Pressing Save would have linked two activities, one invisible to her.

Fault 2 is the one worth stating as a rule: **the guard was never wrong.** `visible_activities`
did its job everywhere it was used. Nobody had asked whether a *suggestion about* a hidden
row should exist as a card. **A review queue is a list of questions a person can answer**,
and that was the property it was missing.

**Fixed 2026-08-18 (0221/0222 + the card):** a duplicate card carries the counterpart in
full — route, owner, source, time, distance — and renders two shapes side by side with two
answers, *Same outing — link them* / *Not the same*. No radio list, no free-text, no second
generic Save. Cards whose subject (or whose counterpart) the reader cannot see are **not
returned**. Her queue: **33 → 18 answerable**. Josh's: 22. Nothing deleted — they are his
recordings and his own queue still shows them. Also hers: *Looks right* → **Save**, and the
dead *Import an activity file* button (pointing at `/import/timeline`, a route that does not
exist) is gone.

**STILL OPEN from her instruction, and it is the naming half:** *populate the name from the
source or the location, and only ask when there is doubt.* Today `activity_display_name`
names an activity after its place at insert; what does not exist is a rule for **when a name
is good enough not to ask**. That is 3e below.

##### Codex's ingest review, verified line by line

Its **database claims are exactly right**; its **file paths are not** — it cites
`app/src/pages/Settings.tsx` and `app/src/pages/AddPage.tsx`, and **`app/src/pages/` does not
exist** in this repository (everything is `app/src/routes/`). Treat its line numbers as
indicative and its measurements as sound.

| Codex's claim                                                                                                                              | Verified?                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Two paths write`shared_group_id` with no review — `ingest_activity` Tier 3, and `strava-backfill` calling `dedupe_shared_outings` | **TRUE** — both confirmed in source                                          |
| 40 shared groups: 3 singletons, 6 spanning over an hour, 1 over twelve                                                                     | **TRUE, exactly** — worst span **12:12:54**                            |
| 548 activity_sources, 539 with no`ingest_item_id`, only 10 ingest items                                                                  | **TRUE** — and **0 import_artifacts**, 48 runs                         |
| No SHA-256, no original file stored, no artifact row, failures not persisted                                                               | **TRUE**                                                                      |
| Ingest RPCs accept caller-controlled actor/run data                                                                                        | **TRUE** — `begin_ingest_run` takes `p_actor_kind` from the caller       |
| `setActivitySolo` (0188) deletes and recreates participants, bypassing tag claims                                                        | **TRUE** — and it is the same "tag without acceptance" 7a-12 fixed elsewhere |
| "Import an activity file" points at a route that does not exist                                                                            | **TRUE** — fixed today                                                       |
| Needs Attention rows both link to`/add`; the real inbox is embedded there                                                                | **TRUE** — mine, from 2026-08-18                                             |
| Data Health and Needs Attention overlap; export duplicated across both                                                                     | **TRUE**                                                                      |

**Where I disagree with its ordering:** it puts "add a canonical-outings view and move every
reader onto it" first. The 40 groups those readers would count are the ones it also says are
unaudited — including a twelve-hour group. **Auditing the groups has to precede trusting
them**, or a new view is a faster way to count the wrong thing.

#### 3e. THE PLAN TO MAKE INGEST AND REVIEW MAKE SENSE *(2026-08-18, sequenced)*

Ordered so each step is verifiable on live before the next depends on it.

**Step 1 — stop making unreviewed groups, then audit the ones that exist.**

- `ingest_activity` Tier 3 and `dedupe_shared_outings` must **propose**, never write
  `shared_group_id`. §2's rule already says a machine may only propose; these two predate it.
- Audit all 40: **3 singletons** (a group of one is not a group), **6 spanning over an hour**,
  **one spanning 12:12:54**. Each is either a real joint outing or a bad merge, and until
  reviewed no total that groups by them is trustworthy.
- **Do not bulk-link the pending proposals** until the comparison screen and this audit are
  done. Codex is right about that and the "Link all" button should say so.

**Step 2 — naming that does not ask when it does not need to.** Her instruction, unbuilt:

- Take the name from the SOURCE first (Strava/Garmin title where a person typed one), then
  the place, then the geocoder.
- Ask **only when in doubt**: no source name AND an unnamed or brand-new place, or two
  candidates that disagree. Everything else is named silently and shows up in history, not
  in a queue.
- The existing `isGenericActivityName` already knows "Morning Hike" is a clock reading rather
  than a name; that is the seed of the doubt test.

**Step 3 — provenance that is actually recorded.** 539 of 548 sources have no ingest item and
there are zero artifacts:

- SHA-256 every uploaded file; store the original privately; write `import_artifacts`, link
  it to the `ingest_items` row, and persist FAILURES as items too.
- Keep the three identities separate and never conflate them: **file hash** (this exact file),
  **provider id** (this record at Strava/Garmin), **content key** (this recording, 0216).
- Label pre-existing rows `legacy` rather than inventing provenance for them.

**Step 4 — lock the ingest RPCs.** User-facing entry points hardcode `actor_kind='user'` and
`initiated_by=auth.uid()`, verify the run belongs to the caller and is still running, and
webhook/scheduled imports move to separate service-only functions. Add try/finally around the
importer so a failure cannot leave the page stuck busy.

**Step 5 — one repair queue.** `/add` creates, `/attention` repairs, `/inbox` redirects to
`/attention`, Data Health explains system condition only. The repair cards themselves move
into Needs Attention rather than being embedded in Add.

**Step 6 — finish people tagging.** `setActivitySolo` must stop deleting participant rows:
changing your OWN participation is direct, adding another *user* creates a proposed claim,
and declining never removes that person's own recording. Then extend tagging to visits,
photos and places (8b-i), and Josh's **44 legacy claims** get answered.

**Step 7 — one Export & Backup screen**, distinguishing a places export, an activities
export, and a full account archive — the current copy implies a completeness it does not have.

**Three decisions only Erica can make**, unchanged and not guessed at:

1. **"Florida"** — a Run of 67.8 miles in 502 seconds (486 mph) that also created a Florida
   place and visit. Delete, quarantine, or correct?
2. **Leesburg 2024-10-22** and **Great Falls 2026-07-19** — visits claiming evidence with
   nothing behind them. Real manual visits, or remove?
3. **Josh's 44 legacy tag claims** — his to accept or decline.

#### 3f. STEP 1 DONE — and the audit found six days that had been deleted *(0223/0224/0225)*

**"Florida" is gone.** Erica, 2026-08-20: *"yes remove the Florida 486 mph run"*. The
activity is deleted (67.8 miles in 502 seconds, a two-point line — a flight recorded as a
run); its derived visit went with it; the place it invented is in **Trash**, restorable,
because nothing else ever lived there. Her 2026-02-01 mileage drops from 94.9 to **27.1**.

**Both unreviewed grouping paths now propose (0224).** `ingest_activity` Tier 3 and
`dedupe_shared_outings` — the one still called at the end of every Strava backfill — wrote
`shared_group_id` on two rows outright. §2 has forbidden that since it was written; these
two predate the card that made it answerable and never caught up. Nothing they find is
lost; it becomes a card with two shapes and two answers.

##### The audit, and what it found

Not "unreviewed". **Wrong.** All six groups spanning more than an hour were ONE PERSON
going out twice in a day, recorded as one outing:

    Josh  2023-08-02   6.04 mi 10:27  +  6.02 mi 22:39     12h 12m apart
    Josh  2023-08-01   6.02 mi 15:29  +  6.12 mi 21:40      6h 11m
    Erica 2022-12-04   Dickey Ridge   +  Shenandoah         2h 28m
    Erica 2025-10-04   ride 9.80      +  ride 10.50         1h 34m
    Josh  2023-05-30   3.89 mi        +  3.88 mi            1h 29m
    Erica 2020-05-12   ride 6.44      +  ride 6.08          1h 28m

**The cause is one column used as if it meant something else.** `dedupe_shared_outings`
decides "two different people" with `a2.athlete_id is distinct from r.athlete_id` — but
`athlete_id` names a **Strava account**, not an owner. A file import has `athlete_id = NULL`,
and `null is distinct from <id>` is TRUE, so a person's own file copy read as a different
athlete from their own Strava copy — **and from their own second run that day.**

**Why this is the worst kind of bug here: linking makes an outing count ONCE.** Six wrong
links meant **six days of hers and his were absent from every total** — not visibly, not
recoverably by looking. Nothing on screen was wrong; the number was simply smaller than the
truth. Unlinking them RESTORES six outings; it removes nothing.

    shared groups   39 → 33      spanning over an hour   6 → 0      worst   12h12m → 50m
    outings counted            Erica 369 of 374 activities · Josh 163 of 173

0225 also fixes the matcher to compare `owner_profile`, so it can no longer propose a person
as their own companion.

##### Three left, and they are HERS to call — not auto-decided

Same fault, same-person pairs, but short enough to be genuinely ambiguous:

    Josh  2023-05-24   1.01 mi + 1.01 mi        50 min apart
    Erica 2018-08-01   0.78 mi + 0.75 mi        36 min   (Leesburg, both)
    Erica 2018-08-13   1.12 mi + 1.03 mi        22 min   (Lake of the Red Rocks / Red Rock Regional Park)

Each is either two short outings close together, or one outing whose recording restarted.
**The asymmetry argues for unlinking**: a wrong link silently erases a day, while a wrong
unlink merely double-counts one — which is visible and trivially fixed. But that is a
judgement about days she was there for, so it waits for her. There is no *unlink* card yet;
the review queue can only propose linking, which is the next gap to close.

#### 3g. CI RAN OUT OF MINUTES, AND THE SHAPE WAS THE PROBLEM *(2026-08-20)*

Actions stopped dead on 2026-08-19: **3,000 of 3,000 minutes used, twelve days to reset.**
Every workflow — including the nightly **Backup** — failed with *"recent account payments
have failed or your spending limit needs to be increased"*. The two causes produce identical
text, which is why it read as a payment problem when it was an exhausted allowance.

**It was not volume, it was billing shape.** Measured before changing anything: **431 CI runs
in 30 days**, and

    a full CI run     11 billed minutes
    a docs-only run    6 billed minutes   ← six jobs, each doing 3–9 seconds of work

**GitHub rounds every JOB up to a whole minute.** This workflow fans out into six, and each
one started, checked out, and *then* guarded every step with an `if:`. So a run with nothing
to do still cost six minutes — and a docs-only change cost that **twice**, once for the PR
and again for the push to `main`. 431 × ~7 ≈ 3,000. The whole allowance, about half of it
buying nothing.

**Three changes (#128):**

- **The skip moved from the step to the job.** A skipped job bills nothing.
- **The release gate treats `skipped` as "nothing to check."** It demanded exactly `success`
  from all four gates, so job-level skips would have failed every docs change.
- **Full validation is weekly, not nightly** — it carries the cross-browser matrix, ~9
  billable minutes alone, ~450/month, re-proving what every code PR already proves.

**Left alone deliberately:** the push-to-main trigger. `PRODUCTION_DEPLOY_ENABLED=true`, so
that push **is** the deploy path — dropping it to save minutes would have silently removed
automatic deployment. Verified afterwards: the merge of #128 ran **Deploy production
successfully**, and `/version.json` matched `main`.

##### What the first green run answered

CI had not run since 08-18, so 0223–0225 went in unverified. The first run after billing was
restored applied **all 225 migrations to a disposable database with ZERO errors** and failed
exactly **one of 60** SQL tests — `0203`, a real consequence of 0224 rather than an artifact.
Its assertion read *"another person's recording was swallowed as a duplicate (proposed)"*,
conflating **not inserted** with **not stored**; those became different things the day Tier 3
stopped linking automatically. Rewritten to prove the activity IS created, the join is
**offered**, and nothing was linked behind anyone's back.

**That also settles the seven other failures** seen when the suite was run against
production: they are artifacts of fixture tests meeting live data, not regressions. The
disposable run is the authority.

**Running costs now, measured:** backup **4 min/night (~120/month)**; a code PR ~10; a
docs-only PR should be ~2. Against 3,000.

**One thread left open:** `supabase start` replaying migrations one-by-one fails at
**0078** (`column "elevation_gain" does not exist`). CI never sees it because `db-bootstrap.sh`
builds the schema differently — and that path applies all 225 cleanly. Nothing is broken
today, but "the chain replays from zero" is the property a restore leans on.

#### 3h. STEP 2 DONE — names that do not ask a question nobody has *(0226)*

Erica: *"it should populate … the Name of the activity from the source or the location of
the source, then ask me to approve it only if there is some doubt."*

`activity_display_name` already had the right shape — a person's words, else the place, else
the type. The gap was what counts as **a person's words**. Measured across all 547:

    353  named after their place       ← the rule working
    129  a real name she typed
     58  "<X></x> County Running"          ← GARMIN's auto-name, counted as hers
      7  "Morning Hike"                ← Strava's, already caught

Garmin names an activity after the administrative area — *"Loudoun County Running"* **55
times over**. That is a machine's words, and the place it actually happened (Broadlands,
Potomac Station, Bear's Den) is strictly better. **58 renamed, no cards raised.**

**The pattern is narrow, and that was measured rather than chosen.** Every name ending in a
bare gerund is machine-made, but not all have something better:

    "Bay Lake Running"     → its place is "Cake Bake Shop Restaurant"
    "Track Meet Running"   → its place is "Sterling"

So it matches only the unambiguous `<something> County|City <gerund>`. The rest keep their
names: renaming those would be a loss, and a loss is worse than a poor name.

##### The eight left over are not what they look like

    5  Josh's, at a place still called "New place", WITH coordinates
    3  Erica's, with NO coordinates — 0.06 / 0.21 / 3.08 mi, indoor

The five are the **unnamed-place problem wearing an activity costume**: name the place and
the activity names itself, and that queue already exists. The three cannot be named by
anything but her, and a card asking her to name a 0.06-mile walk is noise rather than
review. **So this raised no cards at all** — which is what *"only if there is some doubt"*
means.

##### And the quieter half: 411 activities were named by VALUE

An activity named after its place stores a **copy** of that name. Rename the place and every
one of them keeps the old text — §"Derived vs source" again, in a spot nobody had looked.
`apply_inbox_field` now moves them with the place, and only them: a name she typed herself
never moves. Tested both ways.

    named after their place   353 → 411        still machine-named   65 → 8

#### 3i. STEP 3 — the file is kept, and every outcome is written down *(0227)*

Measured before writing anything:

    activity_sources              548
    …with no ingest_item_id       539
    ingest_items                   10
    import_artifacts                0      ← not one, ever
    storage buckets                 0      ← nowhere to put a file

**The provenance schema has existed since 0202 and had never been used.** An import recorded
that an activity came from *"a file"* — not which file, not its bytes, and nothing at all
about the ones that failed. A batch of 184 with three unreadable ones left 181 successes and
no trace of the rest.

Now, before a file is even parsed: **hashed (SHA-256), stored in a private bucket under its
own hash, and recorded as an artifact.** Then whatever happens next — inserted, duplicate,
proposed, or failed — lands in `ingest_items` pointing at that artifact.

**Three identities, kept separate on purpose**, because conflating them is how the last two
weeks of bugs happened:

|                              | Says                                   | Certainty                         |
| ---------------------------- | -------------------------------------- | --------------------------------- |
| **SHA-256** (0227)     | *this exact file, again*             | the same bytes — no inference    |
| **provider id** (0209) | *this record at Strava/Garmin*       | exact, within that provider       |
| **content key** (0216) | *this looks like the same recording* | an inference, deliberately narrow |

`file_already_imported` runs first and is the cheapest of the three: it can say *"you
uploaded this on 17 August"* rather than quietly making a second copy.

**Legacy is labelled, not invented.** The 539 rows that predate this have no artifact and
never will — nobody kept those files, and minting a hash for one would be writing down
provenance that does not exist. The new integrity check is **scoped by date** for that
reason: it flags a file import made *after* 2026-08-20 with no artifact, and says nothing
about the ones before.

**Verified end to end against production, then cleaned up:** unknown file → `seen:false`;
record → artifact id; ask again → `seen:true` with its first-seen date; record the same
bytes → **the same artifact id, no second row**; a failure → `disposition=failed`, linked to
the artifact, and the run reporting `ok=0 failed=1`.

**Still open in Step 3/4:** the ingest RPCs still take `actor_kind` from the caller
(§3e Step 4), and originals are stored but nothing yet re-parses them when a parser improves.

#### 3j. SHARING BECAME A CHOICE, AND A TOTAL STOPPED BEING A RECORDING *(0228–0231)*

Four instructions on 2026-08-20, which together are a better rule than any one of them:

> *"fuck Strava — add the route and the distance for those 24 cards"* ·
> *"use Garmin first then Strava and don't share Strava information"* ·
> *"I want users to be able to share their activities if they want"* → *"share everything I
> tag Josh on"* · *"I do want him to be able to see my total miles and total activities"*

**Tagging someone IS the act of sharing with them** — deliberate, owner-controlled, off by
default, revocable. `profiles.share_tagged_outings`, false for every new account, true for
Erica because she asked.

**The reversal of 0200 is narrow on purpose.** 0200 closed a genuine leak (46 of her
activities and 356 of her miles were showing as Josh's). It also made the product's stated
purpose unreachable. So the new rule is *a person may see the recording of an outing they
are on* — one outing at a time, never the account. Measured after:

    Josh reads          his own 90 Strava rows + the 46 of hers he is tagged on
    Josh cannot read    her other 138          ← unchanged
    his answerable tags 20 → 44

**GARMIN FIRST.** `visible_recording_of` now prefers a non-Strava sibling: where one outing
has both recordings, the copy with no strings attached is the one shown. Her instruction,
and the right default for a reason beyond preference.

**Nothing is copied.** Writing her polyline onto a row owned by Josh would have been the
same data with a different label and two copies to disagree. This changes who may READ the
single record that exists.

##### A total is not a recording (0231)

    the truth about her         394 rows → 375 outings, 1,968 miles
    what Josh could see         256 activities, 1,354 miles

`mileage_by_person` reads `visible_activities`, so ~799 miles simply vanished from her
totals as he saw them — silently smaller, not hidden-with-a-note. `person_totals` returns
**counts and miles and nothing else**: no id, no name, no route, no date, nothing joinable
back to a recording. *"Erica has run 1,968 miles"* is a fact about Erica; the route she took
on the 4th is a recording and stays behind 0228. The codebase had already drawn this line
once, for `data_health`.

##### The same second is the same recording (0230)

*"there are 58 activities asking me to review them but they are from my garmin so clearly
they are the same activity."* She was right, mechanically: **Strava's copy came FROM the
Garmin file**, so both start at the same second.

    25  different people                            ← a real question, left alone
     6  same person, 0–7s apart, within 1%
     4  same person, 0–18s apart, distance differs  ← Strava recomputes the total
     4  same person, 5–15 min apart                 ← ambiguous, still asked

0216's content key never caught them: a FIT brings a provider key, so the key path was taken,
found nothing, and fell through to a proposal. **The test is TIME, not distance** — distance
is recomputed by Strava, a start timestamp is copied verbatim through every hop, and one
person cannot begin two runs a minute apart. 12 certainties linked and closed; her queue
28, all of them real questions.

#### 3k. STEP 4 — the import RPCs stop taking the caller's word *(0234/0235)*

Codex called them "too trusting". Reading them found three holes, and the second decided
**whose account data landed in**:

1. **The authorization check could be skipped by asking nicely.**
   `if p_actor_kind = 'user' and not public.is_editor_or_owner()` — the guard only ran when
   the caller *said* they were a user. Passing `'scheduled'` skipped it entirely.
2. **A run could be attached to somebody else's connection.** `p_connection` went through
   unchecked, and `source_owner_profile` is read from that connection's owner — so
   `ingest_activity` made **that person** the owner of every activity the run created.
3. **Idempotency was global.** Reusing another person's key *joined their run*.

And `ingest_activity` took nothing but a run id — which is not a secret: it is returned by
`begin_ingest_run` and stored on every ledger row.

**The rule now:** a user-facing call says only WHAT it is importing. Who is importing, on
whose behalf, and into which run are read from the session, never from the arguments.
Service callers (cron, migrations, the Strava webhook) have no `auth.uid()`, are trusted by
the grant rather than by a parameter, and are unaffected.

**Each hole attacked as Josh against production, and refused:**

    claims actor_kind=scheduled   → "a signed-in import is a user import"
    opens a run via her connection → "that connection is not yours"
    writes into her run            → "that import run is not yours, or is already finished"
    finishes her run               → "that import run is not yours"
    her own import                 → inserted
    finishing twice                → 204, a no-op

**0235 exists because 0234's own test failed on its first run.** Scoping the *lookup* to the
caller left the index globally unique, so a second person reusing a key no longer joined the
run — they got a raw `23505 duplicate key` instead. Better than the hole, still wrong twice:
an import fails for a reason nothing to do with the importer, and the error confirms someone
else has used that key. The index is now scoped to its initiator, matching the lookup.

#### 3l. STEP 5 — one verb per screen *(2026-08-20)*

Erica, 2026-08-18: *"Needs Attention and Review Inbox are redundant."* They were, and the
arrangement was worse than duplication: **Needs attention listed counts while the actual
cards were embedded in `/add`** — the page named after *creating* — and `/inbox` redirected
there too. That is why she had to ask where the pending cards were: they were filed under
the wrong verb, and my first pass at merging the two only made the counts link to `/add`
rather than moving the work.

The split is by verb now, which is the one line that stays put:

    /add        create and import new information
    /attention  repair what is already there      ← the cards live here
    /inbox      redirects to /attention
    /health     diagnose the system, change nothing

`/add` keeps a **pointer** — "12 cards are waiting for you" — because adding something is
when a person is most likely to notice there is tidying to do. What it no longer keeps is
the queue.

Pinned with an e2e check, because an embedded queue is exactly the kind of thing that drifts
back onto whichever page someone is working on next: `/inbox` must land on `/attention`, the
cards must render there, and `/add` must not host them.

**Not done in this step, and still true:** Data Health and Needs attention still overlap on
photos and places (Codex's point), and the repair cards for duplicate PLACES still live at
`/duplicates`. Both are the same move as this one and are next after tagging.


### Step 6 — saying who was there stopped overwriting what they said about it *(0236)*

`set_activity_solo` backs the `Together / Just me / Just Josh` picker, and it ran:

```sql
delete from public.activity_profiles where activity_id = p_activity;
insert into public.activity_profiles (activity_id, profile_id) select ...
```

Every participant row wiped and replaced with a bare one. Four consequences, the last of
which had only been true since that afternoon:

1. **It erased his answer** — `claim_status`, `evidence`, `asserted_by`, `decided_by`,
   `rule_id`. If Josh had ACCEPTED a tag, the record that he accepted it was gone, and
   §7a-12 exists precisely to keep it.
2. **It tagged him without asking**, around `tag_claims` entirely.
3. Its "everyone" branch **re-added every owner and editor** — the 0039 behaviour that put
   46 of her activities on his stats in the first place.
4. **And it shared.** Since 0228 an `activity_profiles` row is what lets a tagged person see
   a Strava recording, so a picker that silently writes rows silently shares.

The rule now: your own participation you may state; adding anyone else **proposes** a claim
they can accept or decline; removing them **retracts** it; and a row evidencing somebody's
own recording is never the tagger's to delete — that is the difference between "you weren't
with me" and "your run did not happen". Verified against production and rolled back:

```
before: his row says          accepted / tagged_and_accepted / decided by HIM
after "Together":             accepted / tagged_and_accepted / decided by HIM
after "Just me": he is        removed, and his claim retracted
her own row                   survived
his own separate recording    untouched
re-tagging him creates        proposed
```

**A guard that was fictional.** 0228 gated sharing on `claim_status <> 'declined'`. The
column's CHECK permits **accepted, accepted_legacy, proposed, rejected** — there is no
`'declined'`, so the clause could never exclude anybody. It had leaked nothing, because
declining DELETES the row, but it read like a safeguard while doing nothing, which is worse
than not having written it. Corrected in all three places that carry the predicate.

### The rest of Step 6 — a visit is a claim too *(0240–0245)*

`set_activity_solo` was one of three. `set_visit_participants` — which backs the same picker
on a visit, and on a place, and in the photo sorter — ran the identical
`delete … ; insert (visit_id, profile_id)`. `visit_profiles` carries claim_status, evidence,
created_by, asserted_by, decided_by, decided_at and rule_id; 655 rows in production, every one
of them `accepted` / `unknown`, which is what that history looks like after enough overwrites.

**ONE DIFFERENCE FROM THE ACTIVITY CASE, AND IT DECIDES THE DESIGN.** For an activity, 0236
writes a `proposed` row straight away, because since 0228 that row is also what SHARES the
recording. A visit has no sharing gate — and **nothing filters `visit_profiles` by
claim_status**. Checked against production: of the 24 functions that read that table, exactly
one (`respond_to_tag`) looks at the column. `place_visit_counts`, `settings_stats`,
`wander_stats`, `place_ids_for_view` and `shared_outings` all treat a row as a fact. A
`proposed` row would therefore put a place on somebody's counts before they agreed they had
been there, which is the 0039 harm — the one that put 46 of her activities on his stats. So
**for a visit the claim IS the pending state**, and no row exists until it is accepted.

**A PLACE ASKS ONCE.** `set_place_solo` loops every visit at the place; Lake of the Red Rocks
has 43. Answering "were you with me here" forty-three times is not a better version of never
being asked, so `tag_claims.subject_kind` gains **'place'**: one question, and accepting it
writes the rows for every visit there. Asking it also **withdraws the open questions about
that place's individual days** — a place and one of its visits are a question and its own
subset, and asking both is how the queue got to *"redundant and makes no sense"*. Not
symmetric: naming somebody on a single day does not touch the wider question.

**WHAT CANNOT BE TAKEN AWAY.** 0236 protected a row evidencing somebody's own recording; the
visit equivalent is their own evidence for the day — a photo THEY uploaded or an activity THEY
recorded, in `visit_evidence`. Somebody else saying "I was here alone" does not delete the
proof that another person was too.

**0241 — asking again after taking it back.** 0240's own test found it on the first run:
`tag_claims_one_per_subject` is UNIQUE per (kind, subject, person), so the entirely ordinary
sequence *Together → Just me → Together* retracted the claim and then crashed inserting a
second one. Nobody could re-add a person they had removed. 0236 had avoided the crash by never
re-asking at all, which is the opposite failure. Three closed states, three answers:
**retracted → reopen** (she changed her mind, that is hers to do); **declined → leave it**
("I was not there" is answered once, and re-asking on every press is nagging dressed as a data
model); **accepted → leave it**.

**0243 — and the picker says what it actually did.** All four functions returned `void`, so
every one of the six screens that call them did `await setPlaceSolo(...)` and then showed the
person as being there. That is worse than the bug being fixed: before, the app wrote something
untrue to the database; after, it would write the right thing and tell her the wrong one. They
return `{stated, asked, removed}` now, and the screens say *"Asked Josh. It counts for them
once they say yes"* instead of guessing — the photo sorter merging a whole batch into one
sentence rather than a snack per visit.

**0245 — and creating a visit builds a record; the picker makes a statement.** Five tests
failed in CI, none of them about tagging: evidence routes (0166), one way to change a visit
(0169), the trip rules (0170), merging (0185) and the counts (0190). Each had built a visit
with two people in order to test something else and now got one. The line is not "the picker
asks and everything else asks too" — it is **a person's word about somebody else is a
question; a record being constructed from a list its caller already holds is not**.
`set_visit_solo` and `set_place_solo` are the first. `create_visit` is the second, and no live
screen calls it: `addVisit` is deprecated with zero callers and passes no participants at all.
Its rows say `evidence = 'created_with'` rather than claiming somebody decided something, so
if that ever stops being true it is visible in the data.

**0244 — undo puts people back; it does not ask about them again.** `set_visit_participants`
has three callers and only one of them is a person saying who was there. `restore_visit` ran
everybody through the asking path, so pressing **Undo** on a deleted visit turned somebody
else's ACCEPTED participation into an unanswered question and dropped them from the visit
until they answered it a second time. Caught by `0185_two_visits_that_were_one` the moment
0240 reached CI. `create_visit` was left alone deliberately — naming somebody while creating a
visit is the same statement as naming them on the picker afterwards, and should ask for the
same reason; the fixtures that broke were asserting the old behaviour and now accept the
claim. The snapshot was also too small for its job: `delete_visit` recorded
`jsonb_agg(vp.profile_id)`, which was enough while a participant WAS an id, and an undo that
restores only the id throws away who asserted it, who decided it and when. It records the
whole row now, and restore reads both shapes because an undo token issued minutes before the
deploy still carries the old one.

**A QUESTION NOBODY IS ASKED IS NOT A QUESTION.** `my_tags_to_confirm` returned ACTIVITY claims
only. Visit claims have been storable since 0201 and `respond_to_tag` has known how to answer
them just as long — but nothing ever put one in front of the person, so a visit tag sat
'proposed' forever. All three kinds are surfaced now.

**AND TWO WORDS FOR ONE IDEA, WHICH IS NOT FIXED.** `tag_claims.status` permits **declined**;
`activity_profiles.claim_status` permits **rejected**. Same meaning, different word, adjacent
tables — which is exactly how 0228 came to gate sharing on a value that could never appear.
Unifying them is a data migration and was not done here; it is written down in 0240 so the
next person to read a `<> 'declined'` does not assume it works.

### Step 7 — an export that is actually everything *(0237, 0238)*

Two screens offered an export and both overstated it:

| Screen | What it said | What it produced |
| --- | --- | --- |
| Data health | *"Download everything you can take with you."* | 162 places |
| Settings | *"Download all 162 places"* | the same three buttons |

567 activities, 552 visits, 655 participants, 178 photos, 619 pieces of visit evidence,
17,128 pings, 49 import runs and every journal entry were not in it. The Data health
sentence is the one that mattered: it told her the record was safe on her own disk when
almost none of it was, and **a backup you believe in and do not have is worse than no
backup at all**.

**One screen, `/export`, three distinct things**, each saying what it contains AND what it
does not: the **places** (CSV/GPX/KML, for opening in a map), the **outings** (CSV with
miles/time/climb, GPX with one track per route), and the **archive** — 31 sections, ~24,000
rows, one JSON file — which shows its own table of contents, with real row counts read from
the database, before anything is downloaded.

**Three functions, not one, and the reason is a number:** `authenticated` carries
`statement_timeout = 8s`, and the whole archive takes about seven seconds to assemble as
superuser. A single `export_archive()` would have died on the timeout for the person with
the most data — the one who most needs it. So `export_manifest()` (the contents),
`export_header()` (the envelope), `export_section(name)` (one section), and the browser
walks the list. `0237_the_export_is_the_whole_thing.test.sql` asserts that every section the
manifest promises resolves AND has the count it claimed, so the contents and the table of
contents cannot drift apart silently.

**SECURITY INVOKER, deliberately**, where nearly every other function here is DEFINER. An
export is exactly where a definer's convenience becomes a way around everything: a
`SECURITY DEFINER export_everything()` would have handed all 567 activities to anyone who
could call it and quietly undone 0228 and 0236. Running as the caller, the archive is
bounded by the same policies as the app. Measured on production: Josh's manifest says
**429 activities**, Erica's says **477**, of 567 — each seeing their own plus what the other
has chosen to share. What you can see is what you can take.

**And it found something on its first run.** `import_artifacts` (0227) — the record of every
original file uploaded, its hash, size and object key — had RLS enabled and **no SELECT
policy at all**, and `authenticated` was never granted SELECT. Not a decision anybody wrote
down; the grant its two siblings got (`ingest_runs`, `ingest_items`, both `is_member()`) was
simply not repeated. `ingest_items` already exposed `artifact_id`, so a member could see
that an artifact existed and not what it was: no privacy gained, provenance broken. **0238**
gives it the same rule as its siblings.

**And one section pages, because one section grows on its own** *(0239)*. Measured the day
0237 shipped: `location_pings` was 17,128 rows and 1,270 ms server-side; every other section
combined was under 300 ms. Roughly 6× headroom and exactly one thing that will spend it — a
device recording all day adds thousands of pings without anybody going anywhere. At ~100,000
the section stops returning, and it stops returning for the person with the most to lose,
which is the failure 0237 split the function up to avoid. `p_offset`/`p_limit` therefore
apply to `location_pings` and to nothing else, ordered `(recorded_at, id)` because pings
share a timestamp often enough that ordering by time alone would put a row in two pages or in
none. The test asserts the pages partition the section exactly: a ping dropped between pages
is a place somebody went that the archive says they did not.

**Four things are deliberately absent, and the screen says all four out loud**: the photo and
video FILES (this holds their dates, places, names and hashes — bytes are what the nightly
encrypted off-site backup is for); CREDENTIALS (restoring them would restore somebody's
ability to act as her); anything the person asking cannot already see; and machine proposals
and operational logs. Point geometries are dropped rather than written as GeoJSON — `places`,
`activities`, `photos` and `location_pings` each carry `lat`/`lng` beside `geom`, so keeping
both was a megabyte of the same fact twice — while real shapes are written as GeoJSON so the
file opens in something other than this application.

## 8. Facts that must not be relearned

- **Overpass** rate-limits 2 slots per IP and edge functions share Supabase egress:
  rotate mirrors, hard-abort at 25s, keep batches ≤8.
- **Overpass returns nothing for Red Rock / Lake of the Red Rocks** — 97 activities. No
  suggestion must mean leave it alone.
- **`admin.rpc(...).catch()` is a TypeError** — an rpc() is a thenable, not a Promise.
- **A date-only string parses as UTC midnight** and renders as the previous day west of
  Greenwich. Parse `YYYY-MM-DD` with local components. (`fmtRunDate` now does this itself.)
- **~~`places.part_of` is the record of membership~~ — REVERSED 2026-08-15 by migration
  0192. `place_membership` is the record; `part_of` is the mirror.** For most of this
  project's life the opposite was true, and writing a membership row on its own undid
  itself the next time anyone touched that place — which is why the old wording said
  "write `part_of`". 0192 dropped `places_sync_membership` and added
  `membership_sync_part_of` going the other way, and moved every writer:
  `add_to_container`, `remove_from_container`, `add_place_to_visit`, `merge_places_auto`
  and **`create_experience`** — that last one is the card's "Part of a trail?", which
  would otherwise have been accepted and silently dropped. **Write the ROW.** The array is
  kept correct only until `create_experience`, `rebuild_place_visits` and the exports stop
  reading it, and then it goes.
- **The app's global input CSS is `display:block; width:100%`** — it makes a radio 238px
  wide. Pin size on any radio or checkbox.
- **MapLibre 6** removed the default export; **Vite 8** removed object `manualChunks` and
  preloads lazy chunks (both put 1 MB of MapLibre back on `/login`).
- **A branch deploy goes to a preview alias**, not production; the alias serves a stale
  `index.html` for a while — verify against the exact deploy-hash URL.
- **`AON_SUPABASE_SECRET_KEY` in `.env.local` is the disabled legacy JWT.** Use
  `SUPABASE_SECRET_KEY`.
- **No local Deno, no psql.** Edge-function pure logic is tested by vitest; SQL tests run
  against production inside a rolled-back transaction — which is **not** equivalent to a
  fresh database, so tests must never assert production row counts.
- **A deleted file can be RESURRECTED by OneDrive plus the auto-save commit.** `README.md`
  was deleted on 2026-08-11 and reappeared 90 minutes later in
  `auto: save from Claude Code (2026-08-11 08:58)` — OneDrive restored the file from its
  own history and the periodic auto-commit added it back. After deleting anything, check
  it is still gone an hour later.
- **Never** reintroduce the home exclusion zone. **Never** force-push. The service_role
  key is already rotated — do not ask her to rotate it again.

---

## 9. Where things live

**Here.** Everything is in this file, from 2026-08-11: the model, the business rules, the
operations runbooks, the security baseline and the decision history are all sections below.

`CLAUDE.md` still exists ONLY because Claude Code loads it automatically at the start of
every session — it is a four-line pointer to this file, not a second document. Nothing
else is a `.md`.

**History of deleted docs:** git. `git log --diff-filter=D --name-only` finds them.

Both of those lived outside the repo and are now deleted too.

---

# PART TWO — REFERENCE

Everything below was a separate markdown file until 2026-08-11. Erica: *"it is now the
SINGLE source of truth and any future changes and instructions should be added there,
never create a new MD."* The plan is Part One, above; this is the reference material it
relies on.

## 10. The data model

*(was §10 (the data model, below))*

**Authoritative as of 2026-08-08 (migrations 0136–0137). If any other document, comment, or
plan contradicts this file, this file wins and the other one is wrong.**

Read this before touching places, visits, trips, stats, or containment.

#### Why this file exists

The same schema work was redone at least five times. The cause was not carelessness —
it was that **three different models were each "authoritative" in some document**, so
every session picked one and undid the last:

| Document                                      | Claimed a trip is…                               |
| --------------------------------------------- | ------------------------------------------------- |
| ADR 0001 (deleted 2026-08-11, in git history) | a first-class`trips` row, **not** a place |
| `NewClaude.md` (deleted 2026-08-11)         | a**place** that is a non-counting rollup    |
| What Erica actually wants                     | a**visit she marked**                       |

Worse, two mechanisms silently *regenerated* the retired model, so data fixes could
not hold:

1. `sync_place_category` had `when NEW.categories @> array['trip'] then 'trip'` as its
   second branch. Migration 0127 cleared that category; every later UPDATE re-derived
   it. Cape Cod ended up back at `category='trip'` → `counts_as_place=false`, holding
   10 photos and a real visit while counting as **nothing**.
2. `visits.is_trip` was a GENERATED column, `end_date > start_date` (migration 0047),
   so the database promoted **any** multi-day visit to a trip by arithmetic. 50 of 485
   visits were flagged trips that Erica never marked. Brewster's 2-day stay was one.

Both concepts are now removed, not merely cleaned up. There is nothing to regenerate.

#### The model — two nouns

##### PLACE — counts **once**, ever

A row in `places`. Every real thing is one: a city, a region, a restaurant, a beach, a
trail, a destination like Cape Cod. Returning to a place does **not** add another
place; it adds a visit.

```
counts_as_place = NOT is_trail
```

A **trail** is the only thing that does not count, because it is a rollup of segments
that already counted — counting it too would double-count. A destination **always**
counts. There is **no `trip` place category**; do not add one back.

A city is both a place you visited *and* a box holding other places. It is not one or
the other. San Diego counts, and so do the taco shop, the beach, and the ride.

##### VISIT — counts **every** time

A row in `visits`: dates, attribution, and evidence. Two stays in San Diego are two
visits at one place.

- `is_trip` — **a person marked this visit as a trip.** Nothing automatic ever sets
  it. Not duration, not a stop count, not an importer. `set_visit_is_trip()` is the
  only way, and it requires owner/editor.
- `status` — `taken` (it happened) or `planned` (a future-dated trip).
- `manual` — protects the row from `rebuild_place_visits`, which deletes derived
  visits. Any marked trip is `manual = true` for exactly this reason.
- `solo_profile` — attribution. `null` = **Both**; otherwise that person. Attribution
  lives on the visit only, never on the place. `places.solo_profile` was the last
  place-level remnant and was **dropped in 0136**; read a place's attribution from
  `place_attribution()`, which derives it from the visits.

**Photos and activities are evidence hanging off a visit.** They are not sibling rows
and never their own visits. Brewster is one 2-day visit that contains a ride and a
run — not three visits.

#### Containment

A place attaches to a container two ways:

- **spatially** — coordinates inside a `boundary` polygon (cities, regions)
- **by explicit link** — `place_membership`, for trails and destinations

`place_membership` is canonical. `places.part_of` is a compatibility mirror only.
Write relationships through the canonical mutation API from §0.3; never add a new direct
writer to `part_of`.

#### The statistics

Every stat uses the same view rule, so they can never disagree:

Use `accepted_visits` joined to `visit_profiles`. An absent participant row means unknown,
not "Both"; shared attribution requires explicit participant rows. The older
`solo_profile IS NULL` rule is retired compatibility history.

| Stat   | Definition                                                                   |
| ------ | ---------------------------------------------------------------------------- |
| Places | distinct places with a qualifying visit, where`counts_as_place`            |
| Visits | count of visit rows (the map badge = number of visits, never days)           |
| Trips  | count of accepted top-level visits where canonical`counts_as_trip` is true |
| Miles  | sum of`activities.distance`, attributed the same way                       |

#### Naming (migrations 0129–0131)

There is **no automatic naming.** The nightly geocoder and the dupe-merger were
unscheduled in 0130 — they were the thing overwriting names within the hour.

- `name_locked` — a person named it; automation must never rewrite it
- `named_by` — who chose the name
- `name_scope` — the space it was named in: a profile id = that person's own space and
  only they may rename; `null` = the shared Both space and either may

A real name is claimed on **any** write by a trigger (0131), so the several client
creation paths cannot drift out of sync one at a time.

#### Rules for changing this

1. Never reintroduce a `trip` place category or a derived `is_trip`.
2. A one-shot data fix that a trigger can undo is not a fix. Remove the mechanism.
3. Every rule here is enforced by a DB test in `supabase/tests/`. If you change a
   rule, change its test in the same migration — and give the test a negative control
   that fails when the rule is removed.
4. Update **this** file, not a new plan document.

#### Retired — do not restore

- The `trips` / `trip_stops` tables (a trip is a visit). **Dropped in 0137**, along
  with the `trip` place category, the /trips + /trip/:id + suggested-review pages,
  and every `*_trip_stops_*` function. `rebuild_place_visits` takes its fusing
  window from `visits.is_trip` now; `create_experience` raises on a trip link.
- `places.solo_profile` (dropped in 0136).
- `places.category = 'trip'`, and `holds_children` including `'trip'`.
- `visits.is_trip` as a generated column.
- Auto-detected / `suggested` trips that reappeared as new suggestions daily.
- The nightly geocode and dupe-merge schedules.

## 11. Business rules and agent instructions

*(was the substance of `CLAUDE.md`)*

Private travel-map web app for Erica (owner) and her partner (editor). World map of visited
places, auto-built from photo EXIF, passive GPS, and Strava. Invite-only. Domain:
adventureorno.com on Cloudflare Pages. Repo: github.com/adventureorno26/adventureorno.com
(GitHub account: adventureorno26).

#### The verification rule (non-negotiable)

**Every change is verified in the UI, on production, after it deploys.** Not "the build
is green", not "the migration applied", not "the row is in the table" — opened in a
browser, on the real site, doing the thing it claims to do.

This exists because it was broken repeatedly:

- A membership row was deleted and the card still showed the section, because the UI
  reads a denormalised `part_of` column and the delete never touched it.
- 28 visits were reported as empty because a query counted activities on the container
  instead of the sections.
- A config value went missing and the Google Photos button silently disappeared —
  nothing failed, nothing logged.

So: **done means seen on the screen.** If it has not been opened in the app after
reaching production, it is not done, and it must not be reported as done. When the
database and the screen disagree, the screen is right.

#### Stack (do not substitute without asking)

- Frontend: React 18 + Vite + TypeScript. MapLibre GL JS v5 for all maps. Deployed to Cloudflare Pages.
- Current basemap: Mapbox raster fallback rendered by MapLibre GL JS v5. Target basemap:
  self-hosted Protomaps PMTiles in Cloudflare R2 through the read-only tile Worker in
  Phase 4. Geocoding currently uses Mapbox with a MapTiler fallback; it is a separate
  replaceable service, not part of the self-hosted basemap.
- Backend: Supabase — Postgres 15 with PostGIS, Auth, Edge Functions (Deno), pg_cron.
- Photo storage: Cloudflare R2, accessed only through the `photo-gateway` Worker (upload + signed reads).
- Workers: Wrangler-managed, in `/workers`. Edge Functions in `/supabase/functions`.
- Package manager: npm. Lint: eslint + prettier. Tests: Vitest, SQL regression tests on a disposable Supabase stack, Worker tests, and Playwright across desktop Chrome/WebKit plus iPhone/Android projects.

#### Repository layout

```
/app                 React SPA
/workers/photo-gateway   R2 upload, thumbnailing, signed URL reads
/supabase/migrations     SQL migrations (numbered, never edited after merge)
/supabase/functions      ingest-overland, strava-webhook, strava-backfill, invite
/docs                STATE.md — this file, and nothing else (2026-08-11)
```

#### Non-negotiable business rules

1. **No home exclusion zone.** There is NO location-based ingest filter. Photos, location pings,
   and Strava activities are stored regardless of where they were taken — including at home. (The
   old 15-mile "home zone" around Leesburg was removed in migration `0102`; do not reintroduce it
   anywhere — code, `settings`, docs, or UI.) Local outings ARE logged and counted.
2. **Strava ingest.** Every Strava activity with a start point is ingested and placed, regardless
   of type or location. (Hikes/Walks/Runs are no longer a special case — nothing is excluded.)
3. **Mileage counter.** The stats bar shows total miles (sum of `activities.distance`, meters →
   miles, 1 decimal) across all stored Strava activities, plus a per-type breakdown on hover/tap.
4. **Photo processing.** Server-side resize so the longest edge ≤ 2400 px (originals are NOT
   retained), plus a 400 px thumbnail. Serve via signed URLs only — no public R2 access. Strip
   GPS EXIF from the stored file; coordinates live only in the DB.
5. **No screenshots.** The upload Worker rejects: any image without GPS EXIF, any PNG, and any
   image whose EXIF lacks a camera make/model. (The iOS Shortcut also filters `Is Screenshot = false` and `Has GPS = true` — the Worker is the backstop, not the only gate.)
6. **Deletion blocks the automated re-import, but a manual re-upload can bring a photo back.**
   Owner can delete any photo; an editor can delete photos they uploaded. Deletion removes the R2
   objects and DB row AND inserts the photo's SHA-256 hash into `deleted_hashes`. The nightly
   Shortcut ingest still rejects any upload whose hash is in `deleted_hashes` (so deletions aren't
   auto-resurrected). A **deliberate manual upload** (override) may re-add a deleted photo — doing
   so clears the hash from `deleted_hashes`. (Changed from the original "permanent + sticky" rule
   at the owner's request.)
7. **Auto-upload is Erica-only.** Exactly one device ingest token exists (Erica's). The partner
   has role `editor`: full manual upload / entry editing rights in the UI, but no ingest token is
   ever issued to him, and there is no UI to create additional device tokens without owner role.
   **The database disagreed with this rule until 2026-08-29**, when `ingest_tokens` held three
   live rows: Erica's *daily Shortcut* token (the one actually in use), an *"Erica iPhone —
   photos"* token created 2026-07-25 that has **never been used**, and a *"Josh iPhone —
   photos"* token, also live, which is the row this rule says must not exist. Josh's was
   revoked (§7 register). Erica's unused second token was left live at her instruction —
   `select label, last_used_at, revoked_at from ingest_tokens` is the check, and a rule kept
   only in prose is one nothing enforces.
8. **Privacy.** No public routes. Every page requires an authenticated session; every table has
   RLS requiring a `profiles` row. Signups disabled in Supabase Auth — access only via the invite
   flow. Never log photo coordinates or tokens.

#### Schema quick reference

**The data model is defined in §10 (the data model, below) — read that first.**
A place counts once; a visit counts every time; a trip is a visit you marked. There is
no `trips` table and no `trip` place category.

(Table list below; authoritative version = migrations)
`places`, `entries`, `photos`, `location_pings`, `activities`, `trips`, `profiles`, `invites`,
`deleted_hashes`, `settings`, `ingest_tokens` — as defined in `0001_init.sql`. Geometry columns
are `geography(Point,4326)`. Cluster job uses `ST_ClusterDBSCAN` over unassigned photos + pings,
merge radius 10 km, assigning to nearest existing place within 10 km before creating new ones.

#### Environment (this project's live services)

- Supabase project URL: `https://aanfyhsjbtnqzphuoiem.supabase.co`
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_...` key) are
  client-safe and live in `.env.local` / Pages env vars. The **service_role key is never
  committed, printed, or logged** — Supabase/Wrangler secrets and `.env.local` only.
- `VITE_MAPBOX_TOKEN` and `VITE_MAPTILER_KEY` are client-side fallback credentials and
  must be origin-restricted in their provider dashboards. Neither is the target basemap.
- Actual key values: see `.env.local` (gitignored) — MANUAL-SETUP.md records the
  provider/dashboard source, never the value.

#### Git & GitHub workflow

- Remote: `adventureorno26/adventureorno.com`, authenticated via the local `gh` CLI session
  (account adventureorno26). Verify with `gh auth status` at session start; if unauthenticated,
  stop and ask Erica to run `gh auth login`.
  **`gh` holds four github.com accounts on this machine and `adventureorno26` is not the
  active one** (2026-08-29 — the active account was `erica-83`). The failure is confusing
  rather than obvious: every call returns `Could not resolve to a Repository`, i.e. a private
  repo answering as if it does not exist. `gh auth status` alone is not enough — check *which*
  account is active, and `gh auth switch --user adventureorno26` before anything else:

  ```sh
  gh api user --jq .login     # must print adventureorno26
  ```
- Work on a focused branch; open a PR with a summary and exact verification counts.
  Never merge or promote a production deployment while required CI is red.
- **`main` is protected, and the line that said it could not be is wrong** (corrected
  2026-08-29). It said *"this private repository cannot use GitHub's paid branch
  protection on the current plan"*. That was written before the account moved to GitHub
  Pro (§7d, 2026-08-16) and nobody re-tested it afterwards. **A repository ruleset was
  created and is `active`**: ruleset `21818125`, "main protection", on `refs/heads/main`,
  with
  `deletion`, `non_fast_forward` (force-push), `pull_request` (0 approvals — there is
  only one reviewer) and `required_status_checks` = **`Release gate`**, the single job
  that already aggregates build/database/security/smoke. `RepositoryRole 5` (admin)
  keeps `bypass_mode: always`, so Erica is never locked out of her own repository;
  everything else has to go through a PR with a green gate.
  Read it back with `gh api repos/adventureorno26/adventureorno.com/rulesets/21818125`.
- **Dependabot alerts and automated security fixes are on** (2026-08-29 — both were off,
  which is why `.github/dependabot.yml` had been opening version PRs but nothing was
  watching for vulnerabilities). `gh api repos/<repo>/vulnerability-alerts` returns 204
  when enabled and 404 when not; `automated-security-fixes` reports `{"enabled":true}`.

  **Turning it on immediately surfaced 17 open advisories — 2 critical, 8 high, 7
  moderate** — that had been invisible the whole time, and the first push to the repo
  after enabling it said so in the push output. They are all dependencies, so they are
  **not** in the change that found them; automated security fixes will start opening the
  PRs. What is there today:

  | severity | package | vulnerable | patched |
  | -------- | ------- | ---------- | ------- |
  | CRITICAL | `vitest` (root lock **and** `workers/photo-gateway`) | `< 3.2.6` | `3.2.6` |
  | HIGH | `vite` | `<= 6.4.2` | `6.4.3` |
  | HIGH | `sharp` | `< 0.35.0` | `0.35.0` |
  | HIGH | `brace-expansion` (×4 ranges) | `< 1.1.18`, `< 5.0.9` | `1.1.18` / `5.0.9` |
  | HIGH | `undici` | `>= 7.0.0, < 7.29.0` | `7.29.0` |
  | HIGH | `js-yaml` | `>= 4.0.0, < 4.3.1` | `4.3.1` |
  | MODERATE | `esbuild`, `vite`, `undici` (×4) | see the alert list | — |

  The two CRITICALs are the same finding twice: the photo gateway still runs **vitest 2**,
  which is exactly the pin the `optionalDependencies` note in `package.json` describes
  working around. Upgrading it is a real change with a real chance of turning the release
  gate red, so it wants its own branch and its own verification, not a footnote in this one.

  **Closed out the same day, 17 → 0.** `#158` (brace-expansion), `#159` (js-yaml) and `#161`
  (vite + vitest) landed on `main`; `#161` put the photo gateway on `vitest ^4.1.11` and left
  a single `vitest 4.1.11` / `vite 8.2.2` in the tree instead of two. The last six — `sharp`
  HIGH and `undici` HIGH ×1 + MODERATE ×4 — were **not** separate packages to chase: both
  arrive only through `wrangler` → `miniflare`, and `wrangler` was pinned exactly at
  `4.113.0` in three places. `4.120.0` onward resolves `sharp 0.35.2` and `undici 7.29.0`,
  so the whole remainder is one pin bump to `4.127.1` (`app`, `photo-gateway`, `basemap`;
  `watchtower` floats on `^4.0.0`). The pin stays exact — that was deliberate and reproducible
  deploys still want it. `jsdom`'s `undici 8.10.0` was never in range and is untouched.

  Verified from a **clean `npm ci`**, not an incremental install: lint + prettier clean,
  **286 tests across 34 files**, worker typecheck clean, production build clean, and
  `wrangler deploy --dry-run` for all three workers with every binding still resolving
  (`PHOTOS` R2, `BASEMAP` R2, and the environment variables).

#### The `@rollup/rollup-linux-x64-gnu` pin is gone, because rollup is

`package.json` carried a long `//optionalDependencies` note explaining that npm records only
the HOST platform's optional binary, so a lock generated on a Mac gave Linux CI no rollup
native — fatal because *"the photo-gateway worker still runs vitest 2, which loads rollup."*

That premise died with `#161`. **`rollup` is no longer in the dependency tree at all**: Vite 8
builds with **rolldown**, and rolldown declares all fifteen platform bindings as ordinary
optional dependencies, so `package-lock.json` contains every one of them —
`@rolldown/binding-linux-x64-gnu` included. The pin was holding a package nothing depended
on. Removed, and the note rewritten to say what is actually true, including the thing worth
keeping: if a Linux-only native goes missing again, **check whether the bundler changed
before re-adding a pin.** This is the class of bug that cannot be seen on a Mac, so the
proof is Linux CI, not a local run.
- Never force-push. The ruleset now refuses it rather than relying on memory. The only
  exception is the separately approved history-scrub procedure, which must stop for
  Erica's exact approval before any rewrite — and now also for a deliberate admin bypass.

#### 2026-08-29 — the working copy had no `.git` at all

`/Users/ericagaffney/Code/adventureorno` was **not a git repository**. No `.git`, so
`git status`, `git log`, `git diff` and every hook were dead, `gh` had nothing to push,
and the `.githooks/pre-commit` gate could not run because nothing invoked it. Any edit
made in that state was one accidental overwrite away from gone — and OneDrive sits on
this folder, which is the same mechanism that kept restoring the deleted markdown files.

**Nothing was lost.** Before touching anything, the remote was cloned to a scratch
directory and diffed against the working copy: every tracked file was byte-identical to
`origin/main` at `9aa0b76`. The only extra entries on disk were already-ignored local
artifacts (`.env.local`, `.backup-work/`, `supabase/snapshots/`, `app/TimlineTakeout/`,
build tsbuildinfo, `.wrangler/`) plus `.claude/`, which is now ignored too.

Repaired in place without overwriting a single working file — `git init -b main`, add the
`origin` remote, `git fetch`, then `git reset --mixed origin/main`, which sets HEAD and the
index and leaves the working tree alone. `git config core.hooksPath .githooks` was set again
because that is repo-local config and died with the old `.git`. `git status` came back clean.

**Check this at the start of a session**, because it is silent while it is true:

```sh
git rev-parse --is-inside-work-tree   # must print true
git config core.hooksPath             # must print .githooks
git status --short --branch           # must show a branch tracking origin/main
```

How it happened is not known — there is no `.git` left to ask. What is known is that the
condition produced no error anywhere until someone ran a git command.

#### Conventions

- Every phase ends with: migrations applied and recorded, `npm run lint && npm run test`
  clean, deployed preview verified, PR opened, and the decision/proof recorded in this
  file. Do not recreate `/docs/decisions.md`.
- Secrets only via Wrangler secrets / Supabase secrets / `.env.local` (gitignored). Never commit
  keys. `.env.example` lists every var with a comment.
- Small commits with imperative messages.
- When a task requires a human step (dashboard clicks, App Store installs, OAuth approval), stop
  and print the exact steps rather than faking it — MANUAL-SETUP.md tracks these.

#### There is one plan, and this is not it

[`docs/STATE.md`](docs/STATE.md) is the ONLY planning document: what the app is, the one
model, what is left to build, and the rules that stop work being erased. This file holds
agent instructions and business rules — nothing about what to do next.

The July 25 backlog ledger and the Commercial/Spaces proposal that used to live here were
removed on 2026-08-11, along with `README.md`, `docs/archive/`, `docs/adr/`, `NewClaude.md`
and `CLAUDE-CODE-INSTRUCTIONS-2-70.md`. Between them they made ~380 KB of competing
"what to do next", which is the mechanical reason the same work kept being re-requested:
every session picked a different one. They are all in git history if a decision needs
recovering — `git log --diff-filter=D --name-only` will find them.

**If you are about to write a plan into a new markdown file: don't. Put it in STATE.md.**

## 12. Operations

### 12a. Manual setup

*(was §12a (below))*

The project is already live. This file records owner-only provider/device
operations; it is not an initial build checklist. Never paste real credential
values into this file. this file has the order of work.

#### 1. Domain (5 min)

`adventureorno.com` is registered and attached to the live Pages project. Manage
DNS/custom domains only through the verified account and use
§12b (below) for deployment controls.

#### 2. Repo & Claude Code ↔ GitHub connection (10 min)

Repo: **adventureorno26/adventureorno.com** (private). To configure a new local
operator workstation:

- `git clone https://github.com/adventureorno26/adventureorno.com.git` and work from that root.
- `gh auth login` → GitHub.com → HTTPS → "Login with a web browser" while signed into the
  **adventureorno26** account in that browser. Confirm with `gh auth status`. This is what lets
  Claude Code push branches and open PRs as you.
- Optional but recommended: inside a Claude Code session run `/install-github-app` and install
  the Claude GitHub App on this repo — you can then tag `@claude` on issues/PR comments and it
  works asynchronously from GitHub.

#### 3. Supabase — project already exists (5 min of settings)

Copy the project URL and current publishable key from the Supabase dashboard into
`.env.local` and the corresponding Cloudflare `VITE_*` variables. Then audit:

- Authentication → Sign In/Up: **disable "Allow new users to sign up"** (invite-only depends on
  this).
- Project Settings → API keys: copy the **service_role/secret key** into `.env.local` ONLY when
  Phase 1 asks. Never paste it into chats, commits, or client code.
- Database: Phase 1's migrations will enable PostGIS; no manual action.

#### 4. MapTiler — key exists, restrict it (3 min)

Copy the current key into `VITE_MAPTILER_KEY`. In cloud.maptiler.com → API keys → this key →
**Allowed HTTP origins**: add `adventureorno.com`, `www.adventureorno.com`, `localhost:5173`.
Unrestricted keys can be scraped from your bundle and drain the free tier.

#### 5. Cloudflare R2 (Phase 2)

The private `adventureorno-photos` bucket is live. Confirm it remains non-public;
use only a short-lived/scoped API token when maintenance requires one.

#### 6. Strava API app (Phase 4, 10 min)

strava.com/settings/api → Create app. Category: Data Importer. Website: https://adventureorno.com.
**Authorization Callback Domain:** `aanfyhsjbtnqzphuoiem.supabase.co` (the OAuth callback is the
`strava-auth` Edge Function). Save Client ID + Secret, then:

**a. Server secrets** (from the repo root, token in `.env.local`):

```bash
supabase secrets set STRAVA_CLIENT_ID=<id> STRAVA_CLIENT_SECRET=<secret> \
  --project-ref aanfyhsjbtnqzphuoiem
```

**b. Client id** → add `VITE_STRAVA_CLIENT_ID=<id>` to `.env.local` **and** Cloudflare Pages env,
then rebuild/redeploy the SPA (Vite bakes it at build time).

**c. Connect** — open `/settings` on the live site → **Connect Strava** → approve. You should land
back on `?strava=connected`.

**d. Create the push subscription** (one time; the verify token is in `.env.local` as
`STRAVA_VERIFY_TOKEN`):

```bash
source .env.local
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=<id> -F client_secret=<secret> \
  -F callback_url=https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/strava-webhook \
  -F verify_token=$STRAVA_VERIFY_TOKEN
```

Strava immediately GETs the callback with a challenge; the deployed `strava-webhook` echoes it and
the subscription activates. Verify: `curl -G https://www.strava.com/api/v3/push_subscriptions \ -d client_id=<id> -d client_secret=<secret>` should list it. After that, finished activities
appear on the map within ~a minute; `/settings → Strava → Backfill` pulls history.

#### 7. iPhone setup — Erica's phone (Phase 2–3, ~20 min)

- Build the **daily photo Shortcut**. Automations: daily 9:00 PM + "when joining home Wi-Fi",
  both set to Run Immediately / no confirmation. **The written spec does not exist** — this
  line used to point at `/docs/ios-shortcut-daily.md`, which was deleted with every other
  document on 2026-08-11 and was never folded in here. What is known about the Shortcut is
  scattered: it filters `Is Screenshot = false` and `Has GPS = true` (§11), and it carries the
  device ingest token from `.env.local` as `?token=` (C5, §7 — still in plaintext in the
  request logs). **The Shortcut Erica runs today exists only on her phone.** Writing its
  steps down here is a real gap, not a formatting one.
- Install **Overland** (App Store, free).

  > ⚠️ **2026-08-29: OVERLAND HAS NEVER DELIVERED A SINGLE PING.** This was written as a
  > completed setup and it is not one. `select source, count(*) from location_pings` returns
  > **`timeline` 16,952** (Google Takeout imports, 2025-12-19 → 2026-07-19) and **`app` 191**
  > (the in-browser location, 2026-07-25 → 2026-08-28). `source='overland'` is **zero rows,
  > all time**, and `ingest-overland` stamps `last_used_at` on every accepted batch, so this
  > is not a logging gap — the function has never accepted one. Matching that, the token this
  > step tells Overland to use — `ERICA_DEVICE_INGEST_TOKEN`, which is the row labelled
  > *"Erica iPhone — daily Shortcut"* — last authenticated **2026-07-29**, a month ago.
  >
  > So there is no live location ingest at all right now: Timeline stopped on 07-19 and
  > Overland never started. Nothing is broken in a way that logs; it simply never ran. Before
  > writing any of this off as a credential problem, do the cheap test first — the **Send Now**
  > step below returns `{"result":"ok"}` when the token is good, and a 401 when it is not.

  In its settings:
  - **Receiver Endpoint URL:**
    `https://aanfyhsjbtnqzphuoiem.supabase.co/functions/v1/ingest-overland?token=<ERICA_DEVICE_INGEST_TOKEN>`
    (the same device token as the photo Shortcut — value is in `.env.local` as
    `ERICA_DEVICE_INGEST_TOKEN`. Overland can't add custom headers, so the token
    rides in the query string.)
  - Significant-location or continuous mode, **batch 50**, trip mode off.
  - Tap **Send Now** once — you should see a green success and a `{"result":"ok"}`.
    There is no home-exclusion zone. Location ingestion follows the current accuracy
    and authorization rules, including at-home observations.

#### 8. Partner's iPhone (Phase 5, 5 min)

Nothing to install for ingestion (by design — his photos are manual-only). He just accepts his
invite email and optionally adds the site to his home screen (Share → Add to Home Screen).

#### 9. One-time backfill (Phase 6)

- **Strava history:** automatic once Phase 4 auth exists — the backfill function pulls the past
  year (rate-limited, may take ~15 min).
- **Photos, past year:** build the one-shot variant of the daily Shortcut — same steps, date
  range = last 365 days, run in month-sized batches you trigger manually (expect it to churn;
  keep the phone plugged in). Its spec doc is gone too, and depends on the daily one above.
- **Google Timeline (optional):** if you had Google Maps location history on your iPhone, request
  Takeout → Location History (Timeline) → drop the JSON into the importer at /settings/import.
  If you never used Google Timeline, skip — photos + Strava cover the year well.

### 12b. Deploying the app

*(was §12b (below))*

Current project: `adventureorno-com` (Git-integrated), custom domains
`adventureorno.com` and `www.adventureorno.com`. This runbook operates the live
project; do not create a replacement project.

No step here authorizes a production change. Verify the target project, commit,
environment, and backup/rollback path before acting.

#### Production-branch auto-deploy is disabled

This safety change is complete. Keep **automatic production branch deployments** disabled
for `adventureorno-com`. The only production path is the gated `deploy-production` job in
`.github/workflows/ci.yml`; do not re-enable Cloudflare Git integration as a second path.
Preview deployments may remain enabled because they do not control the custom domain.

Cloudflare documents this control in
[Branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

#### Environment inventory

Production and Preview need the client-safe values below. Copy real values from
the provider dashboards or the existing Cloudflare configuration; never put them
in this document or a commit.

```text
NODE_VERSION=22
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAPTILER_KEY
VITE_PHOTO_GATEWAY_URL
VITE_GOOGLE_CLIENT_ID
VITE_STRAVA_CLIENT_ID
VITE_MAPBOX_TOKEN          # optional
VITE_FOURSQUARE_KEY        # optional
```

Do not add a Supabase service-role key, provider client secret, device ingest
token, or Cloudflare API token to Pages build variables. Vite exposes `VITE_*`
values to the browser.

#### Manual verified promotion (temporary)

Use only after every required Phase 1 check passes for the exact commit:

```sh
git status --short
git rev-parse HEAD
npm ci
npm run build --workspace app
npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

The command requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`CLOUDFLARE_API_TOKEN` in the shell. Do not echo either value. After upload, smoke
test `/login` and `/no-such-page`; confirm the deployment's commit and production
alias in Cloudflare before considering the promotion complete.

#### CI-gated promotion is implemented

`.github/workflows/ci.yml` already runs `deploy-production` only for a green push to
`main` when `PRODUCTION_DEPLOY_ENABLED=true`, rebuilds the exact SHA, deploys it to
`adventureorno-com`, and checks production `/version.json`. Keep its Cloudflare token
scoped to Pages edit for the correct account. The remaining hardening is to require a
fresh backup and `STRICT=1 npm run check:ledger` before the build is uploaded.

Cloudflare's official pattern is documented in
[Direct Upload with continuous integration](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

#### Supabase Auth redirects

Dashboard → **Authentication** → **URL Configuration**:

- Site URL: `https://adventureorno.com`
- Redirect URLs: the apex and `www` `/login` URLs, local `/login`, and only the
  preview URLs intentionally used for authentication testing.

Do not use the production Supabase project for automated acceptance tests.

#### Rollback

Cloudflare → `adventureorno-com` → **Deployments** → select the last known-good
production deployment → **Rollback**. Then record the failed and restored
deployment IDs, commit SHAs, timestamps, and smoke-test result. Fix forward in Git;
do not hide the incident by rewriting history.

### 12c. Deploying the photo gateway

*(was §12c (below))*

The Worker and R2 bucket are live. These are maintenance and redeployment steps,
not initial setup instructions. They require explicit production authority.

#### 0. Before any production change

- Confirm the target account, Worker, R2 bucket, and current deployed version.
- Run Worker typecheck, unit tests, and Wrangler dry-run locally.
- Never print a device token or service-role key. Rotate a credential first if it
  has appeared in a log, document, commit, or chat transcript.

#### 1. Confirm the existing R2 binding

`workers/photo-gateway/wrangler.toml` is the source of truth for the bucket binding.
List the account's buckets and confirm the configured bucket exists; do not run a
create/delete command during an ordinary deployment.

```bash
### Needs an API token with R2 edit + Workers Scripts edit (create at
### dash.cloudflare.com → My Profile → API Tokens → "Edit Cloudflare Workers"
### template, and add R2 Storage: Edit). Then:
export CLOUDFLARE_ACCOUNT_ID=<account-id>
### RENAMED 2026-08-11: .env.local now carries CLOUDFLARE_API_TOKEN_MASTER (verified
### against R2 and Pages). wrangler reads the UN-SUFFIXED name, so map it across.
### `npx wrangler login` also works and covers R2 without any token at all.
export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_MASTER"
cd workers/photo-gateway
npx wrangler r2 bucket list
```

#### 2. Set Worker secrets

> ⚠️ **This block used to be a live footgun** (found 2026-08-11). It read
> `printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | wrangler secret put …`, and NEITHER of those
> variable names exists in `.env.local` — the real ones are `SUPABASE_SECRET_KEY` and
> `VITE_SUPABASE_PUBLISHABLE_KEY`. Run verbatim, it piped EMPTY STRINGS over two working
> Worker secrets and took the photo gateway down. The version below reads the right names
> and refuses to write an empty value.

```bash
### The Worker's PostgREST + session-check keys. Names as they are in .env.local:
###   SUPABASE_SECRET_KEY            -> the Worker's SUPABASE_SERVICE_ROLE_KEY
###   VITE_SUPABASE_PUBLISHABLE_KEY  -> the Worker's SUPABASE_ANON_KEY
### An empty pipe here silently breaks photo serving, so check first and stop if blank.
set -euo pipefail
cd workers/photo-gateway

put_secret() {                       # put_secret <worker-name> <value>
  [ -n "${2:-}" ] || { echo "REFUSING: $1 is empty — nothing written." >&2; return 1; }
  printf '%s' "$2" | npx wrangler secret put "$1"
}
put_secret SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SECRET_KEY"
put_secret SUPABASE_ANON_KEY         "$VITE_SUPABASE_PUBLISHABLE_KEY"
```

#### 3. Deploy

```bash
npx wrangler deploy
### Note the printed URL, e.g. https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

#### 4. Point the SPA at it

Add to `.env.local` and to **Cloudflare Pages → adventureorno-com → Settings →
Environment variables** (Production + Preview):

```
VITE_PHOTO_GATEWAY_URL=https://adventureorno-photo-gateway.<subdomain>.workers.dev
```

Then rebuild and follow §12b (below). Vite bakes
the value at build time; do not promote while required CI is red. The temporary
manual command, after verification and explicit approval, is:

```bash
cd ../../app && npm run build
cd .. && npx wrangler pages deploy app/dist --project-name adventureorno-com --branch main
```

#### 5. Verify (acceptance criteria)

- `curl -H "Authorization: Bearer $ERICA_DEVICE_INGEST_TOKEN" --data-binary @geotagged.jpg \ -H "Content-Type: image/jpeg" https://<gateway>/ingest` → `{"ok":true,"id":...}`;
  photo shows in the unassigned tray, ≤ 2400 px, no GPS in the served file's EXIF.
- POST a screenshot PNG → `{"skipped":"screenshot"}`. (There is no location filter —
  a geotagged photo taken at home is stored like any other.)
- Delete it in the UI, re-POST the same bytes → `{"skipped":"deleted"}` (rule #6).
- `/ingest` with a bad/absent token → 401. A partner session can `/upload` but
  never `/ingest`.

#### Optional: custom subdomain / route

For a stable URL you can add a route like `photos.adventureorno.com/*` in
`wrangler.toml` (`routes = [...]`) once the DNS record exists; not required — the
`*.workers.dev` URL is fine for a private app.

### 12d. Backup and restore

*(was §12d (below))*

AdventureOrNo is a private two-person memory journal + trip planner. Its data —
exact places, visit dates, notes, ratings, coordinates, and media — is
irreplaceable and private. This document is the **procedure**; it deliberately
contains **no destinations, keys, or credentials**. You supply those at run time.

> Status: procedure only. Running these commands is a manual, user-initiated
> step. No scheduled job, upload, or production mutation is created by committing
> this file. Nothing here has been executed against production.

#### What gets backed up

1. **Postgres** (Supabase project) — all canonical rows: `profiles`, `people`,
   `places`, `visits`, `entries`, `trips`/`trip_stops`, `activities`,
   `location_pings`, `photos`/`videos` **metadata**, reactions, `place_categories`,
   membership, and `settings`. The concrete tool is **`scripts/export-data.sh
   <dir>`** — a versioned, integrity-checked export (`manifest.json` with format +
   schema version, per-table row counts + SHA-256; `data/<table>.copy`). It
   **excludes** the credential tables (`ingest_tokens`, `strava_accounts`,
   `google_tokens`) and never emits bytes or signed URLs. `pg_dump` is a fallback.
