import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
// Svelte mount 追加而非替换：先清掉 index.html 里的启动占位。
target.replaceChildren();
// 导出实例供测试在 teardown 显式 unmount，避免生命周期泄漏污染后续用例。
export const app = mount(App, { target });
