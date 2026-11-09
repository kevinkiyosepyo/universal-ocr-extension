import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createSolverServer } from '../server/app.mjs';
import { SolverClient } from '../shared/client.js';
const path=process.argv[2];if(!path)throw new Error('Usage: node scripts/benchmark.mjs path/to/samples.json');
const samples=JSON.parse(await readFile(path,'utf8'));if(!Array.isArray(samples)||samples.length>100)throw new Error('Use an array of at most 100 sample descriptions.');
const key=randomBytes(32).toString('hex');
const {server}=createSolverServer({key,cache:false,model:process.env.OCR_VISION_MODEL||'qwen3-vl:4b-instruct',ollamaEndpoint:process.env.OCR_OLLAMA_ENDPOINT||'http://127.0.0.1:11435'});server.listen(0,'127.0.0.1');await once(server,'listening');
const client=new SolverClient({key,endpoint:`http://127.0.0.1:${server.address().port}`}),report=[];
try{
 for(const sample of samples){const started=Date.now();try{let image=sharp(resolve(dirname(path),sample.file));if(sample.crop)image=image.extract(sample.crop);const bytes=await image.png().toBuffer();const result=await client.solve({...sample.task,image:bytes.toString('base64')});let passed=null;if(sample.expected){try{for(const [key,value]of Object.entries(sample.expected))assert.deepEqual(result[key],value);passed=true}catch{passed=false}}
 const item={name:sample.name,result,expected:sample.expected,passed,elapsedMs:Date.now()-started};report.push(item);console.log(JSON.stringify(item));
 }catch(error){const item={name:sample.name,passed:false,error:error.message,elapsedMs:Date.now()-started};report.push(item);console.log(JSON.stringify(item));}}
 await mkdir('output/benchmark',{recursive:true});await writeFile('output/benchmark/report.json',JSON.stringify({model:process.env.OCR_VISION_MODEL||'qwen3-vl:4b-instruct',cache:false,results:report},null,2)+'\n');
 if(report.some(item=>item.passed===false))process.exitCode=1;
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
