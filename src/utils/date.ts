export function isoNowMinus(duration: string): string {
    // Supports only hours (e.g., "24h") and days ("7d") for now.
    const now = new Date()
    const m = duration.match(/^(\d+)([hd])$/)
    if (!m) return new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
    const v = parseInt(m[1], 10)
    const unit = m[2]
    let millis = 0
    if (unit === 'h') millis = v * 3600 * 1000
    else if (unit === 'd') millis = v * 24 * 3600 * 1000
    return new Date(now.getTime() - millis).toISOString()
}

export function getTimestamp(timezone = 'UTC'): string {
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
