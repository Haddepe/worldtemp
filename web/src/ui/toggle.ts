/** Interrupteur générique (`role="switch"`) : DOM seulement ; l'état initial et l'URL viennent de l'appelant. */
export interface Toggle {
  setOn(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

export function createToggle(button: HTMLButtonElement, onChange: (on: boolean) => void, unavailableTitle: string): Toggle {
  let on = false;
  const idleTitle = button.title;
  // Désactivé = annoncé éteint : un switch grisé resté `aria-checked="true"` ment aux lecteurs d'écran.
  const render = () => button.setAttribute("aria-checked", String(on && !button.disabled));
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
      button.title = disabled ? unavailableTitle : idleTitle;
      render();
    },
  };
}
