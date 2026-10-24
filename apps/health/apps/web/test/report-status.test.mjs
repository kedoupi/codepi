import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const components = ["WeeklyPage.svelte", "ComparePage.svelte"];
const componentSource = name => readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");

function renderStatus({ error, message }) {
  const role = error ? "alert" : "status";
  const live = error ? "assertive" : "polite";
  const dom = new JSDOM(`<div class="status${error ? " err" : ""}" role="${role}" aria-live="${live}">${message}</div>`);
  return dom.window.document.querySelector(".status");
}

test("weekly and compare status regions expose live loading and success updates", () => {
  for (const name of components) {
    const source = componentSource(name);
    assert.match(source, /role=\{statusErr \? "alert" : "status"\}/, `${name} should switch between alert and status roles`);
    assert.match(source, /aria-live=\{statusErr \? "assertive" : "polite"\}/, `${name} should announce status updates`);
    if (name === "WeeklyPage.svelte") assert.match(source, /class="status" role="status">\{t\(locale, "weeklyEmpty"\)\}/, "weekly empty state should remain a status update");

    const loading = renderStatus({ error: false, message: "Loading" });
    assert.equal(loading.getAttribute("role"), "status");
    assert.equal(loading.getAttribute("aria-live"), "polite");
    assert.equal(loading.textContent, "Loading");

    const success = renderStatus({ error: false, message: "Updated" });
    assert.equal(success.getAttribute("role"), "status");
    assert.equal(success.getAttribute("aria-live"), "polite");

    const failure = renderStatus({ error: true, message: "Unable to load" });
    assert.equal(failure.getAttribute("role"), "alert");
    assert.equal(failure.getAttribute("aria-live"), "assertive");
    assert.equal(failure.textContent, "Unable to load");
  }
});
