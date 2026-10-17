<script lang="ts">
  import { showToast, errText } from "../lib/toast";

  let {
    label,
    confirmLabel,
    onConfirm,
    class: klass = "text-btn",
    disabled = false,
  }: {
    label: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
    class?: string;
    disabled?: boolean;
  } = $props();

  let armed = $state(false);
  let busy = $state(false);
  let timer = 0;

  async function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || busy) return;
    if (!armed) {
      armed = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { armed = false; }, 3000);
      return;
    }
    window.clearTimeout(timer);
    armed = false;
    busy = true;
    try {
      await onConfirm();
    } catch (error) {
      showToast(errText(error, "操作失败"), "err");
    } finally {
      busy = false;
    }
  }
</script>

<button class={klass} class:is-armed={armed} type="button" disabled={disabled || busy} onclick={handleClick}>
  {armed ? confirmLabel : label}
</button>
