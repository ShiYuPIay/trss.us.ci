import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() { return { hasError: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染异常', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return <main className="not-found"><div><span>!</span><h1>页面暂时没有加载成功</h1><p>内容仍然安全保存，请刷新页面后再试。</p><button className="button button-primary" onClick={() => window.location.reload()}>重新加载</button></div></main>
    }
    return this.props.children
  }
}
