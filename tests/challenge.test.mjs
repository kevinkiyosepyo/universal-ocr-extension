import test from 'node:test';
import assert from 'node:assert/strict';
import {providerURL,imageURL,gridChanges,gridShape} from '../src/challenge-common.js';
import {validateTask,validateSolution} from '../shared/protocol.js';
test('challenge fetch permissions reject lookalike domains, credentials and other origins',()=>{
 assert.equal(providerURL('https://www.google.com/recaptcha/api2/bframe'),true);
 assert.equal(providerURL('https://newassets.hcaptcha.com/captcha/v1/challenge.html'),true);
 for(const value of ['https://google.com.evil.test/recaptcha/','https://evil-hcaptcha.com/','http://www.google.com/recaptcha/','https://user:secret@www.google.com/recaptcha/','https://www.google.com/mail/'])assert.equal(providerURL(value),false,value);
 assert.equal(imageURL('https://www.gstatic.com/recaptcha/image.png','https://example.com'),true);
 assert.equal(imageURL('https://example.com/image.png','https://example.com'),true);
 for(const value of ['http://127.0.0.1:47821/health','file:///tmp/image.png','https://example.com.evil/image.png','https://other.example/image.png'])assert.equal(imageURL(value,'https://example.com'),false,value);
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
});
