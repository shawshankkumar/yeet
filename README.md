# yeet

Granola meeting transcript → shareable link, in one command.

Pick a meeting from an interactive list, and `yeet` publishes the transcript as a GitHub Gist (or Jotbird link) and copies the URL to your clipboard.

```
$ yeet
✓ Granola authenticated
✓ GitHub authenticated
▸ Fetching recent meetings...

  Select meeting ›
  2026-04-03T16:30  Q2 /ACQ/ Tech work
  2026-04-03T15:00  Interview — Aditya Thakur
  2026-04-02T14:00  Sprint Retro
  ...

✓ Selected: Q2 /ACQ/ Tech work
▸ Fetching transcript...
▸ Publishing to GitHub Gist...

✓ Yeeted via gist! URL copied to clipboard:
   https://gist.github.com/you/abc123def456
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/aakashlpin/yeet/main/install.sh | bash
```

Or manually:

```bash
curl -fsSL https://raw.githubusercontent.com/aakashlpin/yeet/main/yeet -o ~/.local/bin/yeet
chmod +x ~/.local/bin/yeet
```

## Uninstall

```bash
rm $(which yeet)
```

## Dependencies

| Tool | Install | Required for |
|------|---------|-------------|
| `node` / `npx` | `brew install node` | Granola CLI |
| `fzf` | `brew install fzf` | Interactive picker |
| `gh` | `brew install gh` | Gist backend (default) |
| `python3` | `brew install python3` | JSON parsing |
| `jotbird` | — | Jotbird backend (optional) |

## Usage

```bash
yeet                # publish via GitHub Gist (default)
yeet --jotbird      # publish via Jotbird
yeet -j             # short for --jotbird
yeet --limit 50     # show more meetings in picker
yeet --help         # show all options
```

### Environment variables

```bash
YEET_BACKEND=jotbird yeet   # override backend
YEET_LIMIT=50 yeet          # override meeting count
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

1. Checks Granola auth (re-authenticates if session expired)
2. Fetches recent meetings via `npx granola-cli meeting list`
3. Presents an interactive `fzf` picker with date + title
4. Fetches the selected meeting's transcript
5. Publishes via your chosen backend
6. Copies the shareable URL to clipboard

## License

MIT
