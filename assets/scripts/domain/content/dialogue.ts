const freezeLines = <T extends readonly string[]>(lines: T): T => (
  Object.freeze([...lines]) as unknown as T
);

export const BOSS_DIALOGUE = Object.freeze({
  meeting: freezeLines(['这个需要大家先对齐一下。', '先开个会把问题定义清楚。', '我觉得要形成长期机制。'] as const),
  dump: freezeLines(['这个让负责人先处理。', '专业的事交给专业的人。', '小张，你来跟进一下。'] as const),
  outsource: freezeLines(['能花钱解决的问题就不是问题。', '找个外部团队快速落地。', '预算要用在刀刃上。'] as const),
  changeRequest: freezeLines(['原需求的格局还是小了。', '我们顺便把体验整体升级。', '这个很简单，再加两个入口。'] as const),
  strategicUpgrade: freezeLines(['要从更高维度看这个问题。', '这不是按钮，这是增长体系。', '先做一版三年战略规划。'] as const),
  complete: freezeLines(['我早就有这个思路。', '实践证明方向是对的。', '一线工作确实很有启发。', '这个成果可以总结成方法论。'] as const),
});

export const BOSS_DIALOGUE_TAGS = Object.freeze({
  '这个很简单，再加两个入口。': freezeLines(['simple-phrase'] as const),
});
