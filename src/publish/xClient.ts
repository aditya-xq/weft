import { Client, OAuth1, type ClientConfig, type OAuth1Config } from '@xdevplatform/xdk'

//@ts-expect-error - callback is not required
const AUTH_CONFIG: OAuth1Config = {
    apiKey: process.env.X_CONSUMER_KEY!,
    apiSecret: process.env.X_CONSUMER_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessTokenSecret: process.env.X_ACCESS_SECRET!
}

const oauth1: OAuth1 = new OAuth1(AUTH_CONFIG)

const config: ClientConfig = {
    oauth1: oauth1
}

const client: Client = new Client(config)

async function uploadMedia(buffer: any): Promise<string> {
    const totalBytes = buffer.byteLength

    // Validate buffer size < 5MB
    if (totalBytes > 5 * 1024 * 1024) {
        throw new Error("Media file size exceeds 5MB limit")
    }
    const mediaRes = await client.media.upload({
        body: {
            media: buffer.toString('base64'),
            //@ts-expect-error - types are kinda wrong here
            media_type: 'image/png',
            media_category: 'tweet_image',
        }
    })
    const mediaId = mediaRes?.data?.id
    return mediaId
}

export async function postToX(text: string, mediaBuffer?: any) {
    let mediaId: string | undefined
    if (mediaBuffer) {
        mediaId = await uploadMedia(mediaBuffer)
    }

    return client.posts.create({
        text,
        ...(mediaId ? { media: { media_ids: [mediaId] } } : {})
    })
}
