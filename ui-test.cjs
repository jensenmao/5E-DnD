// Local browser regression harness; all API replies and storage are in memory.
// Run: node ui-test.cjs, then open http://127.0.0.1:3001.
const http = require('node:http');
const fs = require('node:fs');
const { makeCharacter } = require('./server');
const sample = makeCharacter({ name:'艾琳', race:'human', class:'fighter', background:'soldier', backstory:'我在寻找失踪的哥哥。他留给我的银色徽章，指向北境的旧灯塔。', scores:{STR:15,DEX:14,CON:13,INT:12,WIS:10,CHA:8} });
sample.history = [{role:'dm',text:'雨停在黄昏之前。\n\n你沿着旧商道走进灰港，靴底还沾着北境的泥。街角的酒馆亮起第一盏灯，而门前的告示上，画着一枚你再熟悉不过的银色徽章。\n\n“你也在找那座灯塔？”门边的老人抬起头。他握着一封没有寄出的信。'}, {role:'player',text:'我取出哥哥的徽章，询问老人这封信的来历。'}, {role:'dm',text:'老人凝视着徽章，神情忽然变得凝重。\n\n“这封信等了三年。”他将信封推到灯下，封蜡上是同样的纹章。“如果你要去灯塔，最好赶在潮水上涨之前。”\n\n远处，雾里的钟声响了三下。'}];
sample.journal = '灰港：调查银色徽章与北境灯塔之间的联系。';
sample.inventory = ['长剑','盾牌','银色徽章','未拆封的信'];
const isolatedStorage = `<script>const testStorage=new Map();Storage.prototype.getItem=function(k){return testStorage.get(k)||null};Storage.prototype.setItem=function(k,v){testStorage.set(k,String(v))};</script>`;
const checks = `<script>
(async()=>{
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const sample=${JSON.stringify(sample)};
 $('provider').value='llmgateway';$('provider').onchange();
 assert($('baseUrl').value==='https://api.llmgateway.io/v1','gateway address');
 $('provider').value='anthropic';$('provider').onchange();
 assert($('baseUrl').value==='https://api.anthropic.com/v1','anthropic address');
 await request({kind:'start'});
 assert(!$('setupError').hidden,'missing key error');
 $('key').value='test-only';
 window.fetch=async()=>({ok:true,json:async()=>({state:structuredClone(sample),options:['询问信的内容','前往北境灯塔']})});
 await request({kind:'start'});
 assert(!$('game').hidden && $('setup').hidden,'start view');
 assert(!localStorage.getItem('dnd5e-config').includes('test-only'),'key not saved');
 assert($('choices').children.length===4 && $('choices').hidden,'four options start hidden');
 $('choices').firstChild.click();assert($('action').value==='询问信的内容','choice fills action');
 state.combat={enemy:{name:'迷雾中的守卫',hp:12,ac:14}};render();
 assert(document.querySelector('.composer').hidden && !$('battlebar').hidden,'combat focus');
 setBusy(true);assert(!$('gameBusy').hidden && $('settings').disabled,'combat busy state');
 assert([...$('battlebar').children].every(b=>b.disabled),'busy disables combat');setBusy(false);
 state.hp=0;render();assert($('battlebar').textContent==='进行死亡豁免','death action');
 state=structuredClone(sample);render();$('settings').click();$('resume').click();
 assert(state.hp===sample.hp && !$('game').hidden,'resume stored character');
 assert(!document.querySelector('.composer').hidden,'exploration composer restored');
 window.fetch=async()=>({ok:false,json:async()=>({error:'测试：接口暂不可用'})});
 $('action').value='保留这段尚未提交的行动';await request({kind:'explore'});
 assert(!$('gameError').hidden && $('action').value==='保留这段尚未提交的行动','failed request preserves action');
 clearError();$('action').value='';render(['询问信的内容','前往北境灯塔']);
 const exported=makeSave(true),withoutKey=makeSave(false);
 assert(!withoutKey.includes('test-only'),'optional key exclusion');
 state=null;$('key').value='';restoreSave(parseSave(exported));
 assert(state.name===sample.name && $('key').value==='test-only' && !$('game').hidden,'file restores key and game');
 assert($('choices').children.length===4,'file restores choices');
 assert(!localStorage.getItem('dnd5e-config').includes('test-only'),'import never persists key to browser');
 state.combat={enemy:{name:'地精',hp:7,ac:12,attack:2,damageCount:1,damageSides:6,damageBonus:1,dexSave:2,xp:50},dodge:false,advantage:true};state.hp=0;render();
 const fighting=makeSave(true);state=null;restoreSave(parseSave(fighting));
 assert(state.combat.advantage && $('battlebar').textContent==='进行死亡豁免','file restores combat and unconscious state');
 restoreSave(parseSave(withoutKey));
 assert(!$('setup').hidden && $('key').value==='' && !$('setupError').hidden,'file without key requests key');
 const before=JSON.stringify(state);try{restoreSave({format:'invalid'})}catch{}
 assert(JSON.stringify(state)===before,'invalid import preserves state');
 restoreSave(parseSave(exported));
 document.body.dataset.tests='passed';document.title='UI checks passed · 旅途手札';
})().catch(e=>{document.body.dataset.tests='failed';document.body.dataset.failure=e.message;console.error(e)});
</script>`;
const server=http.createServer((req,res)=>{
  if(req.url==='/tokens.css'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(fs.readFileSync('tokens.css','utf8'));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html','utf8').replace('<script>',isolatedStorage+'<script>').replace('</body>',checks+'</body>'));
});
const port=Number(process.env.UI_TEST_PORT || 3001);
server.listen(port,'127.0.0.1',()=>console.log(`Isolated UI checks: http://127.0.0.1:${port}`));
