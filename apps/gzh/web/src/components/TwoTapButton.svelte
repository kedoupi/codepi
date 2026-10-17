<script lang="ts">
    let {
    label,
    confirmLabel,
    onConfirm,
    class: klass = "text-btn",
  }: {
    label: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
    class?: string;
  } = $props();

  let armed = $state(false);
  let busy = $state(false);
  let timer = 0;

  async function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!armed) {
      armed = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { armed = false; }, 3000);
      return;
    }
    window.clearTimeout(timer);
    armed = false;
    busy = true;
    // onConfirm 自行处理错误（toast）并可靠返回；成功后通常整页跳转/重载。
    // 无论结果如何都复位 busy，避免失败后按钮永久 disabled 无法重试。
    await onConfirm();
    busy = false;
  }
</script>

<button class={klass} class:is-armed={armed} type="button" disabled={busy} onclick={handleClick}>
  {armed ? confirmLabel : label}
</button>
