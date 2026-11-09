import test from 'node:test';
import { scoreScript } from '../src/providers.js';
import assert from 'node:assert/strict';
import {providerURL,imageURL,gridChanges,gridShape,challengeProviders,challengeOrigins} from '../src/challenge-common.js';
import {validateTask,validateSolution} from '../shared/protocol.js';
test('challenge fetch permissions reject lookalike domains, credentials and other origins',()=>{
 assert.equal(providerURL('https://www.google.com/recaptcha/api2/bframe'),true);
 assert.equal(providerURL('https://newassets.hcaptcha.com/captcha/v1/challenge.html'),true);
 for(const value of ['https://google.com.evil.test/recaptcha/','https://evil-hcaptcha.com/','http://www.google.com/recaptcha/','https://user:secret@www.google.com/recaptcha/','https://www.google.com/mail/'])assert.equal(providerURL(value),false,value);
 assert.equal(imageURL('https://www.gstatic.com/recaptcha/image.png','https://example.com'),true);
 assert.equal(imageURL('https://example.com/image.png','https://example.com'),true);
 for(const value of ['http://127.0.0.1:47821/health','file:///tmp/image.png','https://example.com.evil/image.png','https://other.example/image.png'])assert.equal(imageURL(value,'https://example.com'),false,value);
});
test('provider access is scoped to the selected adapter, including managed widgets',()=>{
 assert.deepEqual(challengeOrigins(['text-captcha']),[]);
 assert.deepEqual(challengeOrigins(['mtcaptcha']),['https://*.mtcaptcha.com/*']);
 assert.equal(providerURL('https://service.mtcaptcha.com/mtcv1/client/iframe.html',['mtcaptcha']),true);
 assert.equal(providerURL('https://service.mtcaptcha.com/mtcv1/client/iframe.html',['recaptcha-v2']),false);
 assert.equal(providerURL('https://static.geetest.com/captcha/one.png',['geetest-v4']),true);
 assert.equal(providerURL('https://static.geetest.com.evil.test/captcha/one.png',['geetest-v4']),false);
 assert.equal(imageURL('https://static.geetest.com/captcha/one.png','https://example.com',['mtcaptcha']),false);
 assert.throws(()=>challengeProviders(['recaptcha-v3']),/no challenge adapter/);
 assert.throws(()=>challengeProviders([]),/no challenge adapter/);
});
test('grid updates toggle only differences and reject out-of-range outputs',()=>{
 assert.deepEqual(gridChanges([1,4],[false,true,true,false,false,false],6),[2,4]);
 assert.throws(()=>gridChanges([6],[],6),/Invalid/);assert.throws(()=>gridChanges([.5],[],6),/Invalid/);
 const tile=(x,y)=>({getBoundingClientRect:()=>({top:y,left:x,height:80,width:80})});
 const a=tile(0,0),b=tile(80,0),c=tile(0,80),d=tile(80,80);
 const result=gridShape([d,a,c,b]);assert.deepEqual(result,{rows:2,columns:2,tiles:[a,b,c,d]});
 assert.throws(()=>gridShape([a,b,c]),/rectangular/);
});
test('distorted-text and grid-layout contracts preserve only valid output',()=>{
 assert.equal(validateTask({type:'captcha-text',image:'AAAA'}).type,'captcha-text');
 assert.equal(validateTask({type:'grid',image:'AAAA',prompt:'bus',rows:3,columns:3,layout:'scene'}).layout,'scene');
 assert.deepEqual(validateSolution({type:'captcha-text'},{text:' Ab4Cd ',confidence:.9}),{text:'Ab4Cd',confidence:.9});
 assert.throws(()=>validateSolution({type:'captcha-text'},{text:'answer\nexplanation'}),/single short/);
 assert.throws(()=>validateTask({type:'captcha-text',image:'AAAA',minLength:100}),/length/);
 assert.throws(()=>validateSolution({type:'captcha-text',minLength:4},{text:'JMR',confidence:1}),/required length/);
 assert.equal(validateTask({type:'captcha-text',image:'AAAA',minLength:4}).minLength,4);
});
test('invisible v2 and explicit rendering scripts are not mistaken for score-based v3', () => {
  assert.equal(scoreScript('https://www.google.com/recaptcha/api.js?render=explicit'), false);
  assert.equal(scoreScript('https://www.google.com/recaptcha/api.js?render=onload'), false);
  assert.equal(scoreScript('https://www.google.com/recaptcha/api.js?hl=en&render=site-key'), true);
  assert.equal(scoreScript('https://www.recaptcha.net/recaptcha/enterprise.js?render=site-key'), true);
  assert.equal(scoreScript('https://www.google.com.evil.test/recaptcha/api.js?render=site-key'), false);
});
