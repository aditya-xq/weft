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

export function getWindowRange(durationStr: string) {
    const now = new Date()
    const hours = parseInt(durationStr.replace('h', '')) || 24
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000)
    
    return {
        from: from.toISOString(),
        to: now.toISOString(),
        timestamp: now.getTime() // The "Universal" numeric ID
    }
}
