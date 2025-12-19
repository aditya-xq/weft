[![Banner](https://github.com/aditya-xq/weft/blob/main/assets/banner.svg)](https://github.com/aditya-xq/weft/blob/main/assets/banner.svg)

### Your daily GitHub activity → a visual story on X/Twitter

**Weft** is a reusable GitHub Action + Bun-powered CLI that automatically summarizes your GitHub activity into a beautifully rendered image (as shown below) and posts it to **X/Twitter** on a schedule.

Think of it as a daily developer log, woven from your commits, activity, and momentum.

[![Sample output](https://github.com/aditya-xq/weft/blob/main/out/summary.svg)](https://github.com/aditya-xq/weft/blob/main/out/summary.svg)

---

## Quick links

| Item | Link |
|---:|:---|
| Template repo (Use this template) | https://github.com/aditya-xq/weft-template |
| Action repo | https://github.com/aditya-xq/weft |
| Example output | `out/summary.png`, `out/summary.svg` |

---

## ✨ What Weft Does

Every run, Weft:

1. **Collects GitHub activity metrics** for a configurable time window
2. **Renders a clean, minimal SVG** and converts it to PNG
3. **Publishes the image + caption to X/Twitter** (or skips publishing in dry-run mode)

All of this is:

* Fully configurable
* Extensible by design
* Reusable across repositories

---

## How users can install

Two supported options.

### Option 1: Use the template (recommended)

Use the ready-made template repository. It includes workflows, config, and auto-commit for outputs.

Template repo: https://github.com/aditya-xq/weft-template

Steps:
1. Click **Use this template**
2. Create the repository
3. Add required secrets
4. Enable Actions

That is it. The daily workflow will run and commit output images to `out/` and publish to X/Twitter.

---

### Option 2: Use the action directly

Add Weft to an existing repository.

```yaml
name: Daily GitHub Summary to X

on:
  schedule:
    - cron: '30 3 * * *'
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  post_summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aditya-xq/weft@main
        with:
          config_path: config/default.yml
          github_token: ${{ secrets.GITHUB_TOKEN }}
          x_consumer_key: ${{ secrets.X_CONSUMER_KEY }}
          x_consumer_secret: ${{ secrets.X_CONSUMER_SECRET }}
          x_access_token: ${{ secrets.X_ACCESS_TOKEN }}
          x_access_secret: ${{ secrets.X_ACCESS_SECRET }}
```

Weft requires the following secrets:

| Secret              | Description                   |
| ------------------- | ----------------------------- |
| `X_CONSUMER_KEY`    | X/Twitter API consumer key    |
| `X_CONSUMER_SECRET` | X/Twitter API consumer secret |
| `X_ACCESS_TOKEN`    | X/Twitter access token        |
| `X_ACCESS_SECRET`   | X/Twitter access secret       |

---

## 🧪 Local Development & Dry Runs

Weft can be run entirely locally without publishing anything.

### Prerequisites

* **Bun** (latest stable)

### Run locally

```bash
bun install
bun run ./src/cli/main.ts --config config/default.yml --dry-run
```

### Dry-run behavior

* Generates:

  * `out/summary.svg`
  * `out/summary.png`
* ❌ Does **not** publish to X/Twitter

Perfect for:

* Tuning visuals
* Testing new metrics
* Iterating on templates

---

## ⚙️ Configuration

All behavior is controlled via YAML. Check the `config/default.yml` file for more details.

You can:

* Change time windows
* Add/remove metrics
* Adjust rendering preferences
* Disable publishing entirely

---

## 🧩 Extending Weft

Weft is intentionally built to be hacked on.

### ➕ Add new metrics

* Create a new fetcher in `src/fetchers/`
* Implement the shared fetcher interface
* Register it in the pipeline

### 🎨 Customize visuals

* Edit `src/render/svgTemplate.ts`
* Or plug in your own SVG template

---

## 📦 Versioning & Reuse

Weft is designed to be reused across repositories.

* Tagged releases (`v1`, `v1.1.0`, etc.)
* Stable composite action interface
* Safe to consume directly from GitHub

```yaml
uses: aditya-xq/weft@main
```

---

## 🧵 Why “Weft”?

In weaving, **weft** is the thread drawn through the warp,
quietly forming the fabric.

Weft does the same for your GitHub activity:
turning daily work into a visible, shareable narrative.
