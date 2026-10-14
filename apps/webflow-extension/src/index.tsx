import React, {useEffect, useState} from "react";
import ReactDOM from "react-dom/client";
import {AuditApp} from '../../../packages/ui/AuditApp';
declare const __LAUNCHGUARD_API__: string;

const App: React.FC = () => {
  const [site, setSite] = useState<{siteId: string; siteName: string}>();
  const [error, setError] = useState('');
  useEffect(() => {
    void webflow.setExtensionSize('large').catch(error => console.warn('Could not resize LaunchGuard', error));
    webflow.getSiteInfo().then(setSite).catch(() => setError('Open LaunchGuard inside Webflow Designer to access the current site.'));
  }, []);
  return error ? <p role="alert">{error}</p> : site ? <AuditApp designerSite={site} apiBase={__LAUNCHGUARD_API__}/> : <p>Loading site...</p>;
};

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Could not find element with id "root"');
}
const root = ReactDOM.createRoot(rootEl);
root.render(<App />);
