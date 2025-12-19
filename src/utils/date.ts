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

/**
 * Convert UTC hour to target timezone hour
 * @param utcHour - Hour in UTC (0-23)
 * @param timezone - Target timezone (e.g., 'America/New_York', 'Asia/Kolkata')
 * @returns Hour in target timezone (0-23)
 */
export function convertUTCHourToTimezone(utcHour: number, timezone: string): number {
    // Create a date with the UTC hour set
    const now = new Date()
    const utcDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        utcHour,
        0,
        0
    ))
    
    // Format in target timezone and extract the hour
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
    })
    
    const parts = formatter.formatToParts(utcDate)
    const hourPart = parts.find(p => p.type === 'hour')
    
    return hourPart ? parseInt(hourPart.value, 10) : utcHour
}

/**
 * Convert hourly counts array from UTC to target timezone
 * @param utcHourlyCounts - Array of 24 counts indexed by UTC hour
 * @param timezone - Target timezone
 * @returns Array of 24 counts indexed by timezone hour
 */
export function convertHourlyCountsToTimezone(
    utcHourlyCounts: number[],
    timezone: string
): number[] {
    if (timezone === 'UTC') {
        return [...utcHourlyCounts]
    }
    
    const tzCounts = new Array(24).fill(0)
    
    for (let utcHour = 0; utcHour < 24; utcHour++) {
        const tzHour = convertUTCHourToTimezone(utcHour, timezone)
        tzCounts[tzHour] += utcHourlyCounts[utcHour]
    }
    
    return tzCounts
}

/**
 * Find the most active hour from hourly counts
 * @param hourlyCounts - Array of 24 counts indexed by hour
 * @returns Most active hour (0-23) or null if no activity
 */
export function findMostActiveHour(hourlyCounts: number[]): number | null {
    let mostActiveHour: number | null = null
    let maxCount = 0
    
    for (let h = 0; h < 24; h++) {
        const count = hourlyCounts[h] ?? 0
        if (count > maxCount) {
            maxCount = count
            mostActiveHour = h
        }
    }
    
    return maxCount > 0 ? mostActiveHour : null
}
