# Matrix Spec Change (MSC) Compliance

This document tracks Matrix Spec Changes (MSCs) and stable features that Wally
(this Cinny fork) implements, with notes on how completely we implement each
one and where we knowingly deviate. The goal is to make it easy to spot
*genuine* compliance gaps versus deliberate choices, and to give bug reports a
shared vocabulary.

The list is hand-maintained and starts from the references that appear in the
source tree. If you find something we support that isn't listed, please add a
row and a short note on where it lives.

**Legend** for the **Status** column:

- **Implemented** — we have explicit client-side logic for this MSC.
- **Probed** — we detect server support and adapt behaviour, but the actual
  protocol work happens elsewhere (matrix-js-sdk, server, widget, …).
- **Forwarded** — we expose the capability to embedded surfaces (widgets, the
  call driver) but don't act on it directly.
- **Partial** — we implement a subset; see notes for what's missing.
- **Inherited** — relied on indirectly via matrix-js-sdk; no Wally-specific code.
- **Stable** — the MSC has been merged into the spec; we follow the stable form.
- **Unknown** — listed in the source but compliance has not been audited yet.

---

## 1. Explicitly referenced MSCs

These MSCs appear by number somewhere in `src/`. Each links to the
matrix-spec-proposals PR for context.

| MSC | Topic | Status | Where |
| --- | --- | --- | --- |
| [MSC2666](https://github.com/matrix-org/matrix-spec-proposals/pull/2666) | Mutually-related rooms (`/mutual_rooms`) | Probed | `src/app/hooks/useMutualRooms.ts` |
| [MSC2762](https://github.com/matrix-org/matrix-spec-proposals/pull/2762) | Widgets: timeline + state-event capabilities | Forwarded | `src/app/features/call/SmallWidgetDriver.ts`, `src/app/plugins/call/utils.ts`, `src/app/widget/IssueBoardWidget.tsx` |
| [MSC2873](https://github.com/matrix-org/matrix-spec-proposals/pull/2873) | Widget URL template variables (`$client_id`, `$client_origin`) | Implemented | `src/app/features/room/WidgetsDrawer.tsx` |
| [MSC2876](https://github.com/matrix-org/matrix-spec-proposals/pull/2876) | Widget capability: read events from the room | Forwarded | `src/app/features/call/SmallWidget.ts` |
| [MSC2965](https://github.com/matrix-org/matrix-spec-proposals/pull/2965) | OIDC authentication issuer discovery | Probed | `src/app/cs-api.ts` |
| [MSC3401](https://github.com/matrix-org/matrix-spec-proposals/pull/3401) | Group VoIP (call rooms, `m.call`/`m.call.member`) | Implemented | `src/app/components/create-room/utils.ts`, `src/app/plugins/call/utils.ts`, `src/app/features/call/SmallWidget.ts`, `src/types/matrix/room.ts` |
| [MSC3417](https://github.com/matrix-org/matrix-spec-proposals/pull/3417) | Voice rooms (`org.matrix.msc3417.call` room type) | Implemented | `src/types/matrix/room.ts`, `src/app/features/call/*` |
| [MSC3846](https://github.com/matrix-org/matrix-spec-proposals/pull/3846) | Widget capability: TURN server credentials | Forwarded | `src/app/features/call/SmallWidgetDriver.ts`, `src/app/plugins/call/utils.ts` |
| [MSC3856](https://github.com/matrix-org/matrix-spec-proposals/pull/3856) | Threads: thread list endpoint | Probed (with fallback) | `src/app/features/room/ThreadsDrawer.tsx` |
| [MSC3916](https://github.com/matrix-org/matrix-spec-proposals/pull/3916) | Authenticated media | Probed | `src/app/hooks/useMediaAuthentication.ts` |
| [MSC4075](https://github.com/matrix-org/matrix-spec-proposals/pull/4075) | RTC notification (`m.call.notify` / `rtc.notification`) | Implemented | `src/app/pages/client/call/CallProvider.tsx`, `src/app/plugins/call/utils.ts` |
| [MSC4095](https://github.com/matrix-org/matrix-spec-proposals/pull/4095) | Linked media (`filename` + caption) on file events | Implemented (send only) | `src/app/features/room/message/ForwardDialog.tsx` |
| [MSC4133](https://github.com/matrix-org/matrix-spec-proposals/pull/4133) | Extended profiles (custom fields) | Implemented | `src/app/hooks/useExtendedProfile.ts`, `src/app/features/settings/account/Profile.tsx` |
| [MSC4140](https://github.com/matrix-org/matrix-spec-proposals/pull/4140) | Delayed events (legacy flag) | Implemented (with workaround) | `src/app/features/call/SmallWidgetDriver.ts`, `src/app/pages/client/call/PersistentCallContainer.tsx` |
| [MSC4143](https://github.com/matrix-org/matrix-spec-proposals/pull/4143) | MatrixRTC focus / SFU advertisement (`rtc_foci` in `.well-known`) | Implemented | `src/app/cs-api.ts`, `src/app/hooks/useLivekitSupport.ts`, `src/app/pages/client/call/PersistentCallContainer.tsx` |
| [MSC4144](https://github.com/matrix-org/matrix-spec-proposals/pull/4144) | Per-message profile (personas) | Implemented (Beeper unstable key only) | `src/app/state/personas.ts`, `src/app/features/settings/developer-tools/DevelopTools.tsx` |
| [MSC4151](https://github.com/matrix-org/matrix-spec-proposals/pull/4151) | Reporting a room | Probed | `src/app/hooks/useReportRoomSupported.ts` |
| [MSC4155](https://github.com/matrix-org/matrix-spec-proposals/pull/4155) | Invite filtering (`invite_permission_config` account data) | Implemented (block-all only, v1) | `src/app/features/settings/moderation/InviteBlocking.tsx`, `src/types/matrix/accountData.ts` |
| [MSC4157](https://github.com/matrix-org/matrix-spec-proposals/pull/4157) | Delayed events (revised — capability + send/update endpoints) | Implemented | `src/app/features/call/SmallWidgetDriver.ts`, `src/app/pages/client/call/PersistentCallContainer.tsx`, `src/app/plugins/call/utils.ts` |
| [MSC4175](https://github.com/matrix-org/matrix-spec-proposals/pull/4175) | Profile timezone (`us.cloke.msc4175.tz`) | Implemented | `src/app/components/user-profile/UserRoomProfile.tsx`, `src/app/hooks/useExtendedProfile.ts`, `src/app/features/settings/account/fields/ProfileTimezone.tsx` |
| [MSC4193](https://github.com/codeberg.org/lapingvino/cinny/issues) | Spoiler attribute on media events (`page.codeberg.everypizza.msc4193.spoiler*`) | Implemented (read; sending TBD) | `src/types/matrix/common.ts` |
| [MSC4310](https://github.com/matrix-org/matrix-spec-proposals/pull/4310) | RTC decline event (`org.matrix.msc4310.rtc.decline`) | Forwarded | `src/app/plugins/call/utils.ts` |

### Notes per MSC

**MSC2666 — Mutual rooms.** We probe three flag variants
(`uk.half-shot.msc2666`, `…mutual_rooms`, `…query_mutual_rooms`) before calling
the endpoint. If none are advertised, the "rooms in common" UI is hidden
silently. *Open question:* MSC2666 has an evolving query format — confirm we
hit the right endpoint name when only the bare `uk.half-shot.msc2666` flag is set.

**MSC2762/MSC2876/MSC3846/MSC4310 — Widget capabilities.** These are all
*forwarded* through `SmallWidgetDriver` rather than implemented by Wally
directly. Element Call (legacy) is gone, but the widget API surface is still
used by the issue-tracker widget and any third-party room widgets. We grant
timeline + state read/write per room, TURN credentials, and a small set of
RTC-specific event types.

**MSC2873 — Widget URL templating.** We substitute `$matrix_client_origin`,
`$org.matrix.msc2873.client_id` and `$org.matrix.msc2873.client_origin`. We do
*not* yet substitute the wider templating set proposed in later revisions
(`$matrix_user_id`, `$matrix_display_name`, etc.). Add as needed.

**MSC2965 — OIDC discovery.** Read-only: we surface
`org.matrix.msc2965.authentication.account` from `/.well-known/matrix/client`
so that "Manage account" can deep-link to the issuer. We don't implement the
full OIDC login flow; the SDK's existing SSO path is used.

**MSC3401 — Group VoIP.** We create the call power-levels block at room
creation rather than via a follow-up state event (`createRoomCallState` in
`utils.ts`). Membership / signalling happens in MatrixRTC code further down
the call stack — see the call architecture notes in
`/home/joop/.claude/projects/-home-joop-matrix-stuff/memory/MEMORY.md`.

**MSC3417 — Voice rooms.** Cinny's own `RoomType.Call` enum holds the
unstable identifier; on the wire we always use the unstable form because
upstream is still on the unstable spec.

**MSC3856 — Thread list.** When the server advertises the thread-list
endpoint we use it via the SDK; otherwise we fall back to a live-timeline
scan in `ThreadsDrawer.tsx`. The fallback is intentional and covers old
session data that predates `threadSupport: true` being enabled. *Deviation
note:* the synthetic timeline we build skips SDK `Thread` objects entirely
(see MEMORY notes on "Thread view architecture"). Spec-wise the user-visible
result is equivalent, but tooling that walks SDK threads will not see Wally's
view.

**MSC3916 — Authenticated media.** Detected via either
`org.matrix.msc3916.stable` *or* spec version `v1.11`. We do not gate URL
preview behaviour on this flag; encrypted preview is opt-in regardless.

**MSC4075 — RTC notify.** `CallProvider` posts `m.call.notify` after the
LiveKit room reaches `connected`. *Open question:* the spec discusses ringing
semantics for invitees that are not yet members; we do not currently send
secondary `notify` events on member changes.

**MSC4095 — Linked-media captions.** We use this on the *send* side when
forwarding a file message: `body`/`formatted_body` carry the forward notice
while `filename` retains the original filename. We do not yet *render* a
caption distinct from `filename` for received events; we behave the same as
upstream Cinny here. Worth a follow-up if servers/peers start sending
captioned media that needs split rendering.

**MSC4133 — Extended profiles.** We probe both the unstable flag
(`uk.tcpip.msc4133`) and spec `v1.15`. Custom fields (pronouns, timezone) are
stored in `/profile/{userId}` and surfaced in the profile editor.
*Deviation note:* unsupported homeservers fall back to *no* extended profile
at all rather than to a per-field stub — pronouns aren't writable on legacy
servers even though the legacy `/profile` interface could in principle hold
them.

**MSC4140 / MSC4157 — Delayed events.** The pair: 4140 is the original
unstable proposal, 4157 the revised version. We accept either flag. We
defensively *disable* delayed events on the SDK when the homeserver
advertises support but its `restart` endpoint is broken (see the comment
block in `PersistentCallContainer.tsx` — Continuwuity historically had this
issue). The widget driver gates the corresponding capabilities on actual
server support, not just the flag.

**MSC4143 — RTC foci.** We read `org.matrix.msc4143.rtc_foci` from the
homeserver's `.well-known` *and* from federated members' homeservers when
resolving SFU JWT tokens. Falls back to the user's own homeserver focus when
no federated focus is reachable. See the call architecture notes in MEMORY.

**MSC4144 — Per-message profiles.** We send only the unstable Beeper key
(`com.beeper.per_message_profile` / `m.per_message_profile`) and read both for
forward-compat. The personas UI lives behind a developer-tools toggle. The
Matrix account that actually sent the message is always shown as `via @user:server`
on the persona-rendered message; this is a deliberate anti-impersonation
guard rather than spec divergence.

**MSC4151 — Report room.** Detected via either the unstable flag or spec
`v1.13`. The Report button is hidden when neither is true; the actual report
endpoint call is delegated to the SDK.

**MSC4155 — Invite filtering.** Implemented as a single "Block all room
invites" toggle in Moderation & Safety: writes
`{"blocked_servers": ["*"], …existing}` and removes the `*` to disable. We
preserve any per-server entries the user (or another client) added to
`blocked_servers`. We do **not** yet expose `allowed_servers`,
`blocked_users`, `allowed_users`, or the `default` field — adding a per-row
editor is the obvious v2.

**MSC4175 — Profile timezone.** Surface in the profile editor; we read the
field with the `us.cloke.msc4175.tz` key (the unstable namespace). When the
server advertises stable extended profiles (v1.15) we still use the unstable
key because the spec MSC has not landed in stable form for the timezone field
yet — revisit when matrix-spec stabilises this.

**MSC4193 — Spoiler-aware media.** We recognise the
`page.codeberg.everypizza.msc4193.spoiler` and `…spoiler.reason` content
properties on inbound events. *Gap:* we do not currently set these on the send
side from the file-attachment UI. Adding a checkbox at upload time would
close the loop.

**MSC4310 — RTC decline.** Capability is granted to the call widget driver;
Wally itself doesn't render an explicit decline UI distinct from "ignore the
ring" yet.

---

## 2. Stable / spec-merged features we use

These are stable spec features whose **original** MSC is worth recording for
historical context. Compliance is mostly a matter of staying in sync with
matrix-js-sdk; we don't second-guess the SDK on these.

| Spec feature | Original MSC(s) | Where in code |
| --- | --- | --- |
| Spaces (`m.space`, `m.space.parent/child`) | [MSC1772](https://github.com/matrix-org/matrix-spec-proposals/pull/1772) / [MSC2244](https://github.com/matrix-org/matrix-spec-proposals/pull/2244) | `src/app/pages/client/space/`, `src/app/state/room/roomToParents.ts` |
| Restricted join rules | [MSC3083](https://github.com/matrix-org/matrix-spec-proposals/pull/3083) | `src/app/features/common-settings/general/RoomJoinRules.tsx` |
| Knocking | [MSC2403](https://github.com/matrix-org/matrix-spec-proposals/pull/2403) | `src/app/features/common-settings/general/RoomJoinRules.tsx` |
| Edits (`m.replace`) | [MSC2676](https://github.com/matrix-org/matrix-spec-proposals/pull/2676) | `src/app/utils/room.ts`, `src/app/hooks/useRoomEvent.ts` |
| Reactions / annotations | [MSC2677](https://github.com/matrix-org/matrix-spec-proposals/pull/2677) | `src/app/features/room/message/Reactions.tsx`, `src/app/utils/room.ts` |
| Threads (`m.thread`) | [MSC3440](https://github.com/matrix-org/matrix-spec-proposals/pull/3440) | `src/app/features/room/RoomTimeline.tsx`, `src/app/features/room/ThreadsDrawer.tsx` |
| Read receipts incl. private | [MSC2285](https://github.com/matrix-org/matrix-spec-proposals/pull/2285) | Inherited from matrix-js-sdk |
| Direct chats (`m.direct`) | [MSC1228](https://github.com/matrix-org/matrix-spec-proposals/pull/1228) | `src/types/matrix/accountData.ts`, `src/app/utils/memoryReport.ts` |
| Room tags (`m.tag`) | spec | `src/app/features/room-nav/RoomNavItem.tsx` |
| Pinned messages (`m.room.pinned_events`) | spec | `src/types/matrix/room.ts` |
| Stickers | spec | `src/app/utils/room.ts`, `src/types/matrix/room.ts` |
| Encrypted rooms (Megolm v1) | spec | `src/app/components/create-room/utils.ts` |
| Push rules | spec | `src/types/matrix/accountData.ts`, `src/app/features/settings/notifications/` |
| Image packs (Ponies / im.ponies) | unstable, no MSC merged | `src/app/components/image-pack-view/`, `src/types/matrix/accountData.ts` |
| Recent emoji (`io.element.recent_emoji`) | unstable | `src/app/plugins/recent-emoji.ts` |

---

## 3. Known deviations & open compliance questions

The list below collects places where Wally consciously diverges, plus things
we should re-check before claiming compliance.

- **Threads UI doesn't use SDK `Thread` objects.** We build a synthetic
  `EventTimelineSet` from the live timeline. Behaviour matches the spec for
  the user, but external introspection (e.g. SDK-based bots driving Wally) of
  thread state will not work as on upstream Cinny / Element.
- **Per-message profiles send unstable key only.** Once MSC4144 stabilises we
  should add the stable key to the *send* path. Read path already accepts both.
- **MSC4193 spoilers are read-only.** We don't expose a way to mark an
  outbound attachment as a spoiler.
- **MSC4155 toggle is binary.** No UI for `allowed_*` lists, individual user
  blocks, or a `default: "block"` policy. Per-server / per-user editing is a
  natural v2.
- **MSC4075 `m.call.notify` is one-shot per local connect.** We don't re-emit
  on member-list changes, so a peer joining mid-ringing won't re-trigger ringing
  for them. Worth verifying against the latest spec text.
- **OIDC login flow.** We read MSC2965's discovery info but rely entirely on
  the SDK's existing login codepaths. No first-class OAuth client logic in
  Wally itself.
- **MSC3416 device attestation / verification of unstable namespaces.** We
  ship some `org.matrix.*` event types (calls, RTC) without a fallback to
  their stabilised counterparts; once the spec stabilises these we should
  prefer stable forms when the server advertises support.
- **MSC4133/MSC4175 unstable keys.** We still use the unstable namespace
  (`uk.tcpip.msc4133`, `us.cloke.msc4175.tz`) even when the homeserver
  advertises spec v1.15. Revisit when these MSCs are stably named in spec.

---

## 4. How to audit a specific MSC

When asked "do we support MSC NNNN?":

1. `grep -irE "msc${N}[^0-9]" src/` from this directory.
2. If no hits, check the *content keys* the MSC introduces (`m.foo`,
   `org.matrix.something`) — many implementations land via type identifiers
   without naming the MSC.
3. Cross-check matrix-js-sdk: a feature might be "supported" simply because
   the SDK handles it transparently. Look in
   `node_modules/matrix-js-sdk/lib/` for the relevant identifier.
4. Run a quick acceptance test against a homeserver that *advertises* the
   feature (Continuwuity is helpful as it ships unstable flags early).
5. Update this file with the outcome — even "audited, no behaviour" is a
   useful note.
