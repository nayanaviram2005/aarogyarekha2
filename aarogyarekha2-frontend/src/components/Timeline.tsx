import { useI18n } from '../i18n/I18n';
import { formatTime } from '../lib/format';
import { buildTimeline, KIND_LABEL } from '../lib/timeline';
import type { EncounterSummary } from '../lib/types';

/** What happened, in order, from recorded facts only. Original wording is kept in the language it was given. */
export function Timeline({ summary }: { summary: EncounterSummary }) {
  const { t } = useI18n();
  const events = buildTimeline(summary);
  return (
    <section className="block" aria-label={t('timeline.title')}>
      <div className="block__head"><h3>{t('timeline.title')}</h3></div>
      <div className="block__body block__body--flush">
        <table className="table">
          <thead><tr><th>{t('timeline.time')}</th><th>{t('timeline.source')}</th><th>{t('timeline.event')}</th></tr></thead>
          <tbody>
            {events.map((e, i) => <tr key={i}><td>{formatTime(e.at)}</td><td>{KIND_LABEL[e.kind]}</td><td lang={e.lang}>{e.text}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
