# 《老板，这个你来》微信小游戏 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个竖屏、三分钟一局、包含三日内容的微信小游戏 MVP，让玩家分配职场任务、反制老板逃避行为并生成搞笑整改日报。

**Architecture:** 使用 Cocos Creator 3.8 LTS 承担 2D 渲染、场景和微信构建，核心玩法写成不依赖 `cc` 或 `wx` 的纯 TypeScript 领域层。Cocos 组件只负责输入和表现，微信能力通过平台端口隔离；领域层由 Vitest 驱动开发，并通过固定种子的批量模拟验证可玩性。

**Tech Stack:** Cocos Creator 3.8 LTS、TypeScript、Vitest 3.2.4、微信开发者工具、微信小游戏 API。

**Spec:** `docs/superpowers/specs/2026-08-20-boss-wechat-minigame-design.md`

## Global Constraints

- 发布形态必须是微信小游戏，不是普通微信小程序或浏览器网页。
- 设备方向固定为 `Portrait`，重点覆盖 16:9 至 21:9 的竖屏比例。
- 核心逻辑不得导入 `cc`，平台无关代码不得直接访问全局 `wx`。
- 不使用 DOM、WebView、Node.js 运行能力、运行时下载脚本或 3D 物理。
- 主包目标不超过 3.5 MB；平台上限按 4 MB 检查。
- 核心三日玩法不依赖网络请求。
- 游戏切后台时必须暂停计时、任务截止时间和音频，回到前台由玩家主动继续。
- MVP 只包含一个老板、一个办公室、三日、20 个任务、5 种逃避、3 种规则、6 个事件和 4 项数值。
- 所有数值、内容和随机行为必须可复现、可配置、可自动测试。
- 完成标准必须包含 Cocos 构建、微信开发者工具编译和微信真机测试。
- 文案保持可爱、轻松、温和讽刺，不影射现实公司或人物。

---

## Prerequisites and hard gates

当前工作区只有规格文档，且本机检测结果为：Node.js `v24.19.0` 已安装；Cocos Creator、Cocos Dashboard 和微信开发者工具尚未在 PATH 或常见安装目录中找到。

实施前必须具备：

1. 通过 Cocos Dashboard 安装最新可用的 Cocos Creator 3.8.x LTS 补丁版本。
2. 安装稳定版微信开发者工具。
3. 准备一个有效的微信小游戏 AppID；早期空工程可以使用 Cocos 面板内的官方测试 AppID。
4. 最终验收至少有一台 iPhone 和两档 Android 设备。

Task 1 的微信空工程构建是硬门槛。该门槛失败时，不开始玩法实现。

官方参考：

- [Cocos Creator 3.8 LTS 用户手册](https://docs.cocos.com/creator/3.8/manual/zh/)
- [发布到微信小游戏](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-wechatgame.html)
- [命令行发布项目](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)

## Locked file structure

```text
boss-game/
├─ assets/
│  ├─ scenes/main.scene
│  ├─ prefabs/
│  │  ├─ screens/IntroScreen.prefab
│  │  ├─ screens/GameScreen.prefab
│  │  ├─ screens/ResultScreen.prefab
│  │  ├─ ui/TaskCard.prefab
│  │  ├─ ui/RuleButton.prefab
│  │  └─ office/Boss.prefab
│  ├─ resources/
│  │  ├─ audio/
│  │  ├─ textures/
│  │  └─ fonts/
│  └─ scripts/
│     ├─ domain/
│     │  ├─ model.ts
│     │  ├─ SeededRandom.ts
│     │  ├─ GameClock.ts
│     │  ├─ CompanyState.ts
│     │  ├─ TaskSystem.ts
│     │  ├─ RuleSystem.ts
│     │  ├─ BossAI.ts
│     │  ├─ EventSystem.ts
│     │  ├─ ResultSystem.ts
│     │  ├─ GameSession.ts
│     │  └─ content/
│     │     ├─ tasks.ts
│     │     ├─ rules.ts
│     │     ├─ events.ts
│     │     ├─ days.ts
│     │     └─ dialogue.ts
│     ├─ platform/
│     │  ├─ PlatformPort.ts
│     │  ├─ EditorPlatform.ts
│     │  └─ WeChatPlatform.ts
│     ├─ persistence/SaveService.ts
│     ├─ presentation/
│     │  ├─ GameViewModel.ts
│     │  ├─ ResultViewModel.ts
│     │  ├─ LayoutPolicy.ts
│     │  ├─ UiCommandMapper.ts
│     │  └─ TutorialFlow.ts
│     └─ cocos/
│        ├─ AppRoot.ts
│        ├─ IntroScreen.ts
│        ├─ GameScreen.ts
│        ├─ ResultScreen.ts
│        ├─ TaskPanel.ts
│        ├─ TaskCardView.ts
│        ├─ RuleBar.ts
│        ├─ EventChoiceBanner.ts
│        ├─ HudView.ts
│        ├─ BossView.ts
│        ├─ OfficeView.ts
│        ├─ AudioService.ts
│        └─ NodePool.ts
├─ build-configs/wechatgame.json
├─ scripts/verify-wechat-build.mjs
├─ tests/
│  ├─ build/verifyWechatBuild.test.ts
│  ├─ domain/
│  ├─ persistence/
│  ├─ platform/
│  ├─ presentation/
│  └─ helpers/
├─ docs/superpowers/specs/
├─ docs/superpowers/plans/
├─ .gitignore
├─ package.json
└─ vitest.config.ts
```

## Locked domain interfaces

The following names and signatures are shared across tasks and must not drift:

```ts
export type MeterKey = 'company' | 'rectification' | 'face' | 'trust';
export type Assignee = 'employee' | 'boss';
export type TaskStatus =
  | 'offered' | 'employee-working' | 'boss-queued' | 'boss-working'
  | 'completed' | 'failed' | 'expired';
export type AvoidanceType =
  | 'meeting' | 'dump' | 'outsource' | 'change-request' | 'strategic-upgrade';
export type RuleId = 'responsibility-chain' | 'original-request' | 'cost-time-audit';
export type BossState = 'idle' | 'working' | 'warning';

export interface RandomSource {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
}

export interface TaskDefinition {
  id: string;
  department: 'dev' | 'product' | 'ops' | 'sales' | 'hr' | 'finance' | 'admin';
  title: string;
  description: string;
  workload: 1 | 2 | 3 | 4 | 5;
  expertise: 1 | 2 | 3 | 4 | 5;
  urgency: 1 | 2 | 3 | 4 | 5;
  bossFit: 1 | 2 | 3 | 4 | 5;
  deadlineMinutes: number;
  employeeSuccess: number;
  bossSuccess: number;
}

export interface TaskInstance {
  instanceId: string;
  definitionId: string;
  status: TaskStatus;
  offeredAtMinute: number;
  deadlineAtMinute: number;
  assignedAtMinute?: number;
}

export interface MeterSnapshot {
  company: number;
  rectification: number;
  face: number;
  trust: number;
}

export interface DomainEvent {
  type: string;
  payload: Readonly<Record<string, unknown>>;
}

export interface GameSnapshot {
  version: 1;
  dayId: 'day-1' | 'day-2' | 'day-3';
  seed: number;
  rngState: number;
  phase: 'intro' | 'playing' | 'tutorial-paused' | 'paused' | 'result';
  elapsedRealMs: number;
  nextTaskSpawnMs: number;
  meters: MeterSnapshot;
  permissions: number;
  tasks: readonly TaskInstance[];
  taskSequence: number;
  workerJobs: readonly { instanceId: string; remainingMs: number }[];
  boss: {
    state: BossState;
    taskInstanceId?: string;
    avoidance?: AvoidanceType;
    avoidanceLegitimate?: boolean;
    remainingWorkMs: number;
    warningRemainingMs: number;
  };
  activeEvents: readonly { id: string; expiresAtMs: number }[];
  usedEventIds: readonly string[];
  pendingEventChoice?: { id: 'secretary-help'; remainingMs: number };
  stats: Readonly<Record<string, number>>;
}
```

---

### Task 1: Cocos scaffold, test harness, and WeChat smoke build

**Files:**
- Create through Cocos Dashboard: `assets/`, `settings/`, `profiles/`, `package.json`, `tsconfig.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `scripts/verify-wechat-build.mjs`
- Create: `tests/build/verifyWechatBuild.test.ts`
- Create by Cocos export: `build-configs/wechatgame.json`
- Verify output: `build/wechatgame/game.json`
- Verify output: `build/wechatgame/project.config.json`

**Interfaces:**
- Produces: `verifyWechatBuild(root: string): { packageBytes: number; appid: string }`
- Produces: a Cocos project that can build and open in WeChat DevTools.

- [ ] **Step 1: Install and scaffold without overwriting the approved docs**

Install Cocos Creator 3.8.x LTS and WeChat DevTools. In Cocos Dashboard, create an Empty 2D project named `boss-game-cocos-scaffold` under a temporary directory, not inside the repository root. Close the editor, then copy only the generated project entries into the workspace:

```powershell
$projectRoot = (Resolve-Path 'E:\project\game\boss-game').Path
$scaffoldRoot = (Resolve-Path (Join-Path ([IO.Path]::GetTempPath()) 'boss-game-cocos-scaffold')).Path
foreach ($entry in @('assets', 'settings', 'profiles', 'extensions', 'package.json', 'tsconfig.json')) {
  $source = Join-Path $scaffoldRoot $entry
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination $projectRoot -Recurse
  }
}
```

Do not copy `library`, `temp`, `local` or `build` from the staging project.

- [ ] **Step 2: Add version control and test dependencies**

Create `.gitignore` with:

```gitignore
/library/
/temp/
/local/
/build/
/node_modules/
*.log
.DS_Store
Thumbs.db
```

Preserve the Cocos-generated `creator` field in `package.json` and add:

```json
{
  "private": true,
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "verify:wechat": "node scripts/verify-wechat-build.mjs build/wechatgame"
  },
  "devDependencies": {
    "vitest": "3.2.4"
  }
}
```

Run:

```powershell
npm install
git init -b main
```

Expected: `node_modules` and `package-lock.json` are created; `git status --short` does not show generated cache directories.

- [ ] **Step 3: Write the failing build-verifier test**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
```

Create `tests/build/verifyWechatBuild.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyWechatBuild } from '../../scripts/verify-wechat-build.mjs';

function fixture(orientation = 'portrait') {
  const root = mkdtempSync(join(tmpdir(), 'boss-game-build-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'game.json'), JSON.stringify({ deviceOrientation: orientation }));
  writeFileSync(join(root, 'project.config.json'), JSON.stringify({ appid: 'wx-test-appid' }));
  writeFileSync(join(root, 'game.js'), 'console.log("ok")');
  return root;
}

describe('verifyWechatBuild', () => {
  it('accepts a portrait build with an appid', () => {
    expect(verifyWechatBuild(fixture()).appid).toBe('wx-test-appid');
  });

  it('rejects a landscape build', () => {
    expect(() => verifyWechatBuild(fixture('landscape'))).toThrow('portrait');
  });
});
```

- [ ] **Step 4: Run the test and verify failure**

Run: `npm test -- tests/build/verifyWechatBuild.test.ts`

Expected: FAIL because `scripts/verify-wechat-build.mjs` does not exist.

- [ ] **Step 5: Implement the minimal build verifier**

Create `scripts/verify-wechat-build.mjs`:

```js
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_BYTES = 3.5 * 1024 * 1024;

function sizeOf(root) {
  return readdirSync(root).reduce((total, name) => {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return total + sizeOf(path);
    return name.endsWith('.map') ? total : total + stat.size;
  }, 0);
}

export function verifyWechatBuild(root) {
  for (const name of ['game.json', 'project.config.json', 'game.js']) {
    if (!existsSync(join(root, name))) throw new Error(`missing ${name}`);
  }
  const game = JSON.parse(readFileSync(join(root, 'game.json'), 'utf8'));
  const project = JSON.parse(readFileSync(join(root, 'project.config.json'), 'utf8'));
  if (game.deviceOrientation !== 'portrait') throw new Error('build must be portrait');
  if (typeof project.appid !== 'string' || project.appid.length === 0) {
    throw new Error('build must contain appid');
  }
  const packageBytes = sizeOf(root);
  if (packageBytes > TARGET_BYTES) throw new Error('build exceeds 3.5 MB target');
  return { packageBytes, appid: project.appid };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(verifyWechatBuild(process.argv[2] ?? 'build/wechatgame')));
}
```

- [ ] **Step 6: Run tests and verify pass**

Run: `npm test -- tests/build/verifyWechatBuild.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 7: Perform the hard-gate WeChat build**

Open the workspace in Cocos Creator. Create `assets/scenes/main.scene` with a Canvas, Camera and Label reading `老板，这个你来`. In Build panel:

1. Select WeChat Mini Game.
2. Set orientation to Portrait.
3. Use the panel test AppID for the first smoke build.
4. Disable unused 3D and physics modules.
5. Export the build settings to `build-configs/wechatgame.json`.
6. Build to `build/wechatgame`.
7. Open the output in WeChat DevTools and compile it.

Run: `npm run verify:wechat`

Expected: verifier exits successfully; WeChat DevTools displays the label without a compile error. If this fails, stop here and resolve the toolchain before Task 2.

- [ ] **Step 8: Commit the independently runnable foundation**

```powershell
git add .gitignore package.json package-lock.json vitest.config.ts scripts tests/build assets settings profiles build-configs docs
git commit -m "chore: scaffold Cocos WeChat mini game"
```

---

### Task 2: Shared domain model, deterministic random source, and game clock

**Files:**
- Create: `assets/scripts/domain/model.ts`
- Create: `assets/scripts/domain/SeededRandom.ts`
- Create: `assets/scripts/domain/GameClock.ts`
- Create: `tests/domain/SeededRandom.test.ts`
- Create: `tests/domain/GameClock.test.ts`

**Interfaces:**
- Produces: all types from “Locked domain interfaces”.
- Produces: `new SeededRandom(seed: number)`, `next(): number`, `int(min, max): number`, `snapshot(): number`, `restore(state: number)`.
- Produces: `new GameClock(realDurationMs: number)`, `advance(deltaMs)`, `pause()`, `resume()`, `snapshot()`, `restore(snapshot)`, `minuteOfDay`, `finished`, `elapsedRealMs`.

- [ ] **Step 1: Write failing deterministic-random tests**

```ts
import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../../assets/scripts/domain/SeededRandom';

describe('SeededRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    expect([a.next(), a.next(), a.int(2, 8)]).toEqual([b.next(), b.next(), b.int(2, 8)]);
  });

  it('keeps integers inside the half-open range', () => {
    const rng = new SeededRandom(9);
    for (let i = 0; i < 100; i += 1) expect(rng.int(3, 7)).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 100; i += 1) expect(rng.int(3, 7)).toBeLessThan(7);
  });
});
```

- [ ] **Step 2: Write failing clock tests**

```ts
import { describe, expect, it } from 'vitest';
import { GameClock } from '../../assets/scripts/domain/GameClock';

describe('GameClock', () => {
  it('maps 180 real seconds to 09:00 through 18:00', () => {
    const clock = new GameClock(180_000);
    clock.advance(1_000);
    expect(clock.minuteOfDay).toBe(543);
    clock.advance(179_000);
    expect(clock.minuteOfDay).toBe(1080);
    expect(clock.finished).toBe(true);
  });

  it('does not advance while paused', () => {
    const clock = new GameClock(180_000);
    clock.pause();
    clock.advance(30_000);
    expect(clock.elapsedRealMs).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/domain/SeededRandom.test.ts tests/domain/GameClock.test.ts`

Expected: FAIL because the domain files do not exist.

- [ ] **Step 4: Implement model, RNG, and clock**

Copy the locked interfaces into `model.ts`. Implement `SeededRandom` with xorshift32; convert a zero seed to `0x6d2b79f5`, return unsigned values divided by `0x100000000`, and validate `maxExclusive > minInclusive`.

Implement `GameClock` with these formulas:

```ts
this.elapsedRealMs = Math.min(this.realDurationMs, this.elapsedRealMs + Math.max(0, deltaMs));
this.minuteOfDay = 540 + Math.floor((this.elapsedRealMs / this.realDurationMs) * 540);
this.finished = this.elapsedRealMs >= this.realDurationMs;
```

Clamp `minuteOfDay` to 1080 and make `pause()`/`resume()` idempotent.
`SeededRandom.snapshot()` returns the current unsigned xorshift state. `restore()` normalizes it to unsigned and substitutes `0x6d2b79f5` for zero. `GameClock.snapshot()` stores elapsed milliseconds and pause state; `restore()` recalculates `minuteOfDay` and `finished` instead of trusting derived values.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/domain/SeededRandom.test.ts tests/domain/GameClock.test.ts`

Expected: 4 tests PASS.

```powershell
git add assets/scripts/domain/model.ts assets/scripts/domain/SeededRandom.ts assets/scripts/domain/GameClock.ts tests/domain
git commit -m "feat: add deterministic game clock and random source"
```

---

### Task 3: Task content and task-state engine

**Files:**
- Create: `assets/scripts/domain/content/tasks.ts`
- Create: `assets/scripts/domain/TaskSystem.ts`
- Create: `tests/domain/taskContent.test.ts`
- Create: `tests/domain/TaskSystem.test.ts`

**Interfaces:**
- Consumes: `TaskDefinition`, `TaskInstance`, `Assignee`, `DomainEvent`, `RandomSource`.
- Produces: `TASK_DEFINITIONS: readonly TaskDefinition[]`.
- Produces: `TaskSystem.offer(definitionId, nowMinute)`, `assign(instanceId, assignee, nowMinute)`, `startBoss(instanceId)`, `reassignToEmployee(instanceId, nowMinute)`, `complete(instanceId, success, nowMinute)`, `expire(nowMinute)`, `snapshot()`, `restore({ tasks, sequence })`.

- [ ] **Step 1: Write failing content validation tests**

```ts
import { describe, expect, it } from 'vitest';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';

describe('task content', () => {
  it('contains exactly 20 unique valid tasks', () => {
    expect(TASK_DEFINITIONS).toHaveLength(20);
    expect(new Set(TASK_DEFINITIONS.map((task) => task.id)).size).toBe(20);
    for (const task of TASK_DEFINITIONS) {
      expect(task.workload).toBeGreaterThanOrEqual(1);
      expect(task.workload).toBeLessThanOrEqual(5);
      expect(task.employeeSuccess).toBeGreaterThanOrEqual(0);
      expect(task.employeeSuccess).toBeLessThanOrEqual(1);
      expect(task.bossSuccess).toBeGreaterThanOrEqual(0);
      expect(task.bossSuccess).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Define the exact 20-task baseline**

Create `TASK_DEFINITIONS` using this data. Success rates are `employee/boss`; deadline is measured in game minutes.

| id | department | title | workload | expertise | urgency | bossFit | deadline | success |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `dev-payment-error` | dev | 支付接口故障 | 4 | 5 | 5 | 2 | 45 | .85/.35 |
| `dev-online-crash` | dev | 线上服务崩溃 | 5 | 5 | 5 | 3 | 30 | .90/.30 |
| `dev-capacity` | dev | 服务器紧急扩容 | 4 | 5 | 4 | 2 | 60 | .80/.25 |
| `dev-button-color` | dev | 修改按钮颜色 | 1 | 2 | 1 | 1 | 180 | .95/.60 |
| `product-new-feature` | product | 客户临时加功能 | 4 | 3 | 4 | 3 | 90 | .75/.50 |
| `product-scope-conflict` | product | 需求口径打架 | 3 | 3 | 3 | 4 | 120 | .70/.75 |
| `product-metric` | product | 定义增长指标 | 2 | 4 | 2 | 3 | 150 | .80/.55 |
| `ops-launch-ppt` | ops | 发布会 PPT | 3 | 2 | 5 | 2 | 60 | .85/.55 |
| `ops-official-copy` | ops | 公众号文案 | 2 | 2 | 4 | 1 | 90 | .90/.45 |
| `ops-live-incident` | ops | 直播活动事故 | 4 | 3 | 5 | 4 | 30 | .75/.70 |
| `sales-complaint` | sales | 大客户投诉 | 3 | 2 | 5 | 5 | 45 | .60/.90 |
| `sales-renewal` | sales | 续约折扣谈判 | 3 | 3 | 4 | 5 | 90 | .65/.85 |
| `sales-overpromise` | sales | 超范围交付承诺 | 4 | 2 | 5 | 5 | 60 | .55/.80 |
| `hr-resignation` | hr | 核心员工准备离职 | 3 | 3 | 5 | 5 | 45 | .65/.85 |
| `hr-hiring` | hr | 招聘名额审批 | 2 | 2 | 3 | 4 | 120 | .80/.80 |
| `hr-conflict` | hr | 团队公开争执 | 3 | 4 | 4 | 5 | 60 | .70/.80 |
| `finance-cashflow` | finance | 现金流异常 | 5 | 5 | 5 | 5 | 45 | .75/.75 |
| `finance-invoice` | finance | 发票抬头错误 | 2 | 3 | 3 | 1 | 120 | .90/.35 |
| `finance-vendor` | finance | 供应商催款 | 3 | 4 | 4 | 4 | 90 | .80/.70 |
| `admin-coffee` | admin | 咖啡机坏了 | 1 | 1 | 1 | 1 | 180 | .95/.90 |

Use these exact descriptions in row order:

1. `线上支付突然报错，客户已经开始在群里刷问号。`
2. `服务刚刚崩了，监控大屏红得很有节日气氛。`
3. `访问量暴涨，服务器正在用风扇表达意见。`
4. `客户原话只有六个字：按钮再红一点。`
5. `客户把“顺手加一下”说得像复制粘贴。`
6. `三个群里出现了四个版本的最终需求。`
7. `老板说要增长，但没人知道增长具体指什么。`
8. `发布会下午开始，PPT 还停留在新建文件。`
9. `今晚必须发文，标题已经改到第二十八版。`
10. `直播间突然翻车，弹幕比应急方案先到。`
11. `大客户要求老板亲自解释为什么又延期了。`
12. `客户愿意续约，但折扣已经谈出了骨折感。`
13. `老板昨晚答应的功能，研发今天第一次听说。`
14. `核心员工把离职信命名为“个人发展规划”。`
15. `团队缺人，但每个审批人都建议再评估一下。`
16. `两个部门在大群里用“收到”进行激烈交流。`
17. `账上数字很安静，财务的表情不太安静。`
18. `一张发票写错抬头，已经旅行了三个部门。`
19. `供应商第六次来电，语气一次比一次像老朋友。`
20. `咖啡机停止工作，公司真正的核心系统宕机了。`

- [ ] **Step 3: Write failing task-state tests**

```ts
import { describe, expect, it } from 'vitest';
import { TaskSystem } from '../../assets/scripts/domain/TaskSystem';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';

describe('TaskSystem', () => {
  it('caps offered tasks at four', () => {
    const tasks = new TaskSystem(TASK_DEFINITIONS);
    for (let i = 0; i < 4; i += 1) tasks.offer(TASK_DEFINITIONS[i].id, 540 + i);
    expect(() => tasks.offer(TASK_DEFINITIONS[4].id, 550)).toThrow('offer queue is full');
  });

  it('caps the boss queue at three and expires overdue work', () => {
    const tasks = new TaskSystem(TASK_DEFINITIONS);
    const ids = TASK_DEFINITIONS.slice(0, 4).map((item, i) => tasks.offer(item.id, 540 + i).instanceId);
    ids.slice(0, 3).forEach((id) => tasks.assign(id, 'boss', 545));
    expect(() => tasks.assign(ids[3], 'boss', 545)).toThrow('boss queue is full');
    expect(tasks.expire(1080).some((event) => event.type === 'task-expired')).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run: `npm test -- tests/domain/taskContent.test.ts tests/domain/TaskSystem.test.ts`

Expected: content test passes after Step 2; state tests FAIL because `TaskSystem` does not exist.

- [ ] **Step 5: Implement TaskSystem**

Use an incrementing instance suffix scoped to the session: `${definitionId}-${sequence}`. Reject unknown definitions, transitions from terminal states, and queue overflow. `assign` moves tasks to `employee-working` or `boss-queued`; queued plus currently working boss tasks may total at most three. `startBoss` changes only `boss-queued` to `boss-working`. `reassignToEmployee` changes only `boss-working` to `employee-working`. `complete` only accepts working states. `expire` marks every non-terminal task whose deadline is reached and emits one event per task. Return cloned readonly snapshots so UI code cannot mutate domain state. `restore` validates every definition ID and state, restores the sequence counter, and rejects duplicate instance IDs.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- tests/domain/taskContent.test.ts tests/domain/TaskSystem.test.ts`

Expected: 3 tests PASS.

```powershell
git add assets/scripts/domain/content/tasks.ts assets/scripts/domain/TaskSystem.ts tests/domain
git commit -m "feat: add task catalog and task state engine"
```

---

### Task 4: Rectification rules and permission economy

**Files:**
- Create: `assets/scripts/domain/content/rules.ts`
- Create: `assets/scripts/domain/RuleSystem.ts`
- Create: `tests/domain/RuleSystem.test.ts`

**Interfaces:**
- Consumes: `RuleId`, `AvoidanceType`, `DomainEvent`.
- Produces: `RULE_DEFINITIONS`.
- Produces: `new RuleSystem(initialPermissions = 5)`, `use(ruleId, avoidance)`, `remaining`, `restore(remaining)`.
- `use` returns `{ accepted: boolean; matched: boolean; cost: number; events: DomainEvent[] }`.

- [ ] **Step 1: Write failing rule tests**

```ts
import { describe, expect, it } from 'vitest';
import { RuleSystem } from '../../assets/scripts/domain/RuleSystem';

describe('RuleSystem', () => {
  it('maps all five avoidances to one of three rules', () => {
    expect(new RuleSystem(5).use('responsibility-chain', 'dump').matched).toBe(true);
    expect(new RuleSystem(5).use('original-request', 'change-request').matched).toBe(true);
    expect(new RuleSystem(5).use('original-request', 'strategic-upgrade').matched).toBe(true);
    expect(new RuleSystem(5).use('cost-time-audit', 'meeting').matched).toBe(true);
    expect(new RuleSystem(5).use('cost-time-audit', 'outsource').matched).toBe(true);
  });

  it('charges a wrong rule but never allows a negative balance', () => {
    const rules = new RuleSystem(1);
    const wrong = rules.use('original-request', 'meeting');
    expect(wrong).toMatchObject({ accepted: true, matched: false, cost: 1 });
    expect(rules.remaining).toBe(0);
    expect(rules.use('cost-time-audit', 'meeting').accepted).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- tests/domain/RuleSystem.test.ts`

Expected: FAIL because `RuleSystem` does not exist.

- [ ] **Step 3: Implement exact rule definitions**

```ts
export const RULE_DEFINITIONS = {
  'responsibility-chain': { cost: 2, counters: ['dump'] },
  'original-request': { cost: 1, counters: ['change-request', 'strategic-upgrade'] },
  'cost-time-audit': { cost: 1, counters: ['meeting', 'outsource'] },
} as const;
```

`use` must emit `rule-used` for every accepted use, `avoidance-countered` when matched, `rule-missed` when mismatched, and `rule-rejected` when permissions are insufficient. Clamp restored permissions to 0 through 5.

- [ ] **Step 4: Run test and commit**

Run: `npm test -- tests/domain/RuleSystem.test.ts`

Expected: 2 tests PASS.

```powershell
git add assets/scripts/domain/content/rules.ts assets/scripts/domain/RuleSystem.ts tests/domain/RuleSystem.test.ts
git commit -m "feat: add rectification rule economy"
```

---

### Task 5: Boss finite-state machine and avoidance warnings

**Files:**
- Create: `assets/scripts/domain/content/dialogue.ts`
- Create: `assets/scripts/domain/BossAI.ts`
- Create: `tests/domain/BossAI.test.ts`
- Create: `tests/helpers/StubRandom.ts`

**Interfaces:**
- Consumes: `TaskDefinition`, `RandomSource`, `BossState`, `AvoidanceType`, `RuleId`, `DomainEvent`.
- Produces: `new BossAI(random: RandomSource)`.
- Produces: `accept(instanceId, task, nowMs, context)`, `tick(deltaMs)`, `counter(ruleId)`, `snapshot()`, `restore(snapshot)`.
- Boss context is `{ face: number; queueLength: number; minuteOfDay: number; difficulty: 1 | 2 | 3 }`.

- [ ] **Step 1: Add deterministic test random source**

```ts
import type { RandomSource } from '../../assets/scripts/domain/model';

export class StubRandom implements RandomSource {
  constructor(private readonly values: number[]) {}
  next() { return this.values.length ? this.values.shift()! : 0.5; }
  int(min: number, max: number) { return min + Math.floor(this.next() * (max - min)); }
}
```

- [ ] **Step 2: Write failing state-machine tests**

```ts
import { describe, expect, it } from 'vitest';
import { BossAI } from '../../assets/scripts/domain/BossAI';
import { TASK_DEFINITIONS } from '../../assets/scripts/domain/content/tasks';
import { StubRandom } from '../helpers/StubRandom';

describe('BossAI', () => {
  it('warns for at least 1200 ms before avoidance succeeds', () => {
    const boss = new BossAI(new StubRandom([0, 0]));
    boss.accept('sales-complaint-1', TASK_DEFINITIONS[10], 0, { face: 65, queueLength: 1, minuteOfDay: 600, difficulty: 1 });
    boss.tick(100);
    expect(boss.snapshot().state).toBe('warning');
    boss.tick(1_199);
    expect(boss.snapshot().state).toBe('warning');
    expect(boss.tick(601).some((event) => event.type === 'avoidance-succeeded')).toBe(true);
  });

  it('returns to work when the matching rule counters the warning', () => {
    const boss = new BossAI(new StubRandom([0, 0]));
    boss.accept('sales-complaint-1', TASK_DEFINITIONS[10], 0, { face: 65, queueLength: 1, minuteOfDay: 600, difficulty: 1 });
    boss.tick(100);
    const warning = boss.snapshot().avoidance;
    const matching = warning === 'dump' ? 'responsibility-chain'
      : warning === 'meeting' || warning === 'outsource' ? 'cost-time-audit'
      : 'original-request';
    expect(boss.counter(matching).some((event) => event.type === 'avoidance-countered')).toBe(true);
    expect(boss.snapshot().state).toBe('working');
  });

  it('marks urgent specialist outsourcing as legitimate', () => {
    const boss = new BossAI(new StubRandom([0, 0.99]));
    boss.accept('dev-payment-error-1', TASK_DEFINITIONS[0], 0, {
      face: 65, queueLength: 1, minuteOfDay: 600, difficulty: 1,
    });
    boss.tick(100);
    expect(boss.snapshot()).toMatchObject({ avoidance: 'outsource', avoidanceLegitimate: true });
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/domain/BossAI.test.ts`

Expected: FAIL because `BossAI` does not exist.

- [ ] **Step 4: Implement BossAI with explicit timing**

Use a 1,500 ms default warning, clamped to the spec range of 1,200–1,800 ms. Compute base avoidance chance as `0.16 + difficulty * 0.05 + queueLength * 0.04`; add `0.12` when face > 80 and `0.08` when face < 20; clamp to `0.05–0.65`. Select behavior from task tags inferred by department and attributes:

- `bossFit <= 2`: prefer `dump` or `outsource`.
- `expertise >= 4`: prefer `meeting` or `outsource`.
- `department === 'product'`: prefer `change-request` or `strategic-upgrade`.
- all other cases: evenly choose from the five behaviors.

Mark a meeting legitimate when `bossFit >= 4`, `workload >= 3`, and department is product, sales, or HR. Mark outsourcing legitimate when `urgency >= 4`, `expertise >= 4`, and `bossSuccess < 0.5`. Other avoidances are not legitimate. Include the flag in warning events and snapshots; the UI may explain the context but must not reveal whether the action is legitimate.

Work duration is `task.workload * 2_500` real milliseconds. A matched counter resumes with 80% of the remaining work time; a mismatched rule has no effect on BossAI. Emit state-change events for every transition.

When a warning expires, `meeting` resumes work after adding 3,000 ms and `strategic-upgrade` resumes work after adding 4,000 ms. `dump`, `outsource`, and `change-request` emit success and move BossAI to idle so GameSession can reassign or complete the task. Clear `taskInstanceId` only when moving to idle.

Create these exact dialogue arrays. Tag the line containing “这个很简单” with `simple-phrase` so `ResultSystem` can count it.

```ts
export const BOSS_DIALOGUE = {
  meeting: ['这个需要大家先对齐一下。', '先开个会把问题定义清楚。', '我觉得要形成长期机制。'],
  dump: ['这个让负责人先处理。', '专业的事交给专业的人。', '小张，你来跟进一下。'],
  outsource: ['能花钱解决的问题就不是问题。', '找个外部团队快速落地。', '预算要用在刀刃上。'],
  changeRequest: ['原需求的格局还是小了。', '我们顺便把体验整体升级。', '这个很简单，再加两个入口。'],
  strategicUpgrade: ['要从更高维度看这个问题。', '这不是按钮，这是增长体系。', '先做一版三年战略规划。'],
  complete: ['我早就有这个思路。', '实践证明方向是对的。', '一线工作确实很有启发。', '这个成果可以总结成方法论。'],
} as const;
```

`restore` validates remaining timers and requires a task ID for `working` or `warning` states.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/domain/BossAI.test.ts`

Expected: 3 tests PASS.

```powershell
git add assets/scripts/domain/BossAI.ts assets/scripts/domain/content/dialogue.ts tests/domain/BossAI.test.ts tests/helpers/StubRandom.ts
git commit -m "feat: add boss avoidance state machine"
```

---

### Task 6: Company meters and six temporary events

**Files:**
- Create: `assets/scripts/domain/CompanyState.ts`
- Create: `assets/scripts/domain/content/events.ts`
- Create: `assets/scripts/domain/EventSystem.ts`
- Create: `tests/domain/CompanyState.test.ts`
- Create: `tests/domain/EventSystem.test.ts`

**Interfaces:**
- Consumes: `MeterSnapshot`, `MeterKey`, `RandomSource`, `DomainEvent`.
- Produces: `new CompanyState(initial?)`, `apply(delta)`, `snapshot()`, `failed`.
- Produces: `EVENT_DEFINITIONS` with six entries.
- Produces: `new EventSystem(random, definitions)`, `draw(count)`, `activate(id, nowMs)`, `choose(id, choice, nowMs)`, `tick(nowMs)`, `modifiers()`, `snapshot()`, `restore(snapshot)`.

- [ ] **Step 1: Write failing meter tests**

```ts
import { describe, expect, it } from 'vitest';
import { CompanyState } from '../../assets/scripts/domain/CompanyState';

describe('CompanyState', () => {
  it('starts at the approved values and clamps every meter', () => {
    const state = new CompanyState();
    expect(state.snapshot()).toEqual({ company: 70, rectification: 0, face: 65, trust: 50 });
    state.apply({ company: -100, rectification: 120, face: 80, trust: -90 });
    expect(state.snapshot()).toEqual({ company: 0, rectification: 100, face: 100, trust: 0 });
    expect(state.failed).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing event tests**

```ts
import { describe, expect, it } from 'vitest';
import { EVENT_DEFINITIONS } from '../../assets/scripts/domain/content/events';
import { EventSystem } from '../../assets/scripts/domain/EventSystem';
import { StubRandom } from '../helpers/StubRandom';

describe('EventSystem', () => {
  it('contains six unique events and restores temporary modifiers', () => {
    expect(EVENT_DEFINITIONS).toHaveLength(6);
    expect(new Set(EVENT_DEFINITIONS.map((event) => event.id)).size).toBe(6);
    const events = new EventSystem(new StubRandom([0]), EVENT_DEFINITIONS);
    const id = events.draw(1)[0];
    events.activate(id, 1_000);
    expect(events.modifiers()).not.toEqual({});
    events.tick(1_000 + 30_001);
    expect(events.modifiers()).toEqual({});
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- tests/domain/CompanyState.test.ts tests/domain/EventSystem.test.ts`

Expected: FAIL because meter and event modules do not exist.

- [ ] **Step 4: Implement meters and the exact six events**

`CompanyState.apply` clamps all fields to `0–100`, emits one `meter-changed` event per changed key, and exposes `failed` when company is zero.

Create these event definitions:

| id | duration | modifier or generated effect |
| --- | ---: | --- |
| `board-observer` | 30 s | boss work speed `1.3`, avoidance chance multiplier `0.2` |
| `vip-visit` | instant | request one `sales-complaint` offer |
| `secretary-help` | 20 s | boss work speed `1.2`, trust gain multiplier `0.8` |
| `team-building` | 25 s | employee work speed `0.7` |
| `golf-invite` | 20 s | after 16:30, avoidance chance multiplier `1.5` |
| `coffee-broken` | 8 s | boss work speed `0.0`, then restore to previous effective value |

Store active events separately and derive combined modifiers from immutable base values. `draw(2)` must return unique IDs; the same event cannot activate twice in one session.
`snapshot` stores active IDs with expiry times and every used ID. `restore` rejects unknown IDs and recomputes modifiers from definitions.
Activating `secretary-help` creates a five-second pending choice instead of applying a modifier. `choose('secretary-help', 'ignore', nowMs)` activates its 20-second modifier; `choose('secretary-help', 'report', nowMs)` closes the prompt with no modifier. If the choice timer expires, apply `ignore`. Persist the pending ID and remaining choice time in the event snapshot.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/domain/CompanyState.test.ts tests/domain/EventSystem.test.ts`

Expected: 2 tests PASS.

```powershell
git add assets/scripts/domain/CompanyState.ts assets/scripts/domain/EventSystem.ts assets/scripts/domain/content/events.ts tests/domain
git commit -m "feat: add company meters and random events"
```

---

### Task 7: Day goals, scoring, report, and titles

**Files:**
- Create: `assets/scripts/domain/content/days.ts`
- Create: `assets/scripts/domain/ResultSystem.ts`
- Create: `tests/domain/ResultSystem.test.ts`

**Interfaces:**
- Consumes: `MeterSnapshot`, session statistics, task outcomes.
- Produces: `DAY_DEFINITIONS`.
- Produces: `ResultSystem.evaluate(input): DayResult`.
- `DayResult` is `{ grade: 'SSS' | 'S' | 'A' | 'B' | 'C' | 'F'; score: number; title: string; goalMet: boolean; report: readonly ReportRow[] }`.
- `ReportRow` is `{ label: string; value: string; emphasis?: 'good' | 'bad' | 'funny' }`.

- [ ] **Step 1: Write failing result tests**

```ts
import { describe, expect, it } from 'vitest';
import { ResultSystem } from '../../assets/scripts/domain/ResultSystem';

const stats = {
  bossCompleted: 5,
  bossWorkload: 18,
  totalWorkload: 30,
  bossWorkMs: 72_000,
  meetings: 2,
  usefulMeetings: 1,
  dumpAttempts: 3,
  dumpSuccesses: 0,
  outsources: 0,
  outsourceCost: 0,
  simplePhraseCount: 4,
  unresolvedUrgent: 0,
};

describe('ResultSystem', () => {
  it('awards SSS only when every approved condition is met', () => {
    const result = ResultSystem.evaluate({
      dayId: 'day-3', meters: { company: 75, rectification: 100, face: 55, trust: 75 }, stats,
    });
    expect(result).toMatchObject({ grade: 'SSS', goalMet: true });
  });

  it('caps the grade below A when the hard goal fails', () => {
    const result = ResultSystem.evaluate({
      dayId: 'day-3', meters: { company: 45, rectification: 100, face: 55, trust: 90 }, stats,
    });
    expect(['B', 'C', 'F']).toContain(result.grade);
    expect(result.goalMet).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- tests/domain/ResultSystem.test.ts`

Expected: FAIL because `ResultSystem` does not exist.

- [ ] **Step 3: Implement the exact day goals**

```ts
export const DAY_DEFINITIONS = [
  { id: 'day-1', difficulty: 1, spawnEveryMs: 15_000, goal: { bossCompleted: 3 } },
  { id: 'day-2', difficulty: 2, spawnEveryMs: 12_000, goal: { bossWorkloadRatio: 0.35 } },
  { id: 'day-3', difficulty: 3, spawnEveryMs: 10_000, goal: { companyAtLeast: 50, rectificationAtLeast: 70 } },
] as const;
```

The goal evaluator must use completed workload, not tasks still in progress.
For day 2, calculate `bossWorkload / totalWorkload`; return zero when total completed workload is zero.

- [ ] **Step 4: Implement scoring, grades, report rows, and title precedence**

Calculate score as:

```ts
const faceBalance = Math.max(0, 100 - Math.abs(meters.face - 50) * 2);
const score = Math.round(
  meters.rectification * 0.40
  + meters.company * 0.25
  + meters.trust * 0.20
  + faceBalance * 0.15,
);
```

Grade rules:

- `F`: company is zero.
- `SSS`: goal met, company ≥ 70, trust ≥ 70, face 30–70, unresolved urgent count is zero.
- `S`: goal met and score ≥ 85.
- `A`: goal met and score ≥ 70.
- `B`: score ≥ 55.
- `C`: every other non-failure result.

Title precedence, first match wins:

1. SSS → `让老板心甘情愿打工的人`.
2. meetings ≥ 5 and usefulMeetings / meetings < .3 → `会议终结者`.
3. dumpAttempts ≥ 4 and dumpSuccesses === 0 → `甩锅回旋镖大师`.
4. rectification === 100 and face < 20 → `赛博周扒皮`.
5. company < 30 → `公司还活着就行`.
6. default → `温和改革派`.

Report rows must include all ten statistics from the spec and the four ending meters. Format boss work time as `X小时Y分钟` using rounded game-time minutes.

- [ ] **Step 5: Run test and commit**

Run: `npm test -- tests/domain/ResultSystem.test.ts`

Expected: 2 tests PASS.

```powershell
git add assets/scripts/domain/content/days.ts assets/scripts/domain/ResultSystem.ts tests/domain/ResultSystem.test.ts
git commit -m "feat: add day goals and CEO report scoring"
```

---

### Task 8: Full GameSession orchestration and balance simulation

**Files:**
- Create: `assets/scripts/domain/GameSession.ts`
- Create: `tests/domain/GameSession.test.ts`
- Create: `tests/domain/balanceSimulation.test.ts`
- Create: `tests/helpers/strategies.ts`

**Interfaces:**
- Consumes: every domain module from Tasks 2–7.
- Produces: `GameSession.create(dayId, seed)`, `dispatch(command)`, `tick(realDeltaMs)`, `snapshot()`, `restore(snapshot)`.
- `GameCommand` is one of `assign-task`, `use-rule`, `event-choice`, `pause`, `resume`, `skip-intro`, `finish-tutorial`.
- Produces a complete ordered list of `DomainEvent` for every command and tick.

Use this exact command union:

```ts
export type GameCommand =
  | { type: 'assign-task'; instanceId: string; assignee: Assignee }
  | { type: 'use-rule'; ruleId: RuleId }
  | { type: 'event-choice'; eventId: 'secretary-help'; choice: 'ignore' | 'report' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'skip-intro' }
  | { type: 'finish-tutorial' };
```

- [ ] **Step 1: Write failing orchestration tests**

```ts
import { describe, expect, it } from 'vitest';
import { GameSession } from '../../assets/scripts/domain/GameSession';

describe('GameSession', () => {
  it('is deterministic for one seed and command stream', () => {
    const a = GameSession.create('day-1', 20260820);
    const b = GameSession.create('day-1', 20260820);
    for (let i = 0; i < 40; i += 1) {
      a.tick(500);
      b.tick(500);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('freezes clock and deadlines while paused', () => {
    const game = GameSession.create('day-1', 7);
    game.tick(10_000);
    game.dispatch({ type: 'pause' });
    const before = game.snapshot();
    game.tick(60_000);
    expect(game.snapshot()).toEqual(before);
  });

  it('round-trips every in-progress subsystem state', () => {
    const original = GameSession.create('day-2', 88);
    original.tick(65_000);
    const saved = original.snapshot();
    const restored = GameSession.create('day-2', 88);
    restored.restore(saved);
    expect(restored.snapshot()).toEqual(saved);
    original.tick(10_000);
    restored.tick(10_000);
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- tests/domain/GameSession.test.ts`

Expected: FAIL because `GameSession` does not exist.

- [ ] **Step 3: Implement session scheduling and commands**

Create exactly one RNG per session and pass it to all random systems. Advance the clock first, then expire tasks, resolve worker progress, tick events, tick BossAI, offer scheduled tasks, and finally check end-of-day. Use this stable order on every tick.

Initialize statistics with these exact keys and zeros:

```ts
const stats = {
  bossCompleted: 0, bossWorkload: 0, totalWorkload: 0, bossWorkMs: 0,
  meetings: 0, usefulMeetings: 0, dumpAttempts: 0, dumpSuccesses: 0,
  outsources: 0, outsourceCost: 0, simplePhraseCount: 0, unresolvedUrgent: 0,
  counteredAvoidances: 0,
};
```

Day 1 triggers one event at 70 seconds. Days 2 and 3 trigger events at 55 and 125 seconds. Draw at trigger time from events not already used. A `vip-visit` offer that encounters a full decision queue is held until the next slot opens; it keeps its original deadline relative to the actual offer time.

Employee work duration is `workload * 2_000 / employeeWorkSpeed` real milliseconds. Employee and boss success use each task's configured probability. Successful employee work changes company by `+workload`; successful boss work changes company by `+workload`, rectification by `workload * 4`, face by `-2`, and trust by `+2`. Failure changes company by `-(urgency * 2)` and trust by `-1`; expiry changes company by `-(urgency * 3)` and trust by `-2`.

Every successfully finished task adds its workload to `totalWorkload`. Boss success also increments `bossCompleted`, `bossWorkload`, and `bossWorkMs`; employee and outsourced success do not. Count `bossWorkMs` from fixed-step time actually spent in BossAI `working`, excluding warning and meeting delay.

Wrong rule use changes trust by `-2`. Mechanically matching a rule against a harmful avoidance changes face by `-3`, trust by `+1`, and increments the counter statistic. Countering a legitimate meeting or outsource still stops it but changes trust by `-3` and company by `-2`. A succeeded harmful avoidance applies:

- meeting: company `-2`, meetings `+1`.
- dump: face `+2`, dumpSuccesses `+1`, move task to employee processing.
- outsource: company `-task.workload * 2`, outsources `+1`, finish task successfully.
- change-request: trust `-3`, finish task with half rectification credit.
- strategic-upgrade: company `-3`, meetings `+1`, extend task work by 4 seconds.

A legitimate meeting adds company `+1`, trust `+1`, and usefulMeetings `+1`, while still adding 2 seconds to the task. A legitimate outsource costs company `-task.workload`, completes the task successfully, and records the same value as `outsourceCost`. Harmful outsource records `task.workload * 2` as `outsourceCost`.

At 18:00, stop offering tasks, expire unresolved high-urgency work, resolve the result once, and enter `result` phase. Event choice `secretary-ignore` adds rectification `+4` and trust `-3`; `secretary-report` adds trust `+3` and face `-4`.

`snapshot()` must include RNG state, clock, next task spawn, TaskSystem sequence and tasks, employee jobs, BossAI timers and task ID, RuleSystem balance, EventSystem active/used/pending data, meters and statistics. `restore()` validates `version === 1`, restores every subsystem, and rejects a boss or worker job that refers to a missing/non-working task.

- [ ] **Step 4: Run orchestration tests and make them pass**

Run: `npm test -- tests/domain/GameSession.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Add two explicit player strategies for automated balance checks**

In `tests/helpers/strategies.ts`, implement:

```ts
export const sensibleStrategy = {
  assign(task) { return task.bossFit >= 4 ? 'boss' : 'employee'; },
  counter(warning) {
    if (warning.legitimate) return undefined;
    if (warning.type === 'dump') return 'responsibility-chain';
    if (warning.type === 'meeting' || warning.type === 'outsource') return 'cost-time-audit';
    return 'original-request';
  },
};

export const bossOnlyStrategy = {
  assign() { return 'boss'; },
  counter() { return undefined; },
};
```

The simulation driver ticks in 100 ms increments, immediately assigns offered tasks, uses a counter when available, and stops on `result`.

- [ ] **Step 6: Write and run balance assertions**

```ts
import { describe, expect, it } from 'vitest';
import { simulate } from '../helpers/strategies';

describe('MVP balance', () => {
  it('lets a sensible strategy win most seeded games without guaranteeing SSS', () => {
    const results = Array.from({ length: 100 }, (_, seed) => simulate('day-3', seed + 1, 'sensible'));
    const wins = results.filter((r) => r.goalMet).length;
    const sss = results.filter((r) => r.grade === 'SSS').length;
    expect(wins).toBeGreaterThanOrEqual(60);
    expect(wins).toBeLessThanOrEqual(90);
    expect(sss).toBeLessThanOrEqual(20);
  });

  it('does not reward giving every task to the boss', () => {
    const results = Array.from({ length: 100 }, (_, seed) => simulate('day-3', seed + 101, 'boss-only'));
    expect(results.filter((r) => ['SSS', 'S'].includes(r.grade)).length).toBeLessThanOrEqual(10);
  });
});
```

Run: `npm test -- tests/domain/balanceSimulation.test.ts`

Expected: 2 tests PASS. Change only numeric configuration values when correcting balance; do not add special cases for the test strategies.

- [ ] **Step 7: Run the complete domain suite and commit**

Run: `npm test -- tests/domain`

Expected: all domain tests PASS.

```powershell
git add assets/scripts/domain/GameSession.ts tests/domain tests/helpers/strategies.ts
git commit -m "feat: orchestrate complete playable workday"
```

---

### Task 9: Versioned save data and platform isolation

**Files:**
- Create: `assets/scripts/platform/PlatformPort.ts`
- Create: `assets/scripts/platform/EditorPlatform.ts`
- Create: `assets/scripts/platform/WeChatPlatform.ts`
- Create: `assets/scripts/persistence/SaveService.ts`
- Create: `tests/persistence/SaveService.test.ts`
- Create: `tests/platform/EditorPlatform.test.ts`

**Interfaces:**
- Produces: `PlatformPort` with `read`, `write`, `onHide`, `onShow`, `vibrateShort`, and `getViewport`.
- Produces: `SaveService.load()`, `saveProgress()`, `savePausedGame()`, `clearPausedGame()`.
- Persisted key: `boss-game-save-v1`.

- [ ] **Step 1: Define the platform port**

```ts
export interface PlatformPort {
  read(key: string): string | null;
  write(key: string, value: string): void;
  onHide(listener: () => void): () => void;
  onShow(listener: () => void): () => void;
  vibrateShort(): void;
  getViewport(): { width: number; height: number; safeTop: number; safeBottom: number };
}
```

`EditorPlatform` uses an in-memory `Map`, listener sets, no-op vibration, and viewport `{ width: 750, height: 1624, safeTop: 44, safeBottom: 34 }`. `WeChatPlatform` accesses `wx` only through a small typed object read from `globalThis`, calls `wx.getStorageSync`, `wx.setStorageSync`, `wx.onHide`, `wx.onShow`, `wx.offHide`, `wx.offShow`, `wx.vibrateShort`, and `wx.getWindowInfo`, and catches every platform exception. Convert `safeArea.top` and the distance below `safeArea.bottom` into top/bottom insets; when window information is unavailable, return `{ width: 750, height: 1624, safeTop: 0, safeBottom: 0 }`.

- [ ] **Step 2: Write failing save tests**

```ts
import { describe, expect, it } from 'vitest';
import { EditorPlatform } from '../../assets/scripts/platform/EditorPlatform';
import { SaveService } from '../../assets/scripts/persistence/SaveService';

describe('SaveService', () => {
  it('returns a safe default for corrupt data', () => {
    const platform = new EditorPlatform();
    platform.write('boss-game-save-v1', '{broken');
    expect(new SaveService(platform).load()).toEqual({
      version: 1,
      highestUnlockedDay: 1,
      bestGrades: {},
      settings: { music: true, sound: true },
    });
  });

  it('round-trips a paused snapshot without sharing references', () => {
    const service = new SaveService(new EditorPlatform());
    const game = {
      version: 1, dayId: 'day-1', seed: 2, rngState: 2, phase: 'paused', elapsedRealMs: 10,
      nextTaskSpawnMs: 15_000,
      meters: { company: 70, rectification: 0, face: 65, trust: 50 },
      permissions: 5, tasks: [], taskSequence: 0, workerJobs: [],
      boss: { state: 'idle', remainingWorkMs: 0, warningRemainingMs: 0 },
      activeEvents: [], usedEventIds: [], stats: {},
    } as const;
    service.savePausedGame(game);
    expect(service.load().pausedGame).toEqual(game);
  });
});
```

- [ ] **Step 3: Run test and verify failure**

Run: `npm test -- tests/persistence/SaveService.test.ts tests/platform/EditorPlatform.test.ts`

Expected: FAIL because platform and save modules do not exist.

- [ ] **Step 4: Implement versioned saves and corruption recovery**

Use this persisted shape:

```ts
interface GameSaveV1 {
  version: 1;
  highestUnlockedDay: 1 | 2 | 3;
  bestGrades: Partial<Record<'day-1' | 'day-2' | 'day-3', string>>;
  settings: { music: boolean; sound: boolean };
  pausedGame?: GameSnapshot;
}
```

Validate every field after parsing. A corrupt save returns the default and overwrites storage only on the next explicit save. `savePausedGame` deep-clones through structured object copying, not by retaining the session object. `WeChatPlatform.write` first reads the current value, writes the new JSON, reads it back for equality, and restores the previous value when verification fails.

- [ ] **Step 5: Test lifecycle listeners**

Add an `EditorPlatform` test that registers hide/show callbacks, triggers each through test-only `emitHide()` and `emitShow()`, unsubscribes, and verifies no second call. Assert the editor viewport exactly. Add a WeChat adapter test with no global `wx` and assert the zero-inset fallback. Keep test emitters out of the `PlatformPort` interface.

Run: `npm test -- tests/persistence tests/platform`

Expected: all persistence and platform tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add assets/scripts/platform assets/scripts/persistence tests/persistence tests/platform
git commit -m "feat: add resilient saves and WeChat platform adapter"
```

---

### Task 10: Pure presentation models and responsive layout policy

**Files:**
- Create: `assets/scripts/presentation/GameViewModel.ts`
- Create: `assets/scripts/presentation/ResultViewModel.ts`
- Create: `assets/scripts/presentation/LayoutPolicy.ts`
- Create: `tests/presentation/GameViewModel.test.ts`
- Create: `tests/presentation/ResultViewModel.test.ts`
- Create: `tests/presentation/LayoutPolicy.test.ts`

**Interfaces:**
- Consumes: `GameSnapshot`, `TaskDefinition[]`, `DayResult`.
- Produces: `GameViewModel.from(snapshot, definitions)` and `ResultViewModel.from(result)`.
- Produces: `LayoutPolicy.forViewport(width, height, safeTop, safeBottom)`.

- [ ] **Step 1: Write failing formatting and layout tests**

```ts
import { describe, expect, it } from 'vitest';
import { GameViewModel } from '../../assets/scripts/presentation/GameViewModel';
import { LayoutPolicy } from '../../assets/scripts/presentation/LayoutPolicy';

describe('presentation', () => {
  it('formats 09:00 through 18:00 and exposes four meters', () => {
    expect(GameViewModel.formatMinute(540)).toBe('09:00');
    expect(GameViewModel.formatMinute(1080)).toBe('18:00');
    expect(GameViewModel.meterRows({ company: 70, rectification: 20, face: 65, trust: 50 })).toHaveLength(4);
  });

  it.each([[750, 1334], [750, 1624], [750, 1800]])('keeps actions above the safe bottom at %ix%i', (w, h) => {
    const layout = LayoutPolicy.forViewport(w, h, 44, 34);
    expect(layout.ruleBar.bottom).toBeGreaterThanOrEqual(34);
    expect(layout.office.height / layout.content.height).toBeGreaterThan(0.40);
    expect(layout.office.height / layout.content.height).toBeLessThan(0.55);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- tests/presentation`

Expected: FAIL because presentation modules do not exist.

- [ ] **Step 3: Implement view models**

`GameViewModel` returns immutable structures for time, goal text, four meter rows, up to four task cards, boss status text, warning text, permission count, and rule enabled states. Task cards expose only IDs and display values; they never expose mutable `TaskInstance` objects.

`ResultViewModel` maps `good`, `bad`, and `funny` report emphasis to palette tokens and produces the final quote. Use these deterministic quotes and do not call a network service:

- SSS: `我早就说过，管理者必须深入一线。`
- S or A: `这个整改机制总体方向是正确的。`
- B or C: `我认为这个流程还有很大的优化空间。`
- F: `创业嘛，最重要的是积累经验。`

- [ ] **Step 4: Implement layout policy**

Compute usable content as viewport minus safe insets. Allocate top HUD 12%, office 48%, tasks 25%, rule bar 15%; if aspect ratio is taller than 19.5:9, place extra height above and below the office rather than scaling the boss. Return integer rectangles `{ x, y, width, height, top?, bottom? }` for all four regions.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- tests/presentation`

Expected: all presentation tests PASS.

```powershell
git add assets/scripts/presentation tests/presentation
git commit -m "feat: add game presentation and portrait layout models"
```

---

### Task 11: Cocos scene shell, portrait HUD, task cards, and rule input

**Files:**
- Modify in Cocos Editor: `assets/scenes/main.scene`
- Create in Cocos Editor: `assets/prefabs/screens/GameScreen.prefab`
- Create in Cocos Editor: `assets/prefabs/ui/TaskCard.prefab`
- Create in Cocos Editor: `assets/prefabs/ui/RuleButton.prefab`
- Create: `assets/scripts/presentation/UiCommandMapper.ts`
- Create: `assets/scripts/cocos/AppRoot.ts`
- Create: `assets/scripts/cocos/GameScreen.ts`
- Create: `assets/scripts/cocos/TaskPanel.ts`
- Create: `assets/scripts/cocos/TaskCardView.ts`
- Create: `assets/scripts/cocos/RuleBar.ts`
- Create: `assets/scripts/cocos/EventChoiceBanner.ts`
- Create: `assets/scripts/cocos/HudView.ts`
- Create: `assets/scripts/cocos/NodePool.ts`
- Create: `tests/presentation/UiCommandMapper.test.ts`

**Interfaces:**
- Consumes: `GameSession`, `GameViewModel`, `LayoutPolicy`, `PlatformPort`, `SaveService`.
- Produces: user commands without exposing Cocos nodes to the domain layer.
- `UiCommandMapper.assign(instanceId, assignee)`, `UiCommandMapper.useRule(ruleId)`, and `UiCommandMapper.eventChoice(choice)` return `GameCommand`.

- [ ] **Step 1: Write the failing input-mapping test**

```ts
import { describe, expect, it } from 'vitest';
import { UiCommandMapper } from '../../assets/scripts/presentation/UiCommandMapper';

describe('UiCommandMapper', () => {
  it('creates domain commands from task and rule taps', () => {
    expect(UiCommandMapper.assign('task-7', 'boss')).toEqual({
      type: 'assign-task', instanceId: 'task-7', assignee: 'boss',
    });
    expect(UiCommandMapper.useRule('cost-time-audit')).toEqual({
      type: 'use-rule', ruleId: 'cost-time-audit',
    });
    expect(UiCommandMapper.eventChoice('report')).toEqual({
      type: 'event-choice', eventId: 'secretary-help', choice: 'report',
    });
  });
});
```

- [ ] **Step 2: Run the test, implement the mapper, and rerun**

Run: `npm test -- tests/presentation/UiCommandMapper.test.ts`

Expected before implementation: FAIL because the mapper does not exist.

Implement the three static methods as exact object constructors with no side effects.

Run again. Expected: 1 test PASS.

- [ ] **Step 3: Build the root scene hierarchy**

In Cocos Editor, set Canvas design resolution to `750 × 1624`, Fit Width enabled, Fit Height disabled. Build this hierarchy:

```text
Canvas
├─ Background
├─ SafeContent
│  └─ ScreenLayer
├─ ModalLayer
└─ ToastLayer
AppRoot
Camera
```

Attach `AppRoot.ts` to `AppRoot`. At startup it selects `WeChatPlatform` only when a valid `wx` object exists; otherwise it uses `EditorPlatform`. It loads `SaveService`, creates or restores `GameSession`, subscribes to platform hide/show, and instantiates the current screen under `ScreenLayer`.

- [ ] **Step 4: Build the GameScreen prefab hierarchy**

```text
GameScreen
├─ Hud (12%)
│  ├─ TimeLabel
│  ├─ TimeProgress
│  ├─ GoalLabel
│  └─ MeterRow
├─ Office (48%)
│  ├─ OfficeBackground
│  ├─ BossAnchor
│  ├─ DeskTaskAnchor
│  └─ BubbleAnchor
│  └─ EventChoiceBanner
├─ TaskPanel (25%)
│  ├─ HorizontalCards
│  ├─ EmployeeButton
│  └─ BossButton
└─ RuleBar (15%)
   ├─ PermissionLabel
   └─ ThreeRuleButtons
```

Use Widget/Layout components for the four regions, not absolute device pixels. Ask `PlatformPort.getViewport()` for width, height and safe insets, pass them to `LayoutPolicy`, and set the four region rectangles from its output.

- [ ] **Step 5: Apply the platform viewport to the prefab**

Read `PlatformPort.getViewport()` once at screen creation and again after a foreground return. Pass it through `LayoutPolicy`, update the four root region transforms, and rerender only when the returned dimensions or insets changed. Run the Task 9 adapter viewport tests before previewing the prefab.

- [ ] **Step 6: Implement a fixed-step GameScreen driver**

`GameScreen.update(dt)` must cap a frame at 250 ms and advance the domain in 100 ms fixed steps:

```ts
this.accumulatorMs += Math.min(dt * 1000, 250);
while (this.accumulatorMs >= 100) {
  const events = this.session.tick(100);
  this.consume(events);
  this.accumulatorMs -= 100;
}
```

Rebuild `GameViewModel` only after domain events or once per 100 ms step. Do not allocate task cards every frame.

- [ ] **Step 7: Implement pooled task cards and rule buttons**

`NodePool` owns inactive TaskCard nodes and resets label text, button listeners, scale, opacity and position on release. `TaskPanel` renders at most four cards and a single expanded card. `TaskCardView` emits an instance ID only. `RuleBar` shows remaining points, disables unaffordable rules, supports long-press help after 450 ms, and prevents a second tap until the first domain command returns.

`EventChoiceBanner` appears only for `secretary-help`, shows “睁一只眼闭一只眼”和“举报代做”, displays the five-second countdown, and sends one `event-choice` command. It disables both buttons after the first tap and hides when the corresponding domain event resolves.

- [ ] **Step 8: Connect lifecycle pause and snapshot saving**

On platform hide: dispatch `pause`, save `session.snapshot()` through `SaveService`, and pause audio. On show: display a blocking “继续工作” modal; only its button dispatches `resume`. Never advance the session by wall-clock time while hidden.

- [ ] **Step 9: Verify three portrait sizes in Cocos preview**

Preview at `750×1334`, `750×1624`, and `750×1800`. Expected at every size:

- HUD and rule bar are inside the safe area.
- The boss remains fully visible.
- Both assignment buttons remain reachable.
- Task cards do not overlap the rules.
- Extra tall-screen space becomes office padding rather than stretched art.

- [ ] **Step 10: Run tests and commit**

Run: `npm test`

Expected: all tests PASS.

```powershell
git add assets/scenes assets/prefabs assets/scripts/cocos assets/scripts/presentation assets/scripts/platform tests
git commit -m "feat: build responsive portrait game interface"
```

---

### Task 12: First-entry story and in-context tutorial

**Files:**
- Create in Cocos Editor: `assets/prefabs/screens/IntroScreen.prefab`
- Create: `assets/scripts/cocos/IntroScreen.ts`
- Create: `assets/scripts/presentation/TutorialFlow.ts`
- Modify: `assets/scripts/domain/GameSession.ts`
- Modify: `assets/scripts/persistence/SaveService.ts`
- Modify: `assets/scripts/cocos/AppRoot.ts`
- Create: `tests/presentation/TutorialFlow.test.ts`
- Modify: `tests/persistence/SaveService.test.ts`

**Interfaces:**
- Produces: `TutorialFlow.next(event)`, `currentStep`, `completed`.
- Adds `tutorialCompleted: boolean` to `GameSaveV1`.
- Extends creation to `GameSession.create(dayId, seed, options?: { tutorial: boolean })`; omitted options preserve the Task 8 playing behavior.
- Allows only the current tutorial-required `assign-task` or `use-rule` command while phase is `tutorial-paused`; all other commands and all time-based updates remain frozen.

- [ ] **Step 1: Write the failing tutorial-state test**

```ts
import { describe, expect, it } from 'vitest';
import { TutorialFlow } from '../../assets/scripts/presentation/TutorialFlow';

describe('TutorialFlow', () => {
  it('advances only on the required first actions', () => {
    const flow = new TutorialFlow();
    expect(flow.currentStep).toBe('intro');
    flow.next({ type: 'intro-finished' });
    expect(flow.currentStep).toBe('assign-first-task');
    flow.next({ type: 'task-assigned-to-boss' });
    expect(flow.currentStep).toBe('counter-first-dump');
    flow.next({ type: 'avoidance-countered' });
    expect(flow.completed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and implement TutorialFlow**

Run: `npm test -- tests/presentation/TutorialFlow.test.ts`

Expected before implementation: FAIL. Implement exactly three steps: `intro`, `assign-first-task`, `counter-first-dump`, followed by `done`. Ignore unrelated events. Run again and expect PASS.

- [ ] **Step 3: Build the 22-second intro prefab**

Create five timed beats with a visible skip button from the first frame:

1. 0–4 s: AI 大屏“经营效率审计完成”。
2. 4–8 s: “CEO 一线参与度：3.2%”。
3. 8–12 s: 老板“数据不一定能反映真实情况。”
4. 12–17 s: AI“整改方案已由董事会通过。”
5. 17–22 s: 玩家电脑“已获得整改任务提交权限”。

The final button is “开始今天的工作”. Skip and final button both emit `intro-finished` exactly once. Intro timers use Cocos scheduling and are cancelled when the prefab is destroyed.

- [ ] **Step 4: Add contextual first-task and first-dump teaching**

When `GameSession.create` receives `{ tutorial: true }`, start in `intro`. After intro, force the first offered task to `sales-complaint`. Freeze phase at `tutorial-paused`, highlight the task and “提交老板”, and disable unrelated controls. After assignment, force the first boss behavior to `dump`; when the warning appears, freeze again and highlight `责任链追溯`. Allow that one command through the paused phase, then mark the tutorial complete and resume time. Normal sessions never force task or behavior selection.

- [ ] **Step 5: Persist completion and verify no repeat**

Add `tutorialCompleted: false` to the safe default save. After the first successful counter, save it as true. On subsequent launches, show a compact home state with “继续整改” instead of replaying the intro. Add a persistence test that round-trips this flag.

- [ ] **Step 6: Test pause correctness and commit**

Add a GameSession test that records the snapshot during both tutorial pauses, ticks 10 seconds, and verifies elapsed time and deadlines are unchanged.

Run: `npm test`

Expected: all tests PASS.

```powershell
git add assets/prefabs/screens assets/scripts/cocos/IntroScreen.ts assets/scripts/presentation/TutorialFlow.ts assets/scripts/domain/GameSession.ts assets/scripts/persistence/SaveService.ts assets/scripts/cocos/AppRoot.ts tests
git commit -m "feat: add first-entry story and contextual tutorial"
```

---

### Task 13: Final art, boss reactions, audio, and result screen

**Files:**
- Create in Cocos Editor: `assets/prefabs/office/Boss.prefab`
- Create in Cocos Editor: `assets/prefabs/screens/ResultScreen.prefab`
- Create: `assets/scripts/cocos/BossView.ts`
- Create: `assets/scripts/cocos/OfficeView.ts`
- Create: `assets/scripts/cocos/AudioService.ts`
- Create: `assets/scripts/cocos/ResultScreen.ts`
- Create: `assets/scripts/cocos/AssetCatalog.ts`
- Create generated bitmap assets under: `assets/resources/textures/`
- Create generated audio under: `assets/resources/audio/`
- Create: `scripts/generate-audio.mjs`
- Create: `tests/build/assetCatalog.test.ts`

**Interfaces:**
- Consumes: domain events, `GameViewModel`, `ResultViewModel`, save settings.
- Produces: complete event-to-animation and event-to-sound mappings.
- Produces: `AssetCatalog` with stable resource keys.

Create `AssetCatalog.ts` as a pure TypeScript constant with no `cc` import:

```ts
export const AssetCatalog = {
  boss: {
    idle: 'textures/boss/idle', phone: 'textures/boss/phone', coffee: 'textures/boss/coffee',
    receive: 'textures/boss/receive', work: 'textures/boss/work', shock: 'textures/boss/shock',
    guilty: 'textures/boss/guilty', meeting: 'textures/boss/meeting', dump: 'textures/boss/dump',
    outsource: 'textures/boss/outsource', changeRequest: 'textures/boss/change-request',
    giveUp: 'textures/boss/give-up', complete: 'textures/boss/complete',
  },
  office: {
    background: 'textures/office/background', deskFront: 'textures/office/desk-front',
    deskMess: 'textures/office/desk-mess',
  },
  ui: {
    ruleResponsibility: 'textures/ui/rule-responsibility', ruleOriginal: 'textures/ui/rule-original',
    ruleAudit: 'textures/ui/rule-audit', stampSuccess: 'textures/ui/stamp-success', stampFail: 'textures/ui/stamp-fail',
    deptDev: 'textures/ui/dept-dev', deptProduct: 'textures/ui/dept-product', deptOps: 'textures/ui/dept-ops',
    deptSales: 'textures/ui/dept-sales', deptHr: 'textures/ui/dept-hr', deptFinance: 'textures/ui/dept-finance',
    deptAdmin: 'textures/ui/dept-admin', meterCompany: 'textures/ui/meter-company',
    meterRectification: 'textures/ui/meter-rectification', meterFace: 'textures/ui/meter-face',
    meterTrust: 'textures/ui/meter-trust',
  },
  audio: {
    taskArrive: 'audio/task-arrive', taskSubmit: 'audio/task-submit', ruleStamp: 'audio/rule-stamp',
    counterSuccess: 'audio/counter-success', warning: 'audio/warning', resultGood: 'audio/result-good',
    resultBad: 'audio/result-bad', uiTap: 'audio/ui-tap', officeLoop: 'audio/office-loop',
  },
} as const;
```

- [ ] **Step 1: Write the failing asset-catalog test**

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetCatalog } from '../../assets/scripts/cocos/AssetCatalog';

describe('AssetCatalog', () => {
  it('declares every MVP boss pose and core sound', () => {
    expect(Object.keys(AssetCatalog.boss)).toEqual(expect.arrayContaining([
      'idle', 'phone', 'coffee', 'receive', 'work', 'shock', 'guilty',
      'meeting', 'dump', 'outsource', 'changeRequest', 'giveUp', 'complete',
    ]));
    for (const path of Object.values(AssetCatalog.audio)) {
      expect(existsSync(join(process.cwd(), 'assets/resources', `${path}.wav`))).toBe(true);
    }
    for (const path of [...Object.values(AssetCatalog.boss), ...Object.values(AssetCatalog.office), ...Object.values(AssetCatalog.ui)]) {
      expect(existsSync(join(process.cwd(), 'assets/resources', `${path}.png`))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Create a consistent generated-art style sheet**

Before producing bitmap artwork, load the `imagegen` skill. Generate one style sheet containing the Q-version boss, office palette, task card shapes and five facial expressions. Use the confirmed palette and these invariants:

- original fictional boss, no resemblance to a public figure;
- large head, small body, rounded shapes, clean outlines;
- warm cream office, mint UI, coral actions;
- no embedded text in bitmap art;
- transparent background for character poses;
- consistent camera angle and costume across poses.

Inspect the style sheet before generating final assets. Save final approved images as PNG; use `1024×1024` source for the office and `512×512` source for each boss pose, then let Cocos import and atlas them.

- [ ] **Step 3: Produce the exact MVP bitmap set**

Create:

- `office/background.png`, `office/desk-front.png`, `office/desk-mess.png`.
- `boss/idle.png`, `phone.png`, `coffee.png`, `receive.png`, `work.png`, `shock.png`, `guilty.png`, `meeting.png`, `dump.png`, `outsource.png`, `change-request.png`, `give-up.png`, `complete.png`.
- `ui/rule-responsibility.png`, `rule-original.png`, `rule-audit.png`, `stamp-success.png`, `stamp-fail.png`.
- seven department icons and four meter icons.

Create texture atlases no larger than `2048×2048`. Trim transparent borders and disable mipmaps for 2D UI sprites.

- [ ] **Step 4: Generate original lightweight audio**

Create `scripts/generate-audio.mjs` using Node’s `Buffer` API to write mono, 16-bit PCM WAV files. Its core signatures and note table are:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function oscillator(type, frequency, timeSeconds) {
  const phase = Math.PI * 2 * frequency * timeSeconds;
  if (type === 'square') return Math.sin(phase) >= 0 ? 1 : -1;
  if (type === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase));
  return Math.sin(phase);
}

function envelope(sampleIndex, sampleCount, sampleRate, attackMs = 5, releaseMs = 40) {
  const attack = Math.max(1, Math.round(sampleRate * attackMs / 1000));
  const release = Math.max(1, Math.round(sampleRate * releaseMs / 1000));
  if (sampleIndex < attack) return sampleIndex / attack;
  if (sampleIndex >= sampleCount - release) return (sampleCount - sampleIndex - 1) / release;
  return 1;
}

function writeWav(path, sampleRate, samples) {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, wav);
}

function renderNotes(sampleRate, notes, gain = 0.22) {
  const output = [];
  for (const [type, frequency, seconds] of notes) {
    const count = Math.round(sampleRate * seconds);
    for (let i = 0; i < count; i += 1) {
      output.push(oscillator(type, frequency, i / sampleRate) * envelope(i, count, sampleRate) * gain);
    }
  }
  return output;
}

const sounds = [
  ['task-arrive', 22050, [['sine', 660, 0.07], ['sine', 880, 0.07]]],
  ['task-submit', 22050, [['triangle', 440, 0.09], ['triangle', 220, 0.09]]],
  ['rule-stamp', 22050, [['triangle', 120, 0.08], ['sine', 900, 0.04]]],
  ['counter-success', 22050, [['sine', 523.25, 0.08], ['sine', 659.25, 0.08], ['sine', 783.99, 0.08]]],
  ['warning', 22050, [['square', 740, 0.15], ['square', 660, 0.15]]],
  ['result-good', 22050, [['triangle', 523.25, 0.125], ['triangle', 659.25, 0.125], ['triangle', 783.99, 0.125], ['triangle', 1046.50, 0.125]]],
  ['result-bad', 22050, [['triangle', 329.63, 0.15], ['triangle', 293.66, 0.15], ['triangle', 261.63, 0.15]]],
  ['ui-tap', 22050, [['sine', 820, 0.07]]],
];

const outputRoot = join(process.cwd(), 'assets', 'resources', 'audio');
for (const [name, sampleRate, notes] of sounds) {
  writeWav(join(outputRoot, `${name}.wav`), sampleRate, renderNotes(sampleRate, notes));
}
const loopNotes = [261.63, 329.63, 392.00, 329.63, 440.00, 392.00, 329.63, 293.66]
  .map((frequency) => ['triangle', frequency, 1]);
writeWav(join(outputRoot, 'office-loop.wav'), 11025, renderNotes(11025, loopNotes, 0.09));
```

Use the functions above to generate these original sounds:

- `task-arrive.wav`: 660→880 Hz, 140 ms.
- `task-submit.wav`: 440→220 Hz, 180 ms.
- `rule-stamp.wav`: 120 Hz thump plus 900 Hz click, 120 ms.
- `counter-success.wav`: C5–E5–G5, 240 ms.
- `warning.wav`: 740/660 Hz alternating, 300 ms.
- `result-good.wav`: C5–E5–G5–C6, 500 ms.
- `result-bad.wav`: E4–D4–C4, 450 ms.
- `ui-tap.wav`: 820 Hz, 70 ms.
- `office-loop.wav`: an 8-second, 11,025 Hz quiet triangle-wave loop using C4–E4–G4–E4–A4–G4–E4–D4, one second per note.

Keep total generated audio below 600 KB. Run `node scripts/generate-audio.mjs` and commit both script and generated WAV files.

- [ ] **Step 5: Implement BossView and office reactions**

Map state events to cross-faded sprite poses and Cocos tweens. Required timings:

- task receive: 300 ms squash-and-bounce plus folder flight;
- warning: 1.2–1.8 s pulse and matching bubble;
- correct counter: 250 ms desk shake, guilty pose, stamp sound;
- wrong counter: 160 ms button shake, no boss state reset;
- completion: 350 ms proud pose and small confetti capped at 12 particles.

`OfficeView` shows coffee steam, monitor blink and plant sway only outside low-performance mode. Desk mess switches at boss queue lengths 2 and 3.

- [ ] **Step 6: Build and bind the ResultScreen prefab**

The result screen displays grade, title, ten statistics, four meters, boss quote, “再来一天” and “返回整改计划”. Use `ResultViewModel` only; no result math in the Cocos component. Count-up animation lasts at most 1.2 seconds and is skippable by tap. MVP does not show a leaderboard or payment control.

- [ ] **Step 7: Implement AudioService and settings**

Preload the eight short sounds and `office-loop.wav` after the first user interaction. Loop `office-loop.wav` on one music channel and use three reusable effect channels. Respect `music` and `sound` save settings, pause all channels on hide, and never start audio from the intro before a tap. Music and sound effects are enabled by default and can be switched independently.

- [ ] **Step 8: Run asset tests, preview, and commit**

Run: `npm test -- tests/build/assetCatalog.test.ts`

Expected: asset catalog test PASS and generated audio total is below 600 KB.

In Cocos preview, manually trigger every boss behavior and both result outcomes. Expected: no missing sprite, overlapping bubble, stalled animation, or audio playing after hide.

```powershell
git add assets/prefabs assets/resources assets/scripts/cocos scripts/generate-audio.mjs tests/build/assetCatalog.test.ts
git commit -m "feat: add final office art audio and result presentation"
```

---

### Task 14: Automated build wrapper, package budget, DevTools, and real-device acceptance

**Files:**
- Create: `scripts/build-wechat.ps1`
- Modify from Cocos export: `build-configs/wechatgame.json`
- Create during verification: `docs/qa/wechat-mvp-test-report.md`

**Interfaces:**
- Consumes: Cocos executable path, project path, exported build config, AppID.
- Produces: reproducible `build/wechatgame` output and a completed QA report.

- [ ] **Step 1: Create a safe command-line build wrapper**

Create `scripts/build-wechat.ps1`:

```powershell
param(
  [Parameter(Mandatory = $true)][string]$CreatorPath,
  [Parameter(Mandatory = $true)][string]$AppId
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$creatorExe = (Resolve-Path -LiteralPath $CreatorPath).Path
$sourceConfig = (Resolve-Path (Join-Path $projectRoot 'build-configs\wechatgame.json')).Path
$generatedDir = Join-Path $projectRoot 'temp\codex-wechat-build'
New-Item -ItemType Directory -Force $generatedDir | Out-Null
$generatedConfig = Join-Path $generatedDir 'wechatgame.json'
$buildLog = Join-Path $generatedDir 'creator-build.log'

$config = Get-Content -Raw -Encoding UTF8 $sourceConfig | ConvertFrom-Json
if ($null -eq $config.packages.wechatgame) { throw 'exported config is missing packages.wechatgame' }
$config.packages.wechatgame.appid = $AppId
$config.packages.wechatgame.orientation = 'portrait'
$configJson = $config | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText($generatedConfig, $configJson, [Text.UTF8Encoding]::new($false))

& $creatorExe --project $projectRoot --build "configPath=$generatedConfig;logDest=$buildLog"
$creatorExit = $LASTEXITCODE
if ($creatorExit -ne 36) { throw "Cocos build failed with exit code $creatorExit; see $buildLog" }

node (Join-Path $projectRoot 'scripts\verify-wechat-build.mjs') (Join-Path $projectRoot 'build\wechatgame')
if ($LASTEXITCODE -ne 0) { throw 'WeChat build verification failed' }
```

Cocos Creator 3.8 command-line success code is 36; all other exit codes fail the wrapper.

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
npm test
```

Expected: every build, domain, persistence, platform and presentation test PASS, including 200 balance simulations.

- [ ] **Step 3: Build the production-shaped WeChat output**

Discover the installed executable and read the AppID from a task-specific environment variable:

```powershell
$creatorCommand = Get-Command CocosCreator -ErrorAction SilentlyContinue
$creatorExe = if ($creatorCommand) { $creatorCommand.Source } else {
  Get-ChildItem 'D:\Program Files\CocosCreator','C:\Program Files\CocosCreator' -Filter CocosCreator.exe -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
$gameAppId = [Environment]::GetEnvironmentVariable('BOSS_GAME_WECHAT_APPID')
if ([string]::IsNullOrWhiteSpace($creatorExe)) { throw 'CocosCreator.exe was not found' }
if ([string]::IsNullOrWhiteSpace($gameAppId)) { throw 'BOSS_GAME_WECHAT_APPID is not set' }
.\scripts\build-wechat.ps1 -CreatorPath $creatorExe -AppId $gameAppId
```

Do not write the production AppID into source files. Expected: build exit code is treated as success, verifier passes, and `build/wechatgame` contains portrait `game.json`, correct `project.config.json`, and `game.js`.

- [ ] **Step 4: Verify package and resource rules in WeChat DevTools**

Import `build/wechatgame`, compile with the current stable base library, and record:

- DevTools version and base-library version.
- main-package size and total package size.
- compile warnings and whether each was fixed or explicitly accepted.
- network requests; core three-day play must make none.
- absence of remote script, WebView, DOM and Node runtime use.

Main package must be ≤ 3.5 MB by project target and below the platform 4 MB limit. If over target, first trim unused engine modules, compress atlases and generated WAV files, then use official engine separation; do not delete generated runtime files by hand.

- [ ] **Step 5: Execute the device matrix**

On one iPhone and two Android devices representing mid-range and lower-range hardware, perform:

1. Fresh launch and complete intro.
2. Skip intro on a reset test profile.
3. Complete all three days.
4. Trigger all five avoidance behaviors and all three rules.
5. Trigger all six random events across seeded/repeated sessions.
6. Hide for 30 seconds during a task warning, return, and verify no time advanced.
7. Lock the screen during play, unlock, and resume through the modal.
8. Disable network after launch and finish a complete day.
9. Restart after a paused save and verify task, meter and clock state.
10. Play ten consecutive sessions and watch memory and frame rate.

Acceptance: no crash, black screen, stuck input, lost result, or hidden-time advance; minimum stable gameplay frame rate is 30 FPS.

- [ ] **Step 6: Create the completed QA report**

Create `docs/qa/wechat-mvp-test-report.md` containing:

- commit hash tested;
- Cocos Creator exact 3.8.x version;
- WeChat DevTools and base-library versions;
- build command used with AppID redacted;
- main-package and total sizes;
- each test device model, OS, WeChat version, average FPS and peak memory;
- results for all ten device-matrix scenarios;
- known non-blocking limitations;
- final pass/fail decision against every item in design-spec section 19.

Do not mark a row passed without an observed result. P0/P1 issues block completion; P2 issues require an explicit accepted limitation in the report.

- [ ] **Step 7: Final regression and commit**

Run:

```powershell
npm test
.\scripts\build-wechat.ps1 -CreatorPath $creatorExe -AppId $gameAppId
git status --short
```

Expected: tests and build pass; only intended source and QA-report changes are present.

```powershell
git add scripts/build-wechat.ps1 build-configs assets tests docs/qa package.json package-lock.json
git commit -m "test: verify WeChat mini game release candidate"
```

---

## Spec coverage map

| Spec area | Implemented and verified by |
| --- | --- |
| Three-minute core loop and three days | Tasks 2, 3, 7, 8 |
| 20 tasks and queue limits | Task 3 |
| Five boss avoidances and warning window | Task 5 |
| Three rules and five permission points | Task 4 |
| Four meters and six events | Task 6 |
| CEO report, grades, and six titles | Task 7 and Task 13 |
| Determinism and balance | Task 8 |
| Save corruption and hide/show recovery | Task 9 and Task 11 |
| Portrait responsive interface | Task 10 and Task 11 |
| First-entry story and contextual tutorial | Task 12 |
| Cute modern art, animation, and sound | Task 13 |
| Package, Cocos build, DevTools, and devices | Task 1 and Task 14 |

## Completion definition

The project is complete only when Task 14 is passed and its QA report contains observed results. Passing browser or Cocos preview alone is not completion.
