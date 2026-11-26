# Ideas and planned tests

[Dansk](../IDEER.md) · **English** · Not started. Noted 18.11.2026.

## 1. 24-hour test: do all concentrators register the same contact?

**Question.** The status check shows, for each concentrator, only the *latest* contact with the meter
(`TimestampUtcToDevice`). We do not know whether a concentrator that hears the meter always registers
the contact, or whether only the concentrator the meter is attached to updates the timestamp. In the
second case, "occasional contact" can hide a good backup link, and the redundancy verdict is wrong.

**What we know (meter 84751487, 18.11.2026).**

- 73475312 and 73495179 have contact at 07:54:19 and 07:54:20 UTC: the same telegram registered by
  two concentrators. At the CALL test on 12.11.2026 about 25 concentrators answered within half a
  minute. Several concentrators can therefore register the same contact.
- After 07:54 only 73475313 (−119 dBm) has contact. The others are at −127…−130 dBm, close to the
  reception limit. Whether they did not hear the meter, or did not register the contact, cannot be
  told from one snapshot.
- `TimestampUtcFromDevice` and `RssiFromDevice` are empty for all concentrators: we only have one
  direction.
- Kamstrup lists the same concentrator several times in `Links`, with older records (57–61 days).
  The meaning is unknown. The app shows only the latest (v0.15).

**Test.** A separate page (not in the installer app), left open on a PC for 24 hours:

- asks Kamstrup about 5–10 chosen meters every 10 minutes (≈ 1 request per minute), both meters with
  good coverage and meters in difficult areas;
- stores every change of a concentrator's timestamp and signal;
- exports CSV and a summary per meter.

**How to read the result.**

| Observation | Meaning |
|---|---|
| At each transmission several concentrators update in the same second | all register; "occasional" = really weak reception |
| At each transmission only one updates, always the same; the others only when the first is missing | only the active link is registered; "occasional" can hide a good backup |
| Transmissions per hour and how many each concentrator catches | the real stability hour by hour |

**Requirement.** A PC that can stay on for a day. The page uses the same direct access to Kamstrup as
the app, so it needs no server.

**Question for Kamstrup (can be sent now).**

> When a LinkIQ meter transmits, do all concentrators that receive the telegram register the contact
> (TimestampUtcToDevice updated)? Or only the concentrator the meter is attached to? And what does it
> mean when the same concentrator appears several times in Links with different timestamps?

## 2. History of status checks

Store the result of each status check per meter, so the app can show "contact within the last hour
at 3 of 3 checks". One snapshot does not prove stability. Needs data kept on the phone; awaiting a
decision.
