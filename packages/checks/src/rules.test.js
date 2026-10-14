import test from 'node:test';import assert from 'node:assert/strict';import {checkRequiredField,classifyHttpResult,groupFindings} from './rules.js';
test('required field: blank is issue',()=>assert.equal(checkRequiredField({fieldData:{'seo-description':''}},'seo-description',true).status,'issue'));
test('optional field: blank allowed',()=>assert.equal(checkRequiredField({fieldData:{summary:''}},'summary',false).status,'not applicable'));
test('required field: filled passes',()=>assert.equal(checkRequiredField({fieldData:{summary:'Done'}},'summary',true).status,'pass'));
test('404 is broken; timeout is unverified',()=>{assert.equal(classifyHttpResult({status:404}),'issue');assert.equal(classifyHttpResult({timeout:true}),'could not verify')});
test('one template cause aggregates affected pages',()=>assert.equal(groupFindings([{ruleId:'headings',templateId:'services',pageId:'1'},{ruleId:'headings',templateId:'services',pageId:'2'}])[0].affected.length,2));
