/**
 * Findings — the API feedback deliverable.
 *
 * Nothing on this page is hand-written prose about the API: the findings are
 * detected from the snapshot by `detectFindings` in `src/lib/analysis.ts`, so
 * the evidence on screen is evidence that was actually observed. The issue log
 * the snapshot itself carries is shown separately and labelled as such.
 */

import { CopyButton, Endpoint, Panel } from './components.tsx';
import { int } from './format.ts';
import { SEVERITY_LABEL, SEVERITY_SHORT } from './theme.ts';
import type { AppData } from './data.ts';
import type { Finding } from '../lib/analysis.ts';
import type { ApiIssue } from '../lib/types.ts';

interface IssueLike {
  id: string;
  title: string;
  detail: string;
  endpoint: string;
  evidence: string;
  severity: 1 | 2 | 3;
  repro?: string | undefined;
  suggestedFix?: string | undefined;
}

function FindingCard({ issue }: { issue: IssueLike }) {
  return (
    <article className="finding">
      <header className="finding-head">
        <span className={`sev s${issue.severity}`}>{SEVERITY_SHORT[issue.severity]}</span>
        <span className="finding-title">{issue.title}</span>
        <span className="finding-id">{issue.id}</span>
      </header>
      <div className="finding-body">
        <p>{issue.detail}</p>

        <div>
          <div className="tiny" style={{ marginBottom: 4 }}>
            endpoint
          </div>
          <Endpoint endpoint={issue.endpoint} />
        </div>

        <div>
          <div className="tiny" style={{ marginBottom: 4 }}>
            evidence
          </div>
          <div className="evidence">{issue.evidence}</div>
        </div>

        {issue.repro ? (
          <div>
            <div className="code-head">
              <span className="lbl">reproduce</span>
              <span className="spacer" />
              <CopyButton text={issue.repro} />
            </div>
            <pre className="code">
              <span className="prompt">$ </span>
              {issue.repro}
            </pre>
          </div>
        ) : null}

        {issue.suggestedFix ? (
          <div className="fix">
            <span className="lbl">suggested fix</span>
            {issue.suggestedFix}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function FindingsView({ data }: { data: AppData }) {
  const { snapshot, findings, analysis } = data;

  const logged: ApiIssue[] = snapshot.apiIssues ?? [];
  const all: IssueLike[] = [...findings, ...logged];
  const bySeverity = (s: 1 | 2 | 3) => all.filter((i) => i.severity === s).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Findings<span className="accent">.</span>
          </h1>
          <p className="page-sub">
            {int(findings.length)} issue{findings.length === 1 ? '' : 's'} auto-detected from this
            snapshot by <span className="mono">detectFindings()</span>, plus{' '}
            {int(logged.length)} recorded in the snapshot's own issue log. Every one of them blocks
            or degrades a number a consumer would otherwise take at face value.
          </p>
        </div>
      </div>

      <div className="strip" style={{ marginBottom: 14 }}>
        <div className="strip-item">
          <div className="strip-label">severity 3 · blocks the product</div>
          <div className="strip-value">{bySeverity(3)}</div>
        </div>
        <div className="strip-item">
          <div className="strip-label">severity 2 · material defect</div>
          <div className="strip-value">{bySeverity(2)}</div>
        </div>
        <div className="strip-item">
          <div className="strip-label">severity 1 · cosmetic</div>
          <div className="strip-value">{bySeverity(1)}</div>
        </div>
        <div className="strip-item">
          <div className="strip-label">assets scanned</div>
          <div className="strip-value">{int(analysis.summary.assetsScanned)}</div>
        </div>
        <div className="strip-item">
          <div className="strip-label">wrappers seen</div>
          <div className="strip-value">{int(analysis.summary.wrappersSeen)}</div>
        </div>
        <div className="strip-item">
          <div className="strip-label">credits spent</div>
          <div className="strip-value">{int(snapshot.scope.credits)}</div>
        </div>
      </div>

      <Panel
        title="auto-detected from this snapshot's data"
        note={`${int(findings.length)} finding${findings.length === 1 ? '' : 's'}`}
        flush
      >
        <div style={{ padding: findings.length === 0 ? 0 : 14 }}>
          {findings.length === 0 ? (
            <div className="empty">
              No issue was detected in this snapshot's data. That is a claim about this snapshot, not
              a claim about the API.
            </div>
          ) : (
            findings.map((finding: Finding) => <FindingCard key={finding.id} issue={finding} />)
          )}
        </div>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel
        title="recorded in the snapshot's issue log"
        note={`${int(logged.length)} issue${logged.length === 1 ? '' : 's'} · from the run that produced this snapshot`}
        flush
      >
        <div style={{ padding: logged.length === 0 ? 0 : 14 }}>
          {logged.length === 0 ? (
            <div className="empty">The snapshot carries no recorded issues.</div>
          ) : (
            logged.map((issue) => <FindingCard key={issue.id} issue={issue} />)
          )}
        </div>
      </Panel>

      <div style={{ height: 14 }} />

      <Panel title="how severity is read">
        <div className="grid cols-3">
          <div>
            <span className={`sev s3`}>severity 3</span>
            <p className="tiny" style={{ marginTop: 6 }}>
              {SEVERITY_LABEL[3]}. A consumer that trusts the payload produces a wrong number, not
              a missing one.
            </p>
          </div>
          <div>
            <span className={`sev s2`}>severity 2</span>
            <p className="tiny" style={{ marginTop: 6 }}>
              {SEVERITY_LABEL[2]}. The consumer has to do extra work to avoid being misled, and
              will usually not.
            </p>
          </div>
          <div>
            <span className={`sev s1`}>severity 1</span>
            <p className="tiny" style={{ marginTop: 6 }}>
              {SEVERITY_LABEL[1]}. Annoying, but it does not change a decision.
            </p>
          </div>
        </div>
        <div className="divider" />
        <p className="tiny" style={{ margin: 0 }}>
          The repro commands run against CoinMarketCap's Pro API with a key in{' '}
          <span className="mono">$CMC_API_KEY</span>. Every one of them is a real request shape taken
          from the receipts of the run that produced this snapshot — see the Method page for the
          full list of calls, queries, credits and timings behind these findings.
        </p>
      </Panel>
    </>
  );
}
