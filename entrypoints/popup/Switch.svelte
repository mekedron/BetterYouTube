<script lang="ts">
  let {
    checked = $bindable(false),
    label,
    disabled = false,
  }: { checked: boolean; label: string; disabled?: boolean } = $props();
</script>

<button
  type="button"
  class="switch"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => (checked = !checked)}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    flex: none;
    position: relative;
    width: 36px;
    height: 22px;
    border: 0;
    border-radius: 999px;
    background: var(--track);
    cursor: pointer;
    transition: background 0.18s ease;
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
  }
  .switch:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.18s ease;
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(14px);
  }
</style>
