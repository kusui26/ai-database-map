# Database Map
1. Project Overview
・・・

2. Technology Stack
    - Infrastructure & Hosting: Vercel (Hobby Plan)
    - Language: TypeScript
    - Framework: Next.js (App Router) + React
    - Map Rendering : MapLibre GL JS
    - Map Tiles / Base Map: MapTiler
    - AI / LLM: Google Gemini 2.5 Flash
    - Database: Supabase
    - Spatial Extension: PostgreSQL + PostGIS

3. System Architecture & Responsibilities
    
    [A] Frontend Layer (Next.js / React / MapLibre)

    [B] Backend / API Layer (Next.js API Routes on Vercel)

    [C] Database Layer (Supabase / PostgreSQL / PostGIS)

    [D] AI Layer (Gemini 2.5 Flash)

4. Core Protocol: "GUI Chat Protocol (Map Edition)"
AI（バックエンド）とフロントエンドが通信するための標準インターフェース。AIエージェントは、最終的にこの型（Type）に合致するレスポンスをフロントエンドに返すようにAPIを実装すること。
