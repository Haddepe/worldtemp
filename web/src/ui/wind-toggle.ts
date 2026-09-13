/** Interrupteur « Vent » (spec vent §9) : DOM seulement ; l'état initial et l'URL viennent de wind/select.ts. */
export interface WindToggle {
  setOn(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function createWindToggle(button: HTMLButtonElement, onChange: (on: boolean) => void): WindToggle {
  let on = false;
  const render = () => button.setAttribute("aria-checked", String(on));
  button.addEventListener("click", () => {
    if (button.disabled) return;
    on = !on;
    render();
    onChange(on);
  });
  render();
  return {
    setOn(v) {
      on = v;
      render();
    },
    setDisabled(disabled) {
      button.disabled = disabled;
      button.title = disabled ? "Vent indisponible" : "";
    },
  };
}
