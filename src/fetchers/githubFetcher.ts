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

// --- Public function ---------------------------------------------------------

export async function fetchGithubMetrics(
    token: string,
    username: string,
    window: TimeWindow
): Promise<RawMetrics> {
    if (!token) throw new Error('GITHUB_TOKEN is required')
    
    const { from, to } = getWindowRange(window.duration ?? "24h")
    const currentHour = new Date().getUTCHours()

    info('Querying GitHub activity', { username, from, to, currentHour })

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

    // --- Fetch actual commit timestamps ---
    const commitTimestamps: Date[] = []
    let processedCommits = 0

    async function fetchCommitTimestampsForRepo(owner: string, repo: string): Promise<Date[]> {
        // Build search query for commits by this user in the time window
        const rawQ = `repo:${owner}/${repo} author:${username} committer-date:${from}..${to}`
        const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(rawQ)}&per_page=100&sort=committer-date&order=desc`

        const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')
        if (!res.ok) {
            warn(`Commit search failed for ${owner}/${repo} (status: ${res.status})`)
            return []
        }

        const items = (res.json?.items ?? []) as any[]
        const timestamps: Date[] = []
        
        for (const item of items) {
            // Use commit.committer.date for the actual commit timestamp
            const timestamp = item.commit?.committer?.date
            if (timestamp) {
                timestamps.push(new Date(timestamp))
            }
        }
        
        return timestamps
    }

    // Gather all commit timestamps concurrently
    await withConcurrency(repoContributionNodes, 3, async (r) => {
        try {
            const timestamps = await fetchCommitTimestampsForRepo(r.owner, r.name)
            for (const ts of timestamps) {
                commitTimestamps.push(ts)
                processedCommits++
            }
        } catch (e) {
            warn(`Failed to get timestamps for ${r.owner}/${r.name}`, e)
        }
    })

    // Calculate hourly distribution from actual commit timestamps
    const hourlyCounts = new Array(24).fill(0)
    
    for (const timestamp of commitTimestamps) {
        const hour = timestamp.getUTCHours()
        hourlyCounts[hour] += 1
    }

    const commitsCount = commitTimestamps.length

    // Determine Most Active Hour
    // The current hour is the latest hour (inclusive)
    // When there's a tie, prefer the earliest hour
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
    const commitShasToFetch: Array<{ owner: string; repo: string; sha: string }> = []

    async function fetchCommitShasForRepo(owner: string, repo: string): Promise<string[]> {
        const rawQ = `repo:${owner}/${repo} author:${username} committer-date:${from}..${to}`
        const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(rawQ)}&per_page=20`

        const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')
        if (!res.ok) {
            warn(`Commit search failed for ${owner}/${repo} (status: ${res.status})`)
            return []
        }

        const items = (res.json?.items ?? []) as any[]
        return items.map(i => i.sha).filter(Boolean)
    }

    // Reset processedCommits counter for lines changed calculation
    processedCommits = 0

    // 1. Gather SHAs (Concurrent)
    await withConcurrency(repoContributionNodes, 3, async (r) => {
        try {
            const shas = await fetchCommitShasForRepo(r.owner, r.name)
            for (const sha of shas) {
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
        hourly_counts: hourlyCounts,
        current_hour: currentHour
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
