import { getWindowRange } from '../utils/date'
import { info, warn } from '../utils/logger'
import type { TimeWindow, RawMetrics } from '../types'

const GITHUB_API = 'https://api.github.com/graphql'
const GITHUB_REST = 'https://api.github.com'
const MAX_REPOS = 100

type RepoSummary = {
    owner: string
    name: string
    description?: string | null
    url?: string
    isPrivate?: boolean
    stargazers?: number
    language?: string
}

async function graphqlFetch(token: string, query: string, variables: any) {
    const res = await fetch(GITHUB_API, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'daily-github-snapshot'
        },
        body: JSON.stringify({ query, variables })
    })

    if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`GitHub GraphQL error: ${res.status} ${res.statusText} - ${txt}`)
    }
    const json = await res.json()
    if (json.errors) warn('GitHub GraphQL returned errors', json.errors)
    return json
}

/**
 * Generic REST JSON fetch with configurable Accept header.
 */
async function restJson(token: string, url: string, acceptHeader = 'application/vnd.github.v3+json') {
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: acceptHeader,
            'User-Agent': 'daily-github-snapshot'
        }
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, json: await res.json() }
}

// Simple concurrency worker runner
async function withConcurrency<T>(items: T[], concurrency: number, fn: (it: T) => Promise<void>) {
    const queue = [...items]
    const workers = Array(Math.min(items.length, concurrency)).fill(null).map(async () => {
        while (true) {
            const item = queue.shift()
            if (!item) break
            try {
                await fn(item)
            } catch (e) {
                // swallow single item errors; any important ones should be logged by fn
            }
        }
    })
    await Promise.all(workers)
}

/**
 * Calculate the appropriate interval size based on time window duration
 * @param windowHours - Duration of the time window in hours
 * @returns Interval size in hours
 */
function calculateIntervalSize(windowHours: number): number {
    if (windowHours <= 24) return 1      // 1-hour intervals for 24h or less
    if (windowHours <= 48) return 2      // 2-hour intervals for 48h
    if (windowHours <= 72) return 3      // 3-hour intervals for 72h
    return Math.ceil(windowHours / 24)   // Scale proportionally for longer periods
}

/**
 * Calculate the number of intervals based on window duration
 * @param windowHours - Duration of the time window in hours
 * @param intervalSize - Size of each interval in hours
 * @returns Number of intervals
 */
function calculateIntervalCount(windowHours: number, intervalSize: number): number {
    return Math.ceil(windowHours / intervalSize)
}

// --- Public function ---------------------------------------------------------

export async function fetchGithubMetrics(
    token: string,
    username: string,
    window: TimeWindow
): Promise<RawMetrics> {
    if (!token) throw new Error('GITHUB_TOKEN is required')
    
    const { from, to } = getWindowRange(window.duration ?? "24h")
    const windowHours = parseInt((window.duration ?? "24h").replace('h', '')) || 24
    const intervalSize = calculateIntervalSize(windowHours)
    const intervalCount = calculateIntervalCount(windowHours, intervalSize)

    info('Querying GitHub activity', { 
        username, 
        from, 
        to, 
        windowHours, 
        intervalSize,
        intervalCount 
    })

    // Query GraphQL for contributions and repository information
    const gql = `
        query($login: String!, $from: DateTime!, $to: DateTime!, $maxRepos: Int!) {
            user(login: $login) {
                contributionsCollection(from: $from, to: $to) {
                    totalCommitContributions
                    totalIssueContributions
                    totalPullRequestContributions
                    totalPullRequestReviewContributions
                    
                    commitContributionsByRepository(maxRepositories: $maxRepos) {
                        repository {
                            name
                            description
                            url
                            isPrivate
                            stargazers { totalCount }
                            primaryLanguage { name }
                            owner { login }
                        }
                        contributions {
                            totalCount
                        }
                    }
                }
            }
        }
    `

    const json = await graphqlFetch(token, gql, { login: username, from, to, maxRepos: MAX_REPOS })
    const user = json?.data?.user

    if (!user) {
        warn('No user data returned; returning zeros')
        return emptyMetrics(intervalCount)
    }

    const cc = user.contributionsCollection ?? {}
    const issuesCount = cc.totalIssueContributions ?? 0
    const prsCount = cc.totalPullRequestContributions ?? 0
    const reviewsCount = cc.totalPullRequestReviewContributions ?? 0

    const repoEntries: RepoSummary[] = []
    const repoContributionNodes: Array<{ owner: string; name: string }> = []
    const byRepo = cc.commitContributionsByRepository ?? []

    for (const repoBucket of byRepo) {
        const repo = repoBucket?.repository
        if (!repo) continue

        const owner = repo.owner?.login ?? ''

        repoEntries.push({
            owner,
            name: repo.name,
            description: repo.description ?? null,
            url: repo.url ?? undefined,
            isPrivate: repo.isPrivate ?? false,
            stargazers: repo.stargazers?.totalCount,
            language: repo.primaryLanguage?.name
        })

        repoContributionNodes.push({ owner, name: repo.name })
    }

    // --- Fetch actual commit timestamps from ALL repos (public and private) ---
    const commitTimestamps: Date[] = []
    const fromDate = new Date(from)
    const toDate = new Date(to)

    async function fetchCommitTimestampsForRepo(owner: string, repo: string): Promise<Date[]> {
        // Use author-date instead of committer-date to track when commits were originally created
        // This is more accurate for the user's actual activity
        const rawQ = `repo:${owner}/${repo} author:${username} author-date:${from}..${to}`
        const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(rawQ)}&per_page=100&sort=author-date&order=desc`

        const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')
        if (!res.ok) {
            warn(`Commit search failed for ${owner}/${repo} (status: ${res.status})`)
            return []
        }

        const items = (res.json?.items ?? []) as any[]
        const timestamps: Date[] = []
        
        for (const item of items) {
            // Use commit.author.date for the actual authoring timestamp
            const timestamp = item.commit?.author?.date
            if (timestamp) {
                const commitDate = new Date(timestamp)
                // Double-check the timestamp is within our window (API sometimes returns extra results)
                if (commitDate >= fromDate && commitDate <= toDate) {
                    timestamps.push(commitDate)
                }
            }
        }
        
        return timestamps
    }

    // Gather all commit timestamps concurrently
    await withConcurrency(repoContributionNodes, 3, async (r) => {
        try {
            const timestamps = await fetchCommitTimestampsForRepo(r.owner, r.name)
            commitTimestamps.push(...timestamps)
        } catch (e) {
            warn(`Failed to get timestamps for ${r.owner}/${r.name}`, e)
        }
    })

    // Calculate interval-based distribution from actual commit timestamps
    const intervalCounts = new Array(intervalCount).fill(0)
    const fromTime = fromDate.getTime()
    const intervalMs = intervalSize * 60 * 60 * 1000 // Convert hours to milliseconds
    
    for (const timestamp of commitTimestamps) {
        const elapsedMs = timestamp.getTime() - fromTime
        const intervalIndex = Math.floor(elapsedMs / intervalMs)
        
        // Ensure the interval is within bounds
        if (intervalIndex >= 0 && intervalIndex < intervalCount) {
            intervalCounts[intervalIndex] += 1
        }
    }

    const commitsCount = commitTimestamps.length

    // Determine Most Active Interval
    let mostActiveInterval: number | null = null
    let maxIntervalCount = 0

    for (let i = 0; i < intervalCount; i++) {
        const c = intervalCounts[i] ?? 0
        if (c > maxIntervalCount) {
            maxIntervalCount = c
            mostActiveInterval = i
        }
    }

    // If there were no commits, keep mostActiveInterval null
    if (maxIntervalCount === 0) mostActiveInterval = null

    // Convert most active interval to hour (for backward compatibility)
    // This represents the starting hour of the most active interval
    const mostActiveHour = mostActiveInterval !== null 
        ? (mostActiveInterval * intervalSize) % 24 
        : null

    // --- Lines changed calculation (REST) ---
    let totalLinesChanged = 0
    const commitShasToFetch: Array<{ owner: string; repo: string; sha: string }> = []

    async function fetchCommitShasForRepo(owner: string, repo: string): Promise<string[]> {
        const rawQ = `repo:${owner}/${repo} author:${username} author-date:${from}..${to}`
        const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(rawQ)}&per_page=100`

        const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')
        if (!res.ok) {
            warn(`Commit search failed for ${owner}/${repo} (status: ${res.status})`)
            return []
        }

        const items = (res.json?.items ?? []) as any[]
        return items.map(i => i.sha).filter(Boolean)
    }

    // 1. Gather SHAs (Concurrent)
    await withConcurrency(repoContributionNodes, 3, async (r) => {
        try {
            const shas = await fetchCommitShasForRepo(r.owner, r.name)
            for (const sha of shas) {
                commitShasToFetch.push({ owner: r.owner, repo: r.name, sha })
            }
        } catch (e) {
            warn(`Failed to get SHAs for ${r.owner}/${r.name}`, e)
        }
    })

    // 2. Fetch Stats for SHAs (Concurrent)
    if (commitShasToFetch.length > 0) {
        info('Fetching commit stats', { count: commitShasToFetch.length })
        await withConcurrency(commitShasToFetch, 5, async (it) => {
            try {
                const url = `${GITHUB_REST}/repos/${it.owner}/${it.repo}/commits/${it.sha}`
                const res = await restJson(token, url)
                if (!res.ok) return
                const stats = res.json?.stats
                if (stats) {
                    const adds = Number(stats.additions ?? 0)
                    const dels = Number(stats.deletions ?? 0)
                    totalLinesChanged += adds + dels
                }
            } catch (e) {
                warn(`Failed to fetch commit ${it.sha} for ${it.owner}/${it.repo}`, e)
            }
        })
    }

    info('Metrics collection complete', {
        commits: commitsCount,
        prs: prsCount,
        issues: issuesCount,
        reviews: reviewsCount,
        lines: totalLinesChanged,
        most_active_hour: mostActiveHour,
        most_active_interval: mostActiveInterval,
        interval_counts: intervalCounts,
        interval_size: intervalSize
    })

    return {
        commits_count: commitsCount,
        prs_count: prsCount,
        issues_count: issuesCount,
        reviews_count: reviewsCount,
        repos: repoEntries,
        lines_changed: totalLinesChanged,
        most_active_hour: mostActiveHour,
        hourly_counts: intervalCounts,
        interval_size: intervalSize
    } as unknown as RawMetrics
}

function emptyMetrics(intervalCount: number = 24): RawMetrics {
    return {
        commits_count: 0,
        lines_changed: 0,
        prs_count: 0,
        issues_count: 0,
        reviews_count: 0,
        repos: [],
        most_active_hour: null,
        hourly_counts: new Array(intervalCount).fill(0),
        interval_size: 1
    } as unknown as RawMetrics
}
