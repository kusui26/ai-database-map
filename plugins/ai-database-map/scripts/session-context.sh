#!/bin/sh
# SessionStart フック：1 文だけ文脈を足す（詳細は skills が必要時にロードされる）。
# JSON は 1 行・追加の出力なし（stdout がそのまま解釈される）。
printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"AI Database Map plugin: 駅×半径のオープンデータ分析。指標キーは必ず get_metrics_catalog で確認し、数値には単位・半径・年次を添える。災害は想定（もし起きたら）と現況（いま）を混ぜず、「安全」とは言わない。"}}'
