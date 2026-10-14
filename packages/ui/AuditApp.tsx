import React, {useEffect, useState, useRef} from 'react';
import './audit.css';
type Site = {id: string; displayName?: string; name?: string};
type Scan = {id: string; siteId: string; status: string; createdAt: string; issues?: number; error?: string; pageResults?: {pageId: string; name: string; status: 'passed' | 'issues' | 'skipped'; issues: number; detail: string}[]; findings?: {id: string; title: string; detail: string; fix: string}[]};
type Collection = {id: string; displayName: string; fields?: {slug: string; displayName: string; isRequired?: boolean}[]};
export function AuditApp({designerSite, apiBase = ''}: {designerSite?: {siteId: string; siteName: string}; apiBase?: string}) {
  const [sites, setSites] = useState<Site[]>([]), [siteId, setSiteId] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]), [rules, setRules] = useState<string[]>([]);
  const [history, setHistory] = useState<Scan[]>([]), [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [seo, setSeo] = useState(true), [query, setQuery] = useState(''), [connected, setConnected] = useState(false);
  const authWindow = useRef<Window | null>(null);
  const sessionKey = 'launchguard-session:' + apiBase;
  const [extensionSession, setExtensionSession] = useState(() => designerSite ? sessionStorage.getItem(sessionKey) || '' : '');
  useEffect(() => {
    if (!designerSite || !apiBase) return;
    const listener = (event: MessageEvent) => {
      if (event.origin !== new URL(apiBase).origin || event.source !== authWindow.current || event.data?.type !== 'launchguard-connected' || !/^[a-f0-9]{64}$/.test(event.data.session || '')) return;
      sessionStorage.setItem(sessionKey, event.data.session);
      setExtensionSession(event.data.session);
      authWindow.current = null;
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [apiBase, designerSite?.siteId]);
  const connect = () => {
    setError('');
    authWindow.current = window.open(apiBase + '/auth/start?client_origin=' + encodeURIComponent(window.location.origin), 'launchguard-oauth', 'popup,width=650,height=750');
    if (!authWindow.current) setError('Allow popups for this site, then connect again.');
  };
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(apiBase + '/api' + path, {credentials: designerSite ? 'omit' : 'include', headers: {...(extensionSession ? {Authorization: 'Bearer ' + extensionSession} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {})}, ...(body !== undefined ? {method: 'POST', body: JSON.stringify(body)} : {})});
    const data = await response.json();
    if (response.status === 401) {setConnected(false); setSites([]); if (designerSite) {sessionStorage.removeItem(sessionKey); setExtensionSession('');}}
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
  const refresh = async () => {
    try {
      setError(''); const data = await api('/sites');
      setSites(data.sites); setConnected(true);
      setSiteId(current => designerSite?.siteId || current || data.sites[0]?.id || '');
      setHistory((await api('/scans')).scans);
    } catch (e) {setError((e as Error).message);}
  };
  useEffect(() => {void refresh();}, [designerSite?.siteId, extensionSession]);
  useEffect(() => {
    let active = true; setCollections([]); setRules([]); setScan(null);
    if (siteId) api('/collections?siteId=' + encodeURIComponent(siteId)).then(data => {
      if (active) {setCollections(data.collections); setRules(data.collections.flatMap((c: Collection) => (c.fields || []).filter(f => f.isRequired).map(f => c.id + ':' + f.slug)));}
    }).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [siteId]);
  useEffect(() => {
    if (!scan || !['queued', 'running'].includes(scan.status)) return;
    let active = true;
    const timer = setInterval(() => {api('/scans/' + scan.id).then(data => {
      if (active) {setScan(data.scan); if (!['queued', 'running'].includes(data.scan.status)) void refresh();}
    }).catch(e => {if (active) setError(e.message);});}, 1500);
    return () => {active = false; clearInterval(timer);};
  }, [scan?.id, scan?.status]);
  const run = async () => {
    setBusy(true); setError('');
    try {
      const result = await api('/scans', {siteId, checks: seo ? ['SEO metadata'] : [], rules: rules.map(key => {const [collectionId, fieldSlug] = key.split(':'); return {collectionId, fieldSlug, required: true};})});
      setScan((await api('/scans/' + result.id)).scan);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  const running = !!scan && ['queued', 'running'].includes(scan.status);
  return <main className="audit-app">
    <header><div><h1>LaunchGuard</h1><p>{designerSite ? designerSite.siteName : 'Website audits'}</p></div><button onClick={() => void refresh()}>Refresh</button></header>
    {error && <p role="alert" className="audit-error">{error}</p>}
    {!connected ? <section><h2>Connect Webflow</h2>{designerSite ? <button className="audit-action" onClick={connect}>Connect Webflow</button> : <a className="audit-action" href={apiBase + '/auth/start'}>Connect Webflow</a>}</section> : <>
      <section><h2>New audit</h2><label>Website<select value={siteId} disabled={!!designerSite} onChange={e => setSiteId(e.target.value)}><option value="">Select a site</option>{sites.map(s => <option key={s.id} value={s.id}>{s.displayName || s.name || s.id}</option>)}</select></label>
      <label className="audit-check"><input type="checkbox" checked={seo} onChange={e => setSeo(e.target.checked)}/>Page SEO settings</label>
      <h3>CMS fields to check for missing content</h3>{collections.map(c => <fieldset key={c.id}><legend>{c.displayName}</legend>{(c.fields || []).map(f => {const key = c.id + ':' + f.slug; return <label className="audit-check" key={key}><input type="checkbox" checked={rules.includes(key)} onChange={e => setRules(current => e.target.checked ? [...current, key] : current.filter(x => x !== key))}/>{f.displayName || f.slug}</label>;})}</fieldset>)}
      <button className="audit-action" disabled={busy || running || !siteId || (!seo && !rules.length)} onClick={() => void run()}>{busy ? 'Starting...' : 'Run audit'}</button></section>
      {scan && <section><h2>Page checks</h2>
        {scan.pageResults?.length ? scan.pageResults.map(page => <article key={page.pageId} className={'page-check ' + page.status}>
          <h3>{page.name} <small>{page.status === 'passed' ? 'Passed' : page.status === 'skipped' ? 'Skipped' : `${page.issues} SEO issues`}</small></h3>
          <p role={scan.status === 'complete' && page.status === 'passed' ? 'status' : undefined}>{page.status === 'passed' ? `${page.name}: no issues found in SEO title and description settings.` : page.detail}</p>
        </article>) : <p>{running ? 'Page checks pending.' : 'No page checks recorded in this audit. Run a new audit to see page status.'}</p>}
      </section>}
      {scan && <section><h2>Audit results <small>{scan.status}</small></h2>{scan.error && <p role="alert">{scan.error}</p>}{running && <button onClick={() => api('/scans/' + scan.id + '/cancel', {}).catch(e => setError(e.message))}>Cancel audit</button>}<input aria-label="Search findings" placeholder="Search findings" value={query} onChange={e => setQuery(e.target.value)}/>{(scan.findings || []).filter(f => (f.title + f.detail).toLowerCase().includes(query.toLowerCase())).map(f => <article key={f.id}><h3>{f.title}</h3><p>{f.detail}</p><p>{f.fix}</p></article>)}{scan.status === 'complete' && !scan.findings?.length && <p>No issues found for the selected checks.</p>}</section>}
      <section><h2>Scan history</h2>{history.length ? history.filter(s => s.siteId === siteId).map(s => <button className="audit-history" key={s.id} onClick={() => api('/scans/' + s.id).then(data => setScan(data.scan)).catch(e => setError(e.message))}><span>{new Date(s.createdAt).toLocaleString()}</span><span>{s.status} · {s.issues || 0} issues</span></button>) : <p>No audits yet.</p>}</section>
    </>}
  </main>;
}
