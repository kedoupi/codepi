import { describe, expect, it } from "vitest";
import { parseSettingsUpdate } from "../../worker/settings";

const valid = {
  subject_device_ids: ["dev-a"],
  app_categories: { "示例编辑器": "AI 编程" },
  other_network_names: { "net-a": "示例网络" },
  anomaly_thresholds: { early_late_minutes: 40, commute_percent: 50 },
};

describe("设置输入校验", () => {
  it("接受完整设置并转换为领域字段", () => {
    expect(parseSettingsUpdate(valid)).toEqual({
      subjectDeviceIds: ["dev-a"],
      appCategories: { "示例编辑器": "AI 编程" },
      otherNetworkNames: { "net-a": "示例网络" },
      anomalyThresholds: { earlyLateMinutes: 40, commutePercent: 50 },
    });
  });

  it("拒收疑似 secret、未知分类和额外字段", () => {
    expect(() => parseSettingsUpdate({ ...valid, other_network_names: { "net-a": "sk-test-value" } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, app_categories: { "示例编辑器": "未知" } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, extra: true })).toThrow("invalid_settings");
  });

  it("App 名等键只校验长度与字符，值必须是八类之一", () => {
    expect(parseSettingsUpdate({ ...valid, app_categories: { "1Password": "其他", "Token Viewer": "AI 编程" } }).appCategories)
      .toEqual({ "1Password": "其他", "Token Viewer": "AI 编程" });
    expect(() => parseSettingsUpdate({ ...valid, other_network_names: { "net-a": "ghp_abcdefghijklmnop" } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, app_categories: { "a\u0001b": "AI 编程" } })).toThrow("invalid_settings");
    expect(parseSettingsUpdate({ ...valid, anomaly_thresholds: { early_late_minutes: 40, commute_percent: 300 } }).anomalyThresholds.commutePercent).toBe(300);
    expect(() => parseSettingsUpdate({ ...valid, anomaly_thresholds: { early_late_minutes: 40, commute_percent: 301 } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, app_categories: { ["x".repeat(201)]: "AI 编程" } })).toThrow("invalid_settings");
  });

  it("缺少手机和门槛字段时保留已有值", () => {
    expect(parseSettingsUpdate({ app_categories: {}, other_network_names: {} }, {
      subjectDeviceIds: ["dev-a"], appCategories: {}, otherNetworkNames: {}, anomalyThresholds: { earlyLateMinutes: 45, commutePercent: 60 },
    })).toEqual({
      subjectDeviceIds: ["dev-a"], appCategories: {}, otherNetworkNames: {}, anomalyThresholds: { earlyLateMinutes: 45, commutePercent: 60 },
    });
  });
});

