# Weft: Your Daily GitHub Summary -> X/Twitter

This repository implements a reusable GitHub Action + CLI script that:

1. Collects GitHub activity metrics for a configurable time window.
2. Renders a nicely-styled SVG and converts it to PNG.
3. Posts the image and message to an X/Twitter account.

## Local dev

Install Bun locally and run (don't forget to change your configs and .env file to your credentials before doing this):

```bash
bun install
bun run ./src/cli/main.ts --config config/default.yml --dry-run
```

The --dry-run flag writes out/summary.svg and out/summary.png but does not publish to X.

## Extensibility
- Add new fetchers under src/fetchers/ that implement Fetcher semantics.
- Add more SVG rendering options by editing src/render/svgTemplate.ts or providing your own template file.
