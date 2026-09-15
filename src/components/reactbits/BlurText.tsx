import { motion } from 'framer-motion'

export function BlurText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={className} aria-label={text}>
      {Array.from(text).map((character, index) => (
        <motion.span
          key={`${character}-${index}`}
          aria-hidden="true"
          className="inline-block"
          initial={{ opacity: 0, filter: 'blur(10px)', y: 14 }}
          animate={{ opacity: 1, filter: 'blur(0px)', y: 0 }}
          transition={{ delay: 0.04 * index, duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
        >
          {character === ' ' ? '\u00a0' : character}
        </motion.span>
      ))}
    </span>
  )
}
