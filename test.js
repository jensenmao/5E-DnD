const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const vm = require('node:vm');
const { makeCharacter, combatAction, rest, play, server } = require('./server');

const character = { name: '艾琳', race: 'human', class: 'fighter', background: 'soldier', backstory: '一直在寻找失踪的哥哥。', scores: { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 } };
const c = makeCharacter(character);
assert.equal(c.abilities.STR, 16);
assert.equal(c.hp, 12);
assert.equal(c.ac, 18);
assert.equal(c.backstory, character.backstory);
assert.throws(() => makeCharacter({ ...character, scores: { ...character.scores, WIS: 15 } }), /标准数组/);
c.hp = 3;
assert.match(rest(c, 'short'), /短休/);
assert.equal(c.hitDice, 0);
assert.match(rest(c, 'long'), /长休/);
assert.equal(c.hp, c.maxHp);

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const parseSave = vm.runInNewContext('('+html.slice(html.indexOf('function parseSave('), html.indexOf('function makeSave(')).trim()+')', { TextEncoder, URL });
const fileSave = {format:'candle-road-5e',version:1,state:makeCharacter(character),config:{provider:'llmgateway',baseUrl:'https://api.llmgateway.io/v1',model:'test-model',key:'file-test-key'},options:['看看周围']};
assert.equal(parseSave(JSON.stringify(fileSave)).config.key,'file-test-key');
const noKeySave=structuredClone(fileSave);delete noKeySave.config.key;
assert.equal(parseSave(JSON.stringify(noKeySave)).config.key,undefined);
const combatSave=structuredClone(fileSave);
combatSave.state.hp=0;
combatSave.state.combat={enemy:{name:'地精',hp:7,ac:12,attack:2,damageCount:1,damageSides:6,damageBonus:1,dexSave:2,xp:50},dodge:false,advantage:true};
assert.equal(parseSave(JSON.stringify(combatSave)).state.combat.advantage,true);
for (const bad of [
  {...fileSave,version:2},
  {...fileSave,state:{...fileSave.state,hp:-1}},
  {...fileSave,state:{...fileSave.state,abilities:{...fileSave.state.abilities,STR:'<img src=x>'}}},
  {...fileSave,state:{...fileSave.state,history:[{role:'unknown',text:'x'}]}},
  {...fileSave,state:{...fileSave.state,combat:{enemy:{name:'地精'}}}},
  {...fileSave,config:{...fileSave.config,baseUrl:'http://example.com/v1'}},
  {...fileSave,config:{...fileSave.config,baseUrl:'https://user:secret@example.com/v1'}}
]) assert.throws(()=>parseSave(JSON.stringify(bad)));
assert.throws(()=>parseSave('{broken'),/JSON/);
assert.throws(()=>parseSave(' '.repeat(262145)),/256 KB/);
assert.equal(parseSave(JSON.stringify({...fileSave,options:['a','b','c','d']})).options.length,4);
assert.throws(()=>parseSave(JSON.stringify({...fileSave,options:['a','b','c','d','e']})));

// Deterministic clock: 10-second delay, activity resets, and ineligible states.
const elements={game:{hidden:false},saveDialog:{open:false},choices:{hidden:true}};
let now=0,nextTimer=0;const timers=new Map();
const idle=vm.createContext({state:{hp:10,combat:null},busy:false,suggestionsTimer:null,document:{hidden:false},$:id=>elements[id],
  setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,at:now+delay});return nextTimer;},clearTimeout:id=>timers.delete(id)});
vm.runInContext(html.slice(html.indexOf('function canSuggest('),html.indexOf('function setBusy(')),idle);
const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}};
idle.resetSuggestions();advance(9999);assert.equal(elements.choices.hidden,true);
advance(1);assert.equal(elements.choices.hidden,false);
idle.resetSuggestions();assert.equal(elements.choices.hidden,true);advance(9000);
idle.resetSuggestions();advance(9999);assert.equal(elements.choices.hidden,true);advance(1);assert.equal(elements.choices.hidden,false);
for(const reason of ['busy','combat','hp','setup','dialog','hidden']){
  idle.busy=reason==='busy';idle.state={hp:reason==='hp'?0:10,combat:reason==='combat'?{}:null};
  elements.game.hidden=reason==='setup';elements.saveDialog.open=reason==='dialog';idle.document.hidden=reason==='hidden';
  idle.resetSuggestions();advance(10000);assert.equal(elements.choices.hidden,true,reason);
}
assert.match(html,/<label for="action">[^<]+<\/label>\s*<div id="choices"/);

const replies = [
  { scene: '古桥下传来呼救声。', journal: '古桥与呼救声', options: ['走近古桥','观察河面','寻找绳索','询问路人','多余选项'] },
  { scene: '你走近古桥。', journal: '古桥下有线索', check: { ability: 'STR', skill: '运动', dc: 5, success: '你攀上石台。', failure: '你滑落了。' }, item: '铜钥匙' },
  { scene: '暗处出现一只地精。', journal: '古桥下有地精', enemy: { name: '地精', hp: 7, ac: 12, attack: 2, damageCount: 1, damageSides: 6, damageBonus: 1, dexSave: 2, xp: 50 } },
  { allowed: false, scene: '地精仍在搜寻，无法长休。' },
  { allowed: true, scene: '你在安全的屋内睡了一夜。' }
];
global.fetch = async (url, options) => {
  assert.match(String(url), /\/chat\/completions$/);
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  const payload = JSON.parse(options.body);
  assert.equal(payload.messages[0].role, 'system');
  assert.match(payload.messages[1].content, /寻找失踪的哥哥/);
  return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies.shift()) } }] }) };
};
const config = { provider: 'openai', key: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'test-model' };
(async () => {
  let result = await play({ kind: 'start', character, config });
  assert.match(result.scene, /古桥/);
  assert.equal(result.state.backstory, character.backstory);
  assert.equal(result.state.journal, '古桥与呼救声');
  assert.deepEqual(result.options,['走近古桥','观察河面','寻找绳索','询问路人']);
  result = await play({ kind: 'explore', state: result.state, action: '攀上石台', config });
  assert.equal(result.roll.success, true);
  assert.deepEqual(result.state.inventory, ['铜钥匙']);
  result = await play({ kind: 'explore', state: result.state, action: '查看暗处', config });
  assert.equal(result.state.combat.enemy.name, '地精');
  const combatant = result.state;
  combatant.hp = 1;
  const wind = combatAction(combatant, 'wind');
  assert.match(wind[0], /附赠动作/);
  assert.equal(combatant.secondWind, 0);
  assert.equal(combatant.combat.enemy.hp, 7);
  combatant.combat = null;
  const beforeRest = combatant.hp;
  result = await play({ kind: 'rest', state: combatant, action: 'long', config });
  assert.equal(result.state.hp, beforeRest);
  result = await play({ kind: 'rest', state: combatant, action: 'long', config });
  assert.equal(result.state.hp, result.state.maxHp);
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'anthropic-test-key');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'claude-opus-5-5');
    assert.equal(payload.max_tokens, 2048);
    assert.equal(payload.messages[0].role, 'user');
    assert.match(payload.messages[0].content, /寻找失踪的哥哥/);
    assert.match(payload.system, /地下城主/);
    return { ok: true, text: async () => JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ scene: '你走入雨中的酒馆。', journal: '雨中的酒馆' }) }] }) };
  };
  result = await play({ kind: 'start', character, config: { provider: 'anthropic', key: 'anthropic-test-key', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' } });
  assert.match(result.scene, /酒馆/);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = JSON.stringify({ kind: 'start', character, config: { provider: 'anthropic', key: 'anthropic-test-key', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' } });
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/play', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text }));
      });
      req.on('error', reject); req.end(body);
    });
    assert.equal(response.status, 200);
    assert.match(JSON.parse(response.text).scene, /酒馆/);
    assert.equal(response.text.includes('anthropic-test-key'), false);
    const health = await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/healthz' }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject));
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.text).ok, true);
    const tokens = await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:server.address().port,path:'/tokens.css'},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],text}));
    }).on('error',reject));
    assert.equal(tokens.status,200);assert.match(tokens.type,/text\/css/);assert.match(tokens.text,/--color-paper:/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.llmgateway.io/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer gateway-test-key');
    assert.equal(JSON.parse(options.body).model, 'alibaba/deepseek-v4.1-flash:cn-beijing');
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scene: '城门打开了。' }) } }] }) };
  };
  const gateway = { provider: 'llmgateway', key: 'gateway-test-key', model: 'alibaba/deepseek-v4.1-flash:cn-beijing' };
  for (const baseUrl of ['https://api.llmgateway.io', 'https://api.llmgateway.io/v1', 'https://api.llmgateway.io/v1/chat/completions', 'https://llmgateway.io']) {
    result = await play({ kind: 'start', character, config: { ...gateway, baseUrl } });
    assert.match(result.scene, /城门/);
  }
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: `${JSON.stringify({ scene: '门上刻着「{旧徽章}」' })}\n${JSON.stringify({ scene: '不应采用的第二段' })}` } }] }) });
  result = await play({ kind: 'start', character, config: { ...gateway, baseUrl: 'https://api.llmgateway.io' } });
  assert.equal(result.scene, '门上刻着「{旧徽章}」');
  await assert.rejects(() => play({ kind: 'start', character, config: { ...gateway, baseUrl: 'https://127.0.0.1/v1' } }), /未获服务器允许/);
  global.fetch = async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' }; throw error; };
  await assert.rejects(() => play({ kind: 'start', character, config }), /UND_ERR_CONNECT_TIMEOUT/);
  console.log('规则、模型回合与前端脚本检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
