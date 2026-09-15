import { ImageResponse } from 'next/og'

// `/ai` 専用の OG 画像。ルートの画像は地図アプリの紹介なので、リンクを共有したときに
// 「自分の Claude から使える」という話が伝わらない。ここはその 1 点だけを言う。
//
// ⚠ Satori の既定フォントは日本語を描画できない（豆腐になる）。フォントを同梱すると
// OG のためだけに数 MB 積むことになるので、ルートの画像と同じく**ラテン文字だけ**で構成する。
export const alt = 'Ask your own Claude about 9,273 train stations in Japan — no API key'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const FACTS: readonly string[] = ['9,273 stations', '806 columns', '13 tools', 'read-only']

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div
        style={{
          display: 'flex',
          width: '68px',
          height: '68px',
          borderRadius: '18px',
          background: 'rgba(255,255,255,0.16)',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: '20px',
        }}
      >
        <svg width="40" height="40" viewBox="0 0 32 32">
          <path
            d="M16 6.5c-3.59 0-6.5 2.91-6.5 6.5 0 4.6 6.5 12 6.5 12s6.5-7.4 6.5-12c0-3.59-2.91-6.5-6.5-6.5Z"
            fill="#ffffff"
          />
          <circle cx="16" cy="13" r="2.6" fill="#4f46e5" />
        </svg>
      </div>
      <div style={{ fontSize: '31px', fontWeight: 600, letterSpacing: '0.02em', opacity: 0.92 }}>
        AI Database Map
      </div>
    </div>
  )
}

function Facts() {
  return (
    <div style={{ display: 'flex', gap: '14px' }}>
      {FACTS.map((fact) => (
        <div
          key={fact}
          style={{
            display: 'flex',
            fontSize: '24px',
            padding: '8px 18px',
            borderRadius: '999px',
            background: 'rgba(255,255,255,0.16)',
          }}
        >
          {fact}
        </div>
      ))}
    </div>
  )
}

export default function AiOpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        color: '#ffffff',
        background: 'linear-gradient(135deg, #4338ca 0%, #4f46e5 45%, #0ea5e9 100%)',
        fontFamily: 'sans-serif',
      }}
    >
      <Brand />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: '72px', fontWeight: 800, lineHeight: 1.12 }}>
          Ask your own Claude
        </div>
        <div style={{ fontSize: '72px', fontWeight: 800, lineHeight: 1.12 }}>
          about every station in Japan.
        </div>
        <div style={{ display: 'flex', fontSize: '28px', opacity: 0.88, marginTop: '22px' }}>
          Ridership · Population · Land price · Sales · Flood risk — by radius. No API key.
        </div>
      </div>
      <Facts />
    </div>,
    { ...size },
  )
}
