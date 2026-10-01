import { onCleanup } from "solid-js";

interface Props {
  /** новая ширина во время drag */
  onResize: (px: number) => void;
  /** финальная ширина после отпускания (сохранение) */
  onCommit: (px: number) => void;
  /** стартовая ширина */
  start: () => number;
  /** left — ширина считается от левого края, right — от правого */
  side: "left" | "right";
  min?: number;
  max?: number;
}

export default function PanelResizer(props: Props) {
  const min = () => props.min ?? 180;
  const max = () => props.max ?? 480;
  const clamp = (px: number) => Math.min(max(), Math.max(min(), px));

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = props.start();
    document.body.classList.add("panel-resizing");

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = props.side === "left" ? startW + dx : startW - dx;
      props.onResize(clamp(w));
    };
    const up = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = props.side === "left" ? startW + dx : startW - dx;
      props.onCommit(clamp(w));
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    onCleanup(() => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    });
  };

  return <div class="panel-resizer" onPointerDown={onPointerDown} />;
}
