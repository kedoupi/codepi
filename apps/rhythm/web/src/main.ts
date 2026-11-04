import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";

// 深色模式跟随系统：tokens.css 的深色主题按 data-theme 生效。
const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
const applyTheme = () => { document.documentElement.dataset.theme = scheme?.matches ? "dark" : "light"; };
applyTheme();
scheme?.addEventListener?.("change", applyTheme);

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
target.replaceChildren();
mount(App, { target });
