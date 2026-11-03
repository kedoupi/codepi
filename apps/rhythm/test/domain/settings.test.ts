import { describe, expect, it } from "vitest";
import { parseSettingsUpdate } from "../../worker/settings";

const valid = {
  subject_device_ids: ["dev-a"],
  app_categories: { "示例编辑器": "开发" },
  other_network_names: { "net-a": "示例网络" },
  anomaly_thresholds: { early_late_minutes: 40, commute_percent: 50 },
};

describe("设置输入校验", () => {
  it("接受完整设置并转换为领域字段", () => {
    expect(parseSettingsUpdate(valid)).toEqual({
      subjectDeviceIds: ["dev-a"],
      appCategories: { "示例编辑器": "开发" },
      otherNetworkNames: { "net-a": "示例网络" },
      anomalyThresholds: { earlyLateMinutes: 40, commutePercent: 50 },
    });
  });

  it("拒收疑似 secret、未知分类和额外字段", () => {
    expect(() => parseSettingsUpdate({
      ...valid,
      other_network_names: { "net-a": "sk-test-value" },
    })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({
      ...valid,
      app_categories: { "示例编辑器": "未知" },
    })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, extra: true })).toThrow("invalid_settings");
  });
});
