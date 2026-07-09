import { ImageResponse } from 'next/og'

// 動的 OG 画像（自己完結）。Satori 既定フォントは日本語を描画できないためラテン文字で構成する。
export const alt = 'AI Database Map — open data by station and radius, on a map with AI'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          color: '#ffffff',
          background: 'linear-gradient(135deg, #4338ca 0%, #4f46e5 45%, #0ea5e9 100%)',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              width: '76px',
              height: '76px',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.16)',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '22px',
            }}
          >
            <svg width="46" height="46" viewBox="0 0 32 32">
              <path
                d="M16 6.5c-3.59 0-6.5 2.91-6.5 6.5 0 4.6 6.5 12 6.5 12s6.5-7.4 6.5-12c0-3.59-2.91-6.5-6.5-6.5Z"
                fill="#ffffff"
              />
              <circle cx="16" cy="13" r="2.6" fill="#4f46e5" />
            </svg>
          </div>
          <div style={{ fontSize: '34px', fontWeight: 600, letterSpacing: '0.02em', opacity: 0.92 }}>
            AI Database Map
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '82px', fontWeight: 800, lineHeight: 1.1 }}>Open data,</div>
          <div style={{ fontSize: '82px', fontWeight: 800, lineHeight: 1.1 }}>
            by station × radius.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: '29px', opacity: 0.85 }}>
          Passenger · Population · Land price · Bus · Establishments — mapped, with AI
        </div>
      </div>
    ),
    { ...size },
  )
}
