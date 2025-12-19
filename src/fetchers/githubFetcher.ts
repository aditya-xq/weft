import { isoNowMinus } from '../utils/date'
import { info, warn } from '../utils/logger'
import type { TimeWindow, RawMetrics } from '../types'

const GITHUB_API = 'https://api.github.com/graphql'
const GITHUB_REST = 'https://api.github.com'
const MAX_COMMITS_TO_FETCH = 200
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

// --- Helpers -----------------------------------------------------------------

/**
 * Get the hour (0-23) of an ISO timestamp in a specific IANA timezone.
 * Uses Intl.DateTimeFormat.formatToParts when available for robust extraction.
 * Falls back to UTC hour if timezone support isn't available.
 */
function getHourInTargetTZ(tsIso: string, timeZone: string = 'UTC'): number {
    const d = new Date(tsIso)
    if (isNaN(d.getTime())) return 0

    // Preferred: use formatToParts to extract hour reliably (works when full-icu available)
    try {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            hour12: false,
            timeZone
        })
        // formatToParts gives structured parts; find 'hour'
        if (typeof (fmt as any).formatToParts === 'function') {
            const parts = (fmt as any).formatToParts(d)
            const hourPart = parts.find((p: any) => p.type === 'hour')
            if (hourPart && typeof hourPart.value === 'string') {
                const parsed = parseInt(hourPart.value, 10)
                if (!isNaN(parsed)) return parsed
            }
        } else {
            // fallback to parsing the string (format should be like "13" or "13:45:30")
            const s = fmt.format(d)
            const parsed = parseInt(s, 10)
            if (!isNaN(parsed)) return parsed
        }
    } catch (e) {
        // If the environment does not support the timeZone option, warn and fallback
        warn(`getHourInTargetTZ: timezone '${timeZone}' not supported in this environment, falling back to UTC hour`, e)
    }

    // Final fallback: use UTC hour
    return d.getUTCHours()
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

// --- Public function ---------------------------------------------------------

export async function fetchGithubMetrics(
    token: string,
    username: string,
    window: TimeWindow,
    timezone: string = 'UTC' // Default to UTC if not provided
): Promise<RawMetrics> {
    if (!token) throw new Error('GITHUB_TOKEN is required')

    const from = window.from ?? isoNowMinus(window.duration ?? '24h')
    const to = window.to ?? new Date().toISOString()

    info('Querying GitHub activity', { username, from, to, timezone })

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
                        contributions(first: 100) {
                            nodes { occurredAt, commitCount }
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
        return emptyMetrics()
    }

    const cc = user.contributionsCollection ?? {}
    const commitsCount = cc.totalCommitContributions ?? 0
    const issuesCount = cc.totalIssueContributions ?? 0
    const prsCount = cc.totalPullRequestContributions ?? 0
    const reviewsCount = cc.totalPullRequestReviewContributions ?? 0

    const repoEntries: RepoSummary[] = []
    const hourlyCounts = new Array(24).fill(0)

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

        const nodes = repoBucket.contributions?.nodes ?? []

        // Calculate Hourly Distribution
        for (const n of nodes) {
            if (n?.occurredAt) {
                const hour = getHourInTargetTZ(n.occurredAt, timezone)
                // commitCount sometimes missing; default to 1 (safe)
                const count = Number(n.commitCount ?? 1) || 1
                hourlyCounts[hour] = (hourlyCounts[hour] ?? 0) + count
            }
        }

        repoContributionNodes.push({ owner, name: repo.name })
    }

    // Determine Most Active Hour (tie-breaker: earliest hour)
    let mostActiveHour: number | null = null
    let maxHourCount = 0

    for (let h = 0; h < 24; h++) {
        const c = hourlyCounts[h] ?? 0
        if (c > maxHourCount) {
            maxHourCount = c
            mostActiveHour = h
        }
    }

    // If there were no commits, keep mostActiveHour null
    if (maxHourCount === 0) mostActiveHour = null

    // --- Lines changed calculation (REST) ---
    let totalLinesChanged = 0
    let processedCommits = 0
    const commitShasToFetch: Array<{ owner: string; repo: string; sha: string }> = []

    async function fetchCommitShasForRepo(owner: string, repo: string): Promise<string[]> {
        // Build search query and properly URL-encode it
        // Use commit search Accept header (preview) to ensure commits search works
        const rawQ = `repo:${owner}/${repo} author:${username} committer-date:${from}..${to}`
        const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(rawQ)}&per_page=20`

        const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')
        if (!res.ok) {
            // If search fails (rate-limit, preview not available), warn and return empty
            warn(`Commit search failed for ${owner}/${repo} (status: ${res.status})`)
            return []
        }

        const items = (res.json?.items ?? []) as any[]
        return items.map(i => i.sha).filter(Boolean)
    }

    // 1. Gather SHAs (Concurrent)
    await withConcurrency(repoContributionNodes, 3, async (r) => {
        if (processedCommits >= MAX_COMMITS_TO_FETCH) return
        try {
            const shas = await fetchCommitShasForRepo(r.owner, r.name)
            for (const sha of shas) {
                if (processedCommits >= MAX_COMMITS_TO_FETCH) break
                commitShasToFetch.push({ owner: r.owner, repo: r.name, sha })
                processedCommits++
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
                // ignore single commit failures but log at debug level
                warn(`Failed to fetch commit ${it.sha} for ${it.owner}/${it.repo}`, e)
            }
        })
    }

    info('Metrics collection complete', {
        commits: commitsCount,
        prs: prsCount,
        issues: issuesCount,
        lines: totalLinesChanged,
        active_hour: mostActiveHour,
        hourly_counts: hourlyCounts
    })

    return {
        commits_count: commitsCount,
        prs_count: prsCount,
        issues_count: issuesCount,
        reviews_count: reviewsCount,
        repos: repoEntries,
        lines_changed: totalLinesChanged,
        most_active_hour: mostActiveHour,
        hourly_counts: hourlyCounts
    } as unknown as RawMetrics
}

function emptyMetrics(): RawMetrics {
    return {
        commits_count: 0,
        lines_changed: 0,
        prs_count: 0,
        issues_count: 0,
        reviews_count: 0,
        repos: [],
        most_active_hour: null,
        hourly_counts: new Array(24).fill(0)
    } as unknown as RawMetrics
}
