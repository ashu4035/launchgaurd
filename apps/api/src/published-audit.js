import {load} from 'cheerio';
import robotsParser from 'robots-parser';
import {XMLParser} from 'fast-xml-parser';
import {normalizeUrl, safeRead} from './safe-http.js';
import {resourceStatus} from './resource-checks.js';
import {inspectRendered} from './rendered-checks.js';
import {captureVisualEvidence,visualTarget} from './visual-evidence.js';

export const PUBLISHED_CHECKS = ['Published SEO', 'Internal links', 'Download links', 'Image loading', 'Image alt text', 'Headings', 'Contact details', 'Indexing policy', 'Rendered DOM', 'Visual evidence'];
export function inspectHtml(html, url) {
  const $ = load(html);
  const base = normalizeUrl($('base[href]').first().attr('href'), url) || url;
  const images = $('img').toArray().map(el => ({url: normalizeUrl($(el).attr('src') || $(el).attr('data-src'), base), alt: $(el).attr('alt'), decorative: $(el).attr('role') === 'presentation' || $(el).attr('aria-hidden') === 'true'}));
  const links = $('a[href]').toArray().map(el => {
    const href = $(el).attr('href');
    return {url: normalizeUrl(href, base), text: $(el).text().trim().slice(0, 120), fragment: (() => {try {return new URL(href, base).hash;} catch {return '';}})(), download: $(el).attr('download') !== undefined || /\.(pdf|zip|docx?|xlsx?|pptx?|csv)(?:$|\?)/i.test(href)};
  }).filter(link => link.url);
  const text = $('body').clone(); text.find('script,style,noscript').remove();
  return {title: $('title').first().text().trim(), description: $('meta[name="description" i]').first().attr('content')?.trim() || '', robots: $('meta[name="robots" i]').attr('content') || '', h1: $('h1').length, images, links, text: text.text().replace(/\s+/g, ' ').trim(), ids: new Set($('[id]').toArray().map(el => $(el).attr('id')))};
}
function statusOf(response) {
  if (!response.verified || !response.status) return 'Could not verify';
  if ([404, 410].includes(response.status)) return 'Issue';
  if (response.status >= 200 && response.status < 300) return 'Pass';
  return 'Could not verify';
}
export async function auditPublished({site, pages, job, emit, persist, read = safeRead}) {
  const checks = new Set(job.checks);
  if (!PUBLISHED_CHECKS.some(check => checks.has(check))) return;
  const domains = (site.customDomains || []).map(domain => {const value=domain.url||domain.name||'';return normalizeUrl(value.startsWith('https://')?value:'https://'+value);}).filter(Boolean);
  const staging = site.shortName ? normalizeUrl(`https://${site.shortName}.webflow.io`) : null;
  const origin = job.environment === 'Live' ? domains[0] : staging;
  job.coverage = {requested: 0, checked: 0, skipped: 0, unverified: 0, requests: 0, limited: false};
  job.publishedResults = [];
  if (!origin) {job.coverage.unverified++; emit('published-site', {status: 'Could not verify', source: 'Page', title: 'Published site URL unavailable', detail: 'No verified publishing domain was returned by Webflow.', fix: 'Publish this site to staging or connect a live domain.'}); return;}
  const root = new URL(origin).origin;
  const permittedOrigins=new Set(job.environment==='Live'?domains.map(domain=>new URL(domain).origin):[root]);
  const cache = new Map(); const maxRequests = job.limits?.requests || 300;
  const start = Date.now();
  const request = async url => {
    if (job.cancelled) return {verified: false, error: 'Scan cancelled'};
    if (cache.has(url)) return cache.get(url);
    if (job.coverage.requests >= maxRequests || Date.now() - start > 180000) {job.coverage.limited = true; return {verified: false, error: 'Scan request or time limit reached'};}
    job.coverage.requests++;
    const result = await read(url);
    cache.set(url, result); return result;
  };
  const robotsUrl = root + '/robots.txt';
  const robotsResponse = await request(robotsUrl);
  const robots = robotsResponse.status === 200 ? robotsParser(robotsUrl, robotsResponse.bytes.toString()) : null;
  const robotsUnknown = !robotsResponse.verified || (robotsResponse.status !== 200 && robotsResponse.status !== 404);
  const selectedPages = pages.filter(page => !job.scope?.pageIds?.length || job.scope.pageIds.includes(page.id));
  const queue = new Map();
  for (const page of selectedPages) {
    if (page.draft || page.archived || page.collectionId) {job.coverage.skipped++; continue;}
    const path = page.publishedPath || (page.slug === '' || page.slug === 'index' ? '/' : null);
    const url = path ? normalizeUrl(path, root) : null;
    if (url && new URL(url).origin === root) queue.set(url, {name: page.title || page.slug || 'Home', pageId: page.id, locale: page.localeId});
    else {job.coverage.unverified++; emit('published-url', {status: 'Could not verify', source: 'Page', pageId: page.id, page: page.title, title: 'Published URL unavailable', detail: 'The API did not return a usable published path.', fix: 'Publish the page and run the audit again.'});}
  }
  if (!job.scope?.pageIds?.length) {
    const sitemap = await request(root + '/sitemap.xml');
    if (sitemap.status === 200) {
      try {
        const text=sitemap.bytes.toString();
        if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Sitemap DTDs are not supported');
        const xml = new XMLParser({processEntities:false}).parse(text);
        const entries = xml.urlset?.url; const rows = entries ? (Array.isArray(entries) ? entries : [entries]) : [];
        for (const entry of rows.slice(0, 1000)) {const url = normalizeUrl(entry.loc); if (url && permittedOrigins.has(new URL(url).origin) && !queue.has(url)) queue.set(url, {name: new URL(url).pathname});}
      } catch {job.coverage.unverified++;}
    }
  }
  if (job.scope?.publishedUrls?.length) for (const url of queue.keys()) if (!job.scope.publishedUrls.includes(url)) queue.delete(url);
  const maximum = job.limits?.pages || 50;
  job.coverage.requested = queue.size;
  const metadata = [];
  let renderedPages=0;
  let visualPages=0,visualFindings=0;
  for (const [url, location] of queue) {
    if (job.cancelled) break;
    if (job.coverage.checked + job.publishedResults.filter(r => r.status === 'Could not verify').length >= maximum) {job.coverage.limited = true; break;}
    const before = job.findings.length;
    const context = {source: 'Page', url, page: location.name, pageId: location.pageId, locale: location.locale};
    if (robotsUnknown || robots?.isAllowed(url, 'LaunchGuard') === false) {
      job.coverage.skipped++;
      job.publishedResults.push({...location, url, status: 'Skipped', detail: robotsUnknown ? 'Could not verify robots.txt policy' : 'Excluded by robots.txt'}); await persist(); continue;
    }
    const response = await request(url);
    if (statusOf(response) !== 'Pass' || !/text\/html|application\/xhtml/i.test(response.contentType || '')) {
      const status = statusOf(response) === 'Issue' ? 'Issue' : 'Could not verify';
      emit('page-loading', {...context, status, title: 'Published page could not be loaded', detail: response.error || `HTTP ${response.status}; ${response.contentType || 'unknown content type'}`, fix: 'Check the published page URL, access restrictions and publishing status.'});
      job.coverage.unverified++; job.publishedResults.push({...location, url, status, detail: response.error || `HTTP ${response.status}`}); await persist(); continue;
    }
    if (!permittedOrigins.has(new URL(response.url || url).origin)) {job.coverage.unverified++; job.publishedResults.push({...location, url, status: 'Could not verify', detail: 'Page redirected outside the authorized publishing origin'}); continue;}
    const parsed = inspectHtml(response.bytes.toString(), response.url || url);
    if(checks.has('Rendered DOM')){
      const rendered=renderedPages>=3?{verified:false,error:'Rendered checks are limited to three pages per audit'}:await inspectRendered(response.url||url,{read:request});renderedPages++;
      if(!rendered.verified)emit('rendered-dom',{...context,status:'Could not verify',title:'Rendered DOM was not verified',detail:rendered.error,fix:'Enable the isolated Chromium runtime or select at most three pages and recheck.'});
      else{
        if(!rendered.title||!rendered.description)emit('rendered-metadata',{...context,title:'Rendered SEO metadata is missing',detail:'The browser DOM is missing a title or description.',fix:'Review JavaScript or template metadata, publish and recheck.'});
        if(rendered.h1!==1)emit('rendered-h1',{...context,status:'Warning',title:'Rendered H1 structure needs attention',detail:`The browser found ${rendered.h1} H1 headings.`,fix:'Review the rendered heading structure in Designer.'});
        for(const image of rendered.images){if(image.missingAlt)emit('rendered-alt',{...context,resourceUrl:image.url,title:'Rendered image has no alt attribute',detail:'The browser DOM image is not marked decorative and lacks alt text.',fix:'Add alternative text or mark the image decorative.'});if(!image.loaded)emit('rendered-image',{...context,resourceUrl:image.url,status:'Could not verify',title:'Rendered image did not finish loading',detail:'The browser could not confirm a decoded image at load time; lazy loading may be intentional.',fix:'Inspect the image and lazy-loading behavior on the published page.'});}
      }
    }
    metadata.push({...context, titleValue: parsed.title, descriptionValue: parsed.description});
    if (checks.has('Published SEO')) {
      if (!parsed.title) emit('published-title', {...context, severity: 'High', title: 'Published page title is missing', detail: 'The published HTML has no non-empty title element.', fix: 'Set the page or CMS template SEO title, publish, then recheck.'});
      if (!parsed.description) emit('published-description', {...context, title: 'Published description is missing', detail: 'The published HTML has no non-empty meta description.', fix: 'Set the page or CMS template description, publish, then recheck.'});
    }
    if (checks.has('Headings') && parsed.h1 !== 1) emit('heading-h1', {...context, status: 'Warning', title: parsed.h1 ? 'Multiple H1 headings' : 'H1 heading is missing', detail: `Found ${parsed.h1} H1 elements in published HTML.`, fix: 'Review the page heading structure in Designer and publish the intended heading.'});
    if (checks.has('Indexing policy')) {
      const noindex = /(?:^|[,\s])noindex(?:$|[,\s])/i.test(parsed.robots+','+(response.robotsHeader||''));
      const expected = job.environment === 'Staging' ? job.policy?.stagingNoindex !== false : false;
      if (noindex !== expected) emit('indexing-policy', {...context, status: 'Warning', title: expected ? 'Staging page permits indexing' : 'Live page has noindex', detail: `Published robots meta: ${parsed.robots || 'not set'}`, fix: 'Review the selected environment indexing policy and page settings before publishing.'});
    }
    if (checks.has('Contact details')) for (const value of job.policy?.contacts || []) if (!parsed.text.toLowerCase().includes(value.toLowerCase())) emit('contact-details', {...context, status: 'Warning', title: 'Configured contact detail was not found', detail: 'An owner-configured text value was not found in this page HTML.', fix: 'Check the configured contact details and their visibility on this page.'});
    if (checks.has('Image alt text')) for (const image of parsed.images) if (image.alt === undefined && !image.decorative) emit('image-alt', {...context, resourceUrl: image.url, title: 'Image has no alt attribute', detail: 'The published image lacks an alt attribute and is not marked decorative.', fix: 'Add meaningful alternative text or explicitly mark the image decorative in Designer.'});
    for (const image of checks.has('Image loading') ? parsed.images : []) {
      if (!image.url) {emit('image-loading', {...context, status: 'Could not verify', title: 'Image source unavailable', detail: 'No resolvable image source was found in the HTML.', fix: 'Check the image source or lazy-loading configuration.'}); continue;}
      const result = await request(image.url); const status = resourceStatus(result, 'image', image.url);
      if (status !== 'Pass') emit('image-loading', {...context, source: 'Asset', resourceUrl: image.url, status, title: status === 'Issue' ? 'Image URL is broken or returns non-image content' : 'Image could not be verified', detail: result.error || `HTTP ${result.status}; ${result.contentType || 'unknown type'}`, fix: 'Inspect the image source, replace missing assets, publish and recheck.'});
    }
    for (const link of parsed.links) {
      const internal = permittedOrigins.has(new URL(link.url).origin);
      if (!(link.download && checks.has('Download links')) && !(internal && checks.has('Internal links'))) continue;
      if (internal && robots?.isAllowed(link.url, 'LaunchGuard') === false) {job.coverage.skipped++; continue;}
      const result = await request(link.url); let status = resourceStatus(result, link.download ? 'download' : 'link', link.url);
      if (status === 'Pass' && link.fragment && /text\/html/i.test(result.contentType)) {
        let fragment; try {fragment = decodeURIComponent(link.fragment.slice(1));} catch {fragment = link.fragment.slice(1);}
        if (fragment && !inspectHtml(result.bytes.toString(), link.url).ids.has(fragment)) status = 'Issue';
      }
      if (status !== 'Pass') emit(link.download ? 'download-link' : 'internal-link', {...context, resourceUrl: link.url + link.fragment, status, title: link.download ? 'Download could not be verified or is broken' : 'Internal link is broken or could not be verified', detail: result.error || `HTTP ${result.status}; link text: ${link.text || '(empty)'}`, fix: link.download ? 'Check the download target and expected file, then replace or remove the link.' : 'Correct the destination URL or fragment in Designer or CMS, publish and recheck.'});
    }
    if(checks.has('Visual evidence')){
      const pageFindings=job.findings.slice(before);
      for(const finding of pageFindings)finding.visualEvidence={status:'Unavailable',reason:visualTarget(finding)?'Screenshot capture limit reached.':'This rule has no uniquely identifiable visible element.',captures:[]};
      const candidates=pageFindings.filter(visualTarget).slice(0,Math.max(0,4-visualFindings));
      if(candidates.length&&visualPages<2&&!job.cancelled){
        job.progress.phase='Visual evidence';await persist();
        const evidence=await captureVisualEvidence(response.url||url,candidates,{read:request,cancelled:()=>job.cancelled});
        for(const finding of candidates)finding.visualEvidence=evidence.get(finding.id);
        visualPages++;visualFindings+=candidates.length;
      }
      if(pageFindings.some(f=>visualTarget(f)&&f.visualEvidence.captures.length<2))job.visualEvidencePartial=true;
    }
    job.coverage.checked++;
    const added = job.findings.slice(before);
    job.publishedResults.push({...location, url, status: added.some(f => f.status === 'Issue') ? 'Issue' : added.some(f => f.status === 'Could not verify') ? 'Could not verify' : added.length ? 'Warning' : 'Pass', detail: `${added.length} findings from selected checks`});
    await persist();
  }
  if (checks.has('Published SEO')) for (const key of ['titleValue', 'descriptionValue']) {
    const groups = new Map();
    for (const item of metadata) {const value = item[key].toLowerCase(); if (!value) continue; const list = groups.get(value) || []; list.push(item); groups.set(value, list);}
    for (const items of groups.values()) if (items.length > 1) emit('duplicate-' + key, {...items[0], status: 'Warning', title: key === 'titleValue' ? 'Duplicate published titles' : 'Duplicate published descriptions', detail: `The same metadata appears on ${items.length} checked pages.`, affectedUrls: items.map(item => item.url), fix: 'Review each page or CMS template metadata and publish unique values where appropriate.'});
  }
  if (job.coverage.limited) emit('scan-limit', {status: 'Could not verify', source: 'Page', title: 'Published scan reached its limit', detail: 'Some requested pages or resources were not verified.', fix: 'Select a smaller scope and rerun the audit.'});
}
