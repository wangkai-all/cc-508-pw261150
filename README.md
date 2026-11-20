# 经营指标情景推演工具

调整**价格、转化率、成本、供给约束**，实时查看经营指标的联动结果与 P5–P95 不确定区间。
推演数据与正式数据**物理隔离**，方案确认后才生成**不可变、可引用**的版本；输入存在缺失、冲突或超范围时**阻断**并逐条给出原因。

零运行时依赖，原生 ES Modules + Node 内置测试运行器 + 浏览器 localStorage。

## 快速开始

```bash
npm test          # 61 个测试（域逻辑 / 校验 / 引擎 / 存储 / UI 编排 / 图表）
npm run demo      # 命令行走完整链路：阻断→推演→隔离→确认→幂等→回滚→完整性校验
npm start         # 静态服务器，浏览器打开 http://localhost:5173/
```

> ES Modules 需通过 http(s) 加载（`file://` 会被 CORS 拦截），故提供 `scripts/serve.mjs`。

## 需求 → 实现对照

| 需求 | 实现 |
| --- | --- |
| 调整价格/转化率/成本/供给约束 | `src/domain/schema.mjs` 定义 8 个参数及范围；页面左列分组表单 |
| 指标联动结果 | `src/domain/engine.mjs#computeOnce`：需求→供给截断→销量→收入/成本→利润/利润率，含保本点、供给缺口、每访客收入 |
| 不确定区间 | 固定种子的 mulberry32 + Box–Muller，2000 次蒙特卡洛，输出 P5/P50/P95（`engine.mjs` + `rng.mjs`） |
| 推演数据与正式数据隔离 | `src/domain/storage.mjs`：sandbox / ledger / audit 三个独立 localStorage key；草稿可覆盖，账本仅追加 |
| 方案确认后才生成可引用版本 | `confirmVersion` 生成 `v0001…` 版本，带内容指纹（SHA-256）与记录指纹；未确认数据永不进入账本 |
| 输入冲突/缺失/超范围阻断并给原因 | `src/domain/validation.mjs` 返回结构化错误码与中文原因，页面红色横幅 + 字段级提示，阻断期间不产出任何结果 |
| 页面展示参数、依赖、结果比较、确认记录 | `index.html` 六大区块：参数表单 / 依赖链 / KPI+区间图+数值表 / 确认区 / 版本账本 / 审计日志 |
| 验证重复运行 | 同参数 + 同种子 + 同抽样次数 → 结果逐位一致（`tests/engine.test.mjs`）；相同结果重复确认幂等，不产生重复版本 |
| 版本回滚 | `rollbackTo` 把指定版本参数载入沙箱成为草稿；账本只追加不删改；回滚前强制完整性校验 |

## 指标依赖链

```
流量 × 转化率 → 理论需求 →〔供给上限截断〕→ 成交销量
售价 − 单位变动成本 → 单位边际贡献 ┐
成交销量 × 售价 → 营业收入          ├→ 经营利润 / 利润率
成交销量 × 变动成本 + 固定成本 → 总成本 ┘
```

供给上限低于理论需求时，销量被截断并记录**供给缺口**，依赖链对应节点高亮为警示态。

## 阻断规则（`validation.mjs`）

- `PARAM_MISSING`：必填字段缺失（含空字符串、null）
- `PARAM_NOT_A_NUMBER`：非有限数字（含 NaN/Infinity/布尔/非数字字符串）
- `PARAM_OUT_OF_RANGE`：超出 schema 声明的 `[min, max]`
- `PARAM_NOT_INTEGER`：销量/流量/供给等整数字段取小数
- `PARAM_UNKNOWN_KEY`：出现未声明的参数键（防拼写错误被静默吞掉）
- `CONFLICT_COST_GE_PRICE`：单位变动成本 ≥ 售价，单位边际贡献 ≤ 0
- `CONFLICT_SUPPLY_CAP_ZERO`：供给上限为 0，无成交可能

所有问题一次性返回（不短路）；跨字段冲突仅在单字段校验全部通过后判定，避免错误叠加噪音。

## 数据隔离与版本模型

```
localStorage
├── scenario-sim:sandbox:draft:v1      推演草稿（可反复覆盖，非正式数据）
├── scenario-sim:ledger:confirmed:v1   正式版本（仅追加，不可变）
└── scenario-sim:audit:v1              审计事件流
```

- **内容指纹** `contentChecksum`：覆盖参数 + 种子 + 抽样次数 + 引擎版本（不含时间戳），同输入同指纹，是幂等确认的依据。
- **记录指纹** `checksum`：覆盖整条版本记录，`verifyIntegrity` 重算比对；任何字节级篡改都会失配并**阻断回滚**。
- 回滚只改变「当前沙箱草稿指向哪个版本」，历史账本保持完整。

## 目录结构

```
src/domain/   纯业务逻辑，无 DOM 依赖，可在 Node 与浏览器共用
  schema.mjs      参数定义、范围、默认值（唯一事实来源）
  validation.mjs  输入校验与阻断规则
  rng.mjs         确定性随机数（mulberry32 + Box–Muller）
  engine.mjs      联动计算 + 蒙特卡洛区间
  checksum.mjs    规范化 JSON + SHA-256 指纹
  storage.mjs     隔离存储、版本账本、回滚、完整性、审计
src/ui/       展示层
  format.mjs      格式化纯函数
  charts.mjs      纯 SVG 不确定区间图（蓝=基线 / 橙=当前，已通过调色板校验）
  app.mjs         页面编排（事件、渲染、与域层接线）
  styles.css      明暗双主题
scripts/      serve.mjs 静态服务器 · demo.mjs 端到端演示
tests/        node:test 测试，含 DOM stub 的 UI 编排端到端用例
```

## 可重复性说明

随机数生成器是确定性的（mulberry32），种子在页面右上角可调。固定种子与抽样次数时，
同一组参数无论运行多少次，P5/P50/P95 与全部派生指标**逐位一致**；仅 `sampledAt` 时间戳不同，
且时间戳不参与内容指纹。
