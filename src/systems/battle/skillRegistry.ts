/**
 * 技能注册表（SkillRegistry）
 *
 * 职责：统一管理所有 SkillRegistration，供引擎按 id 查询技能的 hook 列表、
 *       autoModifiers、precheck、activeCast。
 *
 * 新增技能仅需：
 *   1. 在 src/systems/battle/skills/ 下新建技能文件
 *   2. 在本文件 import 并 register()
 *   3. 在 cards_all.json / heroesData.ts 中将技能 name 映射到该 id
 *
 * 永远不要在引擎核心或 UI 层硬编码 if/else 判断具体技能！
 */

import type { SkillRegistration } from './types';

// —— P0 六条 ——
import { skill_tanghao_po } from './skills/tanghao_po';
import { skill_xiuluo_zhipei } from './skills/xiuluo_zhipei';
import { skill_xiaoxuan_fen } from './skills/xiaoxuan_fen';
import { skill_xiaoyan_shiyan } from './skills/xiaoyan_shiyan';
import { skill_wanglin_duoming } from './skills/wanglin_duoming';
import { skill_hanli_aw_chongjin } from './skills/hanli_aw_chongjin';

// —— P1/P2 阶段B：本体被动3 + 绝技6 ——
import { skill_xiaowu_wudi } from './skills/xiaowu_wudi';
import { skill_hanli_qingzhu } from './skills/hanli_qingzhu';
import { skill_xuner_guzu } from './skills/xuner_guzu';
import { skill_tangsan_shisha } from './skills/tangsan_shisha';
import { skill_xiaoyan_fonu } from './skills/xiaoyan_fonu';
import { skill_hanli_wanjian } from './skills/hanli_wanjian';
import { skill_wanglin_tiandi } from './skills/wanglin_tiandi';
import { skill_xuner_tianhuo } from './skills/xuner_tianhuo';
import { skill_tangsan_wandu } from './skills/tangsan_wandu';

// —— 阶段 C：觉醒技能 8 条 + 本体占位 1 条 ——
import { skill_tangsan_cage } from './skills/tangsan_cage';
import { skill_xiaowu_aw_chanhun } from './skills/xiaowu_aw_chanhun';
import { skill_xiaowu_aw_sacrifice } from './skills/xiaowu_aw_sacrifice';
import { skill_xiaoyan_aw_fentian } from './skills/xiaoyan_aw_fentian';
import { skill_xiaoyan_aw_huiMie } from './skills/xiaoyan_aw_huimie';
import { skill_xuner_aw_bihu } from './skills/xuner_aw_bihu';
import { skill_xuner_aw_jieje } from './skills/xuner_aw_jieje';
import { skill_hanli_aw_dayan } from './skills/hanli_aw_dayan';
import { skill_wanglin_aw_wanhun } from './skills/wanglin_aw_wanhun';
import { skill_wanglin_aw_yinian } from './skills/wanglin_aw_yinian';
// 阶段 D · D1 扫尾
import { skill_xiaowu_duanhun } from './skills/xiaowu_duanhun';

// —— 阶段 E1 · 非主角 · 绑定 SSR 11 条（塘昊被动已在 P0 里）——
import { skill_erming_tiebi } from './skills/erming_tiebi';
import { skill_erming_yunji } from './skills/erming_yunji';
import { skill_yaochen_lenghuo } from './skills/yaochen_lenghuo';
import { skill_yaochen_danyi } from './skills/yaochen_danyi';
import { skill_guyuan_tianhuo } from './skills/guyuan_tianhuo';
import { skill_guyuan_yuangu } from './skills/guyuan_yuangu';
import { skill_nangongwan_wanhua } from './skills/nangongwan_wanhua';
import { skill_nangongwan_guiyuan } from './skills/nangongwan_guiyuan';
import { skill_situnan_xiulian } from './skills/situnan_xiulian';
import { skill_situnan_duoyuan } from './skills/situnan_duoyuan';
import { skill_tanghao_potian } from './skills/tanghao_potian';

// —— 阶段 E1 · 绑定 SR · 12 条 ——
import { skill_tangya_lanyin } from './skills/tangya_lanyin';
import { skill_tangya_shengming } from './skills/tangya_shengming';
import { skill_wangdonger_shenglong } from './skills/wangdonger_shenglong';
import { skill_wangdonger_shuanglong } from './skills/wangdonger_shuanglong';
import { skill_xiaozhan_bajishou } from './skills/xiaozhan_bajishou';
import { skill_xiaozhan_zushudun } from './skills/xiaozhan_zushudun';
import { skill_xiaoyixian_dushigu } from './skills/xiaoyixian_dushigu';
import { skill_xiaoyixian_quanjing } from './skills/xiaoyixian_quanjing';
import { skill_yinyue_yuehua } from './skills/yinyue_yuehua';
import { skill_yinyue_yuehun } from './skills/yinyue_yuehun';
import { skill_limuwan_qingsi } from './skills/limuwan_qingsi';
import { skill_limuwan_qingshen } from './skills/limuwan_qingshen';

// —— 阶段 E1 · 通用 SSR · 24 条 ——
import { skill_bibidong_shibi } from './skills/bibidong_shibi';
import { skill_bibidong_zhenshen } from './skills/bibidong_zhenshen';
import { skill_huoyuhao_bingyu } from './skills/huoyuhao_bingyu';
import { skill_huoyuhao_jingshen } from './skills/huoyuhao_jingshen';
import { skill_ningfeng_qibao } from './skills/ningfeng_qibao';
import { skill_ningfeng_zengfu } from './skills/ningfeng_zengfu';
import { skill_meidusa_meitong } from './skills/meidusa_meitong';
import { skill_meidusa_shihua } from './skills/meidusa_shihua';
import { skill_yunyun_fengren } from './skills/yunyun_fengren';
import { skill_yunyun_yunsha } from './skills/yunyun_yunsha';
import { skill_xiaoxuan_tianyan } from './skills/xiaoxuan_tianyan';
import { skill_xuangu_yinyang } from './skills/xuangu_yinyang';
import { skill_xuangu_tiandi } from './skills/xuangu_tiandi';
import { skill_mocaihuan_xuli } from './skills/mocaihuan_xuli';
import { skill_mocaihuan_wanbo } from './skills/mocaihuan_wanbo';
import { skill_ziling_laomo } from './skills/ziling_laomo';
import { skill_ziling_shuangxiu } from './skills/ziling_shuangxiu';
import { skill_zhouyi_fengmo } from './skills/zhouyi_fengmo';
import { skill_zhouyi_huashen } from './skills/zhouyi_huashen';
import { skill_tuosen_fengyin } from './skills/tuosen_fengyin';
import { skill_tuosen_zhinu } from './skills/tuosen_zhinu';
import { skill_tianyunzi_minge } from './skills/tianyunzi_minge';
import { skill_tianyunzi_yinguo } from './skills/tianyunzi_yinguo';

// —— 阶段 E1-C · 通用 SR · 24 条 ——
import { skill_daimubai_jinshen } from './skills/daimubai_jinshen';
import { skill_daimubai_liguangbo } from './skills/daimubai_liguangbo';
import { skill_ningrongrong_qibao } from './skills/ningrongrong_qibao';
import { skill_ningrongrong_jiguang } from './skills/ningrongrong_jiguang';
import { skill_qianrenxue_tianshi } from './skills/qianrenxue_tianshi';
import { skill_qianrenxue_shengjian } from './skills/qianrenxue_shengjian';
import { skill_aoska_xiangchang } from './skills/aoska_xiangchang';
import { skill_aoska_jingxiang } from './skills/aoska_jingxiang';
import { skill_mahongjun_tianji } from './skills/mahongjun_tianji';
import { skill_mahongjun_huoyu } from './skills/mahongjun_huoyu';
import { skill_nalanyanran_fengshu } from './skills/nalanyanran_fengshu';
import { skill_nalanyanran_fengbao } from './skills/nalanyanran_fengbao';
import { skill_yafei_buji } from './skills/yafei_buji';
import { skill_yafei_mizang } from './skills/yafei_mizang';
import { skill_fengxian_canyun } from './skills/fengxian_canyun';
import { skill_fengxian_fengbao } from './skills/fengxian_fengbao';
import { skill_guhe_juyuan } from './skills/guhe_juyuan';
import { skill_guhe_pojing } from './skills/guhe_pojing';
import { skill_ziyan_baonu } from './skills/ziyan_baonu';
import { skill_ziyan_longfeng } from './skills/ziyan_longfeng';
import { skill_lifeiyu_jifeng } from './skills/lifeiyu_jifeng';
import { skill_lifeiyu_zhuxian } from './skills/lifeiyu_zhuxian';
import { skill_hanyunzhi_huaxing } from './skills/hanyunzhi_huaxing';
import { skill_hanyunzhi_jingxiang } from './skills/hanyunzhi_jingxiang';
import { skill_mupeiling_miaoshou } from './skills/mupeiling_miaoshou';
import { skill_mupeiling_xuming } from './skills/mupeiling_xuming';
import { skill_yuanyao_yinling } from './skills/yuanyao_yinling';
import { skill_yuanyao_bini } from './skills/yuanyao_bini';
import { skill_bingfeng_hanxiao } from './skills/bingfeng_hanxiao';
import { skill_bingfeng_wanli } from './skills/bingfeng_wanli';
import { skill_hongdie_diewu } from './skills/hongdie_diewu';
import { skill_hongdie_guhuo } from './skills/hongdie_guhuo';
import { skill_liumei_qingyu } from './skills/liumei_qingyu';
import { skill_liumei_qianmeng } from './skills/liumei_qianmeng';
import { skill_tenghuayuan_sousen } from './skills/tenghuayuan_sousen';
import { skill_tenghuayuan_jufan } from './skills/tenghuayuan_jufan';
import { skill_yunquezi_qieyuan } from './skills/yunquezi_qieyuan';
import { skill_yunquezi_wanhun } from './skills/yunquezi_wanhun';
import { skill_xuliguo_weishe } from './skills/xuliguo_weishe';
import { skill_xuliguo_chongsu } from './skills/xuliguo_chongsu';

class SkillRegistryImpl {
  private map: Map<string, SkillRegistration> = new Map();

  register(skill: SkillRegistration): void {
    if (this.map.has(skill.id)) {
      console.warn(`[SkillRegistry] duplicate register: ${skill.id}`);
    }
    // P4 · 防御性校验：run_skill / secret / city 类技能不允许进入战斗注册表
    if (skill.phase && skill.phase !== 'battle') {
      console.error(
        `[SkillRegistry] rejected non-battle skill "${skill.name}" (phase=${skill.phase}). ` +
          `非战斗技能（招募/密谈/城内）不应进入战斗 SkillRegistry。`,
      );
      return;
    }
    this.map.set(skill.id, skill);
  }

  /** 仅返回 phase === 'battle' 的条目（UI/引擎循环用） */
  listBattleSkills(): SkillRegistration[] {
    return [...this.map.values()].filter(
      (s) => !s.phase || s.phase === 'battle',
    );
  }

  get(id: string): SkillRegistration | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  listAll(): SkillRegistration[] {
    return [...this.map.values()];
  }

  /** 中文名 → id 反查（用于从 heroesData.ts 的 skill.name 查到注册 id） */
  findIdByName(name: string): string | undefined {
    for (const s of this.map.values()) {
      if (s.name === name) return s.id;
    }
    return undefined;
  }
}

export const SkillRegistry = new SkillRegistryImpl();

// —— 批量注册 ——
SkillRegistry.register(skill_tanghao_po);
SkillRegistry.register(skill_xiuluo_zhipei);
SkillRegistry.register(skill_xiaoxuan_fen);
SkillRegistry.register(skill_xiaoyan_shiyan);
SkillRegistry.register(skill_wanglin_duoming);
SkillRegistry.register(skill_hanli_aw_chongjin);
// 阶段 B
SkillRegistry.register(skill_xiaowu_wudi);
SkillRegistry.register(skill_hanli_qingzhu);
SkillRegistry.register(skill_xuner_guzu);
SkillRegistry.register(skill_tangsan_shisha);
SkillRegistry.register(skill_xiaoyan_fonu);
SkillRegistry.register(skill_hanli_wanjian);
SkillRegistry.register(skill_wanglin_tiandi);
SkillRegistry.register(skill_xuner_tianhuo);
SkillRegistry.register(skill_tangsan_wandu);
// 阶段 C：觉醒 8 条 + 本体占位 1 条
SkillRegistry.register(skill_tangsan_cage);
SkillRegistry.register(skill_xiaowu_aw_chanhun);
SkillRegistry.register(skill_xiaowu_aw_sacrifice);
SkillRegistry.register(skill_xiaoyan_aw_fentian);
SkillRegistry.register(skill_xiaoyan_aw_huiMie);
SkillRegistry.register(skill_xuner_aw_bihu);
SkillRegistry.register(skill_xuner_aw_jieje);
SkillRegistry.register(skill_hanli_aw_dayan);
SkillRegistry.register(skill_wanglin_aw_wanhun);
SkillRegistry.register(skill_wanglin_aw_yinian);
// 阶段 D · D1 扫尾
SkillRegistry.register(skill_xiaowu_duanhun);

// —— 阶段 E1 · 绑定 SSR · 11 条 ——
SkillRegistry.register(skill_erming_tiebi);
SkillRegistry.register(skill_erming_yunji);
SkillRegistry.register(skill_yaochen_lenghuo);
SkillRegistry.register(skill_yaochen_danyi);
SkillRegistry.register(skill_guyuan_tianhuo);
SkillRegistry.register(skill_guyuan_yuangu);
SkillRegistry.register(skill_nangongwan_wanhua);
SkillRegistry.register(skill_nangongwan_guiyuan);
SkillRegistry.register(skill_situnan_xiulian);
SkillRegistry.register(skill_situnan_duoyuan);
SkillRegistry.register(skill_tanghao_potian);

// —— 阶段 E1 · 绑定 SR · 12 条 ——
SkillRegistry.register(skill_tangya_lanyin);
SkillRegistry.register(skill_tangya_shengming);
SkillRegistry.register(skill_wangdonger_shenglong);
SkillRegistry.register(skill_wangdonger_shuanglong);
SkillRegistry.register(skill_xiaozhan_bajishou);
SkillRegistry.register(skill_xiaozhan_zushudun);
SkillRegistry.register(skill_xiaoyixian_dushigu);
SkillRegistry.register(skill_xiaoyixian_quanjing);
SkillRegistry.register(skill_yinyue_yuehua);
SkillRegistry.register(skill_yinyue_yuehun);
SkillRegistry.register(skill_limuwan_qingsi);
SkillRegistry.register(skill_limuwan_qingshen);

// —— 阶段 E1 · 通用 SSR · 24 条（xiaoxuan_fen 已在 P0 批次注册）——
SkillRegistry.register(skill_bibidong_shibi);
SkillRegistry.register(skill_bibidong_zhenshen);
SkillRegistry.register(skill_huoyuhao_bingyu);
SkillRegistry.register(skill_huoyuhao_jingshen);
SkillRegistry.register(skill_ningfeng_qibao);
SkillRegistry.register(skill_ningfeng_zengfu);
SkillRegistry.register(skill_meidusa_meitong);
SkillRegistry.register(skill_meidusa_shihua);
SkillRegistry.register(skill_yunyun_fengren);
SkillRegistry.register(skill_yunyun_yunsha);
SkillRegistry.register(skill_xiaoxuan_tianyan);
SkillRegistry.register(skill_xuangu_yinyang);
SkillRegistry.register(skill_xuangu_tiandi);
SkillRegistry.register(skill_mocaihuan_xuli);
SkillRegistry.register(skill_mocaihuan_wanbo);
SkillRegistry.register(skill_ziling_laomo);
SkillRegistry.register(skill_ziling_shuangxiu);
SkillRegistry.register(skill_zhouyi_fengmo);
SkillRegistry.register(skill_zhouyi_huashen);
SkillRegistry.register(skill_tuosen_fengyin);
SkillRegistry.register(skill_tuosen_zhinu);
SkillRegistry.register(skill_tianyunzi_minge);
SkillRegistry.register(skill_tianyunzi_yinguo);

// —— 阶段 E1-C · 通用 SR · 24 条 ——
SkillRegistry.register(skill_daimubai_jinshen);
SkillRegistry.register(skill_daimubai_liguangbo);
SkillRegistry.register(skill_ningrongrong_qibao);
SkillRegistry.register(skill_ningrongrong_jiguang);
SkillRegistry.register(skill_qianrenxue_tianshi);
SkillRegistry.register(skill_qianrenxue_shengjian);
SkillRegistry.register(skill_aoska_xiangchang);
SkillRegistry.register(skill_aoska_jingxiang);
SkillRegistry.register(skill_mahongjun_tianji);
SkillRegistry.register(skill_mahongjun_huoyu);
SkillRegistry.register(skill_nalanyanran_fengshu);
SkillRegistry.register(skill_nalanyanran_fengbao);
SkillRegistry.register(skill_yafei_buji);
SkillRegistry.register(skill_yafei_mizang);
SkillRegistry.register(skill_fengxian_canyun);
SkillRegistry.register(skill_fengxian_fengbao);
SkillRegistry.register(skill_guhe_juyuan);
SkillRegistry.register(skill_guhe_pojing);
SkillRegistry.register(skill_ziyan_baonu);
SkillRegistry.register(skill_ziyan_longfeng);
SkillRegistry.register(skill_lifeiyu_jifeng);
SkillRegistry.register(skill_lifeiyu_zhuxian);
SkillRegistry.register(skill_hanyunzhi_huaxing);
SkillRegistry.register(skill_hanyunzhi_jingxiang);
SkillRegistry.register(skill_mupeiling_miaoshou);
SkillRegistry.register(skill_mupeiling_xuming);
SkillRegistry.register(skill_yuanyao_yinling);
SkillRegistry.register(skill_yuanyao_bini);
SkillRegistry.register(skill_bingfeng_hanxiao);
SkillRegistry.register(skill_bingfeng_wanli);
SkillRegistry.register(skill_hongdie_diewu);
SkillRegistry.register(skill_hongdie_guhuo);
SkillRegistry.register(skill_liumei_qingyu);
SkillRegistry.register(skill_liumei_qianmeng);
SkillRegistry.register(skill_tenghuayuan_sousen);
SkillRegistry.register(skill_tenghuayuan_jufan);
SkillRegistry.register(skill_yunquezi_qieyuan);
SkillRegistry.register(skill_yunquezi_wanhun);
SkillRegistry.register(skill_xuliguo_weishe);
SkillRegistry.register(skill_xuliguo_chongsu);
