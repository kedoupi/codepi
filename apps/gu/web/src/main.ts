import { mount } from "svelte";
import App from "./App.svelte";
import "./main-side-effect";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
// Svelte mount 追加而非替换：先清掉 index.html 里的 .boot 启动占位。
target.replaceChildren();
mount(App, { target });
