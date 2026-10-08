// Mirrors server/src/youtube.ts
export interface TranscriptSegment {
  start: number
  duration: number
  text: string
}

export interface Chapter {
  start: number
  title: string
}

export interface VideoMetadata {
  title: string
  author: string
  channelId?: string
  description: string
  lengthSeconds: number
  viewCount?: number
  publishDate?: string
  category?: string
  keywords: string[]
  thumbnailUrl?: string
}

export interface VideoContext {
  videoId: string
  metadata: VideoMetadata
  chapters: Chapter[]
  transcript: TranscriptSegment[]
  transcriptLanguage?: string
  transcriptSource: 'captions' | 'manual' | 'none'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}
