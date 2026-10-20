import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
target.replaceChildren();
mount(App, { target });
