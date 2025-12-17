function escapeXml(value: unknown): string {
    if (value === null || value === undefined) return ''
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function fmt(n: number, locale = 'en-US') {
    if (!isFinite(n)) return '0'
    try { return n.toLocaleString(locale) } catch { return String(Math.round(n)) }
}

function getTimestamp(timezone = 'UTC'): string {
    try {
        const now = new Date()
        return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour12: false,
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(now)
    } catch {
        return new Date().toISOString().split('T')[0]
    }
}

export function renderSVG(
    metrics: Record<string, any>,
    svgCfg: any = {}
) {
    // Standardize dimensions
    const width = Number(svgCfg.width ?? 1200)
    const height = Number(svgCfg.height ?? 675)
    
    const CW = width
    const CH = height
    const CX = 0
    const CY = 0

    const theme = svgCfg.theme ?? {}
    const timezone = svgCfg.timezone ?? 'UTC'
    const username = svgCfg.username ?? 'octocat'

    const bg = theme.background ?? '#020408'
    const panel = theme.panel ?? '#0b1221'
    const text = theme.text ?? '#f8fafc'
    const sub = theme.subtext ?? '#64748b'
    const accent = theme.accent ?? '#a78bfa'
    const border = theme.border ?? '#1e293b'

    const fontStack = '"JetBrains Mono", "Cascadia Code", "Segoe UI Mono", "Roboto Mono", "DejaVu Sans Mono", "Courier New", monospace'

    // Extract metrics
    const commits = Number(metrics.commits_count ?? 0)
    const linesChanged = Number(metrics.lines_changed ?? 0)
    const mostActiveHour = metrics.most_active_hour
    const repos = metrics.repos ?? []
    
    // Format display values
    const commitsText = escapeXml(fmt(commits))
    const displayCommits = commits < 10 ? `0${commitsText}` : commitsText
    
    const linesText = escapeXml(fmt(linesChanged))
    const displayLines = linesChanged < 10 ? `0${linesText}` : linesText
    
    const hourText = mostActiveHour !== null && mostActiveHour !== undefined 
        ? `${String(mostActiveHour).padStart(2, '0')}:00`
        : '--:--'
    
    const timestamp = getTimestamp(timezone)

    // Get top 2 repos
    const topRepos = repos.slice(0, 2)

    const gridPattern = `
        <pattern id="engGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${sub}" stroke-width="0.5" opacity="0.08"/>
        </pattern>
    `

    // Clean definitions optimized for PNG export
    const gradients = ``

    // Calculate layout positions with improved spacing
    const metricsY = 190
    const metricSpacing = CW / 3
    const reposStartY = 440

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}"
     role="img"
     aria-label="Daily commit snapshot">
    <defs>
        ${gridPattern}
        ${gradients}
        <style>
            .root {
                font-family: ${fontStack};
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
            }
            .sharp-text {
                paint-order: stroke fill;
                stroke: ${bg};
                stroke-width: 0.3px;
                stroke-linejoin: round;
            }
            .metric-value {
                letter-spacing: -0.02em;
            }
            .label-text {
                letter-spacing: 0.05em;
            }
            .title-text {
                letter-spacing: 0.08em;
            }
        </style>
    </defs>

    <rect width="${width}" height="${height}" fill="${bg}" />
    
    <g class="root" transform="translate(${CX}, ${CY})">
        
        <rect x="0" y="0" width="${CW}" height="${CH}" fill="${panel}" stroke="${border}" stroke-width="2" rx="4" />
        
        <rect width="${CW}" height="${CH}" fill="url(#engGrid)" rx="4" />

        <rect x="0" y="0" width="${CW}" height="48" fill="${bg}" opacity="0.5" rx="4" />
        <line x1="0" y1="48" x2="${CW}" y2="48" stroke="${border}" stroke-width="1.5" opacity="0.8" />
        
        <g transform="translate(24, 24)">
            <circle cx="0" cy="0" r="6" fill="#ef4444" opacity="0.9" /> 
            <circle cx="22" cy="0" r="6" fill="#eab308" opacity="0.9" /> 
            <circle cx="44" cy="0" r="6" fill="#22c55e" opacity="0.9" /> 
        </g>

        <!-- Main Title -->
        <text x="${CW / 2}" y="110" text-anchor="middle" fill="${text}" font-size="28" font-weight="900" class="sharp-text">
            <tspan fill="${sub}">[</tspan> 
            <tspan fill="${accent}">LIVE</tspan> 
            PULSE: ~/<tspan fill="${accent}">${username}</tspan>@last_24h 
            <tspan fill="${sub}">]</tspan>
        </text>

        <!-- Left Metric: Commits -->
        <g transform="translate(${metricSpacing / 2}, ${metricsY})">
            <text x="0" y="0" text-anchor="middle" fill="${accent}" font-size="24" font-weight="800" text-transform="uppercase" class="label-text" opacity="0.95">
                BREWING CODE
            </text>
            <text x="0" y="85" text-anchor="middle" fill="${text}" font-size="96" font-weight="900" class="sharp-text metric-value">
                ${displayCommits}
            </text>
            <text x="0" y="125" text-anchor="middle" fill="${sub}" font-size="24" font-weight="500" opacity="0.85">
                commits pushed
            </text>
        </g>

        <!-- Middle Metric: Lines Changed -->
        <g transform="translate(${metricSpacing * 1.5}, ${metricsY})">
            <text x="0" y="0" text-anchor="middle" fill="${accent}" font-size="24" font-weight="800" text-transform="uppercase" class="label-text" opacity="0.95">
                SHIFTING BYTES
            </text>
            <text x="0" y="85" text-anchor="middle" fill="${text}" font-size="96" font-weight="900" class="sharp-text metric-value">
                ${displayLines}
            </text>
            <text x="0" y="125" text-anchor="middle" fill="${sub}" font-size="24" font-weight="500" opacity="0.85">
                lines changed
            </text>
        </g>

        <!-- Right Metric: Most Active Hour -->
        <g transform="translate(${metricSpacing * 2.5}, ${metricsY})">
            <text x="0" y="0" text-anchor="middle" fill="${accent}" font-size="24" font-weight="800" text-transform="uppercase" class="label-text" opacity="0.95">
                PEAK FLOW
            </text>
            <text x="0" y="85" text-anchor="middle" fill="${text}" font-size="96" font-weight="900" class="sharp-text metric-value">
                ${hourText}
            </text>
            <text x="0" y="125" text-anchor="middle" fill="${sub}" font-size="24" font-weight="500" opacity="0.85">
                most active hour
            </text>
        </g>

        <!-- Separator Line with gradient effect -->
        <line x1="80" y1="${reposStartY - 60}" x2="${CW - 80}" y2="${reposStartY - 60}" stroke="${accent}" stroke-width="1" opacity="0.3" />

        <!-- Top Repositories Section -->
        <text x="${CW / 2}" y="${reposStartY - 20}" text-anchor="middle" fill="${accent}" font-size="26" font-weight="800" text-transform="uppercase" class="label-text" opacity="0.95">
            ACTIVE REPOS
        </text>

        ${topRepos.map((repo: { name: any; description: any; isPrivate: any }, idx: number) => {
            const col = idx % 2
            const x = col === 0 ? 100 : (CW / 2 + 60)
            const y = reposStartY + 40
            const repoName = escapeXml(repo.name ?? 'unknown')
            const repoDesc = (repo.description ?? 'No description').substring(0, 100)
            const isPrivate = repo.isPrivate ? '🔒 ' : ''
            const cardWidth = (CW / 2) - 120
            
            // Word wrap description into max 3 lines
            const words = repoDesc.split(' ')
            const lines: string[] = []
            let currentLine = ''
            const maxCharsPerLine = 38
            
            for (const word of words) {
                const testLine = currentLine ? `${currentLine} ${word}` : word
                if (testLine.length <= maxCharsPerLine) {
                    currentLine = testLine
                } else {
                    if (currentLine) lines.push(currentLine)
                    currentLine = word
                    if (lines.length >= 3) break
                }
            }
            if (currentLine && lines.length < 3) lines.push(currentLine)
            
            const descLines = lines.slice(0, 3).map(escapeXml)
            
            return `
        <!-- Repo ${idx + 1} -->
        <g transform="translate(${x}, ${y})">
            <rect x="-30" y="-30" width="${cardWidth}" height="110" fill="${bg}" opacity="0.4" rx="6" stroke="${border}" stroke-width="1.5" />
            <text x="0" y="0" fill="${text}" font-size="24" font-weight="800" class="sharp-text">
                ${isPrivate}${repoName}
            </text>
            ${descLines.map((line, i) => `
            <text x="0" y="${28 + i * 20}" fill="${sub}" font-size="19" font-weight="400" opacity="0.9">
                ${line}
            </text>`).join('')}
        </g>`
        }).join('')}

        ${topRepos.length === 0 ? `
        <text x="${CW / 2}" y="${reposStartY + 70}" text-anchor="middle" fill="${sub}" font-size="22" opacity="0.7">
            No repo contributions in this window
        </text>
        ` : ''}

        <!-- Footer -->
        <line x1="0" y1="${CH - 48}" x2="${CW}" y2="${CH - 48}" stroke="${border}" stroke-width="1.5" opacity="0.8" />
        
        <text x="28" y="${CH - 20}" fill="${sub}" font-size="18" font-weight="700" class="label-text">
            WINDOW: <tspan fill="${text}" font-weight="800">24H</tspan>
        </text>

        <text x="${CW / 2}" y="${CH - 20}" text-anchor="middle" fill="${sub}" font-size="17" font-weight="500" opacity="0.75">
            Crafted with <tspan fill="${accent}" font-weight="800">Weft</tspan> by xqbuilds
        </text>

        <text x="${CW - 28}" y="${CH - 20}" text-anchor="end" fill="${sub}" font-size="18" font-weight="700" class="label-text">
            LAST SYNC: <tspan fill="${text}" font-weight="800">${timestamp}</tspan>
        </text>
    </g>
</svg>`
}
