import { useEffect, useRef, useState } from 'react'
import './App.css'

const CHROMECAST_WALLPAPER_ENDPOINT =
  'https://clients3.google.com/cast/chromecast/home/v/c9541b08'
const WALLPAPER_CACHE_KEY = 'kid-picture-scroll.wallpapers.v1'
const WALLPAPER_CACHE_TTL_MS = 1000 * 60 * 60 * 6
const FALLBACK_WALLPAPERS = [
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2000&q=80',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=2000&q=80',
]

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const isLikelyImageUrl = (value) => {
  if (typeof value !== 'string' || !value.startsWith('http')) {
    return false
  }

  return /(\\.jpe?g|\\.png|\\.webp|googleusercontent|ggpht|gstatic|unsplash)/i.test(
    value,
  )
}

const collectImageUrls = (node, found = new Set()) => {
  if (!node) {
    return found
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectImageUrls(item, found))
    return found
  }

  if (typeof node === 'object') {
    Object.values(node).forEach((value) => collectImageUrls(value, found))
    return found
  }

  if (isLikelyImageUrl(node)) {
    found.add(node)
  }

  return found
}

const readCachedWallpapers = () => {
  try {
    const raw = localStorage.getItem(WALLPAPER_CACHE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    const isFresh = Date.now() - parsed.cachedAt < WALLPAPER_CACHE_TTL_MS

    if (!Array.isArray(parsed.wallpapers) || !isFresh) {
      return null
    }

    return parsed.wallpapers
  } catch {
    return null
  }
}

const writeCachedWallpapers = (wallpapers) => {
  try {
    localStorage.setItem(
      WALLPAPER_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), wallpapers }),
    )
  } catch {
    // localStorage may be unavailable in private mode.
  }
}

const toWallpaperObjects = (urls) =>
  urls.map((url, index) => ({
    id: `${index}-${url}`,
    url,
  }))

const warmImageCache = async (urls) => {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return
  }

  try {
    const cache = await window.caches.open('kid-picture-scroll-images-v1')
    for (const url of urls.slice(0, 12)) {
      try {
        if (!(await cache.match(url))) {
          await cache.add(url)
        }
      } catch {
        // Ignore per-image caching failures.
      }
    }
  } catch {
    // Ignore global cache storage failures.
  }
}

const fetchWallpapers = async () => {
  const cached = readCachedWallpapers()
  if (cached?.length) {
    return cached
  }

  try {
    const response = await fetch(CHROMECAST_WALLPAPER_ENDPOINT)
    if (!response.ok) {
      throw new Error(`Google wallpaper request failed: ${response.status}`)
    }

    const payload = await response.json()
    const urls = [...collectImageUrls(payload)]
    if (!urls.length) {
      throw new Error('No wallpapers were returned from Google wallpaper store')
    }

    const wallpapers = toWallpaperObjects(urls)
    writeCachedWallpapers(wallpapers)
    return wallpapers
  } catch {
    return toWallpaperObjects(FALLBACK_WALLPAPERS)
  }
}

function App() {
  const [wallpapers, setWallpapers] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isOverview, setIsOverview] = useState(false)
  const [dragOffsetPx, setDragOffsetPx] = useState(0)

  const pointersRef = useRef(new Map())
  const pinchStartDistanceRef = useRef(null)
  const startedAsPinchRef = useRef(false)
  const dragStartXRef = useRef(0)

  useEffect(() => {
    let isMounted = true

    fetchWallpapers().then((result) => {
      if (!isMounted) {
        return
      }

      setWallpapers(result)
      void warmImageCache(result.map((wallpaper) => wallpaper.url))
    })

    return () => {
      isMounted = false
    }
  }, [])

  const goTo = (nextIndex) => {
    setCurrentIndex(clamp(nextIndex, 0, wallpapers.length - 1))
  }

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })

    if (pointersRef.current.size === 1) {
      dragStartXRef.current = event.clientX
      startedAsPinchRef.current = false
    } else if (pointersRef.current.size === 2) {
      startedAsPinchRef.current = true
      const [first, second] = [...pointersRef.current.values()]
      pinchStartDistanceRef.current = Math.hypot(
        second.x - first.x,
        second.y - first.y,
      )
    }
  }

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return
    }

    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    })

    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()]
      const currentDistance = Math.hypot(second.x - first.x, second.y - first.y)
      const startDistance = pinchStartDistanceRef.current || currentDistance
      const ratio = currentDistance / startDistance

      if (ratio < 0.88) {
        setIsOverview(true)
      } else if (ratio > 1.12) {
        setIsOverview(false)
      }

      setDragOffsetPx(0)
      return
    }

    if (startedAsPinchRef.current || isOverview) {
      return
    }

    setDragOffsetPx(event.clientX - dragStartXRef.current)
  }

  const onPointerUp = (event) => {
    pointersRef.current.delete(event.pointerId)

    if (pointersRef.current.size > 0) {
      return
    }

    const dragThreshold = window.innerWidth * 0.12
    if (!startedAsPinchRef.current && !isOverview) {
      if (dragOffsetPx <= -dragThreshold) {
        goTo(currentIndex + 1)
      } else if (dragOffsetPx >= dragThreshold) {
        goTo(currentIndex - 1)
      }
    }

    setDragOffsetPx(0)
    startedAsPinchRef.current = false
    pinchStartDistanceRef.current = null
  }

  if (!wallpapers.length) {
    return <main className="status">Loading wallpapers…</main>
  }

  return (
    <main className={`wallpaper-app ${isOverview ? 'overview' : ''}`}>
      <section
        className="wallpaper-view"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="wallpaper-strip"
          style={{
            transform: `translateX(calc(${-currentIndex * 100}% + ${dragOffsetPx}px))`,
            transition: dragOffsetPx === 0 ? 'transform 280ms ease' : 'none',
          }}
        >
          {wallpapers.map((wallpaper, index) => (
            <article
              key={wallpaper.id}
              className="wallpaper-slide"
              style={{ backgroundImage: `url(${wallpaper.url})` }}
              aria-hidden={index !== currentIndex}
            />
          ))}
        </div>
      </section>

      {isOverview && (
        <section className="overview-grid" aria-label="Wallpaper overview">
          {wallpapers.map((wallpaper, index) => (
            <button
              key={wallpaper.id}
              className={`overview-item ${index === currentIndex ? 'active' : ''}`}
              onClick={() => {
                setCurrentIndex(index)
                setIsOverview(false)
              }}
              style={{ backgroundImage: `url(${wallpaper.url})` }}
              aria-label={`Open wallpaper ${index + 1}`}
            />
          ))}
        </section>
      )}
    </main>
  )
}

export default App
