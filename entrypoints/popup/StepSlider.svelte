<script lang="ts">
  import { formatCount } from '../../components/format';

  // A slider over a fixed list of round numbers. A saved value that is not
  // one of the steps snaps to the nearest step on the track only; it is
  // rewritten when the viewer moves the slider.
  let {
    value = $bindable(0),
    steps,
    label,
    disabled = false,
  }: { value: number; steps: number[]; label: string; disabled?: boolean } = $props();

  const index = $derived.by(() => {
    let best = 0;
    for (let i = 1; i < steps.length; i++) {
      if (Math.abs(Math.log(steps[i] / value)) < Math.abs(Math.log(steps[best] / value))) best = i;
    }
    return best;
  });
  const fill = $derived((index / (steps.length - 1)) * 100);
</script>

<div class="slider" class:disabled>
  <input
    type="range"
    min="0"
    max={steps.length - 1}
    step="1"
    value={index}
    aria-label={label}
    aria-valuetext={formatCount(steps[index])}
    {disabled}
    style:--fill="{fill}%"
    oninput={(e) => (value = steps[Number((e.currentTarget as HTMLInputElement).value)])}
  />
  <output>{formatCount(value)}</output>
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .slider.disabled {
    opacity: 0.45;
  }
  output {
    min-width: 44px;
    padding: 3px 8px;
    border-radius: 7px;
    background: var(--chip);
    color: var(--fg);
    font: 600 12px/1.3 var(--font);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  input {
    flex: 1;
    height: 22px;
    margin: 0;
    background: transparent;
    appearance: none;
    cursor: pointer;
  }
  input:disabled {
    cursor: default;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--track) var(--fill));
  }
  input::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--track) var(--fill));
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.12),
      0 1px 4px rgba(0, 0, 0, 0.3);
  }
  input::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.12),
      0 1px 4px rgba(0, 0, 0, 0.3);
  }
  input:focus-visible {
    outline: none;
  }
  input:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
