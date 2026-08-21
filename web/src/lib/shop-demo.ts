/**
 * One sample shop, used consistently everywhere on the page so the board, the
 * timeline, and the repair-order detail all describe the same Tuesday.
 *
 * Every number here is illustrative and labelled as such on the page. Phone
 * numbers are in the 555-01xx range, which is reserved for fiction.
 *
 * `by` is the page's one system: "zol" means it happened unattended, "person"
 * means a human took over. It is never used decoratively.
 */

export type Actor = "zol" | "person";

export const shop = {
  name: "Fifth Street Auto",
  location: "Bakersfield, CA",
  bays: 6,
} as const;

export type BoardRow = {
  ro: string;
  vehicle: string;
  plate: string;
  job: string;
  event: string;
  by: Actor;
  state: "In bay" | "Waiting on customer" | "Waiting on parts" | "Ready";
};

export const board: BoardRow[] = [
  {
    ro: "RO-4471",
    vehicle: "2018 Ford F-150 XLT",
    plate: "8XKR241",
    job: "Front brakes + rotors",
    event: "Call answered 9:41p",
    by: "zol",
    state: "In bay",
  },
  {
    ro: "RO-4459",
    vehicle: "2016 Ram 1500 Big Horn",
    plate: "5KJB728",
    job: "A/C not cooling",
    event: "Booked from voicemail",
    by: "zol",
    state: "In bay",
  },
  {
    ro: "RO-4456",
    vehicle: "2014 Nissan Altima 2.5 S",
    plate: "6WQX155",
    job: "Alternator replacement",
    event: "Approval received 8:12a",
    by: "zol",
    state: "In bay",
  },
  {
    ro: "RO-4465",
    vehicle: "2015 Chevrolet Silverado 1500",
    plate: "4YHN092",
    job: "Transmission service",
    event: "Part ordered 11:20a",
    by: "zol",
    state: "Waiting on parts",
  },
  {
    ro: "RO-4468",
    vehicle: "2020 Toyota RAV4 LE",
    plate: "9CMD517",
    job: "Check engine diagnostic",
    event: "Estimate sent 10:04a",
    by: "zol",
    state: "Waiting on customer",
  },
  {
    ro: "RO-4462",
    vehicle: "2021 Hyundai Elantra SEL",
    plate: "8PDF470",
    job: "Oil service + tire rotation",
    event: "Picked up, invoice paid",
    by: "person",
    state: "Ready",
  },
];

export const stats = [
  { label: "Cars in bays", value: "4", note: `of ${shop.bays} bays` },
  { label: "Calls answered", value: "3", note: "today, by ZOL" },
  { label: "Awaiting approval", value: "2", note: "needs a customer reply" },
  { label: "Avg text reply", value: "8s", note: "ZOL, unattended" },
];

/** The four beats of one job, from after-hours call to follow-up. */
export const beats = [
  {
    n: "01",
    clock: "9:41 PM",
    title: "The call",
    body: "The phone rings four hours after close and ZOL picks up. It takes the complaint, the vehicle, and how the customer wants to be reached, then books the slot. Voicemails get transcribed and called back.",
    event: "2m18s · complaint, VIN and callback captured",
    by: "zol" as Actor,
  },
  {
    n: "02",
    clock: "7:12 AM",
    title: "The diagnosis",
    body: "The call is already a repair order before anyone unlocks the door. When your tech finishes the scan, the codes and findings attach to that same record — nothing gets retyped.",
    event: "P0455 · purge valve stuck open, found on smoke test",
    by: "person" as Actor,
  },
  {
    n: "03",
    clock: "8:30 AM",
    title: "The quote",
    body: "The estimate goes out by text with a photo of the failed part and the reasoning in plain English. If nobody replies, ZOL nudges once, then stops and hands it to a person.",
    event: "$742.18 texted · approved by reply in 4 minutes",
    by: "zol" as Actor,
  },
  {
    n: "04",
    clock: "4:20 PM",
    title: "The follow-up",
    body: "The customer hears the car is done, with the total. The invoice goes out by text, payment happens at your counter, and the visit that brings them back is already scheduled.",
    event: "Ready notice texted · invoice sent · follow-up set",
    by: "zol" as Actor,
  },
];

/** RO-4471 in full — the same truck that opens the board. */
export const ticket = {
  ro: "RO-4471",
  vehicle: "2018 Ford F-150 XLT",
  fields: [
    ["Plate", "8XKR241"],
    ["VIN", "1FTEW1EP4JKD82910"],
    ["Mileage", "118,420"],
    ["Bay", "2"],
  ] as const,
  finding:
    "Pedal pulse above 45 mph. Rotors measured below spec at 26.1 mm. Rears still have roughly 40% left.",
  total: "$742.18",
  timeline: [
    {
      title: "Call answered",
      at: "Mon 9:41p",
      detail: "After hours. 2m18s. Captured the complaint, VIN and callback preference.",
      by: "zol" as Actor,
    },
    {
      title: "Ticket written",
      at: "Tue 7:52a",
      detail: "Service writer Dana K. confirmed the vehicle and opened the job.",
      by: "person" as Actor,
    },
    {
      title: "Estimate sent",
      at: "Tue 8:30a",
      detail: "$742.18 texted to (661) 555-0142 with the rotor measurement attached.",
      by: "zol" as Actor,
    },
    {
      title: "Approval received",
      at: "Tue 10:15a",
      detail: "Customer replied YES by text. The RO released to the board on its own.",
      by: "zol" as Actor,
    },
    {
      title: "Job started",
      at: "Tue 12:40p",
      detail: "Tech Manny R. pulled the truck into bay 2.",
      by: "person" as Actor,
    },
    {
      title: "Ready notice + invoice",
      at: "Tue 4:20p",
      detail: "Customer told the truck was done, invoice texted, next service scheduled.",
      by: "zol" as Actor,
    },
  ],
};

/** The four jobs ZOL does end to end. */
export const jobs = [
  {
    title: "It answers the phone",
    body: "Nights, weekends, and every call your front desk cannot get to. It captures the complaint, the VIN and a callback preference — or transcribes the voicemail and calls back to book the slot.",
    event: "Booked from voicemail — transcribed 6:48p, booked 8:00a",
  },
  {
    title: "It texts back in seconds",
    body: "Inbound texts get a real answer before the shop opens. ZOL offers open slots, confirms one, and writes the appointment straight onto the board.",
    event: "Inbound text 7:02a — answered in 8 seconds",
  },
  {
    title: "It chases approvals",
    body: "The estimate goes out with a photo of the failed part and plain-English reasoning. If nobody replies, ZOL sends one nudge — then stops and flags it for a person.",
    event: "No reply after 20h — one nudge sent, then paused",
  },
  {
    title: "It catches parts delays",
    body: "Parts get ordered against the approved estimate. When a vendor pushes an ETA, ZOL surfaces the bay conflict before the car is stuck on a lift.",
    event: "Vendor moved ETA to Thursday — bay 4 conflict flagged",
  },
];

export const integrations = [
  "Tekmetric",
  "Shopmonkey",
  "Shop-Ware",
  "Mitchell 1",
  "AutoLeap",
];

/** What changes with ZOL on top, rather than what it replaces. */
export const comparison = [
  {
    row: "After-hours phone",
    without: "Voicemail, or a separate answering service",
    with: "Answers, triages and books the slot",
  },
  {
    row: "Inbound texts",
    without: "Answered when someone gets a minute",
    with: "Answered in seconds, appointment written to the board",
  },
  {
    row: "Estimate approvals",
    without: "Your writer calls back twice and gives up",
    with: "Texted, nudged once, then handed to a person",
  },
  {
    row: "Parts delays",
    without: "You find out when the car is on the lift",
    with: "Vendor ETA change surfaces the bay conflict early",
  },
  {
    row: "Your shop software",
    without: "—",
    with: "Stays exactly where it is, kept in sync",
  },
];
