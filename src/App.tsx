/**
 * The shell: masthead, navigation, the fixture banner, and the router.
 */

import { useEffect, useState } from 'react';

import { Radar } from './ui/Radar.tsx';
import { AssetView } from './ui/AssetView.tsx';
import { FindingsView } from './ui/FindingsView.tsx';
import { MethodView } from './ui/MethodView.tsx';
import { loadData, type AppData } from './ui/data.ts';
import { useRoute } from './ui/router.ts';
import { int } from './ui/format.ts';

function Masthead({ data }: { data: AppData }) {
  const route = useRoute();
  const { snapshot } = data;
  const radarOn = route.name === 'radar' || route.name === 'asset';

  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <a href="#/radar" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-mark">
            CROSS<em>·</em>THE<em>·</em>SPREAD
          </span>
          <span className="brand-sub">tokenized-equity spread capture, priced</span>
        </a>
        <nav className="nav">
          <a href="#/radar" className={radarOn ? 'on' : ''}>
            Radar
          </a>
          <a href="#/findings" className={route.name === 'findings' ? 'on' : ''}>
            Findings
          </a>
          <a href="#/method" className={route.name === 'method' ? 'on' : ''}>
            Method
          </a>
        </nav>
        <div className="masthead-right">
          <span className={snapshot.source === 'live' ? 'src-badge live' : 'src-badge'}>
            <span className="dot" />
            {snapshot.source === 'live' ? 'live pull' : 'offline fixture'}
          </span>
          <span>
            notional <b>${int(snapshot.scope.sizeUsd)}</b>
          </span>
          <span>
            snapshot <b>{snapshot.generatedAt.replace('T', ' ').replace('.000Z', 'Z')}</b>
          </span>
        </div>
      </div>
    </header>
  );
}

function FixtureBanner({ data }: { data: AppData }) {
  if (!data.isFixture) return null;
  return (
    <div className="banner">
      <div className="wrap banner-inner">
        <span className="banner-tag">Offline fixture</span>
        <span>
          These numbers come from a checked-in <b>fixture snapshot</b>, not from a live pull of
          CoinMarketCap. No API calls were made to render this page. To regenerate it from the
          live API, set <code>CMC_API_KEY</code> and run <code>npm run snapshot</code>.
        </span>
      </div>
    </div>
  );
}

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useRoute();

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="app">
        <main>
          <div className="wrap">
            <h1 className="page-title" style={{ marginBottom: 12 }}>
              The snapshot could not be loaded
            </h1>
            <div className="error-box">{error}</div>
            <p className="tiny" style={{ marginTop: 14 }}>
              The site reads <span className="mono">public/data/snapshot.json</span> at runtime. Run{' '}
              <span className="mono">npm run seed</span> for the offline fixture or{' '}
              <span className="mono">npm run snapshot</span> with a CoinMarketCap key for live data.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app">
        <main>
          <div className="wrap loading">loading snapshot…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Masthead data={data} />
      <FixtureBanner data={data} />
      <main>
        <div className="wrap">
          {route.name === 'radar' && <Radar data={data} />}
          {route.name === 'asset' && <AssetView data={data} symbol={route.symbol} />}
          {route.name === 'findings' && <FindingsView data={data} />}
          {route.name === 'method' && <MethodView data={data} />}
        </div>
      </main>
      <footer className="site">
        <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px' }}>
          <span>
            source <b>{data.snapshot.source}</b>
          </span>
          <span>
            generated <b>{data.snapshot.generatedAt}</b>
          </span>
          <span>
            credits <b>{int(data.snapshot.scope.credits)}</b>
          </span>
          <span>
            calls <b>{int(data.snapshot.scope.calls)}</b>
          </span>
          <span>
            every figure computed by <b>src/lib/analysis.ts</b> over{' '}
            <b>public/data/snapshot.json</b>
          </span>
        </div>
      </footer>
    </div>
  );
}
