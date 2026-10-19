import { Component, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main className="p-10"><h1>Giao diện gặp lỗi</h1><p className="my-4">Dữ liệu đã lưu không bị thay đổi. Hãy mở lại ứng dụng.</p><button onClick={() => location.reload()}>Tải lại giao diện</button></main> : this.props.children; }
}