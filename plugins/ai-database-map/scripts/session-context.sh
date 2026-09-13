#!/bin/sh
# SessionStart フック：スキルがロードされない回でも壊れないだけの作法を足す。
# JSON は 1 行・追加の出力なし（stdout がそのまま解釈される）。
# 単一引用符の中なので、本文に ' を使わない（日本語の引用符「」を使う）。
# ⚠ ここに書くのは「守られないと答えが間違う／無駄が出る」ものだけ。詳細は skills に置く
#   （実走では、ターン 1 でも本走でもスキルが 1 つもロードされない回がある）。
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"AI Database Map plugin: 駅×半径のオープンデータ分析。指標キーは必ず get_metrics_catalog で確認し、数値には単位・半径・年次を添える。対象集合は list_stations を 1 回（路線・会社は配列でまとめる）、多数の比較は build_dataset を 1 回＋ローカル解析。スコアを合成するときは正規化してから重み付けし、使った方法（z-score / min-max など）と重みを 1 行書く。災害は想定（もし起きたら）と現況（いま）を混ぜず、「安全」とは言わない。答えの最後に限界と出典を必ず置く——サブエージェントの報告を要約するときも削らない。ツール名の接頭辞は環境で変わるので末尾の名前（build_dataset など）で見分ける。おすすめ・比較・分類の相談は、データを取る前に要件を 1 回聞く。presentChart / presentForm / presentHtml が使える環境では、要件は presentForm 1 枚で聞き、チャートは present=echarts が返した option をそのまま渡し、地図は render_map の URL を保存して presentHtml にパスで渡す（station-analysis の Canvas 節）。"}}'
