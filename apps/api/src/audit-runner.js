import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {auditPublished} from './published-audit.js';
import {normalizeUrl, safeRead} from './safe-http.js';
import {resourceStatus} from './resource-checks.js';

export function isEmpty(value, type) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return 'url' in value ? !value.url : Object.keys(value).length === 0;
  if (typeof value === 'string' && type === 'RichText') {
    const $ = load(value); return !$.text().replace(/\u00a0/g, ' ').trim() && !$('img,video,audio,iframe,wf-component').length;
  }
  return typeof value === 'string' && !value.trim();
}
export async function runAudit(job, {api, all, persist, token, read = safeRead}) {
  const started = Date.now();
  job.findings = []; job.pageResults = []; job.publishedResults = []; job.coverage = null;
  job.progress = {phase: 'Inventory', collections: 0, items: 0, pages: 0, checked: 0, skipped: 0, unverified: 0};
  const emit = (ruleId, props) => {
    const identity = [job.siteId, job.environment, ruleId, props.collectionId, props.itemId, props.pageId || props.url, props.field, props.resourceUrl, props.locale].join('|');
    const id = createHash('sha256').update(identity).digest('hex').slice(0, 24);
    if (job.findings.some(f => f.id === id)) return;
    job.findings.push({id, ruleId, ruleVersion: 1, scanId: job.id, timestamp: new Date().toISOString(), siteId: job.siteId, environment: job.environment, status: 'Issue', severity: 'Medium', ...props});
  };
  const sites = await all('/sites', 'sites', token);
  const site = sites.find(site => site.id === job.siteId);
  if (!site) throw Error('Site access revoked');
  job.siteName = site.displayName || site.name || site.id;
  const collections = await all(`/sites/${job.siteId}/collections`, 'collections', token);
  let assetRequests = 0;
  for (const collection of collections) {
    if (job.scope?.skipCMS) break;
    if (job.cancelled) break;
    if (job.scope?.collectionIds?.length && !job.scope.collectionIds.includes(collection.id)) continue;
    job.progress.collections++;
    const detail = await api(`/collections/${collection.id}`, token);
    const fields = new Map((detail.fields || []).map(field => [field.slug, field]));
    const rules = job.rules.filter(rule => rule.collectionId === collection.id && rule.required);
    for (const rule of rules) if (!fields.has(rule.fieldSlug)) throw Error('Configured field is not present in this collection');
    if (!rules.length && !job.checks.includes('CMS assets')) continue;
    const items = await all(`/collections/${collection.id}/items`, 'items', token);
    for (const item of items) {
      if (job.cancelled) break;
      if (job.scope?.itemIds?.length && !job.scope.itemIds.includes(item.id)) continue;
      if (job.progress.items >= 2000) {emit('cms-limit', {status: 'Could not verify', source: 'CMS', title: 'CMS item limit reached', detail: 'The scan checks up to 2,000 selected items.', fix: 'Select fewer collections or items and recheck.'}); return;}
      job.progress.items++;
      const context = {source: 'CMS', collection: collection.displayName, collectionId: collection.id, item: item.fieldData?.name || item.fieldData?.slug || item.id, itemId: item.id, locale: item.cmsLocaleId, isDraft: !!item.isDraft, isArchived: !!item.isArchived, location: 'Saved CMS content'};
      for (const rule of rules) {
        const field = fields.get(rule.fieldSlug);
        job.progress.checked++;
        if (isEmpty(item.fieldData?.[rule.fieldSlug], field.type)) emit('required-field', {...context, field: rule.fieldSlug, fieldName: field.displayName, observed: 'Empty', expected: 'Configured field must have saved content', title: `${field.displayName || rule.fieldSlug} is empty`, detail: 'The selected saved-content rule requires a value in this field.', fix: `Open CMS, choose ${collection.displayName}, open ${context.item}, complete ${field.displayName || rule.fieldSlug}, and save.`});
      }
      if (job.checks.includes('CMS assets')) for (const field of fields.values()) {
        if (!['Image', 'MultiImage', 'File', 'Link'].includes(field.type)) continue;
        const value = item.fieldData?.[field.slug]; if (isEmpty(value, field.type)) continue;
        const urls = (Array.isArray(value) ? value : [value]).map(value => normalizeUrl(typeof value === 'string' ? value : value?.url)).filter(Boolean);
        if(!urls.length){if(field.type==='Link'&&typeof value==='string'&&/^(mailto:|tel:)/i.test(value)){job.progress.skipped++;continue;}job.progress.unverified++;emit('cms-asset-url',{...context,field:field.slug,status:'Could not verify',title:'Saved resource URL is not supported',detail:'The configured resource has no supported public HTTP URL.',fix:'Review the saved resource field in CMS.'});}
        for (const url of urls) {
          if (assetRequests >= 100 || Date.now()-started>120000) {job.progress.unverified++; emit('cms-asset-limit', {...context, status: 'Could not verify', title: 'CMS asset request limit reached', detail: 'Remaining saved asset URLs were not checked.', fix: 'Select fewer CMS items and recheck.'}); break;}
          assetRequests++;
          const result = await read(url, {maxBytes: 1000000}); job.progress.checked++;
          const status = resourceStatus(result, ['Image', 'MultiImage'].includes(field.type) ? 'image' : field.type === 'File' ? 'download' : 'link', url);
          if (status !== 'Pass') {if (status === 'Could not verify') job.progress.unverified++; emit('cms-asset', {...context, field: field.slug, fieldName: field.displayName, resourceUrl: url, status, title: `${field.displayName || field.slug} URL needs attention`, detail: result.error || `HTTP ${result.status}; ${result.contentType || 'unknown type'}`, fix: `Open CMS, choose ${collection.displayName}, open ${context.item}, inspect ${field.displayName || field.slug}, and replace the URL or asset if needed.`});}
        }
      }
    }
    await persist();
  }
  const pages = await all(`/sites/${job.siteId}/pages`, 'pages', token);
  job.progress.phase = 'Page settings';
  for (const page of pages) {
    if (job.scope?.skipPages) break;
    if (job.cancelled) break;
    if (job.scope?.pageIds?.length && !job.scope.pageIds.includes(page.id)) continue;
    job.progress.pages++;
    const context = {source: 'Page', page: page.title || page.slug || 'Home', pageId: page.id, locale: page.localeId};
    const result = {pageId: page.id, name: context.page, status: 'skipped', issues: 0, detail: 'Page settings check not selected'};
    if (page.draft || page.archived) {result.detail = 'Unpublished draft or archived page'; job.progress.skipped++;}
    else if (job.checks.includes('SEO metadata')) {
      const before = job.findings.length;
      for (const field of ['title', 'description']) {
        job.progress.checked++;
        if (!page.seo?.[field]) emit('missing-' + field, {...context, status: page.collectionId ? 'Could not verify' : 'Issue', title: `Page SEO ${field} setting is empty`, detail: page.collectionId ? 'This is a CMS template. Published metadata may be supplied dynamically; use Published SEO to verify it.' : 'The saved page SEO setting is empty. Published fallback is checked separately.', fix: 'Review page or template SEO settings. Publish changes and run Published SEO to verify the actual metadata.'});
      }
      result.issues = job.findings.slice(before).filter(f => f.status === 'Issue').length;
      result.status = job.findings.length > before ? result.issues ? 'issues' : 'unverified' : 'passed';
      result.detail = result.status === 'passed' ? 'SEO title and description settings are present' : 'Review the findings for this page';
    }
    job.pageResults.push(result);
  }
  await persist(); job.progress.phase = 'Published content';
  if(!job.scope?.skipPages)await auditPublished({site, pages, job, emit, persist, read});
  if(!job.progress.checked&&!job.coverage?.checked&&!job.findings.length)emit('no-coverage',{status:'Could not verify',source:'Page',title:'No applicable checks completed',detail:'The selected scope did not contain targets for the enabled checks.',fix:'Select CMS field rules for CMS-only scope, or include published pages.'});
  job.partial = !!job.coverage?.limited || !!job.coverage?.unverified || !!job.coverage?.skipped || job.findings.some(f => f.status === 'Could not verify');
  job.progress.phase = job.cancelled ? 'Cancelled' : 'Finished';
}
