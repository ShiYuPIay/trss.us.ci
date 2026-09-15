import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Article } from '@/types/article'
import { BlurText } from '@/components/reactbits/BlurText'

/**
 * 首页主视觉。
 *
 * 版式对齐子比主题的横幅卡片：浅色渐变底 + 左侧文案 + 右侧封面，
 * 而不是通栏深色图片。控件放在文案下方，避免与右侧封面互相压盖。
 */
export function HeroSlider({ articles }: { articles: Article[] }) {
  const slides = articles.slice(0, 3)
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (slides.length < 2) return
    const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), 6500)
    return () => window.clearInterval(timer)
  }, [slides.length])

  if (!slides.length) return null
  const slide = slides[active]

  return (
    <section className="hero-slider" aria-roledescription="carousel" aria-label="精选文章">
      <div className="hero-inner">
        <div className="hero-copy">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.slug}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45 }}
            >
              <span className="eyebrow">FEATURED · 精选故事</span>
              <h1><BlurText text={slide.title} /></h1>
              <p>{slide.excerpt}</p>
              <div className="hero-meta"><span>{slide.published_at}</span><span>{slide.reading_time}</span></div>
              <Link to={`/articles/${slide.slug}`} className="button button-accent">阅读文章 <ArrowRight size={18} /></Link>
            </motion.div>
          </AnimatePresence>

          {slides.length > 1 && (
            <div className="hero-controls">
              <button onClick={() => setActive((active - 1 + slides.length) % slides.length)} aria-label="上一张"><ChevronLeft size={20} /></button>
              <div className="hero-dots">
                {slides.map((item, index) => <button key={item.slug} className={index === active ? 'active' : ''} onClick={() => setActive(index)} aria-label={`切换到第 ${index + 1} 张`} />)}
              </div>
              <button onClick={() => setActive((active + 1) % slides.length)} aria-label="下一张"><ChevronRight size={20} /></button>
            </div>
          )}
        </div>

        <div className="hero-media">
          <AnimatePresence mode="wait">
            {/* 空 src 会让浏览器把当前页面重新下载一遍，无封面时改用渐变占位 */}
            {slide.cover_url ? (
              <motion.img
                key={slide.cover_url}
                src={slide.cover_url}
                alt={slide.title}
                className="hero-image"
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7 }}
                fetchPriority="high"
              />
            ) : (
              <motion.div
                key="hero-fallback"
                className="hero-image article-cover-fallback"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7 }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
