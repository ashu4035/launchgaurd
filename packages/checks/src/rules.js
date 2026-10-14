/** Pure fixture-safe checks; no network requests or access to private Webflow data. */
export function checkRequiredField(item, fieldSlug, required) {
 if(!required)return {status:'not applicable'};
 const value=item?.fieldData?.[fieldSlug];
 return value===undefined||value===null||(typeof value==='string'&&!value.trim())?{status:'issue',rule:'required-field',fieldSlug}:{status:'pass',rule:'required-field',fieldSlug};
}
export function classifyHttpResult(result) {
 if(result?.timeout||result?.blocked||result?.error)return 'could not verify';
 if(typeof result?.status!=='number')return 'could not verify';
 if(result.status===404||result.status===410)return 'issue';
 if(result.status>=200&&result.status<400)return 'pass';
 return 'could not verify';
}
export function groupFindings(items){const grouped=new Map();for(const item of items){const key=[item.ruleId,item.templateId??item.itemId??item.pageId??item.id,item.fieldSlug??'',item.locale??''].join(':');const group=grouped.get(key);if(group)group.affected.push(item);else grouped.set(key,{key,representative:item,affected:[item]});}return [...grouped.values()];}
