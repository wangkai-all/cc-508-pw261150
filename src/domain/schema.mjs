// 输入参数模式：字段定义、合法范围、业务含义。
// 所有范围校验、表单渲染、默认值都以这里为唯一事实来源（single source of truth）。

export const PARAM_FIELDS = [
  {
    key: 'price',
    label: '售价',
    unit: '元/件',
    min: 0.01,
    max: 1_000_000,
    precision: 2,
    description: '单位产品对外售价',
    group: '价格',
  },
  {
    key: 'conversionRate',
    label: '转化率',
    unit: '%',
    min: 0.01,
    max: 100,
    precision: 2,
    description: '流量到成交订单的转化百分比',
    group: '转化',
  },
  {
    key: 'traffic',
    label: '流量',
    unit: '人次',
    min: 0,
    max: 1_000_000_000,
    precision: 0,
    description: '推演周期内的潜在访问人次',
    group: '转化',
  },
  {
    key: 'unitVariableCost',
    label: '单位变动成本',
    unit: '元/件',
    min: 0,
    max: 1_000_000,
    precision: 2,
    description: '每成交一件商品的边际成本（进货/履约/支付手续费等）',
    group: '成本',
  },
  {
    key: 'fixedCost',
    label: '固定成本',
    unit: '元',
    min: 0,
    max: 10_000_000_000,
    precision: 2,
    description: '推演周期内不随销量变化的成本（租金/人力/平台费等）',
    group: '成本',
  },
  {
    key: 'supplyCap',
    label: '供给上限',
    unit: '件',
    min: 0,
    max: 1_000_000_000,
    precision: 0,
    description: '推演周期内最多可交付的商品数量（库存/产能约束）',
    group: '供给',
  },
  {
    key: 'priceVolatility',
    label: '价格波动率',
    unit: '%',
    min: 0,
    max: 100,
    precision: 2,
    description: '售价相对扰动的标准差（用于不确定区间的蒙特卡洛抽样）',
    group: '不确定性',
  },
  {
    key: 'conversionVolatility',
    label: '转化率波动率',
    unit: '%（相对）',
    min: 0,
    max: 200,
    precision: 2,
    description: '转化率相对扰动的标准差，占转化率本身的百分比',
    group: '不确定性',
  },
];

export const PARAM_KEYS = PARAM_FIELDS.map((f) => f.key);

const FIELD_BY_KEY = new Map(PARAM_FIELDS.map((f) => [f.key, f]));

export function getField(key) {
  return FIELD_BY_KEY.get(key);
}

// 蒙特卡洛抽样次数：固定常量，保证同一输入（含种子）重复运行结果一致。
export const DEFAULT_SIMULATION_RUNS = 2000;

// 不确定区间分位数（最近秩法）。
export const PERCENTILES = { p05: 5, p50: 50, p95: 95 };

// 一套内置示例参数，供页面初始加载与演示使用。
export const DEFAULT_PARAMS = Object.freeze({
  price: 199,
  conversionRate: 4.5,
  traffic: 100000,
  unitVariableCost: 110,
  fixedCost: 350000,
  supplyCap: 4000,
  priceVolatility: 8,
  conversionVolatility: 15,
});
