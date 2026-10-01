/**
 * チャットのスレッドを**どこまで送るか**（追従先）を決める純関数（2026-10-02）。
 *
 * 末尾まで送るのが基本。ただし**質問＋回答が枠より高い**ときに末尾へ送ると、回答の頭が上に隠れる
 * （災害のカードは会話の中に出るので背が高い）。そのときは**質問の頭を枠の上端**に合わせて止め、
 * 続きは利用者が読み進める（`docs/261001_fix_user_feedback_ui.md` §3.3）。
 */

/** 質問の頭の上に空ける余白（スレッドの上の余白 `py-3` と同じ）。 */
export const FOLLOW_MARGIN_PX = 12

/** 質問の吹き出しに付ける印（`ChatMessage`）。追従先を DOM から探すのに使う。 */
export const QUESTION_MARKER = { 'data-chat-question': '' } as const

/** 上の印を探すセレクタ（印の名前と同じものを、ここ 1 か所で持つ）。 */
export const QUESTION_SELECTOR = '[data-chat-question]'

/**
 * 追従先の scrollTop。
 *
 * @param bottom_px 末尾まで送ったときの scrollTop
 * @param questionTop_px 最後の質問の頭（スレッドの中身の座標）。質問が無ければ null
 * @param margin_px 質問の頭の上に空ける余白
 */
export function followScrollTop(
  bottom_px: number,
  questionTop_px: number | null,
  margin_px: number,
): number {
  const bottom = Math.max(0, bottom_px)
  if (questionTop_px === null || !Number.isFinite(questionTop_px)) return bottom
  return Math.max(0, Math.min(bottom, questionTop_px - margin_px))
}
