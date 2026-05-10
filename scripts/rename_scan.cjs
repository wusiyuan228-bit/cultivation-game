// 扫描 cards_all.json 中所有 skills 描述里命中的角色原名
const fs = require('fs');
const path = require('path');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/config/cards/cards_all.json'), 'utf-8'));
const pools = ['pool_n', 'pool_r', 'pool_sr', 'pool_ssr', 'bind_ssr', 'bind_sr'];

// 完整原名清单（含主角原型）
const names = [
  // pool_n
  '泰隆', '江楠楠', '许小言', '凤清儿', '萧鼎', '格娜', '张铁', '梅凝', '墨居仁', '张虎', '大牛', '藤厉',
  // pool_r
  '柳二龙', '独孤博', '贝贝', '徐三石', '赵无极', '弗兰德', '青鳞', '萧潇', '若琳', '法犸', '海波东', '林修涯', '辛如音', '蛮胡子', '董萱儿', '王蝉', '李化元', '宋玉', '王卓', '魅姬', '即墨老人', '孙泰', '周茹', '遁天',
  // pool_sr
  '戴沐白', '朱竹清', '宁荣荣', '千仞雪', '奥斯卡', '马红俊', '纳兰嫣然', '风闲', '古河', '天火尊者', '雅妃', '紫妍', '厉飞雨', '菡云芝', '慕沛灵', '陈巧倩', '元瑶', '冰凤', '红蝶', '柳眉', '藤化原', '云雀子', '许立国', '王平',
  // pool_ssr
  '比比东', '霍雨浩', '宁风致', '美杜莎', '云韵', '萧玄', '玄骨', '墨彩环', '紫灵', '周佚', '拓森', '天运子',
  // bind
  '二明', '药尘', '古元', '南宫婉', '司徒南', '唐雅', '王冬儿', '萧战', '小医仙', '银月', '李慕婉',
  // 主角原型名
  '唐三', '小舞', '萧炎', '韩立', '王林',
];

const seen = new Set();
for (const k of pools) {
  for (const c of (d[k] || [])) {
    const sk = c.skills || {};
    for (const slot of ['battle_skill', 'ultimate', 'run_skill']) {
      const s = sk[slot];
      if (!s) continue;
      const desc = s.desc || '';
      const name = s.name || '';
      for (const n of names) {
        if (desc.includes(n) || name.includes(n)) {
          const key = `${c.id}|${slot}|${n}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`${c.id} . ${slot} | hit="${n}" | name="${name}" | desc="${desc.substring(0, 120)}"`);
        }
      }
    }
  }
}
console.log('\n命中条数:', seen.size);
