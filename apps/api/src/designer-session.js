export const sessionActive = (session, now = Date.now()) => !!session && Number.isFinite(session.created) && now - session.created < 604800000 && now >= session.created;

export async function resolveDesignerUser(idToken, token) {
  const response = await fetch('https://api.webflow.com/beta/token/resolve', {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({idToken}),
  });
  if (!response.ok) throw Error('Webflow identity verification failed. Enable Authorized User: Read and reconnect once.');
  const user = await response.json();
  if (typeof user.id !== 'string' || !user.id || typeof user.siteId !== 'string' || !user.siteId) throw Error('Webflow did not verify the Designer user and site.');
  return user;
}

export async function designerSession({sessions, sid, idToken, siteId, verify = resolveDesignerUser, sites, persist, now = Date.now()}) {
  if (typeof idToken !== 'string' || !idToken || idToken.length > 16000 || typeof siteId !== 'string' || !siteId || siteId.length > 100) return null;
  const binding = sid && sessionActive(sessions[sid], now);
  const candidates = binding ? [[sid, sessions[sid]]] : Object.entries(sessions)
    .filter(([, session]) => sessionActive(session, now) && session.designer?.siteId === siteId)
    .sort((a, b) => b[1].created - a[1].created).slice(0, 5);
  const deadline = Date.now() + 8000;
  for (const [id, session] of candidates) {
    if (Date.now() >= deadline) break;
    let user;
    try { user = await verify(idToken, session.token); } catch (error) { if (binding) throw error; continue; }
    // Never trust a client-supplied site or use another Designer user's session.
    if (user.siteId !== siteId || (session.designer && session.designer.userId !== user.id)) continue;
    if (!binding && session.designer?.userId !== user.id) continue;
    const authorizedSites = await sites(session.token);
    if (!authorizedSites.some(site => site.id === siteId)) continue;
    if (sessions[id] !== session || !sessionActive(session)) continue;
    if (binding) {session.designer = {userId: user.id, siteId}; await persist();}
    return {session: id, expiresAt: session.created + 604800000};
  }
  return null;
}
