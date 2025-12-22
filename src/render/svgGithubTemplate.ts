import { convertHourlyCountsToTimezone, findMostActiveHour, getTimestamp } from "../utils/date"
import { escapeXml, fmt } from "../utils/generic"

export function renderSVG(
    metrics: Record<string, any>,
    svgCfg: any = {}
) {
    // Dimensions
    const width = Number(svgCfg.width ?? 1200)
    const height = Number(svgCfg.height ?? 675)
    
    // Theme Parsing
    const theme = svgCfg.theme ?? {}
    const timezone = svgCfg.timezone ?? 'UTC'
    const rawUsername = svgCfg.username ?? 'octocat'
    const username = escapeXml(rawUsername)

    const bg = theme.background ?? '#0f172a'
    const panel = theme.panel ?? '#1e293b'
    const text = theme.text ?? '#f8fafc'
    const sub = theme.subtext ?? '#94a3b8'
    const accent = theme.accent ?? '#38bdf8'
    const border = theme.border ?? '#334155'

    const fontStack = "'JetBrains Mono', 'Cascadia Code', 'Segoe UI Mono', 'Roboto Mono', monospace"

    // Data Extraction
    const commits = Number(metrics.commits_count ?? 0)
    const linesChanged = Number(metrics.lines_changed ?? 0)
    
    // Convert hourly counts from UTC to target timezone
    const utcHourlyCounts = metrics.hourly_counts ?? new Array(24).fill(0)
    const tzHourlyCounts = convertHourlyCountsToTimezone(utcHourlyCounts, timezone)
    
    // Find most active hour in the target timezone
    const mostActiveHour = findMostActiveHour(tzHourlyCounts)

    // Formatting
    const commitsText = escapeXml(fmt(commits))
    const displayCommits = commits < 10 ? `0${commitsText}` : commitsText
    
    const linesText = escapeXml(fmt(linesChanged))
    const displayLines = linesChanged < 10 ? `0${linesText}` : linesText
    
    const hourText = mostActiveHour !== null && mostActiveHour !== undefined 
        ? `${String(mostActiveHour).padStart(2, '0')}:00`
        : '--:--'
    
    const timestamp = getTimestamp(timezone)

    // --- Layout Constants (Adjusted for Full Space) ---
    const pad = 40
    const contentW = width - (pad * 2)
    const metricGap = 30
    const metricCardW = (contentW - (metricGap * 2)) / 3 
    const metricCardH = height - 240 // Increased height to fill the space
    const metricY = 160

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}"
     fill="none"
     role="img"
     aria-label="Daily commit snapshot">
    
    <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${sub}" stroke-width="1" opacity="0.05"/>
        </pattern>
        
        <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="${accent}" />
            <stop offset="100%" stop-color="#818cf8" />
        </linearGradient>

        <linearGradient id="cardGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${panel}" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="${panel}" stop-opacity="0.3"/>
        </linearGradient>

        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
            <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        </filter>

        <style>
            .root { font-family: ${fontStack}; }
            .title { font-size: 36px; font-weight: 700; fill: ${text}; letter-spacing: 1px; }
            .subtitle { font-size: 24px; font-weight: 400; fill: ${sub}; }
            .metric-val { font-size: 110px; font-weight: 900; fill: ${text}; letter-spacing: -4px; }
            .metric-lbl { font-size: 36px; font-weight: 700; fill: ${accent}; letter-spacing: 3px; }
            .metric-sub { font-size: 24px; font-weight: 400; fill: ${sub}; }
            .footer-text { font-size: 18px; font-weight: 600; fill: ${sub}; }
        </style>
    </defs>

    <rect width="${width}" height="${height}" fill="${bg}" />
    <rect width="${width}" height="${height}" fill="url(#grid)" />

    <rect width="${width}" height="6" fill="url(#accentGradient)" />

    <g class="root">
        <g transform="translate(${pad}, 70)">
            <text x="0" y="0" class="subtitle">DEVELOPER ACTIVITY REPORT</text>
            <text x="0" y="55" class="title">
                @${username} <tspan fill="${sub}" font-weight="400">/ 24h Snapshot</tspan>
            </text>
        </g>

        <g transform="translate(${pad}, ${metricY})">
            <rect width="${metricCardW}" height="${metricCardH}" rx="16" fill="url(#cardGradient)" stroke="${border}" stroke-width="1.5" />
            <g transform="translate(${metricCardW/2}, ${metricCardH/2})">
                <text x="0" y="-20" text-anchor="middle" class="metric-val" filter="url(#glow)">${displayCommits}</text>
                <text x="0" y="60" text-anchor="middle" class="metric-lbl">COMMITS</text>
                <text x="0" y="100" text-anchor="middle" class="metric-sub">Pushed to remote</text>
            </g>
        </g>

        <g transform="translate(${pad + metricCardW + metricGap}, ${metricY})">
            <rect width="${metricCardW}" height="${metricCardH}" rx="16" fill="url(#cardGradient)" stroke="${border}" stroke-width="1.5" />
            <g transform="translate(${metricCardW/2}, ${metricCardH/2})">
                <text x="0" y="-20" text-anchor="middle" class="metric-val" filter="url(#glow)">${displayLines}</text>
                <text x="0" y="60" text-anchor="middle" class="metric-lbl">LINES</text>
                <text x="0" y="100" text-anchor="middle" class="metric-sub">Code churned</text>
            </g>
        </g>

        <g transform="translate(${pad + (metricCardW + metricGap) * 2}, ${metricY})">
            <rect width="${metricCardW}" height="${metricCardH}" rx="16" fill="url(#cardGradient)" stroke="${border}" stroke-width="1.5" />
            <g transform="translate(${metricCardW/2}, ${metricCardH/2})">
                <text x="0" y="-20" text-anchor="middle" class="metric-val" filter="url(#glow)">${hourText}</text>
                <text x="0" y="60" text-anchor="middle" class="metric-lbl">PEAK FLOW</text>
                <text x="0" y="100" text-anchor="middle" class="metric-sub">Most active hour</text>
            </g>
        </g>

        <g transform="translate(${pad}, ${height - 40})">
            <text x="0" y="0" class="footer-text">
                Generated by Weft
            </text>
            <text x="${contentW}" y="0" text-anchor="end" class="footer-text">
                Snapshot: ${timestamp}
            </text>
        </g>
    </g>
</svg>`
}
