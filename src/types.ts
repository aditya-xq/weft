export type TimeWindow = { duration?: string; from?: string; to?: string }

export type RawMetrics = Record<string, number>

export type ComputedConfigItem = { id: string; formula: string; description?: string }

export type Config = {
    time_window: TimeWindow;
    github: { username: string; metrics: Array<{ id: string; query: string; description?: string }> }
    computed?: ComputedConfigItem[];
    visual?: any;
    twitter?: { publish?: boolean; message_template?: string }
    runtime?: { timezone?: string; post_time_local?: string }
}
