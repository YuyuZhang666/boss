import { describe, expect, it } from 'vitest';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';

const EXPECTED_TASKS = [
  ['dev-payment-error', 'dev', '支付接口故障', 4, 5, 5, 2, 45, 0.85, 0.35, '线上支付突然报错，客户已经开始在群里刷问号。'],
  ['dev-online-crash', 'dev', '线上服务崩溃', 5, 5, 5, 3, 30, 0.90, 0.30, '服务刚刚崩了，监控大屏红得很有节日气氛。'],
  ['dev-capacity', 'dev', '服务器紧急扩容', 4, 5, 4, 2, 60, 0.80, 0.25, '访问量暴涨，服务器正在用风扇表达意见。'],
  ['dev-button-color', 'dev', '修改按钮颜色', 1, 2, 1, 1, 180, 0.95, 0.60, '客户原话只有六个字：按钮再红一点。'],
  ['product-new-feature', 'product', '客户临时加功能', 4, 3, 4, 3, 90, 0.75, 0.50, '客户把“顺手加一下”说得像复制粘贴。'],
  ['product-scope-conflict', 'product', '需求口径打架', 3, 3, 3, 4, 120, 0.70, 0.75, '三个群里出现了四个版本的最终需求。'],
  ['product-metric', 'product', '定义增长指标', 2, 4, 2, 3, 150, 0.80, 0.55, '老板说要增长，但没人知道增长具体指什么。'],
  ['ops-launch-ppt', 'ops', '发布会 PPT', 3, 2, 5, 2, 60, 0.85, 0.55, '发布会下午开始，PPT 还停留在新建文件。'],
  ['ops-official-copy', 'ops', '公众号文案', 2, 2, 4, 1, 90, 0.90, 0.45, '今晚必须发文，标题已经改到第二十八版。'],
  ['ops-live-incident', 'ops', '直播活动事故', 4, 3, 5, 4, 30, 0.75, 0.70, '直播间突然翻车，弹幕比应急方案先到。'],
  ['sales-complaint', 'sales', '大客户投诉', 3, 2, 5, 5, 45, 0.60, 0.90, '大客户要求老板亲自解释为什么又延期了。'],
  ['sales-renewal', 'sales', '续约折扣谈判', 3, 3, 4, 5, 90, 0.65, 0.85, '客户愿意续约，但折扣已经谈出了骨折感。'],
  ['sales-overpromise', 'sales', '超范围交付承诺', 4, 2, 5, 5, 60, 0.55, 0.80, '老板昨晚答应的功能，研发今天第一次听说。'],
  ['hr-resignation', 'hr', '核心员工准备离职', 3, 3, 5, 5, 45, 0.65, 0.85, '核心员工把离职信命名为“个人发展规划”。'],
  ['hr-hiring', 'hr', '招聘名额审批', 2, 2, 3, 4, 120, 0.80, 0.80, '团队缺人，但每个审批人都建议再评估一下。'],
  ['hr-conflict', 'hr', '团队公开争执', 3, 4, 4, 5, 60, 0.70, 0.80, '两个部门在大群里用“收到”进行激烈交流。'],
  ['finance-cashflow', 'finance', '现金流异常', 5, 5, 5, 5, 45, 0.75, 0.75, '账上数字很安静，财务的表情不太安静。'],
  ['finance-invoice', 'finance', '发票抬头错误', 2, 3, 3, 1, 120, 0.90, 0.35, '一张发票写错抬头，已经旅行了三个部门。'],
  ['finance-vendor', 'finance', '供应商催款', 3, 4, 4, 4, 90, 0.80, 0.70, '供应商第六次来电，语气一次比一次像老朋友。'],
  ['admin-coffee', 'admin', '咖啡机坏了', 1, 1, 1, 1, 180, 0.95, 0.90, '咖啡机停止工作，公司真正的核心系统宕机了。'],
] as const;

describe('task content', () => {
  it('contains the exact 20-task baseline in the approved order', () => {
    expect(TASK_DEFINITIONS).toHaveLength(20);
    expect(new Set(TASK_DEFINITIONS.map((task) => task.id)).size).toBe(20);
    expect(TASK_DEFINITIONS.map((task) => [
      task.id,
      task.department,
      task.title,
      task.workload,
      task.expertise,
      task.urgency,
      task.bossFit,
      task.deadlineMinutes,
      task.employeeSuccess,
      task.bossSuccess,
      task.description,
    ])).toEqual(EXPECTED_TASKS);
  });

  it('keeps every numeric task field inside its declared range', () => {
    for (const task of TASK_DEFINITIONS) {
      for (const rating of [task.workload, task.expertise, task.urgency, task.bossFit]) {
        expect(rating).toBeGreaterThanOrEqual(1);
        expect(rating).toBeLessThanOrEqual(5);
      }
      expect(task.deadlineMinutes).toBeGreaterThan(0);
      expect(task.employeeSuccess).toBeGreaterThanOrEqual(0);
      expect(task.employeeSuccess).toBeLessThanOrEqual(1);
      expect(task.bossSuccess).toBeGreaterThanOrEqual(0);
      expect(task.bossSuccess).toBeLessThanOrEqual(1);
    }
  });
});
