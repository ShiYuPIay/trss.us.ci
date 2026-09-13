import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min((now - started) / 650, 1)
      setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, value])

  return <span ref={ref}>{display}</span>
}
