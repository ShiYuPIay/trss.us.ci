import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

/**
 * 数字滚动。
 *
 * 正确性要求：初始就渲染真实值，动画只是增强。
 * 早期实现从 0 开始、等观察器触发才滚动，一旦观察器不触发（打印、
 * 横向滚动容器内、`prefers-reduced-motion`、或用户直接落在页面中段），
 * 界面上会停留在一个错误的数字——例如「2 篇」显示成「0 篇」。
 *
 * 注意这里不在 effect 体内同步 setState：动画首帧（progress≈0）本身就会把
 * 显示值拉到接近 0，因此无需额外重置，也避开了 `react-hooks/set-state-in-effect`。
 */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    if (!inView) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

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
