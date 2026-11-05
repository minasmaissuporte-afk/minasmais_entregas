import { useLayoutEffect, useRef, useState } from "react";

type PanelLayout = {
  width: number;
  height: number;
  landscape: boolean;
};

export default function useCourierMapPanel() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<PanelLayout>({
    width: 0,
    height: 0,
    landscape: false,
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const landscapeQuery = window.matchMedia(
      "(orientation: landscape) and (max-height: 600px)",
    );
    const measure = () => {
      const { width, height } = panel.getBoundingClientRect();
      const landscape = landscapeQuery.matches;
      setLayout((current) =>
        Math.abs(current.width - width) < 1 &&
        Math.abs(current.height - height) < 1 &&
        current.landscape === landscape
          ? current
          : { width, height, landscape },
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(panel);
    window.addEventListener("resize", measure);
    landscapeQuery.addEventListener("change", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      landscapeQuery.removeEventListener("change", measure);
    };
  }, []);

  return {
    panelRef,
    panelHeight: layout.height,
    landscape: layout.landscape,
    fitPadding: layout.landscape
      ? { top: 24, right: Math.round(layout.width + 24), bottom: 24, left: 24 }
      : { top: 24, right: 24, bottom: Math.round(layout.height + 24), left: 24 },
  };
}
