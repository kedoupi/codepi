/// <reference types="svelte" />
/// <reference types="vite/client" />

type ChartInstance = { destroy: () => void };

declare const Chart: {
  new (item: HTMLCanvasElement, config: unknown): ChartInstance;
};
