'use client'

/**
 * ルートレイアウト自体が落ちたときの最終防衛（P7a）。layout を置換するため html/body を自前で描画し、
 * globals.css に依存せずインラインスタイルで最小限の再試行 UI を出す。
 */

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ maxWidth: '28rem', padding: '1.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>問題が発生しました</h1>
          <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#475569' }}>
            アプリの読み込み中にエラーが発生しました。再読み込みをお試しください。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            再試行
          </button>
        </div>
      </body>
    </html>
  )
}
