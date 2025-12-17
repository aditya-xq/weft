import sharp from 'sharp'

/**
 * Converts an SVG string to a high-quality PNG Buffer using Sharp.
 * Optimized for crisp text and production performance.
 */
export async function svgToPngSharp(
    svg: string, 
    width: number, 
    background?: string
): Promise<Buffer> {
    if (!svg || typeof svg !== 'string') {
        throw new Error('Invalid SVG content provided.');
    }
    const svgBuffer = Buffer.from(svg)
    let pipeline = sharp(svgBuffer, { 
        density: 300
    })
    if (background) {
        pipeline = pipeline.flatten({ background });
    }
    return await pipeline
        .resize({
            width: width,
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .png({
            compressionLevel: 9,
            adaptiveFiltering: true,
            quality: 100
        })
        .toBuffer()
}
