const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const ALLOWED_API_HOSTS = new Set((process.env.ALLOWED_API_HOSTS || 'api.openai.com,api.anthropic.com,api.llmgateway.io').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const RACES = { human: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 }, dwarf: { CON: 2 }, elf: { DEX: 2 }, halfling: { DEX: 2 } };
const CLASSES = {
  fighter: { die: 10, weapon: '长剑', dice: [1, 8], ability: 'STR', skills: ['运动', '威吓'], saves: ['STR', 'CON'] },
  rogue: { die: 8, weapon: '短剑', dice: [1, 6], ability: 'DEX', skills: ['隐匿', '巧手', '察觉'], saves: ['DEX', 'INT'] },
  cleric: { die: 8, weapon: '战锤', dice: [1, 8], ability: 'STR', skills: ['洞悉', '宗教'], saves: ['WIS', 'CHA'] },
  wizard: { die: 6, weapon: '法术', dice: [1, 10], ability: 'INT', skills: ['奥秘', '调查'], saves: ['INT', 'WIS'] }
};
const BACKGROUNDS = { soldier: ['运动', '威吓'], criminal: ['隐匿', '欺瞒'], sage: ['奥秘', '历史'], acolyte: ['洞悉', '宗教'] };
const SKILL_ABILITY = { 运动: 'STR', 巧手: 'DEX', 隐匿: 'DEX', 奥秘: 'INT', 历史: 'INT', 调查: 'INT', 自然: 'INT', 宗教: 'INT', 驯兽: 'WIS', 洞悉: 'WIS', 医药: 'WIS', 察觉: 'WIS', 求生: 'WIS', 欺瞒: 'CHA', 威吓: 'CHA', 表演: 'CHA', 游说: 'CHA' };
const SYSTEM = `你是中文 D&D 5e (2014版) 单人冒险的地下城主。主持有因果、可探索、有 NPC 和选择的原创奇幻冒险。规则引擎负责骰子、生命、资源和战斗；你绝不可代替引擎宣告数值结果。尊重玩家行动，不替玩家决定行动。只返回合法 JSON，不加 Markdown。描写简洁生动，每次推进一个场景。不要引用或复制规则书长段原文。`;
const mod = n => Math.floor((n - 10) / 2);
const die = sides => crypto.randomInt(1, sides + 1);
const roll = (count, sides) => Array.from({ length: count }, () => die(sides));
const bounded = (n, low, high, fallback) => Number.isFinite(Number(n)) ? Math.max(low, Math.min(high, Math.trunc(Number(n)))) : fallback;
const clean = (s, max = 500) => typeof s === 'string' ? s.trim().slice(0, max) : '';

function makeCharacter(input) {
  const name = clean(input.name, 30);
  const race = input.race, job = input.class, background = input.background;
  const scores = input.scores;
  if (!name || !RACES[race] || !CLASSES[job] || !BACKGROUNDS[background] || !scores ||
      ABILITIES.some(a => !Number.isInteger(scores[a])) ||
      ABILITIES.map(a => scores[a]).sort((a, b) => a - b).join() !== '8,10,12,13,14,15') throw Error('角色资料无效：六项属性须各使用一次标准数组。');
  const abilities = Object.fromEntries(ABILITIES.map(a => [a, scores[a] + (RACES[race][a] || 0)]));
  const hp = Math.max(1, CLASSES[job].die + mod(abilities.CON) + (race === 'dwarf' ? 1 : 0));
  const ac = job === 'fighter' ? 18 : job === 'cleric' ? 16 + Math.min(2, mod(abilities.DEX)) : job === 'rogue' ? 11 + mod(abilities.DEX) : 10 + mod(abilities.DEX);
  return { name, race, class: job, background, backstory: clean(input.backstory, 2000), abilities, hp, maxHp: hp, ac, level: 1, xp: 0,
    hitDice: 1, slots: ['cleric', 'wizard'].includes(job) ? 2 : 0, potion: 1, secondWind: job === 'fighter' ? 1 : 0,
    inventory: [], journal: '', death: { success: 0, failure: 0 }, combat: null, history: [] };
}

function d20(character, advantage = 0) {
  let dice = [die(20)];
  if (advantage) dice.push(die(20));
  let natural = advantage > 0 ? Math.max(...dice) : advantage < 0 ? Math.min(...dice) : dice[0];
  if (character.race === 'halfling' && natural === 1) { const reroll = die(20); dice.push(reroll); natural = reroll; }
  return { dice, natural };
}
function check(character, request) {
  const skill = clean(request.skill, 20);
  const ability = SKILL_ABILITY[skill] || (ABILITIES.includes(request.ability) ? request.ability : 'WIS');
  const dc = bounded(request.dc, 5, 30, 12);
  const advantage = bounded(request.advantage, -1, 1, 0);
  const r = d20(character, advantage);
  const proficient = skill ? [...CLASSES[character.class].skills, ...BACKGROUNDS[character.background]].includes(skill) : CLASSES[character.class].saves.includes(ability) && request.save === true;
  const bonus = mod(character.abilities[ability]) + (proficient ? 2 : 0);
  return { ...r, ability, skill, dc, bonus, total: r.natural + bonus, success: r.natural + bonus >= dc };
}
function damage(character, amount) {
  if (character.hp === 0) {
    character.death.failure += amount >= character.maxHp ? 3 : 1;
  } else if (amount >= character.hp + character.maxHp) {
    character.hp = 0; character.death.failure = 3;
  } else {
    character.hp = Math.max(0, character.hp - amount);
  }
}
function enemyTurn(character, events) {
  const c = character.combat;
  if (!c || c.enemy.hp <= 0 || character.death.failure >= 3) return;
  if (character.hp === 0) {
    const r = d20(character);
    if (r.natural === 20) { character.hp = 1; character.death = { success: 0, failure: 0 }; events.push(`死亡豁免自然20：恢复1生命值。`); }
    else { character.death[r.natural < 10 ? 'failure' : 'success'] += r.natural === 1 ? 2 : 1; events.push(`死亡豁免 ${r.natural}：成功${character.death.success} / 失败${character.death.failure}。`); }
    if (character.death.success >= 3) {
      // ponytail: solo play has no ally to stabilize the hero; wake after the encounter instead of implementing a companion.
      character.hp = 1; character.combat = null; events.push('伤势稳定。敌人离开后，数小时后你恢复 1 生命值。');
    }
    return;
  }
  const dice = [die(20)]; if (c.dodge) dice.push(die(20));
  const r = Math.min(...dice), hit = r === 20 || (r !== 1 && r + c.enemy.attack >= character.ac);
  if (hit) { const dealt = Math.max(0, roll(c.enemy.damageCount * (r === 20 ? 2 : 1), c.enemy.damageSides).reduce((a, b) => a + b, 0) + c.enemy.damageBonus); damage(character, dealt); events.push(`${c.enemy.name} 攻击 ${dice.join('/')}+${c.enemy.attack}，命中，造成 ${dealt} 伤害。`); }
  else events.push(`${c.enemy.name} 攻击 ${dice.join('/')}+${c.enemy.attack}，未命中。`);
  c.dodge = false;
}
function combatAction(character, command) {
  if (!character.combat) throw Error('目前不在战斗中。');
  const c = character.combat, enemy = c.enemy, events = [];
  if (character.death.failure >= 3) throw Error('角色已死亡。');
  if (character.hp === 0) { enemyTurn(character, events); if (character.death.failure >= 3) events.push('你已死亡，冒险结束。'); return events; }
  if (command === 'attack' || command === 'firebolt' || command === 'guiding') {
    if (command === 'firebolt' && character.class !== 'wizard' || command === 'guiding' && character.class !== 'cleric') throw Error('职业无法使用此法术。');
    if (command === 'guiding' && !character.slots) throw Error('法术位已用尽。');
    if (command === 'guiding') character.slots--;
    const spell = command !== 'attack';
    const ability = spell ? character.class === 'cleric' ? 'WIS' : 'INT' : CLASSES[character.class].ability;
    const r = d20(character, c.advantage ? 1 : 0);
    const bonus = mod(character.abilities[ability]) + 2;
    const hit = r.natural === 20 || (r.natural !== 1 && r.natural + bonus >= enemy.ac);
    if (hit) {
      const [count, sides] = command === 'guiding' ? [4, 6] : command === 'firebolt' ? [1, 10] : CLASSES[character.class].dice;
      let dealt = roll(count * (r.natural === 20 ? 2 : 1), sides).reduce((a, b) => a + b, 0) + (spell ? 0 : mod(character.abilities[ability]));
      if (command === 'attack' && character.class === 'rogue' && c.advantage) dealt += roll(r.natural === 20 ? 2 : 1, 6).reduce((a, b) => a + b, 0);
      dealt = Math.max(0, dealt); enemy.hp = Math.max(0, enemy.hp - dealt);
      events.push(`${character.name} 使用${spell ? command === 'guiding' ? '曳光弹' : '火焰箭' : CLASSES[character.class].weapon}：${r.natural}+${bonus} 命中，造成 ${dealt} 伤害。`);
      if (command === 'guiding') c.advantage = true; else c.advantage = false;
    } else { events.push(`${character.name} 攻击 ${r.natural}+${bonus}，未命中。`); c.advantage = false; }
  } else if (command === 'missile' && character.class === 'wizard') {
    if (!character.slots) throw Error('法术位已用尽。');
    character.slots--; const dealt = roll(3, 4).reduce((a, b) => a + b, 3); enemy.hp = Math.max(0, enemy.hp - dealt);
    events.push(`魔法飞弹自动命中，造成 ${dealt} 力场伤害。`);
  } else if (command === 'sacred' && character.class === 'cleric') {
    const r = die(20) + bounded(enemy.dexSave, -5, 10, 0), dc = 8 + 2 + mod(character.abilities.WIS);
    if (r < dc) { const dealt = die(8); enemy.hp = Math.max(0, enemy.hp - dealt); events.push(`圣火术：敌人敏捷豁免 ${r} 未达到 DC${dc}，受到 ${dealt} 光耀伤害。`); }
    else events.push(`圣火术：敌人敏捷豁免 ${r} 达到 DC${dc}，未受伤害。`);
  } else if (command === 'heal' && character.class === 'cleric') {
    if (!character.slots) throw Error('法术位已用尽。');
    character.slots--; const healed = Math.max(1, die(8) + mod(character.abilities.WIS)); character.hp = Math.min(character.maxHp, character.hp + healed); events.push(`疗伤术恢复 ${healed} 生命值。`);
  } else if (command === 'wind' && character.class === 'fighter') {
    if (!character.secondWind) throw Error('回气已使用。');
    character.secondWind = 0; const healed = die(10) + character.level; character.hp = Math.min(character.maxHp, character.hp + healed); events.push(`附赠动作回气恢复 ${healed} 生命值；你仍可执行本回合动作。`); return events;
  } else if (command === 'hide' && character.class === 'rogue') {
    const r = d20(character), total = r.natural + mod(character.abilities.DEX) + 2;
    c.advantage = total >= 12; events.push(`隐匿检定 ${total} 对抗 DC12：${c.advantage ? '成功，下次攻击有优势' : '失败'}。`);
  } else if (command === 'dodge') { c.dodge = true; events.push('采取回避动作。'); }
  else if (command === 'potion') {
    if (!character.potion) throw Error('治疗药水已用尽。');
    character.potion--; const healed = die(4) + die(4) + 2; character.hp = Math.min(character.maxHp, character.hp + healed); events.push(`饮用治疗药水，恢复 ${healed} 生命值。`);
  } else if (command === 'flee') {
    const r = d20(character), total = r.natural + mod(character.abilities.DEX);
    if (total >= 12) { character.combat = null; events.push(`撤离检定 ${total} 成功，逃离战斗。`); return events; }
    events.push(`撤离检定 ${total} 失败。`);
  } else throw Error('无效的战斗动作。');
  if (enemy.hp <= 0) {
    events.push(`${enemy.name} 被击败，获得 ${enemy.xp} XP。`);
    character.xp += enemy.xp; character.combat = null;
    const threshold = [0, 300, 900, 2700];
    while (character.level < 3 && character.xp >= threshold[character.level]) {
      character.level++; const gain = Math.max(1, Math.ceil(CLASSES[character.class].die / 2) + 1 + mod(character.abilities.CON));
      character.maxHp += gain; character.hp += gain; character.hitDice++; events.push(`升至 ${character.level} 级，生命上限 +${gain}。`);
    }
  } else { enemyTurn(character, events); if (character.death.failure >= 3) events.push('你已死亡，冒险结束。'); }
  return events;
}

function rest(character, kind) {
  if (character.combat) throw Error('战斗中无法休息。');
  if (character.hp === 0) throw Error('昏迷时无法主动休息。');
  if (kind === 'long') {
    character.hp = character.maxHp; character.hitDice = Math.min(character.level, character.hitDice + Math.max(1, Math.floor(character.level / 2)));
    character.slots = ['cleric', 'wizard'].includes(character.class) ? character.level >= 3 ? 4 : character.level >= 2 ? 3 : 2 : 0;
    character.secondWind = character.class === 'fighter' ? 1 : 0;
    return '完成长休：生命值和法术位恢复，恢复部分生命骰。';
  }
  if (kind === 'short') {
    if (!character.hitDice) throw Error('没有可用生命骰。');
    character.hitDice--; const healed = Math.max(0, die(CLASSES[character.class].die) + mod(character.abilities.CON));
    character.hp = Math.min(character.maxHp, character.hp + healed); character.secondWind = character.class === 'fighter' ? 1 : 0;
    return `完成短休：花费 1 枚生命骰，恢复 ${healed} 生命值。`;
  }
  throw Error('无效的休息类型。');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start < 0) { if (char === '{') { start = i; depth = 1; } continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        const value = JSON.parse(text.slice(start, i + 1));
        if (value && typeof value === 'object' && !Array.isArray(value) && ('scene' in value || 'allowed' in value)) return value;
      } catch {}
      start = -1;
    }
  }
  throw Error('模型没有返回可用的 JSON，请重试或更换模型。');
}
async function ask(config, prompt) {
  const provider = config.provider || 'openai';
  if (!['openai', 'anthropic', 'llmgateway'].includes(provider)) throw Error('不支持的模型接口。');
  const url = new URL(clean(config.baseUrl, 300));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('API 地址必须是 HTTPS 的兼容接口根路径。');
  if (['llmgateway.io', 'www.llmgateway.io'].includes(url.hostname)) {
    if (!['/', '/v1', '/v1/chat/completions'].includes(url.pathname)) throw Error('LLM Gateway API 地址应为 https://api.llmgateway.io/v1。');
    url.hostname = 'api.llmgateway.io';
  }
  if (url.hostname === 'api.llmgateway.io' && url.pathname === '/') url.pathname = '/v1';
  if (['api.openai.com', 'api.anthropic.com'].includes(url.hostname) && url.pathname === '/') url.pathname = '/v1';
  const endpoint = provider === 'anthropic' ? 'messages' : 'chat/completions';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/' + endpoint) ? path : path + '/' + endpoint;
  if (!ALLOWED_API_HOSTS.has(url.hostname.toLowerCase()) || url.port && url.port !== '443') throw Error('此 API 域名未获服务器允许；管理员可设置 ALLOWED_API_HOSTS。');
  const key = clean(config.key, 300), model = clean(config.model, 100);
  if (!key || !model) throw Error('请填写 API Key 和模型名称。');
  const anthropic = provider === 'anthropic';
  const headers = anthropic ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const payload = anthropic ? { model, max_tokens: 2048, system: SYSTEM, messages: [{ role: 'user', content: prompt }] } : { model, temperature: 0.8, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] };
  let response;
  try { response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(60000) }); }
  catch (error) { throw Error(`无法连接模型接口（${error.cause?.code || error.name}）。请检查网络、代理或 API 地址。`); }
  const body = await response.text();
  if (!response.ok) throw Error(`${url.hostname === 'api.llmgateway.io' && response.status === 404 ? 'LLM Gateway 路径或模型有误' : '模型接口返回 ' + response.status}：${body.slice(0, 250).replaceAll(key, '[redacted]')}`);
  let data;
  try { data = JSON.parse(body); } catch { throw Error('模型接口返回的响应不是单个 JSON。'); }
  return parseJson(anthropic ? data.content?.filter(x => x.type === 'text').map(x => x.text).join('\n') || '' : data.choices?.[0]?.message?.content || '');
}
const summary = c => JSON.stringify({ name: c.name, race: c.race, class: c.class, background: c.background, backstory: c.backstory || '', level: c.level, xp: c.xp,
  abilities: c.abilities, hp: c.hp, maxHp: c.maxHp, ac: c.ac, slots: c.slots, potion: c.potion, inventory: c.inventory, journal: c.journal, combat: c.combat,
  recent: c.history.slice(-8) });
const remember = (c, role, text) => { c.history.push({ role, text: clean(text, 1000) }); c.history = c.history.slice(-12); };
async function play(body) {
  const c = body.state;
  if (body.kind === 'start') {
    const character = makeCharacter(body.character || {});
    const answer = await ask(body.config, `新开一场适合1级角色的原创冒险。角色：${summary(character)}。若角色有 backstory，请自然融入其中的人物、牵挂或未解线索，尊重玩家已有设定，不替角色决定行动。返回 {"scene":"开场场景和明确的行动线索","journal":"持续记录重要人物、地点、线索和任务的一段简短摘要","options":["可能的行动1","可能的行动2","可能的行动3","可能的行动4"]}。options 必须给出4条简短、不同且符合当前情境的可选行动。不要掷骰。`);
    const scene = clean(answer.scene, 2000) || '你来到一处陌生的城镇。';
    character.journal = clean(answer.journal, 1200);
    remember(character, 'dm', scene);
    return { state: character, scene, options: Array.isArray(answer.options) ? answer.options.slice(0, 4).map(x => clean(x, 80)) : [] };
  }
  if (!c || !CLASSES[c.class] || !RACES[c.race] || !Array.isArray(c.history)) throw Error('游戏存档无效。');
  if (body.kind === 'explore') {
    if (c.combat) throw Error('请先结束战斗。');
    if (c.hp <= 0) throw Error('角色昏迷，无法行动。');
    const action = clean(body.action, 500);
    if (!action) throw Error('请输入行动。');
    const answer = await ask(body.config, `当前状态：${summary(c)}。玩家行动：${action}。返回 JSON：{"scene":"行动带来的场景推进","journal":"更新后的重要人物地点线索任务摘要","check":null或{"ability":"STR/DEX/CON/INT/WIS/CHA","skill":"中文技能名或空串","save":false,"dc":5到25,"advantage":-1/0/1,"success":"成功结果","failure":"失败结果","failureDamage":{"count":1,"sides":6}或null},"enemy":null或{"name":"敌人","hp":1到40,"ac":8到18,"attack":-2到7,"damageCount":1到2,"damageSides":4/6/8/10,"damageBonus":-1到4,"dexSave":-2到5,"xp":10到100},"item":"成功获得的普通物品或空串","consumeItem":"使用后失去的现有物品或空串","options":["下一步选择1","下一步选择2","下一步选择3","下一步选择4"]}。options 必须给出4条简短、不同且符合当前情境的可选行动。只有真正不确定且有代价的行动才给 check。check 与 enemy 不能同时出现。敌人须适合单个1级角色。不要代替玩家决定行动，也不要自行宣布骰值。`);
    let scene = clean(answer.scene, 2000) || '局势有了变化。', rollResult = null;
    if (answer.check && typeof answer.check === 'object') {
      rollResult = check(c, answer.check);
      scene += '\n\n' + clean(rollResult.success ? answer.check.success : answer.check.failure, 1200);
      const hazard = answer.check.failureDamage;
      if (!rollResult.success && hazard && typeof hazard === 'object') {
        const harm = roll(bounded(hazard.count, 1, 4, 1), [4, 6, 8, 10, 12].includes(hazard.sides) ? hazard.sides : 6).reduce((a, b) => a + b, 0);
        damage(c, harm); scene += `\n受到 ${harm} 点伤害。`;
      }
    } else if (answer.enemy && typeof answer.enemy === 'object') {
      const e = answer.enemy;
      c.combat = { enemy: { name: clean(e.name, 40) || '敌人', hp: bounded(e.hp, 1, 40, 8), ac: bounded(e.ac, 8, 18, 12),
        attack: bounded(e.attack, -2, 7, 2), damageCount: bounded(e.damageCount, 1, 2, 1), damageSides: [4, 6, 8, 10].includes(e.damageSides) ? e.damageSides : 6,
        damageBonus: bounded(e.damageBonus, -1, 4, 1), dexSave: bounded(e.dexSave, -2, 5, 0), xp: bounded(e.xp, 10, 100, 50) }, dodge: false, advantage: false };
      const yours = die(20) + mod(c.abilities.DEX), theirs = die(20) + c.combat.enemy.dexSave;
      scene += `\n\n先攻：你 ${yours}，${c.combat.enemy.name} ${theirs}。`;
      if (theirs > yours) { const events = []; enemyTurn(c, events); scene += '\n' + events.join('\n'); }
    }
    if (answer.item && (!rollResult || rollResult.success)) { const item = clean(answer.item, 50); if (item && c.inventory.length < 30) c.inventory.push(item); }
    if (answer.consumeItem && (!rollResult || rollResult.success)) { const i = c.inventory.indexOf(clean(answer.consumeItem, 50)); if (i >= 0) c.inventory.splice(i, 1); }
    c.journal = clean(answer.journal, 1200) || c.journal;
    remember(c, 'player', action); remember(c, 'dm', scene);
    return { state: c, scene, roll: rollResult, options: Array.isArray(answer.options) ? answer.options.slice(0, 4).map(x => clean(x, 80)) : [] };
  }
  if (body.kind === 'rest') {
    if (c.combat || c.hp <= 0) throw Error('现在无法休息。');
    const type = body.action === 'long' ? '至少8小时的长休' : body.action === 'short' ? '至少1小时的短休' : null;
    if (!type) throw Error('无效的休息类型。');
    const answer = await ask(body.config, `当前状态：${summary(c)}。玩家想进行${type}。根据场景危险、时间和此前的休息，判断能否完成。返回 {"allowed":true或false,"scene":"完成或被打断的简短叙述","options":["行动1","行动2","行动3","行动4"]}。options 须为4条不同且符合当前场景的简短可选行动。24小时内长休只能获益一次。`);
    const scene = answer.allowed === true ? `${rest(c, body.action)}\n\n${clean(answer.scene, 1000)}` : clean(answer.scene, 1000) || '此处不安全，休息被迫中断。';
    remember(c, 'player', `尝试${type}`); remember(c, 'dm', scene);
    return { state: c, scene, options: Array.isArray(answer.options) ? answer.options.slice(0, 4).map(x => clean(x, 80)) : [] };
  }
  if (body.kind === 'combat') {
    const events = combatAction(c, body.action);
    let scene = events.join('\n'), options = [];
    try {
      const answer = await ask(body.config, `角色与场景：${summary(c)}。刚刚发生的确定事实：${scene}。只返回 {"scene":"据此作简短生动的城主叙述","options":[]}。战斗结束时，options 须为4条不同且符合当前场景的简短可选行动；战斗未结束则为空数组。不可更改数值、结果、物品或宣告新的攻击。`);
      options = Array.isArray(answer.options) ? answer.options.slice(0, 4).map(x => clean(x, 80)) : [];
      const flavor = clean(answer.scene, 1000); if (flavor) scene += '\n\n' + flavor;
    } catch (error) { scene += `\n\n（城主暂时无法回应：${error.message}）`; }
    remember(c, 'player', body.action); remember(c, 'dm', scene);
    return { state: c, scene, events, options };
  }
  throw Error('无效请求。');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/tokens.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(__dirname + '/tokens.css'));
  }
  if (req.method === 'GET' && req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end('{"ok":true}'); }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(__dirname + '/index.html'));
  }
  if (req.method !== 'POST' || req.url !== '/api/play') { res.writeHead(404); return res.end(); }
  let raw = '';
  try {
    for await (const chunk of req) { raw += chunk; if (raw.length > 300000) throw Error('请求过大。'); }
    const result = await play(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: error.message }));
  }
});
if (require.main === module) server.listen(PORT, HOST, () => console.log(`DnD 5e 单人冒险：http://${HOST}:${PORT}`));

module.exports = { makeCharacter, check, combatAction, rest, play, mod, server };
