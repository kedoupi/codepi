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

  it("App 名等键只校验长度与字符，含 password 的 App 名可以归类；值仍拒收像 secret 的内容", () => {
    expect(parseSettingsUpdate({ ...valid, app_categories: { "1Password": "其他", "Token Viewer": "开发" } }).appCategories)
      .toEqual({ "1Password": "其他", "Token Viewer": "开发" });
    expect(() => parseSettingsUpdate({ ...valid, other_network_names: { "net-a": "ghp_abcdefghijklmnop" } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, app_categories: { "a\u0001b": "开发" } })).toThrow("invalid_settings");
    expect(() => parseSettingsUpdate({ ...valid, app_categories: { ["x".repeat(201)]: "开发" } })).toThrow("invalid_settings");
  });
});

