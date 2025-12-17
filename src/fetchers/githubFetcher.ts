import { isoNowMinus } from '../utils/date'
import { info, warn } from '../utils/logger'
import type { TimeWindow, RawMetrics } from '../types'

const GITHUB_API = 'https://api.github.com/graphql'
const GITHUB_REST = 'https://api.github.com'
const MAX_COMMITS = 200 // Safety cap to avoid huge history scans
const MAX_REPOS = 100 // Safety cap for repositories returned by GraphQL
const MAX_COMMITS_PER_REPO = 150 // safety per-repo when fetching commit SHAs

type RepoSummary = {
    owner: string
    name: string
    description?: string | null
    url?: string
    isPrivate?: boolean
}

// --- Helpers -----------------------------------------------------------------

function parseOffsetFromIso(iso?: string): number | null {
    if (!iso) return null
    const m = iso.match(/([+-])(\d{2}):?(\d{2})$/)
    if (!m) return null
    const sign = m[1] === '-' ? -1 : 1
    const hh = parseInt(m[2], 10)
    const mm = parseInt(m[3], 10)
    return sign * (hh * 60 + mm)
}

/**
 * Get hour (0-23) for a timestamp in the target timezone.
 * Priority: 1) explicit IANA timeZone string, 2) offset parsed from ISO, 3) local env hour
 */
function getHourInTargetTZ(tsIso: string, windowFromIso?: string, timeZone?: string): number | null {
    const d = new Date(tsIso)
    if (isNaN(d.getTime())) return null

    // 1) explicit IANA timezone
    if (timeZone) {
        try {
            // Use formatToParts to reliably get the numeric hour independent of locale quirks
            const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).formatToParts(d)
            const hourPart = parts.find(p => p.type === 'hour')
            if (hourPart) {
                const h = parseInt(hourPart.value, 10)
                if (!Number.isNaN(h)) return h
            }
        } catch (e) {
            // Fallthrough to other strategies
        }
    }

    // 2) offset from window.from (e.g. +05:30)
    const offsetMinutes = parseOffsetFromIso(windowFromIso)
    if (offsetMinutes !== null) {
        // shift UTC ms by offset (local hour = UTC hour of shifted instant)
        const shifted = new Date(d.getTime() + offsetMinutes * 60_000)
        return shifted.getUTCHours()
    }

    // 3) fallback to environment local hour
    return d.getHours()
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
        const txt = await res.text()
        throw new Error(`GitHub GraphQL error: ${res.status} ${res.statusText} - ${txt}`)
    }
    const json = await res.json()
    if (json.errors) warn('GitHub GraphQL returned errors', json.errors)
    return json
}

async function restJson(token: string, url: string, accept = 'application/vnd.github.v3+json') {
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: accept,
            'User-Agent': 'daily-github-snapshot'
        }
    })
    if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText }
    return { ok: true, json: await res.json() }
}

// Simple concurrency worker runner
async function withConcurrency<T>(items: T[], concurrency: number, fn: (it: T) => Promise<void>) {
    let idx = 0
    const workers: Promise<void>[] = []
    async function worker() {
        while (true) {
            const i = idx++
            if (i >= items.length) break
            await fn(items[i])
        }
    }
    for (let i = 0; i < concurrency; i++) workers.push(worker())
    await Promise.all(workers)
}

// --- Public function ---------------------------------------------------------

export async function fetchGithubMetrics(
    token: string,
    username: string,
    window: TimeWindow,
    timezone: string
): Promise<RawMetrics> {
    if (!token) throw new Error('GITHUB_TOKEN is required')

    const from = window.from ?? isoNowMinus(window.duration ?? '24h')
    const to = window.to ?? new Date().toISOString()

    info('Querying GitHub commit activity', { username, from, to })

    const gql = `
        query($login: String!, $from: DateTime!, $to: DateTime!, $maxRepos: Int!) {
            user(login: $login) {
                contributionsCollection(from: $from, to: $to) {
                    totalCommitContributions
                    commitContributionsByRepository(maxRepositories: $maxRepos) {
                        repository {
                            name
                            description
                            url
                            isPrivate
                            owner { login }
                        }
                        contributions(first: 100) {
                            totalCount
                            nodes { occurredAt commitCount }
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

    const contributionsCollection = user.contributionsCollection ?? {}
    const commitsCount = contributionsCollection.totalCommitContributions ?? 0

    const repoEntries: RepoSummary[] = []
    const commitTimestamps: string[] = []
    const repoContributionNodes: Array<{ owner: string; name: string }> = []

    const byRepo = contributionsCollection.commitContributionsByRepository ?? []
    for (const repoBucket of byRepo) {
        const repo = repoBucket?.repository
        if (!repo) continue
        const owner = repo.owner?.login ?? ''
        repoEntries.push({
            owner,
            name: repo.name,
            description: repo.description ?? null,
            url: repo.url ?? undefined,
            isPrivate: repo.isPrivate ?? false
        })

        const nodes = repoBucket.contributions?.nodes ?? []
        for (const n of nodes) if (n?.occurredAt) commitTimestamps.push(n.occurredAt)

        repoContributionNodes.push({ owner, name: repo.name })
    }

    // hourly distribution
    const hourlyCounts = new Array(24).fill(0)
    const targetTimeZone = timezone || (window as any)?.timezone as string | undefined

    for (const ts of commitTimestamps) {
        const hour = getHourInTargetTZ(ts, from, targetTimeZone)
        if (hour === null) continue
        hourlyCounts[hour] = (hourlyCounts[hour] ?? 0) + 1
    }

    // most active hour (tie -> smallest hour)
    let mostActiveHour: number | null = null
    let maxHourCount = -1
    for (let h = 0; h < 24; h++) {
        if (hourlyCounts[h] > maxHourCount) {
            maxHourCount = hourlyCounts[h]
            mostActiveHour = h
        }
    }

    if (targetTimeZone) {
        info('Computed hourly distribution in timezone', { timezone: targetTimeZone })
    } else if (from && /[+-]\d{2}:?\d{2}$/.test(from)) {
        info('Computed hourly distribution using offset parsed from "from" ISO string', { from })
    } else {
        warn('No timezone or offset provided; computed hourly distribution using environment local timezone')
    }

    // --- Lines changed calculation (REST) ---

    let totalLinesChanged = 0
    let processedCommits = 0
    const commitShasToFetch: Array<{ owner: string; repo: string; sha: string }> = []

    async function fetchCommitShasForRepo(owner: string, repo: string) {
        // Build search query. Keep encoding to stay compatible with original behavior.
        const q = `repo:${owner}/${repo}+author:${encodeURIComponent(username)}+committer-date:${from}..${to}`
        const per_page = 100
        let page = 1
        let keepGoing = true
        const shas: string[] = []

        while (keepGoing && shas.length < MAX_COMMITS_PER_REPO && processedCommits + shas.length < MAX_COMMITS) {
            const url = `${GITHUB_REST}/search/commits?q=${q}&per_page=${per_page}&page=${page}`
            const res = await restJson(token, url, 'application/vnd.github.cloak-preview+json')

            if (!res.ok) {
                warn('Commit search failed; attempting fallback to commits list', { owner, repo, status: res.status })
                // fallback
                const fallbackUrl = `${GITHUB_REST}/repos/${owner}/${repo}/commits?author=${encodeURIComponent(username)}&since=${encodeURIComponent(from)}&until=${encodeURIComponent(to)}&per_page=${per_page}&page=${page}`
                const fb = await restJson(token, fallbackUrl)
                if (!fb.ok) {
                    warn('Fallback commits list also failed', { owner, repo, status: fb.status })
                    return shas
                }
                const data = fb.json
                if (Array.isArray(data)) {
                    for (const c of data) {
                        if (processedCommits + shas.length >= MAX_COMMITS) break
                        if (c?.sha) shas.push(c.sha)
                    }
                    if (data.length < per_page) keepGoing = false
                    else page++
                } else {
                    keepGoing = false
                }
                break
            }

            const json = res.json
            const items = json.items ?? []
            for (const it of items) {
                if (it?.sha) {
                    shas.push(it.sha)
                    if (shas.length >= MAX_COMMITS_PER_REPO) break
                }
            }

            const total = json.total_count ?? 0
            const fetchedSoFar = per_page * page
            if (fetchedSoFar >= total || items.length < per_page) keepGoing = false
            else page++
        }

        return shas
    }

    async function fetchCommitStats(owner: string, repo: string, sha: string) {
        const url = `${GITHUB_REST}/repos/${owner}/${repo}/commits/${sha}`
        const res = await restJson(token, url)
        if (!res.ok) {
            warn('Failed to fetch commit details', { owner, repo, sha, status: res.status })
            return null
        }
        return res.json?.stats ?? null
    }

    // collect SHAs bounded by MAX_COMMITS
    for (const r of repoContributionNodes) {
        if (processedCommits >= MAX_COMMITS) break
        try {
            const shas = await fetchCommitShasForRepo(r.owner, r.name)
            for (const sha of shas) {
                if (processedCommits >= MAX_COMMITS) break
                commitShasToFetch.push({ owner: r.owner, repo: r.name, sha })
                processedCommits++
            }
        } catch (e) {
            warn('Error fetching SHAs for repo', { repo: r, err: String(e) })
        }
    }

    const concurrency = 5
    if (commitShasToFetch.length > 0) {
        info('Fetching commit stats for commits', { count: commitShasToFetch.length })
        await withConcurrency(commitShasToFetch, concurrency, async (it) => {
            try {
                const stats = await fetchCommitStats(it.owner, it.repo, it.sha)
                if (stats && typeof stats.additions === 'number' && typeof stats.deletions === 'number') {
                    totalLinesChanged += (stats.additions + stats.deletions)
                }
            } catch (e) {
                warn('Error fetching commit stats', { item: it, err: String(e) })
            }
        })
    } else {
        info('No commit SHAs found via search; lines changed will be zero or underestimated.')
    }

    info('Fetched GitHub metrics', {
        commits_count: commitsCount,
        repos_count: repoEntries.length,
        total_lines_changed: totalLinesChanged,
        most_active_hour: mostActiveHour,
        hourly_counts: hourlyCounts
    })

    return {
        commits_count: commitsCount,
        repos: repoEntries,
        lines_changed: totalLinesChanged,
        most_active_hour: mostActiveHour,
        hourly_counts: hourlyCounts
    } as unknown as RawMetrics
}

function emptyMetrics(): RawMetrics {
    return { commits_count: 0 } as unknown as RawMetrics
}
