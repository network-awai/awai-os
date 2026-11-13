import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bbJSON} from '../database.mjs';

test('conversation result uses the canonical Muse terminal and rejects tool or ambiguous runs', async()=>{
 const model='muse-spark-1.3',run='synthetic-run';
 const row=(payload_type,payload,sequence)=>({payload_type,sequence,payload:{run_stream:{id:run},...payload}});
 const events=[row('run.model.configured',{provider_id:'meta',model_id:model},1),row('run.usage',{input_tokens:10,output_tokens:2},2),row('run.terminal.completed',{terminal:'completed',text:'Synthetic parser fixture'},3)];
 const parse=rows=>bbJSON(process.env.BB_BIN??'bb',['-m','itonami-chat.result'],{events:rows,exitCode:0,model});
 const accepted=await parse(events);assert.equal(accepted.state,'completed');assert.equal(accepted['muse-run-id'],run);assert.equal(accepted.usage.input_tokens,10);
 assert.equal((await parse(events.slice(0,2))).state,'unknown');
 assert.equal((await parse([...events,row('tool.called',{},4)])).state,'unknown');
 assert.equal((await parse([...events,row('run.model.configured',{provider_id:'meta',model_id:model,run_stream:{id:'other-run'}},4)])).state,'unknown');
});
