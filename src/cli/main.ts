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

async function main() {
    try {
        const argv = process.argv.slice(2)
        const cfgIndex = argv.indexOf('--config')
        const cfgPath = cfgIndex >= 0 ? argv[cfgIndex + 1] : 'config/default.yml'
        const dryRun = argv.includes('--dry-run')

        info('Loading config from', cfgPath)
        const rawCfg = fs.readFileSync(cfgPath, 'utf8')
        const cfg = yaml.load(rawCfg) as Config

        if (!cfg.github?.username) throw new Error('config.github.username is required')

        const token = process.env.GITHUB_TOKEN as string | undefined
        if (!token) throw new Error('GITHUB_TOKEN env secret is required')

        const rawMetrics = await fetchGithubMetrics(token, cfg.github.username, cfg.time_window || { duration: '24h' }, cfg.runtime?.timezone || 'Asia/Kolkata')
        const svgConfig = {
            ...cfg.visual,
            timezone: cfg.runtime?.timezone || 'Asia/Kolkata',
            username: cfg.github.username
        }
        const svg = renderSVG(rawMetrics, svgConfig)
        fs.mkdirSync('out', { recursive: true })
        fs.writeFileSync(path.join('out', 'summary.svg'), svg, 'utf8')

        const pngBuf = await svgToPngSharp(svg, cfg.visual.width, cfg.visual.theme.background)
        await fs.promises.writeFile(path.join('out', 'summary.png'), pngBuf)
        info('Generated out/summary.png')

        if (dryRun) {
            info('Dry-run enabled; skipping publish')
            return
        }

        if (cfg.twitter?.publish && cfg.twitter.message_template) {
            info('Publishing to X...')
            await postToX(cfg.twitter.message_template, pngBuf)
            info('Successfully published!')
        } else {
            info('Publishing disabled in config')
        }
    } catch (err: any) {
        error('Fatal error:', err?.message ?? err)
        process.exit(1)
    }
}

if (import.meta.main) main()
