import { buildFeishuCard } from '@kedoupi/shared/email/notification';

const base = {
  schema: 'notify.event/v1', source: 'preview.synthetic', state: 'firing', severity: 'warning',
  occurred_at: '2026-11-14T01:30:00Z', summary: '合成预览数据', link: 'https://preview.feishu.cn/card/demo',
};
const event = (kind, title, facts, extra = {}) => ({ ...base, event_id: `preview-${kind}`, kind, title, subject: kind, facts, ...extra });

const cards = {
  alert: buildFeishuCard(event('agent.stuck', '代理需要处理', [{ label: '对象', value: '合成代理' }], { severity: 'critical' })),
  status: buildFeishuCard(event('ledger.status', '账务状态已变化', [{ label: '旧状态', value: '待处理' }, { label: '新状态', value: '已核对' }])),
  approval: buildFeishuCard(event('approval.pending', '有一项申请待批准', [{ label: '申请人', value: '合成用户' }], { severity: 'warning' })),
  delivery: buildFeishuCard(event('ledger.delivered', '账务已交付', [{ label: '验收', value: '已通过' }], { severity: 'info' })),
  notice: buildFeishuCard(event('job.health', '日常健康检查完成', [{ label: '结果', value: '正常' }], { severity: 'info', link: undefined })),
  merged: buildFeishuCard(event('notify.merged', '2 条提醒', [{ label: '提醒', value: '代理需要处理' }, { label: '健康检查', value: '正常' }], { link: undefined })),
};
process.stdout.write(`${JSON.stringify(cards)}\n`);
