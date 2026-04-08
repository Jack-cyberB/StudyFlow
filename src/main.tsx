import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean; message: string }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    console.error('Root render failed', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            padding: '32px',
            background: '#f5f2ea',
            color: '#1f2933',
            fontFamily: '"Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              padding: '24px',
              borderRadius: '20px',
              background: '#ffffff',
              boxShadow: '0 20px 50px rgba(24, 39, 75, 0.12)',
            }}
          >
            <h1 style={{ margin: '0 0 12px', fontSize: '22px' }}>界面加载失败</h1>
            <p style={{ margin: '0 0 12px', lineHeight: 1.6 }}>
              程序没有退出，但刚刚的渲染发生了异常。可以先点击下面的按钮重新加载窗口。
            </p>
            {this.state.message ? (
              <pre
                style={{
                  margin: '0 0 16px',
                  padding: '12px',
                  borderRadius: '12px',
                  background: '#f7f8fa',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {this.state.message}
              </pre>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: 'none',
                borderRadius: '999px',
                padding: '10px 18px',
                background: '#3f8d7d',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
