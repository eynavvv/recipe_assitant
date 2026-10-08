import { useEffect, useRef, useState } from 'react'

// Minimal typings for the YouTube IFrame Player API.
interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  getCurrentTime(): number
  getPlayerState(): number
  destroy(): void
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string
          playerVars?: Record<string, number | string>
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void }
        },
      ) => YTPlayer
      PlayerState: { PLAYING: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null

function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  apiPromise ??= new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })
  return apiPromise
}

export function useYouTubePlayer(videoId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<YTPlayer | null>(null)
  const [ready, setReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!videoId || !containerRef.current) return
    let cancelled = false
    const mount = document.createElement('div')
    containerRef.current.replaceChildren(mount)
    loadApi().then(() => {
      if (cancelled || !window.YT) return
      playerRef.current = new window.YT.Player(mount, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => !cancelled && setReady(true),
          onStateChange: (e) => setPlaying(e.data === window.YT?.PlayerState.PLAYING),
        },
      })
    })
    return () => {
      cancelled = true
      setReady(false)
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [videoId])

  // Poll the playhead so the transcript and chapters can follow along.
  useEffect(() => {
    if (!ready) return
    const id = window.setInterval(() => {
      const t = playerRef.current?.getCurrentTime()
      if (typeof t === 'number') setCurrentTime(t)
    }, 500)
    return () => window.clearInterval(id)
  }, [ready])

  const seekTo = (seconds: number, play = true) => {
    const p = playerRef.current
    if (!p) return
    p.seekTo(seconds, true)
    if (play) p.playVideo()
    setCurrentTime(seconds)
  }

  const pause = () => playerRef.current?.pauseVideo()
  const play = () => playerRef.current?.playVideo()
  const getTime = () => playerRef.current?.getCurrentTime() ?? currentTime

  return { containerRef, ready, currentTime, playing, seekTo, pause, play, getTime }
}
