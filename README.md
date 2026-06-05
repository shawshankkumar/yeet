# yeet

Granola meeting → shareable link, in one command.

Pick a meeting from an interactive list, and `yeet` publishes its **notes + AI summary** (or the raw transcript, on a paid plan) as a GitHub Gist (or Jotbird link) and copies the URL to your clipboard.

```
$ yeet
▸ Connecting to Granola...
✓ Granola connected
✓ GitHub authenticated

  Select meeting ›
  2026-06-05 14:30  Interview <> Karanveer Sharma — System Design
  2026-05-22 16:00  Partner launch readiness
  ...

✓ Selected: Partner launch readiness
▸ Fetching meeting notes + summary...
▸ Publishing to GitHub Gist...

✓ Yeeted notes via gist! URL copied to clipboard:
   https://gist.github.com/you/abc123def456
```

## Granola access (OAuth, no API keys)

`yeet` talks to the **official [Granola MCP server](https://docs.granola.ai/help-center/sharing/integrations/mcp)** (`https://mcp.granola.ai/mcp`) through a tiny bundled Node helper (`granola-mcp.mjs`).

- **First run** opens your browser to sign in to Granola (OAuth 2.0 with Dynamic Client Registration — no API keys or secrets).
- The token is cached under `~/.config/yeet/`, so **later runs are silent** — no re-prompt.
- To sign out / re-auth: `node ~/.config/yeet/granola-mcp.mjs logout`.

> **Why not `granola-cli`?** The old CLI imported credentials from the plaintext `supabase.json` that current Granola desktop (v7.162+) no longer updates — it moved to an encrypted store. So `granola-cli` reports "authenticated" but every fetch fails with "Authentication required." The MCP server is Granola's supported, future-proof integration path.

## ⚠️ Transcripts require a paid Granola plan

Over MCP, the raw transcript tool (`get_meeting_transcript`) is **paid-plan only**. On the free plan it returns *"Transcripts are only available to paid Granola tiers."*

So `yeet` defaults to publishing the meeting's **notes + AI summary** (`get_meetings`), which works on **all plans**:

- `yeet` → notes + summary (default, free plan friendly)
- `yeet --transcript` → raw transcript (**paid plan only**; fails with a clear message otherwise)

The free plan also only exposes your **own** notes from the **last 30 days** (no team-space access).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/shawshankkumar/yeet/main/install.sh | bash
```

The installer downloads `yeet` to your `bin` dir, the MCP helper to `~/.config/yeet/`, and preloads its one dependency so the first run doesn't pause to install.

## Uninstall

```bash
rm "$(which yeet)"
rm -rf ~/.config/yeet      # helper + cached Granola token
```

## Dependencies

| Tool | Install | Required for |
|------|---------|-------------|
| `node` / `npm` | `brew install node` | MCP client helper (Granola access) |
| `fzf` | `brew install fzf` | Interactive picker |
| `gh` | `brew install gh` | Gist backend (default) |
| `python3` | `brew install python3` | JSON parsing for the picker |
| `jotbird` | — | Jotbird backend (optional) |

The helper depends on a single npm package, [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk), installed once into `~/.config/yeet/`.

## Usage

```bash
yeet                # publish notes + summary via GitHub Gist (default)
yeet --transcript   # publish raw transcript (paid Granola plan only)
yeet -t             # short for --transcript
yeet --jotbird      # publish via Jotbird
yeet -j             # short for --jotbird
yeet --limit 50     # show more meetings in picker
yeet --help         # show all options
```

### Environment variables

```bash
YEET_BACKEND=jotbird yeet      # override backend
YEET_LIMIT=50 yeet             # override meeting count
YEET_CONTENT=transcript yeet   # override content type
YEET_TIME_RANGE=this_week yeet # this_week | last_week | last_30_days
```

## Backends

### GitHub Gist (default)

- **Unlimited** links (free)
- Gists are created as **secret** (unlisted) — not searchable, not in Discover
- Anyone with the URL can view — treat links like unlisted YouTube videos
- Requires `gh auth login`

### Jotbird

- **10 free links** per account
- Requires `jotbird` CLI
- Use `yeet -j` or `YEET_BACKEND=jotbird`

## How it works

1. Connects to the Granola MCP server (browser OAuth on first run; cached token after)
2. Lists recent meetings via the `list_meetings` MCP tool
3. Presents an interactive `fzf` picker with date + title
4. Fetches the selected meeting's **notes + summary** (`get_meetings`), or the raw **transcript** (`get_meeting_transcript`, paid plan) with `--transcript`
5. Publishes via your chosen backend
6. Copies the shareable URL to clipboard

The installer preloads the MCP client's dependency, so first-time runs don't pause on an npm install.

## License

MIT
