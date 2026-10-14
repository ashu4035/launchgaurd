// Loaded only by the integration test's child process.
globalThis.fetch = async input => {
  const path = new URL(input).pathname;
  const data = {
    '/v2/sites': {sites: [{id: 'site-one', displayName: 'Test site'}]},
    '/v2/sites/site-one/collections': {collections: [{id: 'collection-one', displayName: 'Services'}]},
    '/v2/collections/collection-one': {id: 'collection-one', displayName: 'Services', fields: [{slug: 'summary', displayName: 'Summary', isRequired: true}]},
    '/v2/collections/collection-one/items': {items: [{id: 'item-one', fieldData: {name: 'Design', summary: ''}}]},
    '/v2/sites/site-one/pages': {pages: [{id: 'page-one', title: 'About', seo: {title: 'About', description: ''}}, {id: 'home', title: 'Home', seo: {title: 'Home', description: 'Welcome'}}, {id: 'draft', title: 'Draft', draft: true}]},
  }[path];
  return new Response(JSON.stringify(data || {}), {status: data ? 200 : 404});
};
