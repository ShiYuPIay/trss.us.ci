import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FadeIn } from '@/components/MotionPrimitives'

export default function NotFound() {
  return <main className="not-found"><FadeIn><span>404</span><h1>这条小路还没有内容</h1><p>也许文章换了位置，或者它还在等待被写下。</p><Link to="/" className="button button-primary"><ArrowLeft size={17} />返回首页</Link></FadeIn></main>
}
