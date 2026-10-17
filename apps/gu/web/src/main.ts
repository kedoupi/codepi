import { mount } from "svelte";
import App from "./App.svelte";
import "./main-side-effect";

const target = document.getElementById("app");
if (!target) throw new Error("#app missing");
mount(App, { target });
