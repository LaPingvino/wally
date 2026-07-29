# Wally

A Matrix client built around accessibility, bridged conversations, and calls that actually
connect. It is a fork of an existing web client, kept close enough to merge upstream changes but
free to take a different line where that client's choices got in the way.

The web app is at [wukkie.uk](https://wukkie.uk).

<img align="center" src="public/res/svg/wally.svg" width="96" alt="Wally logo">

## What this fork adds

* **Accessibility.** ARIA roles and live regions throughout, keyboard shortcuts for navigation
  and unread traversal, screen-reader labels on every login and settings form, notification
  sounds, and a treeview room list.
* **Calls.** Direct LiveKit calling for logged-in users, with guest access and breakout rooms for
  conferences, replacing the embedded-widget approach.
* **Sliding sync.** Simplified sliding sync (MSC4186) against a matrix-js-sdk fork, with a
  persistent per-room cache so a reload paints from disk instead of the network.
* **Bridges as first-class.** Bridged 1:1 chats are named after the person, not the bot; you can
  start a chat through a mautrix bridge from a bridged user's profile.
* **Multiple accounts** open simultaneously.
* **Threads**, a **generic widget drawer**, and a schema-driven **issue board** stored in room
  state (also available as an embeddable widget).
* **Per-message profiles** (MSC4144), **pronouns / timezone / extended profile fields**, and
  cross-device **settings sync** through account data.
* **A markdown-it based parser** with spoilers, underline, GFM tables and autolinks.
* **Ash** and **Sepia** themes, and a custom emoji font including Bahá'í symbols.
* **A test suite** — `npm test` runs it.

## Fixes not yet upstream

Behaviour this fork gets right that the upstream `dev` branch does not. Found by running this
fork's test suite against upstream's implementation of the same modules, then confirming each
result in their source; checked on 2026-07-29, along with their issue tracker.

* **Numbered lists stop working at 10.** The list-item marker matches exactly one character, so
  `10. ten` is not a list at all — it renders as literal text.
* **Any letter followed by a dot starts a list.** The same marker class is `[\da-zA-Z]`, broader
  than the `[aAiI]` alphabetic-list handling it feeds, so a line like `k. word` silently becomes
  an ordered list.
* **Inline code cannot contain a backtick.** Code spans are fixed at a single backtick delimiter,
  so the variable-length fences that exist precisely to quote a backtick don't parse.
* **Shared locations render as a raw `geo:` URI.** An `m.location` message shows
  `geo:52.52,13.40;u=35` as its text instead of a readable label.
* **Bridged 1:1 chats are filed under the bridge bot.** Direct-message identity falls back to an
  oldest-joined-member heuristic, and in a bridged room the bot almost always joins first — so
  the chat takes the bot's name and avatar.

Deliberately *not* listed: differences that exist only because this fork made a different
architectural choice — sliding sync, its own call stack, client-side unread counting — and then
had to handle the consequences. Those are our problems to solve, not anyone else's bugs.

## Self-hosting

Serve the contents of `dist/` with any webserver after building, or use the `Dockerfile`.

* Default homeservers and the explore page are configured in [`config.json`](config.json).
* You need redirects so that client-side routes resolve to `index.html`. Example configurations:
  [netlify](netlify.toml), [nginx](contrib/nginx/), [caddy](contrib/caddy/).
  * If redirects are awkward, [enable hash routing](config.json) instead — URLs then carry a
    `/#/` between the domain and the route.
* To deploy under a subdirectory, set `base` in [`build.config.ts`](build.config.ts) and rebuild.

## Development

```sh
npm install
npm start        # development server
npm test         # test suite
npm run lint     # eslint + prettier
npm run build    # production build into dist/
```

### Docker

```sh
docker build -t wally:latest .
docker run -p 8080:80 wally:latest
```

The app is then at `http://localhost:8080`.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Copyright and attribution for the upstream client this is
forked from are preserved there and in the commit history.
