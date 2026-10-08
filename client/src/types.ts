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

export interface Comment {
  author: string
  text: string
  likes: number
  byCreator: boolean
}

export interface VideoContext {
  videoId: string
  metadata: VideoMetadata
  chapters: Chapter[]
  comments: Comment[]
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

// Mirrors RecipeSchema in server/src/recipe.ts
export interface Ingredient {
  group: string | null
  name: string
  quantity: string | null
  unit: string | null
  note: string | null
  source: 'spoken' | 'description' | 'comment' | 'inferred'
}

export interface RecipeStep {
  text: string
  start: number | null
  end: number | null
  timerSeconds: number | null
}

export interface Recipe {
  isRecipe: boolean
  title: string
  servings: number | null
  totalTime: string | null
  ingredients: Ingredient[]
  steps: RecipeStep[]
  tips: string[]
  gaps: string[]
}
