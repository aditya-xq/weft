#!/usr/bin/env bun
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

import { fetchGithubMetrics } from '../fetchers/githubFetcher'
import { postToX } from '../publish/xClient'
import { svgToPngSharp } from '../render/svgToPng'
import { renderSVG } from '../render/svgGithubTemplate'

import type { Config } from '../types'
import { error, info } from '../utils/logger'

function requireEnv(name: string) {
    const value = process.env[name]
    if (!value) throw new Error(`${name} env secret is required`)
    return value
}

async function main() {
    try {
        // -------------------------
        // Parse CLI args
        // -------------------------
        const argv = process.argv.slice(2)
        const cfgIndex = argv.indexOf('--config')
        const cfgPath = cfgIndex >= 0 ? argv[cfgIndex + 1] : 'config/default.yml'
        const dryRun = argv.includes('--dry-run')

        // -------------------------
        // Load & validate config
        // -------------------------
        info('Loading config from', cfgPath)

        if (!fs.existsSync(cfgPath)) {
            throw new Error(`Config file not found: ${cfgPath}`)
        }

        const rawCfg = fs.readFileSync(cfgPath, 'utf8')
        const cfg = yaml.load(rawCfg) as Config

        if (!cfg.github?.username) {
            throw new Error('config.github.username is required')
        }

        // -------------------------
        // Resolve runtime options
        // -------------------------
        const timezone = cfg.runtime?.timezone ?? 'Asia/Kolkata'
        const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
        const outDir = path.join(workspace, 'out')

        // -------------------------
        // Auth: GitHub
        // -------------------------
        const githubToken = requireEnv('GITHUB_TOKEN')

        // -------------------------
        // Fetch metrics
        // -------------------------
        info('Fetching GitHub metrics', {
            username: cfg.github.username,
            timezone
        })

        const rawMetrics = await fetchGithubMetrics(
            githubToken,
            cfg.github.username,
            cfg.time_window ?? { duration: '24h' },
        )

        // -------------------------
        // Render SVG
        // -------------------------
        const svgConfig = {
            ...cfg.visual,
            timezone,
            username: cfg.github.username,
            time_window: cfg.time_window
        }

        const svg = renderSVG(rawMetrics, svgConfig)

        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'summary.svg'), svg, 'utf8')

        // -------------------------
        // Convert SVG → PNG
        // -------------------------
        const pngBuf = await svgToPngSharp(
            svg,
            cfg.visual.width,
            cfg.visual.theme.background
        )

        await fs.promises.writeFile(
            path.join(outDir, 'summary.png'),
            pngBuf
        )

        info('Generated summary image', {
            svg: path.join(outDir, 'summary.svg'),
            png: path.join(outDir, 'summary.png')
        })

        // -------------------------
        // Dry run exit
        // -------------------------
        if (dryRun) {
            info('Dry-run enabled; skipping publish')
            return
        }

        // -------------------------
        // Publish to X (optional) - Config driven or when no commits are done in the last 24h
        // -------------------------
        if (!cfg.twitter?.publish || rawMetrics.commits_count === 0) {
            info('Publishing disabled in config or no commits in the last 24h')
            return
        }

        if (!cfg.twitter.message_template) {
            throw new Error('twitter.message_template is required when publish=true')
        }

        // Ensure X secrets are present before attempting publish
        requireEnv('X_CONSUMER_KEY')
        requireEnv('X_CONSUMER_SECRET')
        requireEnv('X_ACCESS_TOKEN')
        requireEnv('X_ACCESS_SECRET')

        info('Publishing summary to X')
        await postToX(cfg.twitter.message_template, pngBuf)
        info('Successfully published to X')
    } catch (err: any) {
        error('Fatal error:', err?.message ?? err)
        process.exit(1)
    }
}

if (import.meta.main) {
    main()
}
