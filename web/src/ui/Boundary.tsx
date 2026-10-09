import { Component, type ReactNode } from 'react'

export class Boundary extends Component<{ label: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { err: e.message }
  }
  render() {
    if (this.state.err)
      return (
        <div className="glass" style={{ padding: 12 }} role="alert">
          <div className="err-line">{this.props.label} hit an error: {this.state.err}</div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => this.setState({ err: null })}>Try again</button>
        </div>
      )
    return this.props.children
  }
}
