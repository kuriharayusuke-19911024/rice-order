# CLAUDE.md

## Claude と Codex の役割分担

このプロジェクトでは、Claude と Codex（OpenAI）で役割を分けて進める。

- **Claude（社長役）**：設計、方針決め、最終チェック
- **Codex（作業役）**：実装や修正など、手を動かす作業は `/codex:rescue` で Codex に任せる
- **レビュー**：Codex の作業が終わったら `/codex:review` でレビューさせる。指摘が正しいかは Claude が判断し、必要なものだけ直す

### 前提

- Codex プラグイン（`openai/codex-plugin-cc`）が入っている環境でのみ、上記の流れで進める
- `/codex:*` コマンドが使えない環境では、Claude が実装まで担当する
