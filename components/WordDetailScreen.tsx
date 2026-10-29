import { useApp, useStoreVersion } from '../state/AppContext';
import { useRoute } from '../router';
import { PosBadge, TopBar, statusLabel } from './shared';
import { audio } from '../core/audioFeedback';
import { dueLabel, stageLabel } from '../core/progressStore';

export default function WordDetailScreen({ wordId }: { wordId: string }) {
  const { store, bank } = useApp();
  useStoreVersion();
  const [, navigate] = useRoute();

  const word = bank.getById(wordId);
  if (!word) {
    return (
      <div className="screen">
        <p className="load-hint">词条不存在。</p>
        <button className="btn btn-primary" onClick={() => navigate({ name: 'words' })}>
          返回总表
        </button>
      </div>
    );
  }

  const wp = store.getWordProgress(word.id);
  const speak = () => audio.speak(word.word);

  return (
    <>
      <TopBar title="词条详情" backTo={{ name: 'words' }} />
      <main className="screen">
        <div className="detail-card paper">
          <div className="detail-word">
            {word.word}
            <button className="q-speak-btn" onClick={speak} aria-label={`朗读 ${word.word}`}>
              🔊
            </button>
          </div>
          <div className="detail-phonetic">{word.phonetic}</div>
          <div>
            <PosBadge pos={word.partOfSpeech} />
            <span className="detail-notes" style={{ marginLeft: 8 }}>
              {word.globalPage ? `第 ${word.globalPage} 页` : ''} · 学习顺序 {word.freqRank ?? word.sourceOrder}
            </span>
          </div>
          <div className="detail-def">{word.meaning}</div>
          {word.rawDefinition && word.rawDefinition !== word.meaning && (
            <div className="detail-raw">原文定义：{word.rawDefinition}</div>
          )}
          {word.example ? (
            <div className="detail-raw">
              <strong>例句：</strong>
              {word.example}
              {word.exampleTranslation ? `（${word.exampleTranslation}）` : ''}
            </div>
          ) : null}
          {word.notes ? <div className="detail-notes">备注：{word.notes}</div> : null}
        </div>

        <div className="detail-card">
          <p className="card-title">📒 学习记录</p>
          <table className="record-table">
            <tbody>
              <tr>
                <td>当前状态</td>
                <td>{statusLabel(wp.status)}</td>
              </tr>
              <tr>
                <td>出现过次数</td>
                <td>{wp.appearances}</td>
              </tr>
              <tr>
                <td>答对 / 答错</td>
                <td>
                  {wp.correctCount} / {wp.wrongCount}
                </td>
              </tr>
              <tr>
                <td>连续正确</td>
                <td>{wp.streakCorrect}</td>
              </tr>
              <tr>
                <td>拼写题完成</td>
                <td>{wp.spellingDone ? `✅ 完成（答对 ${wp.spellingCorrectCount} 次）` : '未完成'}</td>
              </tr>
              <tr>
                <td>最近一次题型</td>
                <td>{typeLabel(wp.lastQuestionType)}</td>
              </tr>
              <tr>
                <td>最近答题</td>
                <td>{wp.lastAnsweredAt ? new Date(wp.lastAnsweredAt).toLocaleString('zh-CN') : '—'}</td>
              </tr>
              <tr>
                <td>在错词池中</td>
                <td>{wp.inWrongPool ? '是' : '否'}</td>
              </tr>
              <tr>
                <td>记忆阶段</td>
                <td>{stageLabel(wp.reviewStage)}</td>
              </tr>
              <tr>
                <td>下次复习</td>
                <td>{dueLabel(wp.nextReviewAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function typeLabel(t: string | null): string {
  switch (t) {
    case 'word-to-meaning':
      return '看词选义';
    case 'meaning-to-word':
      return '看义选词';
    case 'phonetic-to-word':
      return '音标认词';
    case 'letter-fill':
      return '字母补全';
    case 'letter-tiles':
      return '字母贴纸';
    case 'spell-typing':
      return '自由拼写';
    case 'context-cloze':
      return '语境填空';
    default:
      return t ?? '—';
  }
}
